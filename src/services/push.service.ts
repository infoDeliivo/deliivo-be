import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { prisma } from '../config/index.js';
import logger from '../utils/logger.js';

// ============ FIREBASE INITIALIZATION ============

let firebaseInitialized = false;

/**
 * Initialize Firebase Admin SDK from a JSON env var, base64 env var,
 * legacy base64 env var, local file path, or GOOGLE_APPLICATION_CREDENTIALS.
 */
const loadServiceAccount = (): { serviceAccount: admin.ServiceAccount; source: string } | null => {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (serviceAccountJson) {
        return {
            serviceAccount: JSON.parse(serviceAccountJson) as admin.ServiceAccount,
            source: 'FIREBASE_SERVICE_ACCOUNT_JSON',
        };
    }

    const serviceAccountBase64 =
        process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || process.env.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccountBase64) {
        const source = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
            ? 'FIREBASE_SERVICE_ACCOUNT_BASE64'
            : 'FIREBASE_SERVICE_ACCOUNT (legacy)';
        return {
            serviceAccount: JSON.parse(
                Buffer.from(serviceAccountBase64, 'base64').toString('utf-8'),
            ) as admin.ServiceAccount,
            source,
        };
    }

    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (serviceAccountPath) {
        const resolvedPath = path.resolve(serviceAccountPath);
        return {
            serviceAccount: JSON.parse(fs.readFileSync(resolvedPath, 'utf-8')) as admin.ServiceAccount,
            source: `FIREBASE_SERVICE_ACCOUNT_PATH (${resolvedPath})`,
        };
    }

    return null;
};

const initFirebase = () => {
    if (firebaseInitialized) return;

    try {
        const serviceAccountConfig = loadServiceAccount();

        if (serviceAccountConfig) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccountConfig.serviceAccount),
            });
            logger.info(`Firebase Admin SDK initialized using ${serviceAccountConfig.source}`);
        } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            admin.initializeApp({
                credential: admin.credential.applicationDefault(),
            });
            logger.info('Firebase Admin SDK initialized using GOOGLE_APPLICATION_CREDENTIALS');
        } else {
            logger.warn(
                'Firebase not configured; push notifications disabled. Set FIREBASE_SERVICE_ACCOUNT_JSON, FIREBASE_SERVICE_ACCOUNT_BASE64, FIREBASE_SERVICE_ACCOUNT (legacy), FIREBASE_SERVICE_ACCOUNT_PATH, or GOOGLE_APPLICATION_CREDENTIALS.',
            );
            return;
        }

        firebaseInitialized = true;
    } catch (error) {
        logger.error('Firebase initialization error:', error);
    }
};

// Initialize on module load
initFirebase();

// ============ PUSH NOTIFICATION ============

interface PushPayload {
    title: string;
    body: string;
    data?: Record<string, string>;
}

/**
 * Send push notification to a user's registered devices.
 * Automatically removes invalid/expired tokens.
 */
export const sendPushToUser = async (userId: string, payload: PushPayload): Promise<void> => {
    if (!firebaseInitialized) {
        logger.debug('Firebase not initialized, skipping push notification');
        return;
    }

    // Fetch user's device tokens
    const devices = await prisma.deviceToken.findMany({
        where: { userId },
        select: { id: true, token: true, platform: true },
    });

    if (devices.length === 0) {
        logger.debug(`No device tokens for user ${userId}, skipping push`);
        return;
    }

    const tokens = devices.map((d) => d.token);

    // Build the FCM message
    const message: admin.messaging.MulticastMessage = {
        tokens,
        notification: {
            title: payload.title,
            body: payload.body,
        },
        data: payload.data || {},
        // Android-specific config
        android: {
            priority: 'high',
            notification: {
                channelId: 'default',
                sound: 'default',
            },
        },
        // APNs (iOS) config
        apns: {
            payload: {
                aps: {
                    alert: {
                        title: payload.title,
                        body: payload.body,
                    },
                    sound: 'default',
                    badge: 1,
                },
            },
        },
    };

    try {
        const response = await admin.messaging().sendEachForMulticast(message);

        logger.info(`Push sent to user ${userId}: ${response.successCount} success, ${response.failureCount} failures`);

        // Clean up invalid tokens
        if (response.failureCount > 0) {
            const invalidTokenIds: string[] = [];

            response.responses.forEach((resp, idx) => {
                if (!resp.success && resp.error) {
                    const errorCode = resp.error.code;
                    // Remove tokens that are no longer valid
                    if (
                        errorCode === 'messaging/invalid-registration-token' ||
                        errorCode === 'messaging/registration-token-not-registered'
                    ) {
                        invalidTokenIds.push(devices[idx].id);
                        logger.info(`Removing invalid device token: ${devices[idx].token.substring(0, 10)}...`);
                    }
                }
            });

            if (invalidTokenIds.length > 0) {
                await prisma.deviceToken.deleteMany({
                    where: { id: { in: invalidTokenIds } },
                });
                logger.info(`Cleaned up ${invalidTokenIds.length} invalid device tokens`);
            }
        }
    } catch (error) {
        logger.error(`Push notification error for user ${userId}:`, error);
    }
};
