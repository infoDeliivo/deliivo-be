import admin from 'firebase-admin';
import { getStorage } from 'firebase-admin/storage';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import { resolveStorageTarget } from './s3.config.js';

/**
 * Shared Firebase Admin initialization. Used by both the push service (FCM) and the
 * storage service (Firebase Storage / GCS uploads) so credential handling lives in one place.
 */

type ServiceAccountConfig = {
    serviceAccount: admin.ServiceAccount;
    source: string;
};

const tryParseServiceAccount = (raw: string, source: string): ServiceAccountConfig | null => {
    try {
        return {
            serviceAccount: JSON.parse(raw) as admin.ServiceAccount,
            source,
        };
    } catch (error) {
        logger.warn(`Ignoring invalid ${source}: ${(error as Error).message}`);
        return null;
    }
};

const resolveExistingFilePath = (
    envVarName: 'FIREBASE_SERVICE_ACCOUNT_PATH' | 'GOOGLE_APPLICATION_CREDENTIALS',
): string | null => {
    const filePath = process.env[envVarName];
    if (!filePath) return null;

    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
        logger.warn(`${envVarName} points to a missing file at ${resolvedPath}; skipping file-based Firebase auth.`);
        return null;
    }

    return resolvedPath;
};

/**
 * Load a service account from (in priority order): FIREBASE_SERVICE_ACCOUNT_JSON,
 * FIREBASE_SERVICE_ACCOUNT_BASE64, legacy FIREBASE_SERVICE_ACCOUNT, FIREBASE_SERVICE_ACCOUNT_PATH.
 */
const loadServiceAccount = (): ServiceAccountConfig | null => {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (serviceAccountJson) {
        return tryParseServiceAccount(serviceAccountJson, 'FIREBASE_SERVICE_ACCOUNT_JSON');
    }

    const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    if (serviceAccountBase64) {
        return tryParseServiceAccount(
            Buffer.from(serviceAccountBase64, 'base64').toString('utf-8'),
            'FIREBASE_SERVICE_ACCOUNT_BASE64',
        );
    }

    const legacyServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (legacyServiceAccount) {
        return (
            tryParseServiceAccount(
                Buffer.from(legacyServiceAccount, 'base64').toString('utf-8'),
                'FIREBASE_SERVICE_ACCOUNT (legacy base64)',
            ) || tryParseServiceAccount(legacyServiceAccount, 'FIREBASE_SERVICE_ACCOUNT (legacy JSON)')
        );
    }

    const resolvedPath = resolveExistingFilePath('FIREBASE_SERVICE_ACCOUNT_PATH');
    if (resolvedPath) {
        try {
            return {
                serviceAccount: JSON.parse(fs.readFileSync(resolvedPath, 'utf-8')) as admin.ServiceAccount,
                source: `FIREBASE_SERVICE_ACCOUNT_PATH (${resolvedPath})`,
            };
        } catch (error) {
            logger.warn(`Ignoring invalid FIREBASE_SERVICE_ACCOUNT_PATH file at ${resolvedPath}: ${(error as Error).message}`);
        }
    }

    return null;
};

/**
 * Idempotently initialize (or reuse) the default Firebase Admin app.
 * Returns the app, or null when no credentials are configured (push then no-ops).
 */
export const ensureFirebaseApp = (): admin.app.App | null => {
    if (admin.apps.length > 0) {
        return admin.app();
    }

    try {
        const serviceAccountConfig = loadServiceAccount();

        if (serviceAccountConfig) {
            const app = admin.initializeApp({
                credential: admin.credential.cert(serviceAccountConfig.serviceAccount),
            });
            logger.info(`Firebase Admin SDK initialized using ${serviceAccountConfig.source}`);
            return app;
        }

        const googleApplicationCredentialsPath = resolveExistingFilePath('GOOGLE_APPLICATION_CREDENTIALS');
        if (!googleApplicationCredentialsPath) {
            logger.warn(
                'Firebase not configured; push notifications and Firebase Storage disabled. Set FIREBASE_SERVICE_ACCOUNT_JSON, FIREBASE_SERVICE_ACCOUNT_BASE64, FIREBASE_SERVICE_ACCOUNT (legacy), FIREBASE_SERVICE_ACCOUNT_PATH, or GOOGLE_APPLICATION_CREDENTIALS.',
            );
            return null;
        }

        process.env.GOOGLE_APPLICATION_CREDENTIALS = googleApplicationCredentialsPath;
        const app = admin.initializeApp({
            credential: admin.credential.applicationDefault(),
        });
        logger.info(`Firebase Admin SDK initialized using GOOGLE_APPLICATION_CREDENTIALS (${googleApplicationCredentialsPath})`);
        return app;
    } catch (error) {
        logger.error('Firebase initialization error:', error);
        return null;
    }
};

/** The GCS Bucket type, derived from firebase-admin so no direct @google-cloud/storage import is needed. */
export type StorageBucket = ReturnType<ReturnType<typeof getStorage>['bucket']>;

/**
 * Get the Firebase Storage (GCS) bucket for uploads. The bucket name comes from
 * FIREBASE_STORAGE_BUCKET (via resolveStorageTarget). Throws if firebase is not configured.
 */
export const getStorageBucket = (): StorageBucket => {
    const app = ensureFirebaseApp();
    if (!app) {
        throw new Error('Firebase is not configured; cannot access Firebase Storage.');
    }

    const bucketName = resolveStorageTarget().bucketName;
    if (!bucketName) {
        throw new Error('FIREBASE_STORAGE_BUCKET is not set; cannot access Firebase Storage.');
    }

    return getStorage(app).bucket(bucketName);
};
