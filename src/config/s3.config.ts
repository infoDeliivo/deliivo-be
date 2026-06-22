import { S3Client } from "@aws-sdk/client-s3";
import { configDotenv } from "dotenv";
configDotenv({ quiet: true });

const storageProvider = process.env.PROFILE_IMAGE_STORAGE_PROVIDER?.toLowerCase();
const isR2 = storageProvider === 'r2' || !!process.env.R2_ENDPOINT;

const s3 = new S3Client({
    region: isR2 ? 'auto' : (process.env.AWS_REGION || 'us-east-1'),
    endpoint: isR2 ? process.env.R2_ENDPOINT : undefined,
    forcePathStyle: isR2,
    credentials: {
        accessKeyId: (isR2 ? process.env.R2_ACCESS_KEY_ID : process.env.AWS_ACCESS_KEY_ID) || "",
        secretAccessKey: (isR2 ? process.env.R2_SECRET_ACCESS_KEY : process.env.AWS_SECRET_ACCESS_KEY) || "",
    },
});

export default s3;
