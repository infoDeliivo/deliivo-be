# Profile Image Storage - Cloudflare R2

Status: Implemented for backend-mediated uploads  
Date: 2026-06-21

## Decision

Do not store profile images as binary data in PostgreSQL. Store only image metadata on `User`:

- `avatarUrl`: public URL used by web and mobile clients.
- `avatarKey`: provider object key for future cleanup/replacement.

Use Cloudflare R2 as the preferred low-cost object storage option. The existing backend upload endpoint remains the API surface:

`POST /api/v1/users/me/avatar`

The endpoint accepts a multipart `image` file, uploads it to configured storage, and updates the current user.

## Storage Strategy

- Provider: Cloudflare R2, S3-compatible API.
- Bucket: private write, public read through custom domain or controlled public bucket URL.
- Object key pattern: `uploads/avatar/{userId}/{uuid}.{ext}`.
- Database fields:
  - `User.avatarUrl`
  - `User.avatarKey`
- Upload model:
  - web sends the image to the backend;
  - backend validates file type/size through Multer/Zod;
  - backend uploads to R2/S3/local fallback;
  - backend updates user avatar metadata.

Direct browser-to-R2 pre-signed uploads are deferred until upload volume makes backend-mediated uploads a bottleneck.

## User Setup Steps

1. Create a Cloudflare account or open the Cloudflare dashboard.
2. Go to `R2 Object Storage` and create a bucket named `deliivo-profile-images`.
3. Create an R2 API token with object read/write access for that bucket.
4. Copy these values:
   - Account ID
   - Access Key ID
   - Secret Access Key
   - Bucket name
5. In the bucket settings, configure one public access method:
   - recommended: connect a custom domain such as `images.deliivo.com`;
   - acceptable for dev: enable/use the R2 public development URL.
6. Put those values into root `.env`.
7. Rebuild/restart Docker so the backend receives the new environment.
8. Run Prisma migrations so `User.avatarKey` exists.

## Required Environment Variables

```env
PROFILE_IMAGE_STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=deliivo-profile-images
R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
R2_PUBLIC_BASE_URL=https://cdn.deliivo.com
PROFILE_IMAGE_MAX_SIZE_MB=5
PROFILE_IMAGE_ALLOWED_TYPES=image/jpeg,image/png,image/webp
```

For local development without R2, keep:

```env
PROFILE_IMAGE_STORAGE_PROVIDER=local
```

The backend then writes to `uploads/avatar/...` and serves files from `/uploads`.

## Why R2

- Low or near-zero cost at early scale.
- No egress fees for common access patterns.
- S3-compatible SDK support.
- Avoids database bloat.
- Keeps profile media portable if the app later moves to S3 or another object store.

## Implementation Notes

- Current web upload field name is `image`, matching the backend middleware.
- Existing AWS S3 variables remain supported.
- R2 is selected by `PROFILE_IMAGE_STORAGE_PROVIDER=r2` or by providing `R2_ENDPOINT`.
- Public image URLs come from `R2_PUBLIC_BASE_URL` when set.

## Open Work

- Delete old avatar object after replacement.
- Normalize/resize profile images to WebP.
- Add image moderation policy.
- Move to pre-signed direct uploads if traffic or file size makes backend upload proxying expensive.
