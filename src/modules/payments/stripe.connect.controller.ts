import { Response } from 'express';
import { prisma } from '../../config/index.js';
import { AuthRequest } from '../../middlewares/authMiddleware.js';
import { createConnectOnboardingLink, getConnectAccountStatus } from './stripe.service.js';
import { HttpStatus, sendError, sendSuccess } from '../../utils/index.js';
import { logError, logWarn } from '../../utils/logger.js';
import { matchIdentity } from '../../utils/nameMatch.js';

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
            select: { stripeAccountId: true },
        });

        const appBaseUrl = process.env.APP_BASE_URL ?? 'https://app.example.com';
        const returnUrl = `${appBaseUrl}/driver/stripe-connect/return`;
        const refreshUrl = `${appBaseUrl}/driver/stripe-connect/refresh`;

        const { accountId, onboardingUrl } = await createConnectOnboardingLink(
            userId,
            user?.stripeAccountId ?? null,
            returnUrl,
            refreshUrl
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
                },
            });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { stripeAccountId: true, stripeOnboardingComplete: true, name: true, dob: true },
        });

        if (!user?.stripeAccountId) {
            return sendSuccess(res, {
                message: 'Connect status fetched',
                data: { connected: false, onboardingComplete: false },
            });
        }

        const status = await getConnectAccountStatus(user.stripeAccountId);
        const stripeReady = status.detailsSubmitted && status.chargesEnabled;
        // Stripe asserts name + DOB (no gender); match both against the profile.
        const match = matchIdentity(
            { name: user.name, dob: user.dob },
            { name: status.accountName, dob: status.accountDob },
        );

        let onboardingComplete = user.stripeOnboardingComplete;

        // Only complete onboarding when Stripe is ready AND the account-holder
        // identity matches the entered profile. A mismatch is a hard block.
        if (stripeReady && match.overall && !user.stripeOnboardingComplete) {
            await prisma.user.update({
                where: { id: userId },
                data: {
                    stripeOnboardingComplete: true,
                    stripeAccountName: status.accountName,
                    stripeNameMatch: match.nameMatch,
                    stripeDobMatch: match.dobMatch,
                },
            });
            onboardingComplete = true;
        } else if (stripeReady && !match.overall) {
            await prisma.user.update({
                where: { id: userId },
                data: {
                    stripeAccountName: status.accountName,
                    stripeNameMatch: match.nameMatch,
                    stripeDobMatch: match.dobMatch,
                },
            });
            logWarn('[STRIPE_CONNECT] account ready but identity mismatch — onboarding withheld', {
                userId,
                nameMatch: match.nameMatch,
                dobMatch: match.dobMatch,
            });
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
                identityMismatch: stripeReady && !match.overall,
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
