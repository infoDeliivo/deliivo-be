import { Response } from 'express';
import { prisma } from '../../config/index.js';
import { AuthRequest } from '../../middlewares/authMiddleware.js';
import {
    acceptConnectTerms,
    attachConnectBankAccount,
    createConnectAccountSession,
    createConnectOnboardingLink,
    deleteConnectBankAccount,
    ensureConnectedAccount,
    getConnectAccountStatus,
    getConnectRequirements,
    updateConnectPersonalDetails,
    uploadConnectIdentityDocument,
} from './stripe.service.js';
import {
    ConnectAccountPrefill,
    ConnectPersonalDetails,
    ConnectRequirements,
} from './stripe.types.js';
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

const isConnectPlatformProfileRequired = (error: unknown): boolean => {
    const stripeError = describeStripeError(error);
    return Boolean(
        stripeError?.type === 'StripeInvalidRequestError'
        && stripeError.message.toLowerCase().includes('responsibilities')
        && stripeError.message.toLowerCase().includes('connected accounts')
    );
};

const platformProfileRequiredResponse = (res: Response) =>
    sendError(res, {
        status: HttpStatus.CONFLICT,
        message:
            'Stripe Connect live setup is incomplete. Review the connected account responsibilities in the Stripe platform profile, then retry payout setup.',
        error: {
            code: 'STRIPE_CONNECT_PLATFORM_PROFILE_REQUIRED',
            dashboardUrl: 'https://dashboard.stripe.com/settings/connect/platform-profile',
        },
    });

/**
 * An account Stripe collects requirements for cannot be filled in through our own form. It is a
 * 409 rather than a 500 because nothing failed — the client simply has to send this driver to
 * Stripe's embedded onboarding instead, which `requirementCollection` on the requirements
 * response tells it in advance.
 */
const isNotEditable = (error: unknown): boolean =>
    error instanceof Error && error.message === 'CONNECT_ACCOUNT_NOT_EDITABLE';

const notEditableResponse = (res: Response) =>
    sendError(res, {
        status: HttpStatus.CONFLICT,
        message:
            'This payout account is managed by Stripe. Continue in the Stripe onboarding window to finish setup.',
        error: { code: 'CONNECT_ACCOUNT_NOT_EDITABLE' },
    });

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
        if (isConnectPlatformProfileRequired(error)) return platformProfileRequiredResponse(res);
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
        if (isConnectPlatformProfileRequired(error)) return platformProfileRequiredResponse(res);
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to create Stripe Connect account session',
            error: describeStripeError(error),
        });
    }
};

/* ================= CUSTOM ONBOARDING ================= */
/**
 * The driver-facing onboarding is rendered by our own UI, so these three endpoints replace the
 * Stripe-hosted screens: the client asks what is outstanding, files the identity details, attaches
 * a tokenised bank account and records terms acceptance. Only possible because accounts are
 * controller-based (`requirement_collection: 'application'`) — see stripe.service.ts.
 */
const resolveAccountId = async (userId: string): Promise<string> => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: CONNECT_PREFILL_SELECT,
    });

    const { accountId, created } = await ensureConnectedAccount(
        userId,
        user?.stripeAccountId ?? null,
        toPrefill(user)
    );

    if (created) {
        await prisma.user.update({ where: { id: userId }, data: { stripeAccountId: accountId } });
    }

    return accountId;
};

/**
 * Marks onboarding complete the moment Stripe says the account can take charges, mirroring
 * connectStatus so the two endpoints cannot disagree about a driver's state.
 */
const syncOnboardingComplete = async (userId: string, requirements: ConnectRequirements) => {
    if (
        !requirements.detailsSubmitted
        || !requirements.chargesEnabled
        || !requirements.payoutsEnabled
        || requirements.currentlyDue.length > 0
    ) return;

    await prisma.user.updateMany({
        where: { id: userId, stripeOnboardingComplete: false },
        data: { stripeOnboardingComplete: true },
    });
};

const syncOnboardingIncomplete = async (userId: string, requirements: ConnectRequirements) => {
    if (requirements.payoutsEnabled && requirements.currentlyDue.length === 0) return;

    await prisma.user.updateMany({
        where: { id: userId, stripeOnboardingComplete: true },
        data: { stripeOnboardingComplete: false },
    });
};

export const connectRequirements = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user.id;
        const accountId = await resolveAccountId(userId);
        const requirements = await getConnectRequirements(accountId);
        await syncOnboardingComplete(userId, requirements);

        return sendSuccess(res, { message: 'Connect requirements fetched', data: requirements });
    } catch (error) {
        logError('[STRIPE_CONNECT] requirements failed', error, { userId: req.user?.id });
        if (isConnectPlatformProfileRequired(error)) return platformProfileRequiredResponse(res);
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to fetch Stripe Connect requirements',
            error: describeStripeError(error),
        });
    }
};

export const connectUpdateDetails = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user.id;
        const details = req.body as ConnectPersonalDetails;
        const accountId = await resolveAccountId(userId);
        const requirements = await updateConnectPersonalDetails(accountId, details);
        await syncOnboardingComplete(userId, requirements);

        return sendSuccess(res, { message: 'Connect details saved', data: requirements });
    } catch (error) {
        logError('[STRIPE_CONNECT] details update failed', error, { userId: req.user?.id });
        if (isNotEditable(error)) return notEditableResponse(res);
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to save Stripe Connect details',
            error: describeStripeError(error),
        });
    }
};

export const connectBankAccount = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user.id;
        const { token } = req.body as { token: string };
        const accountId = await resolveAccountId(userId);
        const requirements = await attachConnectBankAccount(accountId, token);
        await syncOnboardingComplete(userId, requirements);

        return sendSuccess(res, { message: 'Bank account added', data: requirements });
    } catch (error) {
        logError('[STRIPE_CONNECT] bank account failed', error, { userId: req.user?.id });
        if (isNotEditable(error)) return notEditableResponse(res);
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to add bank account',
            error: describeStripeError(error),
        });
    }
};

export const connectDeleteBankAccount = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user.id;
        const externalAccountId = req.params.externalAccountId;

        if (typeof externalAccountId !== 'string' || !externalAccountId) {
            return sendError(res, {
                status: HttpStatus.BAD_REQUEST,
                message: 'Bank account id is required',
            });
        }

        const accountId = await resolveAccountId(userId);
        const requirements = await deleteConnectBankAccount(accountId, externalAccountId);
        await syncOnboardingIncomplete(userId, requirements);

        return sendSuccess(res, { message: 'Bank account removed', data: requirements });
    } catch (error) {
        logError('[STRIPE_CONNECT] bank account delete failed', error, { userId: req.user?.id });
        if (isNotEditable(error)) return notEditableResponse(res);
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to remove bank account',
            error: describeStripeError(error),
        });
    }
};

const IDENTITY_DOCUMENT_MIME = new Set(['image/jpeg', 'image/png', 'application/pdf']);

const readIdentityDocumentSide = (value: unknown) => (
    value === 'back' ? 'back' : 'front'
);

const readIdentityDocumentFileName = (req: AuthRequest, fallback: string) => {
    const header = req.get('x-file-name');
    if (!header) return fallback;
    const decoded = (() => {
        try {
            return decodeURIComponent(header);
        } catch {
            return header;
        }
    })();
    return decoded.replace(/[^\w.\- ]/g, '').trim().slice(0, 120) || fallback;
};

export const connectIdentityDocument = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user.id;
        const body = req.body;
        const file = Buffer.isBuffer(body) ? body : null;
        const contentType = (req.get('content-type') || '').split(';')[0].trim().toLowerCase();

        if (!file || file.length === 0) {
            return sendError(res, {
                status: HttpStatus.BAD_REQUEST,
                message: 'Identity document file is required',
            });
        }

        if (!IDENTITY_DOCUMENT_MIME.has(contentType)) {
            return sendError(res, {
                status: HttpStatus.BAD_REQUEST,
                message: 'Identity document must be a JPG, PNG, or PDF file',
            });
        }

        const side = readIdentityDocumentSide(req.query.side);
        const fallbackName = side === 'back' ? 'identity-document-back' : 'identity-document-front';
        const accountId = await resolveAccountId(userId);
        const requirements = await uploadConnectIdentityDocument(accountId, {
            file,
            fileName: readIdentityDocumentFileName(req, fallbackName),
            contentType,
            side,
        });
        await syncOnboardingComplete(userId, requirements);

        return sendSuccess(res, { message: 'Identity document uploaded', data: requirements });
    } catch (error) {
        logError('[STRIPE_CONNECT] identity document upload failed', error, { userId: req.user?.id });
        if (isNotEditable(error)) return notEditableResponse(res);
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to upload Stripe identity document',
            error: describeStripeError(error),
        });
    }
};

export const connectAcceptTerms = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user.id;
        // Stripe stores the IP the driver accepted from as evidence; a proxy address would make
        // that record worthless, so trust proxy must stay configured for req.ip to be the client.
        const ip = req.ip;
        if (!ip) {
            return sendError(res, {
                status: HttpStatus.BAD_REQUEST,
                message: 'Could not determine your IP address to record acceptance',
            });
        }

        const accountId = await resolveAccountId(userId);
        const requirements = await acceptConnectTerms(accountId, {
            ip,
            userAgent: req.get('user-agent') ?? null,
        });
        await syncOnboardingComplete(userId, requirements);

        return sendSuccess(res, { message: 'Terms acceptance recorded', data: requirements });
    } catch (error) {
        logError('[STRIPE_CONNECT] terms acceptance failed', error, { userId: req.user?.id });
        if (isNotEditable(error)) return notEditableResponse(res);
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to record terms acceptance',
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
