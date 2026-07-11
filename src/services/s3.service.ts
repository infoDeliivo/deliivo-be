import {
    PutObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    CopyObjectCommand,
    DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import s3, { resolveStorageTarget } from "../config/s3.config.js";
import { getStorageBucket } from "../config/firebase.config.js";
import { logError } from "../utils/logger.js";

/** Prefix for staged uploads awaiting confirmation. A bucket lifecycle rule expires these. */
export const TMP_PREFIX = 'tmp';
/** Prefix for confirmed/permanent objects. */
export const PERMANENT_PREFIX = 'uploads';

/**
 * Extract the owner id embedded in a permanent object key.
 * Permanent keys are `uploads/<folder>/<ownerId>/<uuid>.<ext>`, so the owner is the
 * third path segment. Returns null for anything that is not a permanent key (e.g. a
 * staged `tmp/` key or a malformed value) — callers treat that as "not owned".
 */
export const ownerIdFromKey = (key: string): string | null => {
    const parts = key.split('/');
    return parts.length >= 4 && parts[0] === PERMANENT_PREFIX ? parts[2] : null;
};

/**
 * Recover the object key from a stored public URL. Public URLs across all providers
 * (S3 / R2 / Railway / GCS) end in `.../<PERMANENT_PREFIX>/<folder>/<owner>/<file>`,
 * so the key is everything from `uploads/` onward. Returns null if not found.
 */
export const keyFromPublicUrl = (url: string): string | null => {
    const marker = `/${PERMANENT_PREFIX}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    // Strip any query string (signed URLs) and decode percent-encoding.
    const raw = url.slice(idx + 1).split('?')[0];
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
};

/**
 * Build the public URL for an object key from the active provider's config.
 */
export const buildPublicUrl = (key: string): string => {
    const t = resolveStorageTarget();
    if (t.publicBaseUrl) return `${t.publicBaseUrl.replace(/\/$/, '')}/${key}`;
    if (t.provider === 'r2') {
        return `https://${t.bucketName}.${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;
    }
    if (t.provider === 'firebase') {
        // Public objects served from the GCS public host (bucket must grant public read on uploads/).
        return `https://storage.googleapis.com/${t.bucketName}/${key}`;
    }
    if (t.provider === 's3') {
        return `https://${t.bucketName}.s3.${t.region}.amazonaws.com/${key}`;
    }
    if (t.endpoint) {
        // Railway / generic path-style endpoint
        return `${t.endpoint.replace(/\/$/, '')}/${t.bucketName}/${key}`;
    }
    throw new Error(`buildPublicUrl: no public URL configured for provider '${t.provider}'`);
};

/* ============================================================
 *  PRESIGNED DIRECT-TO-BUCKET UPLOAD FLOW
 * ============================================================ */

export interface PresignUploadInput {
    folder: string;
    ownerId: string;
    contentType: string;
    fileExtension: string;
    expiresIn?: number;
}

export interface PresignUploadResult {
    tmpKey: string;
    uploadUrl: string;
    expiresIn: number;
}

/**
 * Generate a presigned PUT URL for a staged (tmp/) object. The client uploads the
 * bytes directly to the bucket; nothing is persisted until confirmUpload.
 */
export const getPresignedUploadUrl = async (input: PresignUploadInput): Promise<PresignUploadResult> => {
    const { folder, ownerId, contentType, fileExtension } = input;
    const expiresIn = input.expiresIn ?? 300;
    const tmpKey = `${TMP_PREFIX}/${folder}/${ownerId}/${uuidv4()}.${fileExtension}`;

    const t = resolveStorageTarget();

    if (t.provider === 'firebase') {
        const [uploadUrl] = await getStorageBucket().file(tmpKey).getSignedUrl({
            version: 'v4',
            action: 'write',
            expires: Date.now() + expiresIn * 1000,
            contentType,
        });
        return { tmpKey, uploadUrl, expiresIn };
    }

    const command = new PutObjectCommand({
        Bucket: t.bucketName,
        Key: tmpKey,
        ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn });
    return { tmpKey, uploadUrl, expiresIn };
};

export interface HeadObjectResult {
    exists: boolean;
    contentType?: string;
    contentLength?: number;
}

/** Verify an object exists and read its content-type/size. */
export const headObject = async (key: string): Promise<HeadObjectResult> => {
    const t = resolveStorageTarget();

    if (t.provider === 'firebase') {
        const file = getStorageBucket().file(key);
        const [exists] = await file.exists();
        if (!exists) return { exists: false };
        const [md] = await file.getMetadata();
        return {
            exists: true,
            contentType: md.contentType,
            contentLength: md.size != null ? Number(md.size) : undefined,
        };
    }

    try {
        const res = await s3.send(new HeadObjectCommand({ Bucket: t.bucketName, Key: key }));
        return {
            exists: true,
            contentType: res.ContentType,
            contentLength: res.ContentLength,
        };
    } catch (error) {
        const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) {
            return { exists: false };
        }
        throw error;
    }
};

/**
 * Promote a staged object to its permanent key (copy then delete the staged copy).
 * Returns the permanent key.
 */
export const promoteObject = async (
    tmpKey: string,
    permanentKey: string,
    isPublic = false,
): Promise<string> => {
    const t = resolveStorageTarget();

    if (t.provider === 'firebase') {
        const bucket = getStorageBucket();
        await bucket.file(tmpKey).copy(bucket.file(permanentKey));
        // Public targets need public read; private docs are served via signed URLs.
        // Best-effort: makePublic() (object ACL) throws on uniform-bucket-level-access
        // buckets made public via IAM instead — a failure here must not fail confirm.
        if (isPublic) {
            try {
                await bucket.file(permanentKey).makePublic();
            } catch (error) {
                logError('promoteObject: makePublic failed (bucket may use uniform access + IAM public)', error);
            }
        }
        await bucket.file(tmpKey).delete({ ignoreNotFound: true });
        return permanentKey;
    }

    await s3.send(new CopyObjectCommand({
        Bucket: t.bucketName,
        CopySource: `${t.bucketName}/${tmpKey}`,
        Key: permanentKey,
        // Grant public read on the promoted object for public targets (avatar,
        // vehicle image, chat, draft). Private docs inherit the bucket default.
        ...(isPublic ? { ACL: 'public-read' as const } : {}),
    }));
    await s3.send(new DeleteObjectCommand({ Bucket: t.bucketName, Key: tmpKey }));
    return permanentKey;
};

/**
 * Delete an object. Best-effort: a missing object is not an error (idempotent).
 * Used to reap the previous object when a public image (avatar/vehicle) is replaced.
 */
export const deleteObject = async (key: string): Promise<void> => {
    const t = resolveStorageTarget();

    if (t.provider === 'firebase') {
        await getStorageBucket().file(key).delete({ ignoreNotFound: true });
        return;
    }

    await s3.send(new DeleteObjectCommand({ Bucket: t.bucketName, Key: key }));
};

/** Presigned GET URL for reading a private object. */
export const getPresignedDownloadUrl = async (key: string, expiresIn = 300): Promise<string> => {
    const t = resolveStorageTarget();
    if (t.provider === 'firebase') {
        const [url] = await getStorageBucket().file(key).getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + expiresIn * 1000,
        });
        return url;
    }
    const command = new GetObjectCommand({ Bucket: t.bucketName, Key: key });
    return getSignedUrl(s3, command, { expiresIn });
};
