import { Response } from 'express';
import { prisma } from '../../config/index.js';
import { AuthRequest } from '../../middlewares/authMiddleware.js';
import {
    createConnectAccountSession,
    createConnectOnboardingLink,
    getConnectAccountStatus,
} from './stripe.service.js';
import { ConnectAccountPrefill } from './stripe.types.js';
import { HttpStatus, sendError, sendSuccess } from '../../utils/index.js';
import { logError } from '../../utils/logger.js';

/** Profile fields Stripe accepts as prefill when the connected account is first created. */
const CONNECT_PREFILL_SELECT = {
    stripeAccountId: true,
    firstName: true,
    lastName: true,
    email: true,
    phone: true,
    dob: true,
} as const;

type ConnectPrefillUser = {
    stripeAccountId: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    dob: Date | null;
};

type StripeErrorDetail = { type: string; code?: string; param?: string; message: string };

/**
 * Stripe's rejection message names the offending field ("individual[dob][year]: Must be at least 13
 * years of age"). Swallowing it behind a bare 500 leaves nothing to act on in the client or in a
 * staging log, so it is echoed back — these messages are written for the account holder to read.
 */
const describeStripeError = (error: unknown): StripeErrorDetail | undefined => {
    if (typeof error !== 'object' || error === null) return undefined;

    const candidate = error as { type?: unknown; code?: unknown; param?: unknown; message?: unknown };
    if (typeof candidate.type !== 'string' || !candidate.type.startsWith('Stripe')) return undefined;

    return {
        type: candidate.type,
        code: typeof candidate.code === 'string' ? candidate.code : undefined,
        param: typeof candidate.param === 'string' ? candidate.param : undefined,
        message: typeof candidate.message === 'string' ? candidate.message : 'Stripe request failed',
    };
};

const toPrefill = (user: ConnectPrefillUser | null): ConnectAccountPrefill => ({
    firstName: user?.firstName ?? null,
    lastName: user?.lastName ?? null,
    email: user?.email ?? null,
    phone: user?.phone ?? null,
    dob: user?.dob ?? null,
});

/* ================= CONNECT ONBOARD ================= */
export const connectOnboard = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user.id;
        if (process.env.STRIPE_CONNECT_MOCK_MODE === 'true') {
            return sendSuccess(res, {
                message: 'Stripe Connect mock onboarding link created',
                data: { url: `${process.env.APP_BASE_URL ?? 'http://localhost:8080'}/profile/earnings?stripe_connect=mock` },
            });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: CONNECT_PREFILL_SELECT,
        });

        const appBaseUrl = process.env.APP_BASE_URL ?? 'https://app.example.com';
        const returnUrl = `${appBaseUrl}/driver/stripe-connect/return`;
        const refreshUrl = `${appBaseUrl}/driver/stripe-connect/refresh`;

        const { accountId, onboardingUrl } = await createConnectOnboardingLink(
            userId,
            user?.stripeAccountId ?? null,
            returnUrl,
            refreshUrl,
            toPrefill(user)
        );

        // Persist accountId if newly created
        if (!user?.stripeAccountId) {
            await prisma.user.update({
                where: { id: userId },
                data: { stripeAccountId: accountId },
            });
        }

        return sendSuccess(res, {
            message: 'Stripe Connect onboarding link created',
            data: { url: onboardingUrl },
        });
    } catch (error) {
        logError('[STRIPE_CONNECT] onboard failed', error, { userId: req.user?.id });
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to create Stripe Connect onboarding link',
            error: describeStripeError(error),
        });
    }
};

/* ================= CONNECT ACCOUNT SESSION ================= */
/**
 * Mints an AccountSession for the embedded onboarding component. The account is resolved from the
 * bearer token only — any account id in the request body is ignored. Connect refetches the secret
 * on expiry, so every call creates a fresh session.
 */
export const connectAccountSession = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user.id;
        if (process.env.STRIPE_CONNECT_MOCK_MODE === 'true') {
            return sendSuccess(res, {
                message: 'Stripe Connect mock account session created',
                data: {
                    mock: true,
                    clientSecret: null,
                    expiresAt: null,
                    accountId: 'acct_mock_local',
                    requirementCollection: 'application',
                },
            });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: CONNECT_PREFILL_SELECT,
        });

        const session = await createConnectAccountSession(
            userId,
            user?.stripeAccountId ?? null,
            toPrefill(user)
        );

        // Persist accountId if newly created
        if (!user?.stripeAccountId) {
            await prisma.user.update({
                where: { id: userId },
                data: { stripeAccountId: session.accountId },
            });
        }

        return sendSuccess(res, {
            message: 'Stripe Connect account session created',
            data: {
                clientSecret: session.clientSecret,
                expiresAt: session.expiresAt,
                accountId: session.accountId,
                requirementCollection: session.requirementCollection,
            },
        });
    } catch (error) {
        logError('[STRIPE_CONNECT] account session failed', error, { userId: req.user?.id });
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to create Stripe Connect account session',
            error: describeStripeError(error),
        });
    }
};

/* ================= CONNECT STATUS ================= */
export const connectStatus = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user.id;
        if (process.env.STRIPE_CONNECT_MOCK_MODE === 'true') {
            return sendSuccess(res, {
                message: 'Connect status fetched',
                data: {
                    connected: true,
                    onboardingComplete: true,
                    accountId: 'acct_mock_local',
                    chargesEnabled: true,
                    payoutsEnabled: true,
                    detailsSubmitted: true,
                    requirementCollection: 'application',
                },
            });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { stripeAccountId: true, stripeOnboardingComplete: true },
        });

        if (!user?.stripeAccountId) {
            return sendSuccess(res, {
                message: 'Connect status fetched',
                data: { connected: false, onboardingComplete: false },
            });
        }

        const status = await getConnectAccountStatus(user.stripeAccountId);
        // Identity is matched against the driving licence only (see the Veriff webhook in
        // dl-verification.service.ts). The bank account is not compared to the profile:
        // Stripe readiness alone completes onboarding.
        const stripeReady = status.detailsSubmitted && status.chargesEnabled;

        let onboardingComplete = user.stripeOnboardingComplete;

        if (stripeReady && !user.stripeOnboardingComplete) {
            await prisma.user.update({
                where: { id: userId },
                data: {
                    stripeOnboardingComplete: true,
                    // Retained for audit — which account holder Stripe reported.
                    stripeAccountName: status.accountName,
                },
            });
            onboardingComplete = true;
        }

        return sendSuccess(res, {
            message: 'Connect status fetched',
            data: {
                connected: true,
                onboardingComplete,
                accountId: status.accountId,
                chargesEnabled: status.chargesEnabled,
                payoutsEnabled: status.payoutsEnabled,
                detailsSubmitted: status.detailsSubmitted,
                requirementCollection: status.requirementCollection,
            },
        });
    } catch (error) {
        logError('[STRIPE_CONNECT] status fetch failed', error, { userId: req.user?.id });
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to fetch Stripe Connect status',
        });
    }
};
