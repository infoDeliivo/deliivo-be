import {
    PutObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    CopyObjectCommand,
    DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import { mkdir, stat, rename, unlink } from "fs/promises";
import { join, dirname } from "path";
import s3, { resolveStorageTarget } from "../config/s3.config.js";
import { getStorageBucket } from "../config/firebase.config.js";
import { createLocalUploadToken } from "./upload-token.js";

/** Prefix for staged uploads awaiting confirmation. A bucket lifecycle rule expires these. */
export const TMP_PREFIX = 'tmp';
/** Prefix for confirmed/permanent objects. */
export const PERMANENT_PREFIX = 'uploads';

const EXT_CONTENT_TYPE: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
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
    // local
    const base = process.env.UPLOAD_PUBLIC_BASE_URL?.replace(/\/$/, '') || `http://localhost:${process.env.PORT || '3000'}`;
    return `${base}/${key}`;
};

/** Local API base used to build the dev PUT-receiver URL. */
const localApiBase = (): string =>
    (process.env.UPLOAD_PUBLIC_BASE_URL?.replace(/\/$/, '') || `http://localhost:${process.env.PORT || '3000'}`);

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
 * In local mode, returns a signed URL to our own PUT receiver instead.
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

    if (t.isLocal || !t.bucketName) {
        const token = createLocalUploadToken(tmpKey, expiresIn);
        return {
            tmpKey,
            uploadUrl: `${localApiBase()}/api/v1/uploads/local/${token}`,
            expiresIn,
        };
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

    if (t.isLocal || !t.bucketName) {
        try {
            const info = await stat(join(process.cwd(), key));
            const ext = key.split('.').pop()?.toLowerCase() || '';
            return { exists: true, contentLength: info.size, contentType: EXT_CONTENT_TYPE[ext] };
        } catch {
            return { exists: false };
        }
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
export const promoteObject = async (tmpKey: string, permanentKey: string): Promise<string> => {
    const t = resolveStorageTarget();

    if (t.provider === 'firebase') {
        const bucket = getStorageBucket();
        await bucket.file(tmpKey).copy(bucket.file(permanentKey));
        await bucket.file(tmpKey).delete({ ignoreNotFound: true });
        return permanentKey;
    }

    if (t.isLocal || !t.bucketName) {
        const src = join(process.cwd(), tmpKey);
        const dest = join(process.cwd(), permanentKey);
        await mkdir(dirname(dest), { recursive: true });
        await rename(src, dest);
        return permanentKey;
    }

    await s3.send(new CopyObjectCommand({
        Bucket: t.bucketName,
        CopySource: `${t.bucketName}/${tmpKey}`,
        Key: permanentKey,
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

    if (t.isLocal || !t.bucketName) {
        try {
            await unlink(join(process.cwd(), key));
        } catch (error) {
            const e = error as { code?: string };
            if (e.code !== 'ENOENT') throw error;
        }
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
    if (t.isLocal || !t.bucketName) {
        // Dev fallback: served statically from ./uploads
        return buildPublicUrl(key);
    }
    const command = new GetObjectCommand({ Bucket: t.bucketName, Key: key });
    return getSignedUrl(s3, command, { expiresIn });
};
