import { z } from 'zod';
export const updateProfileSchema = z.object({
  bio: z.string().max(150).optional(),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/)
    .optional(),
  gender: z.enum(['MALE', 'FEMALE', 'NON_BINARY', 'OTHER', 'PREFER_NOT_TO_SAY']).optional(),
  dob: z.string().datetime().optional(), // ISO string
  preferences: z
    .object({
      smoking: z.boolean().optional(),
      pets: z.boolean().optional(),
      music: z.boolean().optional(),
    })
    .optional(),
});

export const updateProfileSchemaOnBoarding = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(50, 'Name must be at most 50 characters'),

  salutation: z.enum(['MR', 'MS', 'MRS', 'MX', 'OTHER']),
  gender: z.enum(['MALE', 'FEMALE', 'NON_BINARY', 'OTHER', 'PREFER_NOT_TO_SAY']),

  dob: z.string().refine((val) => !isNaN(Date.parse(val)), 'Date of birth must be a valid date'),
});

export const avatarUploadSchema = z
  .object({
    fieldname: z.literal('image'),
    originalname: z.string(),
    encoding: z.string(),
    mimetype: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    buffer: z.instanceof(Buffer),
    size: z.number().max(5 * 1024 * 1024),
  })
  .strict();

// Full profile update schema with travel preferences
export const fullProfileUpdateSchema = z.object({
  // Basic info
  name: z.string().min(2).max(50).optional(),
  nickName: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers and underscores')
    .optional(),
  salutation: z.enum(['MR', 'MS', 'MRS', 'MX', 'OTHER']).optional(),
  gender: z.enum(['MALE', 'FEMALE', 'NON_BINARY', 'OTHER', 'PREFER_NOT_TO_SAY']).optional(),
  dob: z.string().refine((val) => !isNaN(Date.parse(val)), 'Date of birth must be a valid date').optional(),

  // Travel preferences (inline update)
  travelPreference: z.object({
    chattiness: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
    pets: z.enum(['YES', 'NO', 'SOMETIMES']).optional(),
  }).optional(),
});
