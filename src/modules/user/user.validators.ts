import { z } from 'zod';
import { isAtLeastAge, MINIMUM_BOOKING_AGE_YEARS } from '../../utils/age.js';

const personNameSchema = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(50, 'Name must be at most 50 characters')
  .regex(/^(?=.*\p{L})[\p{L}\p{M} .'-]+$/u, 'Name must contain letters and cannot be numeric only');

const dobSchema = z
  .string()
  .refine((val) => !isNaN(Date.parse(val)), 'Date of birth must be a valid date')
  .refine((val) => isAtLeastAge(val, MINIMUM_BOOKING_AGE_YEARS), `User must be at least ${MINIMUM_BOOKING_AGE_YEARS} years old`);

export const updateProfileSchema = z.object({
  bio: z.string().max(150).optional(),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/)
    .optional(),
  gender: z.enum(['MALE', 'FEMALE', 'NON_BINARY', 'OTHER', 'PREFER_NOT_TO_SAY']).optional(),
  dob: dobSchema.optional(),
  preferences: z
    .object({
      smoking: z.boolean().optional(),
      pets: z.boolean().optional(),
      music: z.boolean().optional(),
    })
    .optional(),
});

export const updateProfileSchemaOnBoarding = z.object({
  firstName: personNameSchema,
  lastName: personNameSchema,

  salutation: z.enum(['MR', 'MS', 'MRS', 'MX', 'OTHER']),
  gender: z.enum(['MALE', 'FEMALE', 'NON_BINARY', 'OTHER', 'PREFER_NOT_TO_SAY']),

  dob: dobSchema,
});

export const avatarUploadSchema = z
  .object({
    fieldname: z.literal('image'),
    originalname: z.string(),
    encoding: z.string(),
    mimetype: z.enum(['image/jpeg', 'image/png']),
    buffer: z.instanceof(Buffer),
    size: z.number().max(5 * 1024 * 1024),
  })
  .strict();

// Full profile update schema with travel preferences
export const fullProfileUpdateSchema = z.object({
  // Basic info
  firstName: personNameSchema.optional(),
  lastName: personNameSchema.optional(),
  salutation: z.enum(['MR', 'MS', 'MRS', 'MX', 'OTHER']).optional(),
  gender: z.enum(['MALE', 'FEMALE', 'NON_BINARY', 'OTHER', 'PREFER_NOT_TO_SAY']).optional(),
  dob: dobSchema.optional(),

  // Travel preferences (inline update)
  travelPreference: z.object({
    chattiness: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
    pets: z.enum(['YES', 'NO', 'SOMETIMES']).optional(),
  }).optional(),
});

/**
 * Language the user just picked in the switcher. Free-form because the site sends anything from
 * `et` to `ru-RU`; the service decides whether it names a language we support.
 */
export const updateLocaleSchema = z.object({
  locale: z.string().trim().min(1).max(20),
});
