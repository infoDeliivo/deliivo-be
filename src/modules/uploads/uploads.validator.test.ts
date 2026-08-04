/**
 * Upload type gate: presign only accepts PNG and JPG. WEBP (and anything else)
 * must be rejected at validation time, before an upload URL is ever issued.
 */
import { presignSchema } from './uploads.validator.js';
import { ALLOWED_CONTENT_TYPES, ALLOWED_EXTENSIONS } from './uploads.constants.js';

const base = { target: 'avatar' as const };

describe('presignSchema — allowed image types', () => {
    it.each([
        ['image/jpeg', 'jpg'],
        ['image/jpeg', 'jpeg'],
        ['image/png', 'png'],
    ])('accepts %s / .%s', (contentType, fileExtension) => {
        const result = presignSchema.safeParse({ ...base, contentType, fileExtension });
        expect(result.success).toBe(true);
    });

    it.each([
        ['image/webp', 'webp'],
        ['image/gif', 'gif'],
        ['application/pdf', 'pdf'],
    ])('rejects %s / .%s', (contentType, fileExtension) => {
        const result = presignSchema.safeParse({ ...base, contentType, fileExtension });
        expect(result.success).toBe(false);
    });

    it('rejects a disallowed extension even with an allowed contentType', () => {
        const result = presignSchema.safeParse({
            ...base,
            contentType: 'image/png',
            fileExtension: 'webp',
        });
        expect(result.success).toBe(false);
    });

    it('keeps the constants as the single source of truth', () => {
        expect([...ALLOWED_CONTENT_TYPES]).toEqual(['image/jpeg', 'image/png']);
        expect([...ALLOWED_EXTENSIONS]).toEqual(['jpg', 'jpeg', 'png']);
    });
});
