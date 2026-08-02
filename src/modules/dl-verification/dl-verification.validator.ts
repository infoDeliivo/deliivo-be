import { z } from 'zod';

// ISO date format validator (YYYY-MM-DD)
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

// Consent type enum
const consentTypeSchema = z.enum(['ine', 'bipa', 'aadhaar', 'general', 'dvs']);

// Consent object schema
const consentSchema = z.object({
  type: consentTypeSchema,
  approved: z.boolean(),
});

export const createSessionSchema = z.object({
  // Required: this is KYC, so the caller states the identity being verified.
  // createVeriffSession() then rejects anything that is not the caller's own profile name.
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),

  // Optional person fields. Date of birth and gender are not accepted here — they are
  // taken from the profile, which is what the decision webhook enforces the document
  // against, so letting the caller supply them would only invite a mismatch.
  email: z.string().email('Invalid email format').optional(),
  phoneNumber: z.string().min(1).max(20).optional(),
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
  // Veriff rejects non-HTTPS return URLs (error 1302), but a non-HTTPS callback is
  // recoverable: resolveCallbackUrl() in the service drops it and falls back to
  // VERIFF_CALLBACK_URL. Rejecting it here would 400 a request we can still serve.
  callback: z.string().url('Invalid callback URL').optional(),
  endUserId: z.string().uuid('Invalid UUID format').optional(),
  consents: z.array(consentSchema).optional(),
  tag: z.string().min(1).max(64, 'Tag must be max 64 characters').optional(),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;

// Attaches a session the browser SDK created to the caller. `sessionId` is Veriff's
// own verification id — the same value the webhook arrives with.
export const registerSessionSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required').max(100),
  sessionUrl: z
    .string()
    .url('Invalid session URL')
    .refine((value) => value.startsWith('https://'), {
      message: 'Session URL must use HTTPS',
    }),
});

export type RegisterSessionInput = z.infer<typeof registerSessionSchema>;

// The driver's uploaded licence photo, for manual admin review. The value is the
// private S3 key returned by the vehicle_draft_document_private upload target — a
// public URL would defeat the point of storing KYC documents privately.
export const submitDlDocumentSchema = z.object({
  documentImageKey: z
    .string()
    .min(1, 'A document image key is required')
    .max(500)
    .refine((value) => value.startsWith('uploads/vehicle-documents/'), {
      message: 'Document must be uploaded as a private document (uploads/vehicle-documents/…)',
    }),
});

export type SubmitDlDocumentInput = z.infer<typeof submitDlDocumentSchema>;

// Admin decision on a submitted licence.
export const dlUserIdParamSchema = z.object({
  userId: z.string().uuid('A valid user id is required'),
});

export const declineDlSchema = z.object({
  // Shown to the driver verbatim so they know what to re-upload, so it must say something.
  reason: z
    .string()
    .trim()
    .min(1, 'A decline reason is required')
    .max(500, 'Decline reason must be 500 characters or fewer'),
});

export type DeclineDlInput = z.infer<typeof declineDlSchema>;
