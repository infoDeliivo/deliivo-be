import { prisma } from '../../config/index.js';
import { getStripeClient } from '../payments/stripe.service.js';

// ============================================================
//  LIST PAYMENT METHODS
// ============================================================

export const listPaymentMethods = async (userId: string) => {
    return prisma.paymentMethod.findMany({
        where: { userId, status: 'ACTIVE' },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
};

// ============================================================
//  CREATE SETUP INTENT (to save a new card)
// ============================================================

export const createSetupIntent = async (userId: string) => {
    const stripe = getStripeClient();

    // Get or create Stripe customer
    let customerRecord = await prisma.paymentMethod.findFirst({
        where: { userId },
        select: { stripeCustomerId: true },
    });

    let customerId: string;
    if (customerRecord?.stripeCustomerId) {
        customerId = customerRecord.stripeCustomerId;
    } else {
        const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, name: true } });
        const customer = await stripe.customers.create({
            email: user.email ?? undefined,
            name: user.name ?? undefined,
            metadata: { userId },
        });
        customerId = customer.id;
    }

    const setupIntent = await stripe.setupIntents.create({
        customer: customerId,
        automatic_payment_methods: { enabled: true },
    });

    return {
        setupIntentId: setupIntent.id,
        clientSecret: setupIntent.client_secret,
        customerId,
    };
};

// ============================================================
//  CONFIRM AND SAVE PAYMENT METHOD (called after client confirms)
// ============================================================

export const savePaymentMethod = async (userId: string, stripePaymentMethodId: string, stripeCustomerId: string) => {
    const stripe = getStripeClient();
    const pm = await stripe.paymentMethods.retrieve(stripePaymentMethodId);

    const isFirst = (await prisma.paymentMethod.count({ where: { userId, status: 'ACTIVE' } })) === 0;

    return prisma.paymentMethod.create({
        data: {
            userId,
            stripeCustomerId,
            stripePaymentMethodId: pm.id,
            brand: pm.card?.brand ?? null,
            last4: pm.card?.last4 ?? null,
            expMonth: pm.card?.exp_month ?? null,
            expYear: pm.card?.exp_year ?? null,
            isDefault: isFirst,
        },
    });
};

// ============================================================
//  SET DEFAULT
// ============================================================

export const setDefaultPaymentMethod = async (userId: string, paymentMethodId: string) => {
    const paymentMethod = await prisma.paymentMethod.findFirst({
        where: { id: paymentMethodId, userId, status: 'ACTIVE' },
    });
    if (!paymentMethod) throw new Error('PAYMENT_METHOD_NOT_FOUND');

    // Unset current default
    await prisma.paymentMethod.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
    });

    return prisma.paymentMethod.update({
        where: { id: paymentMethodId },
        data: { isDefault: true },
    });
};

// ============================================================
//  REMOVE
// ============================================================

export const removePaymentMethod = async (userId: string, paymentMethodId: string) => {
    const pm = await prisma.paymentMethod.findFirst({
        where: { id: paymentMethodId, userId, status: 'ACTIVE' },
    });
    if (!pm) throw new Error('PAYMENT_METHOD_NOT_FOUND');

    if (process.env.STRIPE_PAYMENT_METHODS_MOCK_MODE !== 'true') {
        const stripe = getStripeClient();
        await stripe.paymentMethods.detach(pm.stripePaymentMethodId);
    }

    return prisma.$transaction(async (tx) => {
        const removed = await tx.paymentMethod.update({
            where: { id: paymentMethodId },
            data: { status: 'REMOVED', isDefault: false },
        });

        if (pm.isDefault) {
            const replacement = await tx.paymentMethod.findFirst({
                where: {
                    userId,
                    status: 'ACTIVE',
                    id: { not: paymentMethodId },
                },
                orderBy: [{ createdAt: 'desc' }],
            });

            if (replacement) {
                await tx.paymentMethod.update({
                    where: { id: replacement.id },
                    data: { isDefault: true },
                });
            }
        }

        return removed;
    });
};
