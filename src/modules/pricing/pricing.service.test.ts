const mockPrisma = {
    ridePricingSnapshot: {
        findUnique: jest.fn(),
        create: jest.fn(),
    },
    pricingConfig: {
        findFirst: jest.fn(),
        create: jest.fn(),
    },
};

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: require('../../test-utils/prisma-mock.js').withPrismaFallback(mockPrisma),
}));

import {
    resolveRideFeeTerms,
    resolveActiveFeeTerms,
    DEFAULT_BALTIC_PRICING_CONFIG,
} from './pricing.service.js';

// Built from the compiled-in default so the two cannot drift: this fixture stands in for the row
// ensureDefaultPricingConfig seeds, which is written from that constant. Tests that care about a
// particular rate pass it as an override.
const activeConfig = (overrides: Record<string, unknown> = {}) => ({
    ...DEFAULT_BALTIC_PRICING_CONFIG,
    id: 'cfg-1',
    active: true,
    validFrom: new Date('2024-01-01'),
    validTo: null,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
});

beforeEach(() => {
    jest.clearAllMocks();
});

describe('resolveRideFeeTerms', () => {
    it('prefers the rate frozen on the ride at publish time', async () => {
        mockPrisma.ridePricingSnapshot.findUnique.mockResolvedValue({
            regionCode: 'BALTIC',
            serviceFeePercent: 2,
            serviceFeeFlat: 0,
        });
        mockPrisma.pricingConfig.findFirst.mockResolvedValue(activeConfig({ serviceFeePercent: 25 }));

        const terms = await resolveRideFeeTerms('ride-1');

        expect(terms).toEqual({ serviceFeePercent: 2, serviceFeeFlat: 0, source: 'SNAPSHOT' });
        // A later admin change must not reprice a ride that was already advertised.
        expect(terms.serviceFeePercent).not.toBe(25);
    });

    it('keeps a ride frozen at a zero fee even after the rate is turned on', async () => {
        mockPrisma.ridePricingSnapshot.findUnique.mockResolvedValue({
            regionCode: 'BALTIC',
            serviceFeePercent: 0,
            serviceFeeFlat: 0,
        });
        mockPrisma.pricingConfig.findFirst.mockResolvedValue(activeConfig({ serviceFeePercent: 2 }));

        const terms = await resolveRideFeeTerms('ride-legacy');

        expect(terms.serviceFeePercent).toBe(0);
        expect(terms.source).toBe('SNAPSHOT');
    });

    it('falls back to the live config when the ride has no snapshot', async () => {
        mockPrisma.ridePricingSnapshot.findUnique.mockResolvedValue(null);
        mockPrisma.pricingConfig.findFirst.mockResolvedValue(activeConfig({ serviceFeePercent: 2, serviceFeeFlat: 0.3 }));

        const terms = await resolveRideFeeTerms('ride-no-snapshot');

        expect(terms).toEqual({ serviceFeePercent: 2, serviceFeeFlat: 0.3, source: 'ACTIVE_CONFIG' });
    });

    it('falls back to the compiled-in default when there is no config at all', async () => {
        mockPrisma.ridePricingSnapshot.findUnique.mockResolvedValue(null);
        mockPrisma.pricingConfig.findFirst.mockResolvedValue(null);
        mockPrisma.pricingConfig.create.mockResolvedValue(activeConfig());

        const terms = await resolveRideFeeTerms('ride-x');

        expect(terms.source).toBe('DEFAULT');
        expect(terms.serviceFeePercent).toBe(DEFAULT_BALTIC_PRICING_CONFIG.serviceFeePercent);
    });

    it('still returns a rate when seeding the default config fails', async () => {
        mockPrisma.ridePricingSnapshot.findUnique.mockResolvedValue(null);
        mockPrisma.pricingConfig.findFirst.mockResolvedValue(null);
        mockPrisma.pricingConfig.create.mockRejectedValue(new Error('DB_DOWN'));

        const terms = await resolveRideFeeTerms('ride-y');

        expect(terms).toEqual({
            serviceFeePercent: DEFAULT_BALTIC_PRICING_CONFIG.serviceFeePercent,
            serviceFeeFlat: DEFAULT_BALTIC_PRICING_CONFIG.serviceFeeFlat,
            source: 'DEFAULT',
        });
    });
});

describe('resolveActiveFeeTerms', () => {
    it('reads the live config, for the publish flow where no ride exists yet', async () => {
        mockPrisma.pricingConfig.findFirst.mockResolvedValue(activeConfig({ serviceFeePercent: 2 }));

        const terms = await resolveActiveFeeTerms();

        expect(terms).toEqual({ serviceFeePercent: 2, serviceFeeFlat: 0, source: 'ACTIVE_CONFIG' });
        expect(mockPrisma.ridePricingSnapshot.findUnique).not.toHaveBeenCalled();
    });

    it('picks up a rate change immediately, unlike a published ride', async () => {
        mockPrisma.pricingConfig.findFirst.mockResolvedValue(activeConfig({ serviceFeePercent: 5 }));

        await expect(resolveActiveFeeTerms()).resolves.toMatchObject({ serviceFeePercent: 5 });
    });
});
