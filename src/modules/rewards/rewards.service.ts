import { randomUUID } from 'crypto';
import { createHash, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/index.js';
import { createNotification } from '../notification/notification.service.js';
import { sendMail } from '../mail/mail.service.js';

const DEFAULT_CURRENCY = 'EUR';

export const REWARD_TRIGGERS = {
  RIDER_REFERRAL_BOOKING_COMPLETION: 'RIDER_REFERRAL_BOOKING_COMPLETION',
  DRIVER_REFERRAL_RIDE_COMPLETION: 'DRIVER_REFERRAL_RIDE_COMPLETION',
  RIDER_COMPLETION_MILESTONE: 'RIDER_COMPLETION_MILESTONE',
  DRIVER_COMPLETION_MILESTONE: 'DRIVER_COMPLETION_MILESTONE',
  MANUAL: 'MANUAL',
} as const;

export const REWARD_AUDIENCES = {
  RIDER: 'RIDER',
  DRIVER: 'DRIVER',
} as const;

const activeCampaignWhere = (triggerType: string, audience: string, now: Date) => ({
  triggerType,
  audience,
  active: true,
  AND: [
    { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
    { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
  ],
});

const generateReferralCode = () => `DLV-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;

const normalizeWalletType = (value?: string | null) => {
  const walletType = (value || '').toUpperCase();
  return walletType === REWARD_AUDIENCES.DRIVER ? REWARD_AUDIENCES.DRIVER : REWARD_AUDIENCES.RIDER;
};

const normalizeCurrency = (currency?: string | null) => {
  const value = (currency || DEFAULT_CURRENCY).trim().toUpperCase();
  return value.length === 3 ? value : DEFAULT_CURRENCY;
};

const walletDirection = (amount: number) => (amount >= 0 ? 'CREDIT' : 'DEBIT');

const stringifyForHash = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return `[${value.map(stringifyForHash).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${key}:${stringifyForHash(entryValue)}`)
      .join('|')}}`;
  }
  return String(value);
};

const computeRewardEntryHash = (input: {
  previousHash: string | null;
  userId: string;
  walletType: string;
  entryType: string;
  direction: string;
  amount: number;
  currency: string;
  sourceType: string;
  sourceId: string;
  campaignId?: string | null;
  referralId?: string | null;
  description?: string | null;
  metadataJson?: Prisma.InputJsonValue | null;
  reversalOfEntryId?: string | null;
  createdById?: string | null;
  idempotencyKey: string;
}) => {
  const payload = [
    input.previousHash || '',
    input.userId,
    input.walletType,
    input.entryType,
    input.direction,
    input.amount.toFixed(2),
    input.currency,
    input.sourceType,
    input.sourceId,
    input.campaignId || '',
    input.referralId || '',
    input.description || '',
    stringifyForHash(input.metadataJson ?? null),
    input.reversalOfEntryId || '',
    input.createdById || '',
    input.idempotencyKey,
  ].join('|');
  return createHash('sha256').update(payload).digest('hex');
};

const firstActiveCampaign = async (triggerType: string, audience: string) => {
  const now = new Date();
  return prisma.rewardCampaign.findFirst({
    where: activeCampaignWhere(triggerType, audience, now),
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
  });
};

const visibleCampaignWhere = () => {
  const now = new Date();
  return {
    active: true,
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
    ],
  };
};

const shouldGrantCampaignAtCount = (campaign: { thresholdCount: number; repeatable: boolean }, occurrenceCount: number) => {
  const threshold = Math.max(1, campaign.thresholdCount || 1);
  return campaign.repeatable ? occurrenceCount % threshold === 0 : occurrenceCount === threshold;
};

const ensureReferralCodeInternal = async (tx: Prisma.TransactionClient, userId: string) => {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, referralCode: true },
  });
  if (!user) throw new Error('USER_NOT_FOUND');
  if (user.referralCode) return user.referralCode;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const referralCode = generateReferralCode();
    try {
      await tx.user.update({
        where: { id: userId },
        data: { referralCode },
      });
      return referralCode;
    } catch (error: any) {
      if (String(error?.code) !== 'P2002') throw error;
    }
  }

  throw new Error('REFERRAL_CODE_GENERATION_FAILED');
};

const walletTotals = (entries: Array<{ walletType: string; currency: string; direction: string; amount: number }>) => {
  const totals = new Map<string, { walletType: string; currency: string; balance: number; credited: number; debited: number }>();

  for (const entry of entries) {
    const key = `${entry.walletType}:${entry.currency}`;
    const current = totals.get(key) ?? {
      walletType: entry.walletType,
      currency: entry.currency,
      balance: 0,
      credited: 0,
      debited: 0,
    };
    if (entry.direction === 'DEBIT') {
      current.balance -= entry.amount;
      current.debited += entry.amount;
    } else {
      current.balance += entry.amount;
      current.credited += entry.amount;
    }
    totals.set(key, current);
  }

  return [...totals.values()].sort((left, right) =>
    left.walletType.localeCompare(right.walletType) || left.currency.localeCompare(right.currency)
  );
};

const loadWalletEntries = async (userId: string) => {
  return prisma.rewardWalletEntry.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: {
      campaign: true,
      referral: {
        include: {
          referrer: { select: { id: true, firstName: true, lastName: true, email: true } },
          referred: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      },
    },
  });
};

const loadLatestRewardEntry = async (userId: string, walletType: string) => {
  return prisma.rewardWalletEntry.findFirst({
    where: { userId, walletType },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { entryHash: true },
  });
};

const verifyRewardLedgerChain = async (userId: string) => {
  const entries = await prisma.rewardWalletEntry.findMany({
    where: { userId },
    orderBy: [{ walletType: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      userId: true,
      walletType: true,
      entryType: true,
      direction: true,
      amount: true,
      currency: true,
      sourceType: true,
      sourceId: true,
      campaignId: true,
      referralId: true,
      description: true,
      metadataJson: true,
      reversalOfEntryId: true,
      createdById: true,
      idempotencyKey: true,
      previousHash: true,
      entryHash: true,
    },
  });

  const chainByWallet = new Map<string, string | null>();
  for (const entry of entries) {
    if (!entry.entryHash || !entry.previousHash) {
      continue;
    }
    const walletKey = `${entry.userId}:${entry.walletType}`;
    const expectedPrevious = chainByWallet.get(walletKey) ?? null;
    const expectedHash = computeRewardEntryHash({
      previousHash: expectedPrevious,
      userId: entry.userId,
      walletType: entry.walletType,
      entryType: entry.entryType,
      direction: entry.direction,
      amount: entry.amount,
      currency: entry.currency,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      campaignId: entry.campaignId,
      referralId: entry.referralId,
      description: entry.description,
      metadataJson: entry.metadataJson as Prisma.InputJsonValue | null,
      reversalOfEntryId: entry.reversalOfEntryId,
      createdById: entry.createdById,
      idempotencyKey: entry.idempotencyKey,
    });

    if (entry.previousHash !== expectedPrevious || entry.entryHash !== expectedHash) {
      return { ok: false as const, brokenEntryId: entry.id };
    }

    chainByWallet.set(walletKey, entry.entryHash ?? null);
  }

  return { ok: true as const, brokenEntryId: null };
};

const ensureReferralRecord = async (
  tx: Prisma.TransactionClient,
  referredUserId: string,
  referrerUserId: string,
  referralCode?: string | null,
) => {
  return tx.rewardReferral.upsert({
    where: { referredUserId },
    update: {
      referrerUserId,
      ...(referralCode ? { referralCode } : {}),
    },
    create: {
      referrerUserId,
      referredUserId,
      ...(referralCode ? { referralCode } : {}),
    },
  });
};

export const ensureUserReferralCode = async (userId: string) => {
  return prisma.$transaction((tx) => ensureReferralCodeInternal(tx, userId));
};

export const attachReferralCodeToUser = async (userId: string, referralCode: string) => {
  const normalized = referralCode.trim().toUpperCase();
  if (!normalized) throw new Error('REFERRAL_CODE_REQUIRED');

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, referredByUserId: true },
    });
    if (!user) throw new Error('USER_NOT_FOUND');
    if (user.referredByUserId) {
      return { attached: false, reason: 'REFERRAL_ALREADY_SET' as const };
    }

    const referrer = await tx.user.findFirst({
      where: { referralCode: normalized },
      select: { id: true },
    });
    if (!referrer) {
      return { attached: false, reason: 'REFERRER_NOT_FOUND' as const };
    }
    if (referrer.id === userId) {
      return { attached: false, reason: 'REFERRAL_SELF' as const };
    }

    await tx.user.update({
      where: { id: userId },
      data: { referredByUserId: referrer.id },
    });
    const referral = await ensureReferralRecord(tx, userId, referrer.id, normalized);
    return { attached: true, referral };
  });
};

export const getRewardWallet = async (userId: string) => {
  const [user, entries, campaigns] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, referralCode: true, referredByUserId: true },
    }),
    loadWalletEntries(userId),
    prisma.rewardCampaign.findMany({
      where: visibleCampaignWhere(),
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    }),
  ]);

  if (!user) throw new Error('USER_NOT_FOUND');

  return {
    userId: user.id,
    referralCode: user.referralCode ?? (await ensureUserReferralCode(user.id)),
    referredByUserId: user.referredByUserId,
    totals: walletTotals(entries),
    campaigns,
    ledgerIntegrity: await verifyRewardLedgerChain(user.id),
    history: entries.map((entry) => ({
      id: entry.id,
      walletType: entry.walletType,
      entryType: entry.entryType,
      direction: entry.direction,
      amount: entry.amount,
      currency: entry.currency,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      description: entry.description,
      previousHash: entry.previousHash,
      entryHash: entry.entryHash,
      reversalOfEntryId: entry.reversalOfEntryId,
      campaign: entry.campaign
        ? {
            id: entry.campaign.id,
            code: entry.campaign.code,
            name: entry.campaign.name,
            triggerType: entry.campaign.triggerType,
            audience: entry.campaign.audience,
          }
        : null,
      referral: entry.referral
        ? {
            id: entry.referral.id,
            referrerUserId: entry.referral.referrerUserId,
            referredUserId: entry.referral.referredUserId,
            status: entry.referral.status,
          }
        : null,
      createdAt: entry.createdAt,
    })),
  };
};

export const listRewardCampaigns = async () => {
  return prisma.rewardCampaign.findMany({
    orderBy: [{ active: 'desc' }, { updatedAt: 'desc' }],
  });
};

export const upsertRewardCampaign = async (
  input: {
    id?: string;
    code: string;
    name: string;
    audience: string;
    triggerType: string;
    thresholdCount?: number;
    rewardAmount: number;
    currency?: string;
    active?: boolean;
    repeatable?: boolean;
    description?: string | null;
    terms?: string | null;
    startsAt?: string | null;
    endsAt?: string | null;
    metadataJson?: Prisma.InputJsonValue | null;
  },
  adminId: string | null,
) => {
  const data = {
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    audience: normalizeWalletType(input.audience),
    triggerType: input.triggerType.trim().toUpperCase(),
    thresholdCount: input.thresholdCount ?? 1,
    rewardAmount: input.rewardAmount,
    currency: normalizeCurrency(input.currency),
    active: input.active ?? true,
    repeatable: input.repeatable ?? false,
    description: input.description ?? null,
    terms: input.terms ?? null,
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
    updatedById: adminId,
  };

  if (input.id) {
    return prisma.rewardCampaign.update({
      where: { id: input.id },
      data: {
        ...data,
        ...(input.metadataJson !== null ? { metadataJson: input.metadataJson } : {}),
      },
    });
  }

  return prisma.rewardCampaign.create({
    data: {
      ...data,
      ...(input.metadataJson !== null ? { metadataJson: input.metadataJson } : {}),
      createdById: adminId,
    },
  });
};

const grantWalletEntry = async (input: {
  userId: string;
  walletType: string;
  entryType: string;
  amount: number;
  currency?: string;
  sourceType: string;
  sourceId: string;
  campaignId?: string | null;
  referralId?: string | null;
  description?: string | null;
  metadataJson?: Prisma.InputJsonValue | null;
  createdById?: string | null;
  reversalOfEntryId?: string | null;
  idempotencyKey: string;
}) => {
  const currency = normalizeCurrency(input.currency);
  const walletType = normalizeWalletType(input.walletType);
  const entry = await prisma.rewardWalletEntry.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (entry) return { entry, created: false };

  const latest = await loadLatestRewardEntry(input.userId, walletType);
  const previousHash = latest?.entryHash ?? null;
  const entryHash = computeRewardEntryHash({
    previousHash,
    userId: input.userId,
    walletType,
    entryType: input.entryType,
    direction: walletDirection(input.amount),
    amount: Math.abs(input.amount),
    currency,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    campaignId: input.campaignId ?? null,
    referralId: input.referralId ?? null,
    description: input.description ?? null,
    metadataJson: input.metadataJson ?? null,
    reversalOfEntryId: input.reversalOfEntryId ?? null,
    createdById: input.createdById ?? null,
    idempotencyKey: input.idempotencyKey,
  });

  const created = await prisma.rewardWalletEntry.create({
    data: {
      userId: input.userId,
      walletType,
      entryType: input.entryType,
      direction: walletDirection(input.amount),
      amount: Math.abs(input.amount),
      currency,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      campaignId: input.campaignId ?? null,
      referralId: input.referralId ?? null,
      description: input.description ?? null,
      createdById: input.createdById ?? null,
      reversalOfEntryId: input.reversalOfEntryId ?? null,
      previousHash,
      entryHash,
      idempotencyKey: input.idempotencyKey,
      ...(input.metadataJson !== null ? { metadataJson: input.metadataJson } : {}),
    },
  });

  return { entry: created, created: true };
};

const maybeSendRewardNotification = async (
  userId: string,
  title: string,
  body: string,
  data: Record<string, string>,
  email?: string | null,
) => {
  await createNotification({
    userId,
    type: 'reward.wallet.updated',
    title,
    body,
    data,
  });

  if (!email) return;

  try {
    await sendMail({
      to: email,
      subject: title,
      text: `${title}\n\n${body}\n\nDeliivo`,
      html: `<div style="font-family: Arial, sans-serif; padding: 20px; color: #111827;"><h2>${title}</h2><p>${body}</p><p>Deliivo</p></div>`,
    });
  } catch {
    // Notification delivery should not fail the reward grant.
  }
};

const awardCampaignReward = async (input: {
  userId: string;
  walletType: string;
  triggerType: string;
  sourceType: string;
  sourceId: string;
  description: string;
  idempotencyKey: string;
  occurrenceCount?: number;
  metadataJson?: Prisma.InputJsonValue | null;
  createdById?: string | null;
}) => {
  const campaign = await firstActiveCampaign(input.triggerType, normalizeWalletType(input.walletType));
  if (!campaign) {
    return { granted: false, reason: 'CAMPAIGN_NOT_CONFIGURED' as const };
  }

  const occurrenceCount = Math.max(1, input.occurrenceCount ?? 1);
  if (!shouldGrantCampaignAtCount(campaign, occurrenceCount)) {
    return { granted: false, reason: 'THRESHOLD_NOT_REACHED' as const, campaign };
  }

  const { entry, created } = await grantWalletEntry({
    userId: input.userId,
    walletType: input.walletType,
    entryType: input.triggerType === REWARD_TRIGGERS.MANUAL ? 'MANUAL_CREDIT' : 'CAMPAIGN_CREDIT',
    amount: campaign.rewardAmount,
    currency: campaign.currency,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    campaignId: campaign.id,
    description: input.description,
    metadataJson: {
      ...(input.metadataJson as Record<string, unknown> | null | undefined),
      campaignCode: campaign.code,
      triggerType: campaign.triggerType,
      audience: campaign.audience,
      occurrenceCount,
    } as Prisma.InputJsonValue,
    createdById: input.createdById ?? null,
    idempotencyKey: input.idempotencyKey,
  });

  if (!created) {
    return { granted: false, reason: 'ALREADY_GRANTED' as const, entry };
  }

  return { granted: true, campaign, entry };
};

export const grantManualReward = async (
  input: {
    userId: string;
    amount: number;
    currency?: string;
    walletType?: string;
    reason: string;
    sourceType?: string;
    sourceId?: string;
    metadataJson?: Prisma.InputJsonValue | null;
  },
  adminId: string | null,
) => {
  const targetWallet = normalizeWalletType(input.walletType);
  const sourceType = (input.sourceType || 'MANUAL').trim().toUpperCase();
  const sourceId = (input.sourceId || randomUUID()).trim();
  const idempotencyKey = `manual:${input.userId}:${sourceType}:${sourceId}:${input.amount}:${normalizeCurrency(input.currency)}`;

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  if (!user) throw new Error('USER_NOT_FOUND');

  const { entry, created } = await grantWalletEntry({
    userId: input.userId,
    walletType: targetWallet,
    entryType: input.amount >= 0 ? 'MANUAL_CREDIT' : 'DEBIT',
    amount: Math.abs(input.amount),
    currency: input.currency,
    sourceType,
    sourceId,
    description: input.reason,
    metadataJson: input.metadataJson,
    createdById: adminId,
    idempotencyKey,
  });

  if (created) {
    await maybeSendRewardNotification(
      user.id,
      'Deliivo wallet updated',
      input.reason,
      {
        userId: user.id,
        walletType: targetWallet,
        amount: String(input.amount),
        currency: normalizeCurrency(input.currency),
        sourceType,
        sourceId,
      },
      user.email,
    );
  }

  return { entry, created };
};

export const reverseRewardEntry = async (
  input: { entryId: string; reason: string; metadataJson?: Prisma.InputJsonValue | null },
  adminId: string | null,
) => {
  const original = await prisma.rewardWalletEntry.findUnique({
    where: { id: input.entryId },
  });
  if (!original) throw new Error('ENTRY_NOT_FOUND');

  return grantWalletEntry({
    userId: original.userId,
    walletType: original.walletType,
    entryType: 'REVERSAL',
    amount: original.direction === 'DEBIT' ? original.amount : -original.amount,
    currency: original.currency,
    sourceType: 'REVERSAL',
    sourceId: original.id,
    description: input.reason,
    metadataJson: {
      ...(input.metadataJson as Record<string, unknown> | null | undefined),
      reversedEntryId: original.id,
      reversedEntryType: original.entryType,
    } as Prisma.InputJsonValue,
    createdById: adminId,
    reversalOfEntryId: original.id,
    idempotencyKey: `reversal:${original.id}`,
  });
};

export const awardBookingCompletionRewards = async (bookingId: string) => {
  const booking = await prisma.rideBooking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      status: true,
      passengerId: true,
      rideId: true,
      completedAt: true,
      passenger: {
        select: {
          id: true,
          email: true,
          referredByUserId: true,
          referralCode: true,
        },
      },
    },
  });

  if (!booking || booking.status !== 'COMPLETED') {
    return { processed: false, reason: 'BOOKING_NOT_COMPLETED' as const };
  }

  const completedCount = await prisma.rideBooking.count({
    where: { passengerId: booking.passengerId, status: 'COMPLETED' },
  });

  const grants: Array<{ type: string; result: unknown }> = [];

  if (completedCount > 0) {
    const milestone = await awardCampaignReward({
      userId: booking.passengerId,
      walletType: REWARD_AUDIENCES.RIDER,
      triggerType: REWARD_TRIGGERS.RIDER_COMPLETION_MILESTONE,
      sourceType: 'BOOKING',
      sourceId: booking.id,
      description: `Reward for completing ${completedCount} ride booking${completedCount === 1 ? '' : 's'}.`,
      idempotencyKey: `booking-milestone:${booking.id}`,
      occurrenceCount: completedCount,
      metadataJson: { completedCount },
    });
    if (milestone.granted) grants.push({ type: 'rider_milestone', result: milestone });
  }

  if (completedCount === 1 && booking.passenger.referredByUserId) {
    const referral = await prisma.rewardReferral.findUnique({
      where: { referredUserId: booking.passengerId },
    });
    const referrerId = referral?.referrerUserId ?? booking.passenger.referredByUserId;

    const grant = await awardCampaignReward({
      userId: referrerId,
      walletType: REWARD_AUDIENCES.RIDER,
      triggerType: REWARD_TRIGGERS.RIDER_REFERRAL_BOOKING_COMPLETION,
      sourceType: 'REFERRAL',
      sourceId: booking.id,
      description: 'Referral reward for a rider completing their first booking.',
      idempotencyKey: `referral-booking:${booking.id}`,
      occurrenceCount: 1,
      metadataJson: {
        referredUserId: booking.passengerId,
        referrerUserId: referrerId,
      },
    });

    if (grant.granted) {
      await prisma.rewardReferral.upsert({
        where: { referredUserId: booking.passengerId },
        update: {
          referrerUserId: referrerId,
          status: 'REWARDED',
          qualificationType: 'BOOKING_COMPLETED',
          qualificationSourceId: booking.id,
          firstQualifiedAt: new Date(),
          rewardedAt: new Date(),
        },
        create: {
          referrerUserId: referrerId,
          referredUserId: booking.passengerId,
          referralCode: booking.passenger.referralCode ?? null,
          status: 'REWARDED',
          qualificationType: 'BOOKING_COMPLETED',
          qualificationSourceId: booking.id,
          firstQualifiedAt: new Date(),
          rewardedAt: new Date(),
        },
      });
      grants.push({ type: 'rider_referral', result: grant });
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: booking.passengerId },
    select: { email: true, firstName: true },
  });
  if (grants.length > 0 && user) {
    await maybeSendRewardNotification(
      booking.passengerId,
      'Deliivo rewards updated',
      'Your reward wallet has been updated after a completed booking.',
      {
        bookingId: booking.id,
        rideId: booking.rideId,
        completedCount: String(completedCount),
      },
      user.email,
    );
  }

  return { processed: true, grants };
};

export const awardRideCompletionRewards = async (rideId: string) => {
  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    select: {
      id: true,
      status: true,
      driverId: true,
      driver: {
        select: {
          id: true,
          email: true,
          referredByUserId: true,
          referralCode: true,
        },
      },
    },
  });

  if (!ride || ride.status !== 'COMPLETED') {
    return { processed: false, reason: 'RIDE_NOT_COMPLETED' as const };
  }

  const completedRideCount = await prisma.ride.count({
    where: { driverId: ride.driverId, status: 'COMPLETED' },
  });

  const grants: Array<{ type: string; result: unknown }> = [];

  const milestone = await awardCampaignReward({
    userId: ride.driverId,
    walletType: REWARD_AUDIENCES.DRIVER,
    triggerType: REWARD_TRIGGERS.DRIVER_COMPLETION_MILESTONE,
    sourceType: 'RIDE',
    sourceId: ride.id,
    description: `Reward for completing ${completedRideCount} published ride${completedRideCount === 1 ? '' : 's'}.`,
    idempotencyKey: `driver-milestone:${ride.id}`,
    occurrenceCount: completedRideCount,
    metadataJson: { completedRideCount },
  });
  if (milestone.granted) grants.push({ type: 'driver_milestone', result: milestone });

  if (completedRideCount === 1 && ride.driver.referredByUserId) {
    const referral = await prisma.rewardReferral.findUnique({
      where: { referredUserId: ride.driverId },
    });
    const referrerId = referral?.referrerUserId ?? ride.driver.referredByUserId;

    const grant = await awardCampaignReward({
      userId: referrerId,
      walletType: REWARD_AUDIENCES.DRIVER,
      triggerType: REWARD_TRIGGERS.DRIVER_REFERRAL_RIDE_COMPLETION,
      sourceType: 'REFERRAL',
      sourceId: ride.id,
      description: 'Referral reward for a driver completing their first ride.',
      idempotencyKey: `referral-ride:${ride.id}`,
      occurrenceCount: 1,
      metadataJson: {
        referredUserId: ride.driverId,
        referrerUserId: referrerId,
      },
    });

    if (grant.granted) {
      await prisma.rewardReferral.upsert({
        where: { referredUserId: ride.driverId },
        update: {
          referrerUserId: referrerId,
          status: 'REWARDED',
          qualificationType: 'RIDE_COMPLETED',
          qualificationSourceId: ride.id,
          firstQualifiedAt: new Date(),
          rewardedAt: new Date(),
        },
        create: {
          referrerUserId: referrerId,
          referredUserId: ride.driverId,
          referralCode: ride.driver.referralCode ?? null,
          status: 'REWARDED',
          qualificationType: 'RIDE_COMPLETED',
          qualificationSourceId: ride.id,
          firstQualifiedAt: new Date(),
          rewardedAt: new Date(),
        },
      });
      grants.push({ type: 'driver_referral', result: grant });
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: ride.driverId },
    select: { email: true },
  });
  if (grants.length > 0 && user) {
    await maybeSendRewardNotification(
      ride.driverId,
      'Deliivo rewards updated',
      'Your reward wallet has been updated after a completed ride.',
      {
        rideId: ride.id,
        completedRideCount: String(completedRideCount),
      },
      user.email,
    );
  }

  return { processed: true, grants };
};

export const listRewardsForUser = getRewardWallet;
