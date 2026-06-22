import { Request, Response } from 'express';
import { getPricePreview, validateAndSnapshotPricing, getActiveConfigs } from './pricing.service.js';

export const pricePreviewHandler = async (req: Request, res: Response) => {
    try {
        const { distanceKm, regionCode } = req.body;
        const result = await getPricePreview({ distanceKm, regionCode });
        res.json({ success: true, data: result });
    } catch (err: any) {
        if (err.message === 'PRICING_CONFIG_NOT_FOUND') {
            return res.status(404).json({ success: false, error: 'No active pricing config for this region' });
        }
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

export const validatePriceHandler = async (req: Request, res: Response) => {
    try {
        const { rideId, distanceKm, selectedPricePerSeat, regionCode } = req.body;
        const result = await validateAndSnapshotPricing({ rideId, distanceKm, selectedPricePerSeat, regionCode });
        if (!result.valid) {
            return res.status(400).json({ success: false, error: result.reason });
        }
        res.json({ success: true, data: result });
    } catch (err: any) {
        if (err.message === 'PRICING_CONFIG_NOT_FOUND') {
            return res.status(404).json({ success: false, error: 'No active pricing config for this region' });
        }
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

export const getConfigsHandler = async (_req: Request, res: Response) => {
    try {
        const configs = await getActiveConfigs();
        res.json({ success: true, data: configs });
    } catch {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};
