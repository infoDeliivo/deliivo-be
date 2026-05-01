import { z } from 'zod';

// ISO date format validator (YYYY-MM-DD)
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

// Gender enum
const genderSchema = z.enum(['M', 'MALE', 'F', 'FEMALE']);

// Consent type enum
const consentTypeSchema = z.enum(['ine', 'bipa', 'aadhaar', 'general', 'dvs']);

// Consent object schema
const consentSchema = z.object({
  type: consentTypeSchema,
  approved: z.boolean(),
});

export const createSessionSchema = z.object({
  // Required fields
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),

  // Optional person fields
  email: z.string().email('Invalid email format').optional(),
  phoneNumber: z.string().min(1).max(20).optional(),
  dateOfBirth: isoDateSchema.optional(),
  gender: genderSchema.optional(),
  idNumber: z.string().min(1).max(50).optional(),
  fullName: z.string().min(1).max(200).optional(),

  // Optional document fields
  documentNumber: z.string().min(1).max(50).optional(),
  documentCountry: z.string().length(2, 'Country code must be 2 characters (ISO 3166-1 Alpha-2)').optional(),
  documentValidFrom: isoDateSchema.optional(),
  documentValidUntil: isoDateSchema.optional(),

  // Optional address fields
  fullAddress: z.string().min(1).max(500).optional(),

  // Optional session configuration
  callback: z.string().url('Invalid callback URL').optional(),
  endUserId: z.string().uuid('Invalid UUID format').optional(),
  consents: z.array(consentSchema).optional(),
  tag: z.string().min(1).max(64, 'Tag must be max 64 characters').optional(),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
