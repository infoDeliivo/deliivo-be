import { z } from 'zod';

/**
 * Payouts are single-country, as the driver-facing form states up front. Everything below is
 * validated against that one country: an address or bank account from anywhere else is rejected
 * here rather than by Stripe, so the driver sees a field error instead of a failed submission.
 */
export const connectCountry = (): string => (process.env.STRIPE_CONNECT_COUNTRY || 'EE').toUpperCase();

/** Stripe rejects an account holder younger than this outright. */
const MINIMUM_AGE_YEARS = 13;
/** Anything older is a mistyped year, not a driver. */
const MAXIMUM_AGE_YEARS = 120;

const requiredText = (field: string, max = 200) =>
    z
        .string()
        .trim()
        .min(1, `${field} is required`)
        .max(max, `${field} must be at most ${max} characters`);

const optionalText = (max = 200) =>
    z
        .string()
        .trim()
        .max(max)
        .optional()
        .nullable()
        .transform((value) => (value ? value : null));

/**
 * Stripe requires E.164. The signup form has historically accepted local formats, so the phone is
 * optional here and validated strictly when present — a half-valid number would fail the whole
 * account update.
 */
const phoneSchema = z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/, 'Phone must be in international format, e.g. +37255512345')
    .optional()
    .nullable()
    .transform((value) => (value ? value : null));

const dobSchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be YYYY-MM-DD')
    .superRefine((value, ctx) => {
        const dob = new Date(`${value}T00:00:00.000Z`);
        if (Number.isNaN(dob.getTime()) || value !== dob.toISOString().slice(0, 10)) {
            ctx.addIssue({ code: 'custom', message: 'Date of birth is not a real date' });
            return;
        }

        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);

        const youngest = new Date(today);
        youngest.setUTCFullYear(youngest.getUTCFullYear() - MINIMUM_AGE_YEARS);
        if (dob.getTime() > youngest.getTime()) {
            ctx.addIssue({
                code: 'custom',
                message: `You must be at least ${MINIMUM_AGE_YEARS} years old to receive payouts`,
            });
        }

        const oldest = new Date(today);
        oldest.setUTCFullYear(oldest.getUTCFullYear() - MAXIMUM_AGE_YEARS);
        if (dob.getTime() < oldest.getTime()) {
            ctx.addIssue({ code: 'custom', message: 'Date of birth is not valid' });
        }
    })
    .transform((value) => {
        const [year, month, day] = value.split('-').map(Number);
        return { day, month, year };
    });

const countrySchema = z
    .string()
    .trim()
    .toUpperCase()
    .default(connectCountry())
    .superRefine((value, ctx) => {
        if (value !== connectCountry()) {
            ctx.addIssue({
                code: 'custom',
                message: `Payouts are only supported for ${connectCountry()} accounts`,
            });
        }
    });

export const connectPersonalDetailsSchema = z.object({
    firstName: requiredText('First name', 100),
    lastName: requiredText('Last name', 100),
    email: z.string().trim().email('Enter a valid email address'),
    phone: phoneSchema,
    dob: dobSchema,
    address: z.object({
        line1: requiredText('Address', 300),
        line2: optionalText(300),
        city: requiredText('City', 100),
        postalCode: requiredText('Post code', 20),
        state: optionalText(100),
        country: countrySchema,
    }),
});

/**
 * Only a Stripe.js token is accepted. Raw account numbers are refused outright so bank credentials
 * never reach this server, its logs, or the database.
 */
export const connectBankAccountSchema = z.object({
    token: z
        .string()
        .trim()
        .regex(/^btok_[A-Za-z0-9]+$/, 'Provide a Stripe.js bank account token'),
});

export const connectTermsSchema = z.object({
    accepted: z.literal(true, { message: 'You must accept the terms to receive payouts' }),
});

export type ConnectPersonalDetailsInput = z.infer<typeof connectPersonalDetailsSchema>;
