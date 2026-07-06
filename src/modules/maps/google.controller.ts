import { Request, Response } from 'express';
import { googleService } from './google.service.js';
import { sendSuccess, sendError, HttpStatus } from '../../utils/index.js';

export const googleController = {
  /* ================= ROUTES ================= */
  async autocomplete(req: Request, res: Response) {
    try {
      const { input, lat, lng, radius, types, strictBounds } = req.query as any;
      const location = lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng) } : undefined;

      const predictions = await googleService.autocomplete(
        input,
        location,
        radius ? parseInt(radius) : undefined,
        types || undefined,
        strictBounds === undefined ? undefined : strictBounds === 'true',
      );

      // Return only name, description, and placeId
      const formatted = predictions.map((p: any) => ({
        description: p.description,
        placeId: p.place_id,
      }));

      return sendSuccess(res, {
        status: HttpStatus.OK,
        message: 'Autocomplete fetched successfully',
        data: formatted,
      });
    } catch (err: any) {
      return sendError(res, {
        status: err.status || HttpStatus.INTERNAL_ERROR,
        message: err.message || 'Autocomplete failed',
        error: err,
      });
    }
  },

  // Fetch full place details
  async placeDetails(req: Request, res: Response) {
    try {
      const { placeId } = req.query as any;
      const details = await googleService.placeDetails(placeId);

      return sendSuccess(res, {
        status: HttpStatus.OK,
        message: 'Place details fetched successfully',
        data: {
          name: details.name,
          address: details.formatted_address,
          location: details.geometry.location,
        },
      });
    } catch (err: any) {
      return sendError(res, {
        status: err.status || HttpStatus.INTERNAL_ERROR,
        message: err.message || 'Place details failed',
        error: err,
      });
    }
  },
  async routes(req: Request, res: Response) {
    try {
      const data = await googleService.computeRoute(req.body);

      return sendSuccess(res, {
        status: HttpStatus.OK,
        message: 'Route computed successfully',
        data,
      });
    } catch (err: any) {
      return sendError(res, {
        status: err.status || HttpStatus.INTERNAL_ERROR,
        message: err.message || 'Failed to compute route',
        error: err,
      });
    }
  },

  /* ================= MULTI ROUTES ================= */
  async multiRoute(req: Request, res: Response) {
    try {
      const data = await googleService.computeMultiRoute(req.body);

      return sendSuccess(res, {
        status: HttpStatus.OK,
        message: 'Multiple routes fetched successfully',
        data,
      });
    } catch (err: any) {
      return sendError(res, {
        status: err.status || HttpStatus.INTERNAL_ERROR,
        message: err.message || 'Failed to fetch routes',
        error: err,
      });
    }
  },

  /* ================= ROADS ================= */
  async roads(req: Request, res: Response) {
    try {
      const data = await googleService.snapToRoads(req.body);

      return sendSuccess(res, {
        status: HttpStatus.OK,
        message: 'Points snapped to roads successfully',
        data,
      });
    } catch (err: any) {
      return sendError(res, {
        status: err.status || HttpStatus.INTERNAL_ERROR,
        message: err.message || 'Snap to roads failed',
        error: err,
      });
    }
  },

  /* ================= GEOLOCATION ================= */
  async geolocation(req: Request, res: Response) {
    try {
      const data = await googleService.geolocate(req.body);

      return sendSuccess(res, {
        status: HttpStatus.OK,
        message: 'Geolocation successful',
        data,
      });
    } catch (err: any) {
      return sendError(res, {
        status: err.status || HttpStatus.INTERNAL_ERROR,
        message: err.message || 'Geolocation failed',
        error: err,
      });
    }
  },
};
