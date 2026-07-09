/**
 * One-off setup: install a bucket lifecycle rule that expires staged (tmp/) uploads.
 *
 * The presigned flow stages objects under `tmp/` and promotes confirmed ones to
 * `uploads/`. Objects that are presigned but never confirmed would otherwise linger
 * forever. This rule expires anything under `tmp/` after 1 day.
 *
 * Run once per bucket (and again if you change providers):
 *   STORAGE_PROVIDER=s3 AWS_S3_BUCKET_NAME=... npx tsx src/scripts/put-tmp-lifecycle.ts
 *   (or: node --loader ts-node/esm src/scripts/put-tmp-lifecycle.ts)
 *
 * No-op for local storage (there is no bucket; the maintenance queue sweeps the
 * on-disk tmp/ folder instead) and for firebase (GCS uses a different lifecycle API —
 * configure `tmp/` expiry with a GCS lifecycle rule via `gcloud`/console instead).
 */
import { PutBucketLifecycleConfigurationCommand } from '@aws-sdk/client-s3';
import s3, { resolveStorageTarget } from '../config/s3.config.js';
import { TMP_PREFIX } from '../services/s3.service.js';

const TMP_EXPIRY_DAYS = Number(process.env.UPLOAD_TMP_EXPIRY_DAYS || '1');

const main = async (): Promise<void> => {
    const target = resolveStorageTarget();

    if (target.provider === 'firebase') {
        console.log(
            'Storage provider is firebase (GCS). This S3 lifecycle script does not apply — ' +
                'configure a GCS lifecycle rule to expire the "tmp/" prefix via gcloud/console.',
        );
        return;
    }

    if (target.isLocal || !target.bucketName) {
        console.log(
            'Storage provider is local (no bucket). Nothing to configure — the maintenance queue sweeps ./tmp instead.',
        );
        return;
    }

    await s3.send(
        new PutBucketLifecycleConfigurationCommand({
            Bucket: target.bucketName,
            LifecycleConfiguration: {
                Rules: [
                    {
                        ID: 'expire-staged-uploads',
                        Status: 'Enabled',
                        Filter: { Prefix: `${TMP_PREFIX}/` },
                        Expiration: { Days: TMP_EXPIRY_DAYS },
                    },
                ],
            },
        }),
    );

    console.log(
        `Lifecycle rule installed on ${target.provider} bucket "${target.bucketName}": ` +
            `objects under "${TMP_PREFIX}/" expire after ${TMP_EXPIRY_DAYS} day(s).`,
    );
};

main().catch((error) => {
    console.error('Failed to install tmp/ lifecycle rule:', error);
    process.exit(1);
});
