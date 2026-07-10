import { S3Client } from "@aws-sdk/client-s3";
import { configDotenv } from "dotenv";
configDotenv({ quiet: true });

export type StorageProvider = 's3' | 'r2' | 'railway' | 'firebase';

export interface StorageTarget {
    provider: StorageProvider;
    endpoint?: string;
    region: string;
    bucketName?: string;
    forcePathStyle: boolean;
    credentials: { accessKeyId: string; secretAccessKey: string };
    publicBaseUrl?: string;
}

/**
 * Resolve the active storage provider from a single env var, `STORAGE_PROVIDER`.
 * Falls back to the legacy `PROFILE_IMAGE_STORAGE_PROVIDER`, then defaults to `railway`.
 *
 * The S3-compatible providers (s3 / r2 / railway) share one AWS client — they differ only
 * in endpoint, credentials, and path style. `firebase` (Google Cloud Storage) is not
 * S3-compatible and uses its own code path via firebase-admin. Switching provider is a
 * config change, no code change.
 */
export const resolveStorageTarget = (): StorageTarget => {
    const raw = (process.env.STORAGE_PROVIDER ?? process.env.PROFILE_IMAGE_STORAGE_PROVIDER ?? '')
        .toLowerCase()
        .trim();
    let provider: StorageProvider =
        raw === 'aws' ? 's3' : (['s3', 'r2', 'railway', 'firebase'].includes(raw) ? (raw as StorageProvider) : '' as StorageProvider);
    if (!provider) provider = 'railway';

    switch (provider) {
        case 's3':
            return {
                provider,
                region: process.env.AWS_REGION || 'us-east-1',
                bucketName: process.env.AWS_S3_BUCKET_NAME,
                forcePathStyle: false,
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
                },
                publicBaseUrl: process.env.AWS_S3_PUBLIC_BASE_URL,
            };
        case 'r2':
            return {
                provider,
                region: 'auto',
                endpoint: process.env.R2_ENDPOINT,
                bucketName: process.env.R2_BUCKET_NAME,
                forcePathStyle: true,
                credentials: {
                    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
                    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
                },
                publicBaseUrl: process.env.R2_PUBLIC_BASE_URL,
            };
        case 'firebase':
            // Google Cloud Storage via firebase-admin — not S3-compatible; the AWS client
            // is unused for this provider (see s3.service.ts firebase branches).
            return {
                provider,
                region: 'auto',
                bucketName: process.env.FIREBASE_STORAGE_BUCKET,
                forcePathStyle: false,
                credentials: { accessKeyId: '', secretAccessKey: '' },
                publicBaseUrl: process.env.FIREBASE_STORAGE_PUBLIC_BASE_URL,
            };
        case 'railway':
            return {
                provider,
                region: process.env.RAILWAY_BUCKET_REGION || 'auto',
                endpoint: process.env.RAILWAY_BUCKET_ENDPOINT,
                bucketName: process.env.RAILWAY_BUCKET_NAME,
                forcePathStyle: true,
                credentials: {
                    accessKeyId: process.env.RAILWAY_BUCKET_ACCESS_KEY_ID || '',
                    secretAccessKey: process.env.RAILWAY_BUCKET_SECRET_ACCESS_KEY || '',
                },
                publicBaseUrl: process.env.RAILWAY_BUCKET_PUBLIC_BASE_URL,
            };
        default:
            throw new Error(`Unsupported STORAGE_PROVIDER: '${provider}'`);
    }
};

const target = resolveStorageTarget();

const s3 = new S3Client({
    region: target.region,
    endpoint: target.endpoint,
    forcePathStyle: target.forcePathStyle,
    credentials: target.credentials,
});

export default s3;
