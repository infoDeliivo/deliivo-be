# Vehicle and profile image storage

Production uploads must use an existing Cloudflare R2 or AWS S3 bucket. Local uploads are intended for development because Railway container storage is ephemeral.

## Cloudflare R2

Set these Railway variables:

```env
PROFILE_IMAGE_STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=<account-id>
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_BUCKET_NAME=<existing-bucket-name>
R2_ACCESS_KEY_ID=<r2-access-key>
R2_SECRET_ACCESS_KEY=<r2-secret-key>
R2_PUBLIC_BASE_URL=https://<public-bucket-or-custom-domain>
```

The bucket must be created before deployment, and the API token must have object write access to that exact bucket. `R2_PUBLIC_BASE_URL` must serve objects publicly so uploaded vehicle images are visible in the web application.

## AWS S3

Set `PROFILE_IMAGE_STORAGE_PROVIDER=aws` and configure `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET_NAME`, and `AWS_S3_PUBLIC_BASE_URL` for an existing bucket.

An upload error saying the configured bucket does not exist means the bucket-name environment variable does not match a bucket available to those credentials.
