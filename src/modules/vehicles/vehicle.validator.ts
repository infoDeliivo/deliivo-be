import { VehicleType, DocumentType } from '@prisma/client';
import { z } from 'zod';

/**
 * Shared helpers
 */
const currentYear = new Date().getFullYear();

/**
 * Create Vehicle (initial registration)
 */
export const createVehicleSchema = z
  .object({
    licenseCountry: z.string().trim().min(1, 'License country is required'),
    licenseNumber: z.string().trim().min(1, 'License number is required'),
  })
  .strict();

/**
 * Update full vehicle details
 */
export const updateVehicleDetailsSchema = z
  .object({
    brand: z.string().trim().min(1, 'Brand is required'),
    model_num: z.string().trim().min(1, 'Model No. is required'),
    model_name: z.string().trim().min(1, 'Model name is required'),
    type: z.nativeEnum(VehicleType),
    color: z.string().trim().min(1, 'Color is required'),
    year: z
      .number()
      .int()
      .min(1990, 'Year must be >= 1990')
      .max(currentYear, `Year cannot be greater than ${currentYear}`),
  })
  .strict();

/**
 * Update brand + model only
 */
export const updateBrandModelSchema = z
  .object({
    brand: z.string().trim().min(1, 'Brand is required'),
    model: z.string().trim().min(1, 'Model is required'),
  })
  .strict();

/**
 * Update vehicle type only
 */
export const updateTypeSchema = z
  .object({
    type: z.nativeEnum(VehicleType),
  })
  .strict();

/**
 * Update vehicle color only
 */
export const updateColorSchema = z
  .object({
    color: z.string().trim().min(1, 'Color is required'),
  })
  .strict();

/**
 * Update vehicle year only
 */
export const updateYearSchema = z
  .object({
    year: z
      .number()
      .int()
      .min(1990, 'Year must be >= 1990')
      .max(currentYear, `Year cannot be greater than ${currentYear}`),
  })
  .strict();

/**
 * Image upload validation (S3 / Multer)
 */
export const imageUploadSchema = z
  .object({
    fieldname: z.literal('image'),
    originalname: z.string(),
    encoding: z.string(),
    mimetype: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    buffer: z.instanceof(Buffer),
    size: z.number().max(5 * 1024 * 1024),
  })
  .strict();

/**
 * Get vehicles list query parameters
 */
export const getVehiclesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

/* ================= DRAFT STEP SCHEMAS ================= */

/**
 * Step 1: License info (creates new draft, clears old)
 */
export const draftLicenseSchema = z
  .object({
    licenseCountry: z.string().trim().min(1, 'License country is required'),
    licenseNumber: z.string().trim().min(1, 'License number is required'),
  })
  .strict();

/**
 * Step 2: Vehicle details (brand, model, type, color, year)
 */
export const draftVehicleDetailsSchema = z
  .object({
    brand: z.string().trim().min(1, 'Brand is required'),
    model_num: z.string().trim().min(1, 'Model No. is required'),
    model_name: z.string().trim().min(1, 'Model name is required'),
    type: z.nativeEnum(VehicleType),
    color: z.string().trim().min(1, 'Color is required'),
    year: z
      .number()
      .int()
      .min(1990, 'Year must be >= 1990')
      .max(currentYear, `Year cannot be greater than ${currentYear}`),
  })
  .strict();

/**
 * Step 4: Image URL
 */
export const draftImageSchema = z
  .object({
    imageUrl: z.string().trim().url('Invalid image URL'),
    documentType: z.nativeEnum(DocumentType),
  })
  .strict();
