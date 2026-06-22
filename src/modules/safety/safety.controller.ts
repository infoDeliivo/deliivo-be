import { Response } from 'express';
import { AuthRequest } from '../../middlewares/authMiddleware.js';
import { sendError, sendSuccess, HttpStatus } from '../../utils/index.js';
import { createEmergencySos } from './safety.service.js';

export const createSos = async (req: AuthRequest, res: Response) => {
  try {
    const alert = await createEmergencySos(req.user.id, req.body);
    return sendSuccess(res, {
      status: HttpStatus.CREATED,
      message: 'Emergency alert created',
      data: alert,
    });
  } catch (error: any) {
    if (error.message === 'BOOKING_NOT_FOUND') {
      return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Booking not found' });
    }
    if (error.message === 'RIDE_NOT_FOUND') {
      return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Ride not found' });
    }
    if (error.message === 'FORBIDDEN') {
      return sendError(res, { status: HttpStatus.FORBIDDEN, message: 'You are not part of this ride' });
    }
    return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to create emergency alert' });
  }
};
