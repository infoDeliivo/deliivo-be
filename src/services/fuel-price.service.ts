import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import redis from '../cache/redis.js';
import { logInfo, logError, logWarn } from '../utils/logger.js';

type FuelCountryCode = 'GB' | 'IN' | 'EE';
type FuelCurrency = 'GBP' | 'INR' | 'EUR';

export interface FuelPriceContext {
    countryCode: FuelCountryCode;
    currency: FuelCurrency;
    fuelType: 'PETROL';
    pricePerLiter: number;
    effectiveDate: string | null;
    sourceUrl: string;
    sourceLabel: string;
    isFallback: boolean;
    isCached: boolean;
}

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = Number(process.env.FUEL_PRICE_FETCH_TIMEOUT_MS || 12000);
const CACHE_TTL_SECONDS: Record<FuelCountryCode, number> = {
    GB: 60 * 60 * 12, // 12 hours
    IN: 60 * 60 * 6,  // 6 hours
    EE: 60 * 60 * 12, // 12 hours (Baltic)
};

const UK_SOURCE_PAGE = 'https://www.gov.uk/government/statistics/weekly-road-fuel-prices';
const INDIA_SOURCE_PAGE = 'https://ppac.gov.in/retail-selling-price-rsp-of-petrol-diesel-and-domestic-lpg/rsp-of-petrol-and-diesel-in-metro-cities-since-16-6-2017';

const fallbackFuelPriceByCountry: Record<FuelCountryCode, number> = {
    GB: Number(process.env.FALLBACK_FUEL_PRICE_GB || 1.5),
    IN: Number(process.env.FALLBACK_FUEL_PRICE_IN || 95),
    EE: Number(process.env.FALLBACK_FUEL_PRICE_EE || 1.65),
};

const cacheKey = (countryCode: FuelCountryCode) => `fuel-price:${countryCode}:petrol`;

const isPositiveNumber = (value: number) => Number.isFinite(value) && value > 0;

const round2 = (value: number) => Math.round(value * 100) / 100;

const resolveCountryFromCurrency = (currency?: string): FuelCountryCode => {
    const normalized = (currency || 'EUR').toUpperCase();
    if (normalized === 'INR') return 'IN';
    if (normalized === 'GBP') return 'GB';
    return 'EE'; // EUR → Baltic (Estonia/Latvia/Lithuania)
};

const getCurrencyForCountry = (countryCode: FuelCountryCode): FuelCurrency => {
    if (countryCode === 'IN') return 'INR';
    if (countryCode === 'GB') return 'GBP';
    return 'EUR';
};

const fallbackContext = (countryCode: FuelCountryCode): FuelPriceContext => ({
    countryCode,
    currency: getCurrencyForCountry(countryCode),
    fuelType: 'PETROL',
    pricePerLiter: fallbackFuelPriceByCountry[countryCode],
    effectiveDate: null,
    sourceUrl: '',
    sourceLabel: 'fallback',
    isFallback: true,
    isCached: false,
});

const fetchText = async (url: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<string> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            throw new Error(`HTTP_${response.status}`);
        }
        return await response.text();
    } finally {
        clearTimeout(timeout);
    }
};

const fetchBuffer = async (url: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<Buffer> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            throw new Error(`HTTP_${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    } finally {
        clearTimeout(timeout);
    }
};

const extractUkCsvUrl = (html: string): string => {
    const matches = [
        ...html.matchAll(/https:\/\/assets\.publishing\.service\.gov\.uk\/media\/[^"'\s]+weekly_road_fuel_prices_[^"'\s]+\.csv/g),
    ].map((match) => match[0]);

    if (matches.length === 0) {
        throw new Error('UK_CSV_URL_NOT_FOUND');
    }

    const preferred = matches.find((url) => !url.includes('2003_to_2017'));
    return preferred || matches[0];
};

const parseUkPriceFromCsv = (csv: string): { pricePerLiter: number; effectiveDate: string | null } => {
    const lines = csv
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    if (lines.length < 2) {
        throw new Error('UK_CSV_EMPTY');
    }

    const headers = lines[0].split(',').map((value) => value.trim());
    const petrolColumnIndex = headers.findIndex((header) => /ULSP.*Pump price/i.test(header));

    if (petrolColumnIndex === -1) {
        throw new Error('UK_PETROL_COLUMN_NOT_FOUND');
    }

    const latestRow = lines[lines.length - 1].split(',').map((value) => value.trim());
    const pencePerLiter = Number(latestRow[petrolColumnIndex]);

    if (!isPositiveNumber(pencePerLiter)) {
        throw new Error('UK_PETROL_VALUE_INVALID');
    }

    return {
        pricePerLiter: round2(pencePerLiter / 100),
        effectiveDate: latestRow[0] || null,
    };
};

const extractIndiaCurrentPdfUrl = (html: string): string => {
    const directMatch = html.match(/href="([^"]*DailyPriceMSHSD_Metro[^"]*\.pdf)"/i);
    const currentAnchorMatch = html.match(/href="([^"]+\.pdf)"[^>]*>\s*Current\s*<\/a>/i);
    const relativeOrAbsolute = directMatch?.[1] || currentAnchorMatch?.[1];

    if (!relativeOrAbsolute) {
        throw new Error('INDIA_CURRENT_PDF_URL_NOT_FOUND');
    }

    return new URL(relativeOrAbsolute, 'https://ppac.gov.in').toString();
};

const extractTextFromPdfWithPdftotext = async (pdfBytes: Buffer): Promise<string> => {
    const tempPath = join(tmpdir(), `ppac-fuel-${randomUUID()}.pdf`);

    try {
        await writeFile(tempPath, pdfBytes);
        const { stdout } = await execFileAsync('pdftotext', [tempPath, '-']);
        return stdout || '';
    } finally {
        await rm(tempPath, { force: true });
    }
};

const extractMetroPetrolPrices = (pdfText: string): number[] => {
    const lines = pdfText.split(/\r?\n/).map((line) => line.trim());
    const runs: number[][] = [];
    let currentRun: number[] = [];

    for (const line of lines) {
        if (/^\d+(?:\.\d+)?$/.test(line)) {
            currentRun.push(Number(line));
            continue;
        }

        if (currentRun.length > 0) {
            runs.push(currentRun);
            currentRun = [];
            if (runs.length >= 8) break;
        }
    }

    if (currentRun.length > 0 && runs.length < 8) {
        runs.push(currentRun);
    }

    if (runs.length < 4) {
        throw new Error('INDIA_PDF_PRICE_BLOCKS_NOT_FOUND');
    }

    const firstFourMetroPrices = runs.slice(0, 4).map((run) => run[0]);
    if (firstFourMetroPrices.some((price) => !isPositiveNumber(price))) {
        throw new Error('INDIA_PDF_PRICE_VALUES_INVALID');
    }

    return firstFourMetroPrices;
};

const parseIndiaEffectiveDate = (pdfText: string): string | null => {
    const match = pdfText.match(/Table Posted:\s*([0-9]{1,2}-[A-Za-z]{3}-[0-9]{2})/i);
    return match?.[1] || null;
};

const fetchUkFuelPrice = async (): Promise<FuelPriceContext> => {
    const sourcePageHtml = await fetchText(UK_SOURCE_PAGE);
    const csvUrl = extractUkCsvUrl(sourcePageHtml);
    const csvText = await fetchText(csvUrl);
    const parsed = parseUkPriceFromCsv(csvText);

    return {
        countryCode: 'GB',
        currency: 'GBP',
        fuelType: 'PETROL',
        pricePerLiter: parsed.pricePerLiter,
        effectiveDate: parsed.effectiveDate,
        sourceUrl: csvUrl,
        sourceLabel: 'gov-uk-weekly-road-fuel-prices',
        isFallback: false,
        isCached: false,
    };
};

const fetchIndiaFuelPrice = async (): Promise<FuelPriceContext> => {
    const sourcePageHtml = await fetchText(INDIA_SOURCE_PAGE);
    const currentPdfUrl = extractIndiaCurrentPdfUrl(sourcePageHtml);
    const pdfBytes = await fetchBuffer(currentPdfUrl);
    const pdfText = await extractTextFromPdfWithPdftotext(pdfBytes);
    const petrolMetroPrices = extractMetroPetrolPrices(pdfText);
    const avgPetrolPrice = petrolMetroPrices.reduce((sum, price) => sum + price, 0) / petrolMetroPrices.length;

    return {
        countryCode: 'IN',
        currency: 'INR',
        fuelType: 'PETROL',
        pricePerLiter: round2(avgPetrolPrice),
        effectiveDate: parseIndiaEffectiveDate(pdfText),
        sourceUrl: currentPdfUrl,
        sourceLabel: 'ppac-metro-rsp-pdf',
        isFallback: false,
        isCached: false,
    };
};

const fetchLiveFuelPriceByCountry = async (countryCode: FuelCountryCode): Promise<FuelPriceContext> => {
    if (countryCode === 'IN') {
        return fetchIndiaFuelPrice();
    }
    if (countryCode === 'EE') {
        // Baltic region: no live scraper yet, use fallback directly
        return fallbackContext('EE');
    }
    return fetchUkFuelPrice();
};

const readFromCache = async (countryCode: FuelCountryCode): Promise<FuelPriceContext | null> => {
    try {
        const raw = await redis.get(cacheKey(countryCode));
        if (!raw) return null;

        const parsed = JSON.parse(raw) as FuelPriceContext;
        if (!isPositiveNumber(parsed.pricePerLiter)) {
            return null;
        }

        return {
            ...parsed,
            isCached: true,
        };
    } catch {
        return null;
    }
};

const writeToCache = async (context: FuelPriceContext): Promise<void> => {
    try {
        await redis.setex(
            cacheKey(context.countryCode),
            CACHE_TTL_SECONDS[context.countryCode],
            JSON.stringify({
                ...context,
                isCached: false,
            })
        );
    } catch {
        // Best-effort cache; ignore cache write failures.
    }
};

export const getFuelPriceForCurrency = async (currency?: string): Promise<FuelPriceContext> => {
    const countryCode = resolveCountryFromCurrency(currency);
    const cached = await readFromCache(countryCode);
    if (cached) return cached;

    try {
        const live = await fetchLiveFuelPriceByCountry(countryCode);
        await writeToCache(live);
        return live;
    } catch (error) {
        const fallback = fallbackContext(countryCode);
        logWarn('Fuel price live fetch failed, using fallback', {
            countryCode,
            error: error instanceof Error ? error.message : String(error),
        });
        return fallback;
    }
};

/**
 * Proactively refresh fuel price for a country and store in cache.
 * Used by the weekly cron job.
 */
export const refreshFuelPrice = async (countryCode: FuelCountryCode = 'GB'): Promise<FuelPriceContext> => {
    try {
        const live = await fetchLiveFuelPriceByCountry(countryCode);
        await writeToCache(live);
        logInfo('Fuel price refreshed', { countryCode, price: live.pricePerLiter, currency: live.currency });
        return live;
    } catch (error) {
        logError('Fuel price refresh failed', undefined, {
            countryCode,
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
};

/**
 * Get the current fuel price (cached or live) for debugging / API endpoint.
 */
export const getCurrentFuelPrice = async (currency?: string): Promise<FuelPriceContext> => {
    return getFuelPriceForCurrency(currency);
};

