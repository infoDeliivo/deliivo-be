import { Response } from 'express';
import * as VehicleService from './vehicle.service.js';
import * as DraftVehicleService from './draft-vehicle.service.js';
import { formatDraftResponse } from './draft-vehicle.service.js';
import { AuthRequest } from '../../middlewares/authMiddleware.js';
import { sendSuccess, sendError, HttpStatus } from '../../utils/index.js';
import { uploadToS3 } from '../../services/s3.service.js';
import { getCache, setCache, deleteCache, cacheKeys } from '../../services/cache.service.js';

/* ================= CREATE / UPDATE VEHICLE ================= */
export const createVehicle = async (req: AuthRequest, res: Response) => {
  try {
    const { licenseCountry, licenseNumber } = req.body;
    const vehicleId = req.params.id as string | undefined;

    if (vehicleId) {
      // Update existing vehicle
      const vehicle = await VehicleService.updateCreateVehicle(
        req.user.id,
        vehicleId,
        licenseCountry,
        licenseNumber,
      );

      // Invalidate caches
      await deleteCache(cacheKeys.vehicle(vehicleId));
      await deleteCache(cacheKeys.userVehicles(req.user.id));

      return sendSuccess(res, {
        message: 'Vehicle updated successfully',
        data: { vehicleId: vehicle.id },
      });
    }

    // Create new vehicle
    const vehicle = await VehicleService.createVehicle(req.user.id, licenseCountry, licenseNumber);

    // Invalidate user vehicles list cache
    await deleteCache(cacheKeys.userVehicles(req.user.id));

    return sendSuccess(res, {
      status: HttpStatus.CREATED,
      message: 'Vehicle created successfully',
      data: { vehicleId: vehicle.id },
    });
  } catch (error: any) {
    console.log(error);

    return sendError(res, {
      status:
        error.message === 'MAX_VEHICLE_LIMIT_REACHED'
          ? HttpStatus.CONFLICT
          : error.message === 'VEHICLE_NOT_FOUND'
            ? HttpStatus.NOT_FOUND
            : HttpStatus.INTERNAL_ERROR,
      message:
        error.message === 'MAX_VEHICLE_LIMIT_REACHED'
          ? 'Maximum vehicle limit reached'
          : error.message === 'VEHICLE_NOT_FOUND'
            ? 'Vehicle not found'
            : 'Failed to process vehicle',
    });
  }
};

/* ================= UPDATE VEHICLE DETAILS ================= */
export const updateVehicleDetails = async (req: AuthRequest, res: Response) => {
  try {
    const vehicleId = req.params.id as string;

    await VehicleService.updateVehicleDetailService(req.user.id, vehicleId, {
      brand: req.body.brand,
      model_num: req.body.model_num,
      model_name: req.body.model_name,
      type: req.body.type,
      color: req.body.color,
      year: req.body.year,
    });

    // Invalidate vehicle cache after update
    await deleteCache(cacheKeys.vehicle(vehicleId));

    return sendSuccess(res, {
      message: 'Vehicle details updated successfully',
    });
  } catch (error: any) {
    return sendError(res, {
      status:
        error.message === 'VEHICLE_NOT_FOUND' ? HttpStatus.NOT_FOUND : HttpStatus.INTERNAL_ERROR,
      message:
        error.message === 'VEHICLE_NOT_FOUND' ? 'Vehicle not found' : 'Failed to update vehicle',
    });
  }
};

/* ================= UPLOAD IMAGE AND UPDATE VEHICLE ================= */
export const uploadImage = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return sendError(res, {
        status: HttpStatus.BAD_REQUEST,
        message: 'Image file required',
      });
    }

    const vehicleId = req.params.id as string;
    const uploadResult = await uploadToS3({ folder: 'vehicle', file: req.file });

    if (!uploadResult.success) {
      return sendError(res, {
        status: HttpStatus.INTERNAL_ERROR,
        message: uploadResult.error || 'Failed to upload image',
      });
    }

    const imageUrl = uploadResult.url!;

    const result = await VehicleService.updateVehicle(req.user.id, vehicleId, {
      imageUrl,
    });

    if (!result.success) {
      return sendError(res, {
        status: HttpStatus.NOT_FOUND,
        message: result.message,
      });
    }

    // Invalidate vehicle cache after update
    await deleteCache(cacheKeys.vehicle(vehicleId));

    return sendSuccess(res, {
      message: 'Vehicle image uploaded and updated successfully',
      data: {
        imageUrl,
        vehicle: result.data
      }
    });
  } catch (error) {
    console.error('uploadImage error:', error);
    return sendError(res, {
      message: 'Failed to upload vehicle image',
    });
  }
};

/* ================= UPLOAD IMAGE ONLY (RETURNS URL) ================= */
export const uploadVehicleImageOnly = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return sendError(res, {
        status: HttpStatus.BAD_REQUEST,
        message: 'Image file required',
      });
    }

    // Upload to S3
    const uploadResult = await uploadToS3({
      folder: 'vehicle',
      file: req.file,
    });

    if (!uploadResult.success) {
      return sendError(res, {
        status: HttpStatus.INTERNAL_ERROR,
        message: uploadResult.error || 'Failed to upload image to S3',
      });
    }

    return sendSuccess(res, {
      status: HttpStatus.OK,
      message: 'Image uploaded successfully',
      data: {
        imageUrl: uploadResult.url,
        key: uploadResult.key
      },
    });
  } catch (error) {
    console.error('uploadVehicleImageOnly error:', error);
    return sendError(res, {
      status: HttpStatus.INTERNAL_ERROR,
      message: 'Server error during image upload',
    });
  }
};

/* ================= GET VEHICLE ================= */
export const getVehicle = async (req: AuthRequest, res: Response) => {
  try {
    const vehicleId = req.params.id as string | undefined;
    const page = req.query.page ? Number(req.query.page) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    
    const cacheKey = vehicleId
      ? cacheKeys.vehicle(vehicleId)
      : cacheKeys.userVehicles(req.user.id);

    // Try cache first (only for single vehicle or default list without pagination params)
    if (!page && !limit) {
      const cached = await getCache(cacheKey);
      if (cached) {
        return sendSuccess(res, {
          message: vehicleId ? 'Vehicle fetched successfully' : 'Vehicles fetched successfully',
          data: cached,
        });
      }
    }

    // Cache miss or pagination requested - fetch from DB
    const data = await VehicleService.getVehicle(req.user.id, vehicleId, page, limit);

    // Cache the result (only for non-paginated requests)
    if (!page && !limit) {
      await setCache(cacheKey, data);
    }

    return sendSuccess(res, {
      message: vehicleId ? 'Vehicle fetched successfully' : 'Vehicles fetched successfully',
      data,
    });
  } catch (error: any) {
    return sendError(res, {
      status:
        error.message === 'VEHICLE_NOT_FOUND' ? HttpStatus.NOT_FOUND : HttpStatus.INTERNAL_ERROR,
      message:
        error.message === 'VEHICLE_NOT_FOUND' ? 'Vehicle not found' : 'Failed to fetch vehicle',
    });
  }
};

/* ================= DELETE VEHICLE ================= */
export const deleteVehicle = async (req: AuthRequest, res: Response) => {
  try {
    const vehicleId = req.params.id as string;

    await VehicleService.deleteVehicle(req.user.id, vehicleId);

    // Invalidate vehicle cache after delete
    await deleteCache(cacheKeys.vehicle(vehicleId));
    await deleteCache(cacheKeys.userVehicles(req.user.id));

    return sendSuccess(res, {
      message: 'Vehicle deleted successfully',
    });
  } catch (error: any) {
    return sendError(res, {
      status:
        error.message === 'VEHICLE_NOT_FOUND' ? HttpStatus.NOT_FOUND : HttpStatus.INTERNAL_ERROR,
      message:
        error.message === 'VEHICLE_NOT_FOUND' ? 'Vehicle not found' : 'Failed to delete vehicle',
    });
  }
};

/* ================= DRAFT: STEP 1 — CREATE WITH LICENSE ================= */
export const createDraftWithLicense = async (req: AuthRequest, res: Response) => {
  try {
    const { licenseCountry, licenseNumber } = req.body;

    const draft = await DraftVehicleService.createWithLicense(req.user.id, {
      licenseCountry,
      licenseNumber,
    });

    return sendSuccess(res, {
      status: HttpStatus.CREATED,
      message: 'Vehicle draft created successfully',
      data: formatDraftResponse(draft),
    });
  } catch (error: any) {
    console.error('createDraftWithLicense error:', error);
    return sendError(res, {
      status: HttpStatus.INTERNAL_ERROR,
      message: 'Failed to create vehicle draft',
    });
  }
};

/* ================= DRAFT: STEP 2 — UPDATE VEHICLE DETAILS ================= */
export const updateDraftVehicleDetails = async (req: AuthRequest, res: Response) => {
  try {
    const { brand, model_num, model_name, type, color, year } = req.body;

    const draft = await DraftVehicleService.updateVehicleDetails(req.user.id, {
      brand,
      model_num,
      model_name,
      type,
      color,
      year,
    });

    return sendSuccess(res, {
      message: 'Vehicle details updated in draft',
      data: formatDraftResponse(draft),
    });
  } catch (error: any) {
    return sendError(res, {
      status:
        error.message === 'DRAFT_NOT_FOUND' ? HttpStatus.NOT_FOUND : HttpStatus.INTERNAL_ERROR,
      message:
        error.message === 'DRAFT_NOT_FOUND' ? 'No vehicle draft found' : 'Failed to update draft',
    });
  }
};

/* ================= DRAFT: STEP 3 — UPLOAD DOCUMENT & SAVE TO DRAFT ================= */
export const uploadDraftDocument = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return sendError(res, {
        status: HttpStatus.BAD_REQUEST,
        message: 'Image file required',
      });
    }

    const { documentType } = req.body;
    if (!documentType) {
      return sendError(res, {
        status: HttpStatus.BAD_REQUEST,
        message: 'documentType is required (VEHICLE_IMAGE, VEHICLE_DOCUMENT, DRIVING_LICENSE, INSURANCE_DOCUMENT)',
      });
    }

    // Upload to S3
    const uploadResult = await uploadToS3({
      folder: 'vehicle',
      file: req.file,
    });

    if (!uploadResult.success) {
      return sendError(res, {
        status: HttpStatus.INTERNAL_ERROR,
        message: uploadResult.error || 'Failed to upload image to S3',
      });
    }

    // Save to Redis draft
    const draft = await DraftVehicleService.addDocument(
      req.user.id,
      uploadResult.url!,
      documentType,
    );

    return sendSuccess(res, {
      message: 'Document uploaded and saved to draft',
      data: {
        imageUrl: uploadResult.url,
        documentType,
        draft: formatDraftResponse(draft),
      },
    });
  } catch (error: any) {
    console.error('uploadDraftDocument error:', error);
    return sendError(res, {
      status:
        error.message === 'DRAFT_NOT_FOUND' ? HttpStatus.NOT_FOUND : HttpStatus.INTERNAL_ERROR,
      message:
        error.message === 'DRAFT_NOT_FOUND' ? 'No vehicle draft found' : 'Failed to upload document',
    });
  }
};

/* ================= DRAFT: SAVE — MOVE REDIS → DB ================= */
export const saveVehicleFromDraft = async (req: AuthRequest, res: Response) => {
  try {
    const vehicle = await DraftVehicleService.saveVehicle(req.user.id);

    // Invalidate user vehicles list cache
    await deleteCache(cacheKeys.userVehicles(req.user.id));

    return sendSuccess(res, {
      status: HttpStatus.CREATED,
      message: 'Vehicle saved successfully',
      data: vehicle,
    });
  } catch (error: any) {
    console.error('saveVehicleFromDraft error:', error);

    const statusMap: Record<string, HttpStatus> = {
      DRAFT_NOT_FOUND: HttpStatus.NOT_FOUND,
      USER_NOT_FOUND: HttpStatus.NOT_FOUND,
      LICENSE_REQUIRED: HttpStatus.BAD_REQUEST,
      MAX_VEHICLE_LIMIT_REACHED: HttpStatus.CONFLICT,
    };
    const messageMap: Record<string, string> = {
      DRAFT_NOT_FOUND: 'No vehicle draft found',
      USER_NOT_FOUND: 'User not found — please sign up or log in again',
      LICENSE_REQUIRED: 'License info is required before saving',
      MAX_VEHICLE_LIMIT_REACHED: 'Maximum vehicle limit reached',
    };

    return sendError(res, {
      status: statusMap[error.message] || HttpStatus.INTERNAL_ERROR,
      message: messageMap[error.message] || 'Failed to save vehicle',
    });
  }
};
