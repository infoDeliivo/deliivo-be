import { Response } from 'express';
import { prisma } from '../../config/index.js';
import { AuthRequest } from '../../middlewares/authMiddleware.js';
import { createConnectOnboardingLink, getConnectAccountStatus } from './stripe.service.js';
import { HttpStatus, sendError, sendSuccess } from '../../utils/index.js';

/* ================= CONNECT ONBOARD ================= */
export const connectOnboard = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user.id;
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
    } catch {
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

        // Mark onboarding complete when Stripe confirms it
        if (status.detailsSubmitted && status.chargesEnabled && !user.stripeOnboardingComplete) {
            await prisma.user.update({
                where: { id: userId },
                data: { stripeOnboardingComplete: true },
            });
        }

        return sendSuccess(res, {
            message: 'Connect status fetched',
            data: { connected: true, onboardingComplete: user.stripeOnboardingComplete, ...status },
        });
    } catch {
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to fetch Stripe Connect status',
        });
    }
};
