import { ownerIdFromKey, keyFromPublicUrl } from './s3.service.js';

describe('ownerIdFromKey', () => {
    it('extracts the owner segment from a permanent key', () => {
        expect(ownerIdFromKey('uploads/vehicle-documents/user-1/abcd.jpg')).toBe('user-1');
        expect(ownerIdFromKey('uploads/avatar/u9/x.png')).toBe('u9');
    });

    it('returns null for staged (tmp/) keys', () => {
        expect(ownerIdFromKey('tmp/vehicle-documents/user-1/abcd.jpg')).toBeNull();
    });

    it('returns null for malformed or too-short keys', () => {
        expect(ownerIdFromKey('')).toBeNull();
        expect(ownerIdFromKey('foo/bar')).toBeNull();
        expect(ownerIdFromKey('uploads/vehicle-documents')).toBeNull();
        expect(ownerIdFromKey('uploads')).toBeNull();
    });
});

describe('keyFromPublicUrl', () => {
    it('recovers the key from a GCS-style public URL', () => {
        expect(
            keyFromPublicUrl(
                'https://storage.googleapis.com/bucket.app/uploads/vehicle/u1/abc.png',
            ),
        ).toBe('uploads/vehicle/u1/abc.png');
    });

    it('recovers the key from an S3-style public URL', () => {
        expect(
            keyFromPublicUrl('https://bucket.s3.eu-west-1.amazonaws.com/uploads/vehicle/u1/x.jpg'),
        ).toBe('uploads/vehicle/u1/x.jpg');
    });

    it('strips a query string (signed URL)', () => {
        expect(
            keyFromPublicUrl('https://host/uploads/vehicle/u1/x.jpg?X-Amz-Signature=abc&e=1'),
        ).toBe('uploads/vehicle/u1/x.jpg');
    });

    it('returns null when there is no uploads/ segment', () => {
        expect(keyFromPublicUrl('https://host/tmp/vehicle/u1/x.jpg')).toBeNull();
        expect(keyFromPublicUrl('not a url')).toBeNull();
    });
});
