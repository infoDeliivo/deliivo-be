import { Response } from 'express';
import { AuthRequest } from '../../types/auth.js';
import { HttpStatus, sendError, sendSuccess } from '../../utils/index.js';
import * as AdminService from './admin.service.js';

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

/* ================= VERIFY VEHICLE ================= */
export const verifyVehicle = async (req: AuthRequest, res: Response) => {
    try {
        const result = await AdminService.verifyVehicle(req.params.id as string);
        return sendSuccess(res, { message: 'Vehicle verified', data: result });
    } catch (error: any) {
        if (error.message === 'VEHICLE_NOT_FOUND')
            return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Vehicle not found' });
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to verify vehicle' });
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
