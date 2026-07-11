# Vehicle and profile image storage

Production uploads use an existing bucket: AWS S3, Cloudflare R2, or a Railway bucket (all S3-compatible), or Firebase Storage (Google Cloud Storage). Local uploads are intended for development because Railway container storage is ephemeral.

## Choosing the provider — `STORAGE_PROVIDER`

A single env var selects the bucket. `s3`, `r2`, and `railway` are S3-compatible and share one code path; `firebase` is Google Cloud Storage and uses the firebase-admin SDK. Migrating between S3-compatible buckets is a config change, no code change.

```env
STORAGE_PROVIDER=s3 | r2 | railway | firebase | local   # unset defaults to railway
```

The legacy `PROFILE_IMAGE_STORAGE_PROVIDER` is still read as a fallback for one release, but `STORAGE_PROVIDER` wins.

### Cloudflare R2

```env
STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=<account-id>
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_BUCKET_NAME=<existing-bucket-name>
R2_ACCESS_KEY_ID=<r2-access-key>
R2_SECRET_ACCESS_KEY=<r2-secret-key>
R2_PUBLIC_BASE_URL=https://<public-bucket-or-custom-domain>
```

### Firebase Storage (Google Cloud Storage)

Reuses the same Firebase credentials as push notifications (`FIREBASE_SERVICE_ACCOUNT_*` or `GOOGLE_APPLICATION_CREDENTIALS`). The service account must be able to sign URLs (a private-key service account, or IAM `signBlob` on GCP).

```env
STORAGE_PROVIDER=firebase
FIREBASE_STORAGE_BUCKET=<your-bucket>.appspot.com
# Optional CDN/custom domain; else public objects serve from https://storage.googleapis.com/<bucket>/<key>
FIREBASE_STORAGE_PUBLIC_BASE_URL=
```

Public targets (avatar, vehicle image) require the bucket to grant public read on the `uploads/` prefix; private targets (documents) are always served via short-lived V4 signed URLs. Staged `tmp/` objects should be expired with a GCS lifecycle rule (via `gcloud`/console), since the S3 lifecycle script does not apply to GCS.

### AWS S3

```env
STORAGE_PROVIDER=s3
AWS_ACCESS_KEY_ID=<key>
AWS_SECRET_ACCESS_KEY=<secret>
AWS_REGION=<region>
AWS_S3_BUCKET_NAME=<existing-bucket>
AWS_S3_PUBLIC_BASE_URL=<public-base-url>
```

### Railway bucket (S3-compatible)

```env
STORAGE_PROVIDER=railway
RAILWAY_BUCKET_ENDPOINT=<s3-endpoint>
RAILWAY_BUCKET_ACCESS_KEY_ID=<key>
RAILWAY_BUCKET_SECRET_ACCESS_KEY=<secret>
RAILWAY_BUCKET_NAME=<bucket>
RAILWAY_BUCKET_REGION=auto
RAILWAY_BUCKET_PUBLIC_BASE_URL=<public-base-url>   # public targets only
```

The bucket must exist before deployment and the credentials must have object read/write access to that exact bucket. An upload error saying the configured bucket does not exist means the bucket-name variable does not match a bucket available to those credentials.

## Presigned direct-to-bucket upload flow

Clients no longer POST files through the API. They upload directly to the bucket using a short-lived presigned URL, then confirm.

1. **Presign** — `POST /api/v1/uploads/presign`
   ```json
   { "target": "avatar" | "vehicle_image" | "vehicle_document",
     "contentType": "image/jpeg",
     "fileExtension": "jpg",
     "vehicleId": "<uuid, for vehicle targets>",
     "documentType": "DRIVING_LICENSE (for vehicle_document)" }
   ```
   Returns `{ key, uploadUrl, method: "PUT", headers: { "Content-Type": ... }, expiresIn }`.
   The `key` is a staged object under `tmp/`.

2. **Upload** — the client `PUT`s the raw bytes to `uploadUrl` with the returned `Content-Type` header. No API involvement.

3. **Confirm** — `POST /api/v1/uploads/confirm` with `{ target, key, vehicleId?, documentType? }`.
   The API verifies the caller owns the key, HeadObjects the staged object (existence, content-type, size ≤ 5 MB), promotes it from `tmp/` to `uploads/`, and persists:
   - `avatar` → `User.avatarUrl` + `avatarKey` (public)
   - `vehicle_image` → `Vehicle.imageUrl` + `imageKey` (public)
   - `vehicle_document` → new `VehicleDocument` row with `imageKey` + `documentType` (private)

4. **Read (private targets)** — `GET /api/v1/uploads/read?target=vehicle_document&vehicleId=<id>&key=<key>` returns a short-lived signed GET URL. Public targets store a directly usable URL and need no read call.

### Visibility

`avatar` and `vehicle_image` are **public** (URL stored in DB). `vehicle_document` (including driving licenses) is **private** — no public URL is stored; reads are signed on demand. Configure the bucket so `vehicle-documents/` objects are **not** public-read.

## Required bucket configuration (ops)

Direct browser uploads and the tmp/ lifecycle are bucket-level concerns not enforceable from app code:

- **CORS** — allow `PUT` (and `GET` for signed reads) from the web app origin(s), with the `Content-Type` header. Example (S3/R2/Railway/GCS JSON):
  ```json
  [{ "AllowedOrigins": ["https://app.deliivo.com"],
     "AllowedMethods": ["PUT", "GET"],
     "AllowedHeaders": ["Content-Type"],
     "MaxAgeSeconds": 3000 }]
  ```
- **Lifecycle rule** — expire objects under the `tmp/` prefix after 1 day. This auto-reclaims uploads that were presigned but never confirmed (orphans).
- **Private documents** — `vehicle-documents/` must not be publicly readable; access only via the signed GET URL from `/uploads/read`.

## Local development

With `STORAGE_PROVIDER=local`, presign returns a URL to the API's own token-authenticated `PUT /api/v1/uploads/local/:token` receiver, which writes to `./uploads` (and `./tmp` for staged files). Served statically from `/uploads`. No bucket needed.
