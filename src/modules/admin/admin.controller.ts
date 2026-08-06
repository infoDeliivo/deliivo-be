import { Response } from 'express';
import { VehicleVerificationStatus } from '@prisma/client';
import { AuthRequest } from '../../types/auth.js';
import { HttpStatus, sendError, sendSuccess } from '../../utils/index.js';
import { logError } from '../../utils/logger.js';
import * as AdminService from './admin.service.js';
import { createPricingConfig as createPricingConfigService, listPricingConfigs as listPricingConfigsService, updatePricingConfig as updatePricingConfigService } from '../pricing/pricing.service.js';

/* ================= LIST USERS ================= */
export const listUsers = async (req: AuthRequest, res: Response) => {
    try {
        const result = await AdminService.listUsers({
            page: req.query.page ? Number(req.query.page) : undefined,
            limit: req.query.limit ? Number(req.query.limit) : undefined,
            search: req.query.search as string | undefined,
            isBanned: req.query.isBanned !== undefined ? req.query.isBanned === 'true' : undefined,
            role: req.query.role as string | undefined,
            dlVerified: req.query.dlVerified !== undefined ? req.query.dlVerified === 'true' : undefined,
        });
        return sendSuccess(res, { message: 'Users fetched', data: result });
    } catch {
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to fetch users' });
    }
};

/* ================= BAN USER ================= */
export const banUser = async (req: AuthRequest, res: Response) => {
    try {
        const result = await AdminService.setBanStatus(req.params.id as string, true);
        return sendSuccess(res, { message: 'User banned', data: result });
    } catch (error: any) {
        if (error.message === 'USER_NOT_FOUND')
            return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'User not found' });
        if (error.message === 'CANNOT_BAN_ADMIN')
            return sendError(res, { status: HttpStatus.FORBIDDEN, message: 'Cannot ban an admin account' });
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to ban user' });
    }
};

/* ================= UNBAN USER ================= */
export const unbanUser = async (req: AuthRequest, res: Response) => {
    try {
        const result = await AdminService.setBanStatus(req.params.id as string, false);
        return sendSuccess(res, { message: 'User unbanned', data: result });
    } catch (error: any) {
        if (error.message === 'USER_NOT_FOUND')
            return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'User not found' });
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to unban user' });
    }
};

/* ================= STATS ================= */
export const getStats = async (req: AuthRequest, res: Response) => {
    try {
        const result = await AdminService.getStats();
        return sendSuccess(res, { message: 'Stats fetched', data: result });
    } catch {
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to fetch stats' });
    }
};

export const getMonitoringTrends = async (_req: AuthRequest, res: Response) => {
    try {
        const result = await AdminService.getMonitoringTrends();
        return sendSuccess(res, { message: 'Monitoring trends fetched', data: result });
    } catch {
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to fetch monitoring trends' });
    }
};

/* ================= RIDE HISTORY ================= */
export const listRides = async (req: AuthRequest, res: Response) => {
    try {
        const result = await AdminService.listRides({
            page: req.query.page ? Number(req.query.page) : undefined,
            limit: req.query.limit ? Number(req.query.limit) : undefined,
            status: req.query.status as string | undefined,
            search: req.query.search as string | undefined,
            searchBy: req.query.searchBy as string | undefined,
        });
        return sendSuccess(res, { message: 'Rides fetched', data: result });
    } catch {
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to fetch rides' });
    }
};

export const getOperationsSummary = async (req: AuthRequest, res: Response) => {
    try {
        const result = await AdminService.getOperationsSummary();
        return sendSuccess(res, { message: 'Operations summary fetched', data: result });
    } catch {
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to fetch operations summary' });
    }
};

/* ================= REVENUE LEDGER ================= */
export const getRevenueLedger = async (req: AuthRequest, res: Response) => {
    try {
        const result = await AdminService.getRevenueLedger({
            page: req.query.page ? Number(req.query.page) : undefined,
            limit: req.query.limit ? Number(req.query.limit) : undefined,
            accountType: req.query.accountType as string | undefined,
        });
        return sendSuccess(res, { message: 'Revenue ledger fetched', data: result });
    } catch {
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to fetch revenue ledger' });
    }
};

/* ================= EMERGENCY SOS ================= */
export const listEmergencyAlerts = async (req: AuthRequest, res: Response) => {
    try {
        const result = await AdminService.listEmergencyAlerts({
            page: req.query.page ? Number(req.query.page) : undefined,
            limit: req.query.limit ? Number(req.query.limit) : undefined,
            status: req.query.status as string | undefined,
        });
        return sendSuccess(res, { message: 'Emergency alerts fetched', data: result });
    } catch {
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to fetch emergency alerts' });
    }
};

export const updateEmergencyAlertStatus = async (req: AuthRequest, res: Response) => {
    try {
        const status = req.body?.status;
        if (!['ACKNOWLEDGED', 'RESOLVED', 'FALSE_ALARM'].includes(status)) {
            return sendError(res, { status: HttpStatus.BAD_REQUEST, message: 'Invalid alert status' });
        }
        const result = await AdminService.updateEmergencyAlertStatus(req.params.id as string, req.user.id, status);
        return sendSuccess(res, { message: 'Emergency alert updated', data: result });
    } catch (error: any) {
        if (error.message === 'ALERT_NOT_FOUND') {
            return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Emergency alert not found' });
        }
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to update emergency alert' });
    }
};

/* ================= LIST VEHICLES (REVIEW QUEUE) ================= */
export const listVehicles = async (req: AuthRequest, res: Response) => {
    try {
        const statusParam = typeof req.query.status === 'string'
            ? req.query.status.toUpperCase()
            : undefined;
        const status = statusParam && statusParam in VehicleVerificationStatus
            ? (statusParam as VehicleVerificationStatus)
            : undefined;

        const result = await AdminService.listVehicles({
            page: req.query.page ? Number(req.query.page) : undefined,
            limit: req.query.limit ? Number(req.query.limit) : undefined,
            status,
        });
        return sendSuccess(res, { message: 'Vehicles fetched', data: result });
    } catch (error) {
        logError('[ADMIN] list vehicles failed', error);
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to fetch vehicles' });
    }
};

/* ================= VERIFY VEHICLE ================= */
export const verifyVehicle = async (req: AuthRequest, res: Response) => {
    try {
        const result = await AdminService.verifyVehicle(req.params.id as string, req.user?.id);
        return sendSuccess(res, { message: 'Vehicle verified', data: result });
    } catch (error: any) {
        if (error.message === 'VEHICLE_NOT_FOUND')
            return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Vehicle not found' });
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to verify vehicle' });
    }
};

/* ================= REJECT VEHICLE ================= */
export const rejectVehicle = async (req: AuthRequest, res: Response) => {
    try {
        const { reason } = req.body as { reason: string };
        const result = await AdminService.rejectVehicle(
            req.params.id as string,
            reason,
            req.user?.id,
        );
        return sendSuccess(res, { message: 'Vehicle rejected', data: result });
    } catch (error: any) {
        if (error.message === 'VEHICLE_NOT_FOUND')
            return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Vehicle not found' });
        logError('[ADMIN] reject vehicle failed', error);
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to reject vehicle' });
    }
};

/* ================= ADMIN REFUND BOOKING ================= */
export const adminRefundBooking = async (req: AuthRequest, res: Response) => {
    try {
        const result = await AdminService.adminRefundBooking(req.params.id as string);
        return sendSuccess(res, { message: 'Booking refunded', data: result });
    } catch (error: any) {
        switch (error.message) {
            case 'BOOKING_NOT_FOUND':
                return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Booking not found' });
            case 'ALREADY_REFUNDED':
                return sendError(res, { status: HttpStatus.CONFLICT, message: 'Booking already refunded' });
            case 'NO_PAYMENT_TO_REFUND':
                return sendError(res, { status: HttpStatus.BAD_REQUEST, message: 'No captured payment to refund' });
            default:
                return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to refund booking' });
        }
    }
};

export const adminForceCompleteBooking = async (req: AuthRequest, res: Response) => {
    try {
        const result = await AdminService.adminForceCompleteBooking(
            req.params.id as string,
            req.user.id,
            req.body.reason,
        );
        return sendSuccess(res, { message: 'Booking force-completed', data: result });
    } catch (error: any) {
        switch (error.message) {
            case 'BOOKING_NOT_FOUND':
                return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Booking not found' });
            case 'BOOKING_NOT_FORCE_COMPLETABLE':
                return sendError(res, { status: HttpStatus.CONFLICT, message: 'Booking is not in a force-completable state' });
            case 'RIDE_NOT_FORCE_COMPLETABLE':
                return sendError(res, { status: HttpStatus.CONFLICT, message: 'Ride is not in a force-completable state' });
            case 'OPEN_DISPUTE_EXISTS':
                return sendError(res, { status: HttpStatus.CONFLICT, message: 'Resolve the open dispute before force-completing this booking' });
            default:
                logError('[ADMIN] force-complete booking failed', error);
                return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to force-complete booking' });
        }
    }
};

export const adminOpenBookingDispute = async (req: AuthRequest, res: Response) => {
    try {
        const result = await AdminService.adminOpenBookingDispute(
            req.params.id as string,
            req.user.id,
            req.body.reason,
            req.body.description,
        );
        return sendSuccess(res, {
            status: result.created ? HttpStatus.CREATED : HttpStatus.OK,
            message: result.created ? 'Dispute opened' : 'Open dispute already exists',
            data: result,
        });
    } catch (error: any) {
        switch (error.message) {
            case 'BOOKING_NOT_FOUND':
                return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Booking not found' });
            case 'BOOKING_ALREADY_TERMINAL':
                return sendError(res, { status: HttpStatus.CONFLICT, message: 'Booking is already terminal' });
            default:
                logError('[ADMIN] open booking dispute failed', error);
                return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to open dispute' });
        }
    }
};

/* ================= PRICING CONFIGURATION ================= */
export const listPricingConfigs = async (_req: AuthRequest, res: Response) => {
    try {
        const configs = await listPricingConfigsService();
        return sendSuccess(res, { message: 'Pricing configs fetched', data: configs });
    } catch {
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to fetch pricing configs' });
    }
};

export const createPricingConfig = async (req: AuthRequest, res: Response) => {
    try {
        const result = await createPricingConfigService({
            regionCode: req.body.regionCode,
            currency: req.body.currency,
            minRatePerKm: req.body.minRatePerKm,
            recommendedRatePerKm: req.body.recommendedRatePerKm,
            maxRatePerKm: req.body.maxRatePerKm,
            minimumSeatPrice: req.body.minimumSeatPrice,
            roundingStrategy: req.body.roundingStrategy,
            active: req.body.active,
            validFrom: req.body.validFrom,
            validTo: req.body.validTo ?? null,
            createdBy: req.user.id,
        });
        return sendSuccess(res, { status: HttpStatus.CREATED, message: 'Pricing config created', data: result });
    } catch (error: any) {
        if (error.message === 'PRICING_CONFIG_NOT_FOUND') {
            return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Pricing config not found' });
        }
        if (error.message === 'INVALID_PRICING_CONFIG') {
            return sendError(res, { status: HttpStatus.BAD_REQUEST, message: 'Invalid pricing thresholds' });
        }
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to create pricing config' });
    }
};

export const updatePricingConfig = async (req: AuthRequest, res: Response) => {
    try {
        const result = await updatePricingConfigService(req.params.id as string, {
            regionCode: req.body.regionCode,
            currency: req.body.currency,
            minRatePerKm: req.body.minRatePerKm,
            recommendedRatePerKm: req.body.recommendedRatePerKm,
            maxRatePerKm: req.body.maxRatePerKm,
            minimumSeatPrice: req.body.minimumSeatPrice,
            roundingStrategy: req.body.roundingStrategy,
            active: req.body.active,
            validFrom: req.body.validFrom,
            validTo: req.body.validTo ?? undefined,
            createdBy: req.user.id,
        });
        return sendSuccess(res, { message: 'Pricing config updated', data: result });
    } catch (error: any) {
        if (error.message === 'PRICING_CONFIG_NOT_FOUND') {
            return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Pricing config not found' });
        }
        if (error.message === 'INVALID_PRICING_CONFIG') {
            return sendError(res, { status: HttpStatus.BAD_REQUEST, message: 'Invalid pricing thresholds' });
        }
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to update pricing config' });
    }
};
