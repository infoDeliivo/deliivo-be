import { z } from 'zod';

const walletTypeSchema = z.enum(['RIDER', 'DRIVER']);

const rewardTriggerSchema = z.enum([
  'RIDER_REFERRAL_BOOKING_COMPLETION',
  'DRIVER_REFERRAL_RIDE_COMPLETION',
  'RIDER_COMPLETION_MILESTONE',
  'DRIVER_COMPLETION_MILESTONE',
  'MANUAL',
]);

export const rewardCampaignUpsertSchema = z.object({
  id: z.string().optional(),
  code: z.string().min(2).max(64),
  name: z.string().min(2).max(120),
  audience: walletTypeSchema,
  triggerType: rewardTriggerSchema,
  thresholdCount: z.number().int().min(1).max(100).optional(),
  rewardAmount: z.number().positive(),
  currency: z.string().length(3).optional(),
  active: z.boolean().optional(),
  repeatable: z.boolean().optional(),
  description: z.string().max(2000).nullable().optional(),
  terms: z.string().max(5000).nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  metadataJson: z.record(z.string(), z.any()).nullable().optional(),
}).strict();

export const rewardGrantSchema = z.object({
  amount: z.number(),
  currency: z.string().length(3).optional(),
  walletType: walletTypeSchema.optional(),
  reason: z.string().min(3).max(500),
  sourceType: z.string().min(1).max(64).optional(),
  sourceId: z.string().min(1).max(128).optional(),
  metadataJson: z.record(z.string(), z.any()).nullable().optional(),
}).strict();
