import { writeFile, mkdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import {
    getPresignedUploadUrl,
    buildPublicUrl,
    deleteObject,
    TMP_PREFIX,
    PERMANENT_PREFIX,
} from '../../services/s3.service.js';
import { createLocalUploadToken, verifyLocalUploadToken } from '../../services/upload-token.js';

const ENV = { ...process.env };
afterEach(() => {
    process.env = { ...ENV };
});

describe('presigned upload key handling', () => {
    beforeEach(() => {
        process.env.STORAGE_PROVIDER = 'local';
    });

    it('stages uploads under tmp/<folder>/<ownerId>/', async () => {
        const { tmpKey, uploadUrl } = await getPresignedUploadUrl({
            folder: 'avatar',
            ownerId: 'user-123',
            contentType: 'image/png',
            fileExtension: 'png',
        });
        expect(tmpKey.startsWith(`${TMP_PREFIX}/avatar/user-123/`)).toBe(true);
        expect(tmpKey.endsWith('.png')).toBe(true);
        expect(uploadUrl).toContain('/api/v1/uploads/local/');
    });

    it('derives the permanent key by swapping the tmp/ prefix for uploads/', () => {
        const tmpKey = `${TMP_PREFIX}/vehicle/u1/abc.png`;
        const permanentKey = `${PERMANENT_PREFIX}${tmpKey.slice(TMP_PREFIX.length)}`;
        expect(permanentKey).toBe('uploads/vehicle/u1/abc.png');
    });
});

describe('local upload token', () => {
    it('round-trips a valid token', () => {
        const key = 'tmp/avatar/u1/x.png';
        const token = createLocalUploadToken(key, 300);
        expect(verifyLocalUploadToken(token)?.key).toBe(key);
    });

    it('rejects a tampered token', () => {
        const token = createLocalUploadToken('tmp/avatar/u1/x.png', 300);
        const tampered = token.slice(0, -2) + (token.endsWith('a') ? 'bb' : 'aa');
        expect(verifyLocalUploadToken(tampered)).toBeNull();
    });

    it('rejects an expired token', () => {
        const token = createLocalUploadToken('tmp/avatar/u1/x.png', -10);
        expect(verifyLocalUploadToken(token)).toBeNull();
    });
});

describe('deleteObject (local mode)', () => {
    beforeEach(() => {
        process.env.STORAGE_PROVIDER = 'local';
    });

    it('removes an existing object', async () => {
        const key = `${PERMANENT_PREFIX}/test-del/${Date.now()}.png`;
        const path = join(process.cwd(), key);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, Buffer.from('x'));

        await deleteObject(key);

        await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('is a no-op for a missing object', async () => {
        const key = `${PERMANENT_PREFIX}/test-del/does-not-exist-${Date.now()}.png`;
        await expect(deleteObject(key)).resolves.toBeUndefined();
    });
});

describe('buildPublicUrl per provider', () => {
    it('uses the AWS virtual-hosted host for s3', () => {
        process.env.STORAGE_PROVIDER = 's3';
        process.env.AWS_S3_BUCKET_NAME = 'my-bucket';
        process.env.AWS_REGION = 'eu-north-1';
        delete process.env.AWS_S3_PUBLIC_BASE_URL;
        expect(buildPublicUrl('uploads/a/b.png')).toBe(
            'https://my-bucket.s3.eu-north-1.amazonaws.com/uploads/a/b.png',
        );
    });

    it('uses the path-style endpoint for railway', () => {
        process.env.STORAGE_PROVIDER = 'railway';
        process.env.RAILWAY_BUCKET_ENDPOINT = 'https://bucket.railway.app';
        process.env.RAILWAY_BUCKET_NAME = 'deliivo';
        delete process.env.RAILWAY_BUCKET_PUBLIC_BASE_URL;
        expect(buildPublicUrl('uploads/a/b.png')).toBe(
            'https://bucket.railway.app/deliivo/uploads/a/b.png',
        );
    });

    it('honors an explicit public base URL', () => {
        process.env.STORAGE_PROVIDER = 'firebase';
        process.env.FIREBASE_STORAGE_BUCKET = 'deliivo.appspot.com';
        process.env.FIREBASE_STORAGE_PUBLIC_BASE_URL = 'https://images.deliivo.com/';
        expect(buildPublicUrl('uploads/a/b.png')).toBe('https://images.deliivo.com/uploads/a/b.png');
    });

    it('uses the R2 host for r2 without a public base URL', () => {
        process.env.STORAGE_PROVIDER = 'r2';
        process.env.R2_BUCKET_NAME = 'deliivo';
        process.env.R2_ACCOUNT_ID = 'acct123';
        delete process.env.R2_PUBLIC_BASE_URL;
        expect(buildPublicUrl('uploads/a/b.png')).toBe(
            'https://deliivo.acct123.r2.cloudflarestorage.com/uploads/a/b.png',
        );
    });

    it('uses the GCS public host for firebase without a public base URL', () => {
        process.env.STORAGE_PROVIDER = 'firebase';
        process.env.FIREBASE_STORAGE_BUCKET = 'deliivo.appspot.com';
        delete process.env.FIREBASE_STORAGE_PUBLIC_BASE_URL;
        expect(buildPublicUrl('uploads/a/b.png')).toBe(
            'https://storage.googleapis.com/deliivo.appspot.com/uploads/a/b.png',
        );
    });
});
