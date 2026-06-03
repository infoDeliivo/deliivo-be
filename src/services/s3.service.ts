import { PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import s3 from "../config/s3.config.js";
import { logError } from '../utils/logger.js';

export interface S3UploadResult {
    success: boolean;
    url?: string;
    key?: string;
    error?: string;
}

export interface S3UploadOptions {
    folder: string; // e.g., 'avatar', 'vehicles', 'documents'
    file: Express.Multer.File;
}

/**
 * Uploads a file to S3 and returns the URL or error status
 */
export const uploadToS3 = async (options: S3UploadOptions): Promise<S3UploadResult> => {
    const { folder, file } = options;

    try {
        // Validate required environment variables
        const bucketName = process.env.AWS_S3_BUCKET_NAME;
        const region = process.env.AWS_REGION;

        if (!bucketName) {
            return {
                success: false,
                error: "AWS_S3_BUCKET_NAME is not configured",
            };
        }

        if (!region) {
            return {
                success: false,
                error: "AWS_REGION is not configured",
            };
        }

        // Generate unique key for the file
        const fileExtension = file.originalname.split(".").pop();
        const key = `uploads/${folder}/${uuidv4()}.${fileExtension}`;

        // Create and send the upload command
        const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype,
        });

        await s3.send(command);

        // Construct the public URL
        const url = `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;

        return {
            success: true,
            url,
            key,
        };
    } catch (error) {
        logError('S3 upload error', error);

        const errorMessage = error instanceof Error ? error.message : "Unknown S3 upload error";

        return {
            success: false,
            error: errorMessage,
        };
    }
};

/**
 * Uploads multiple files to S3
 */
export const uploadMultipleToS3 = async (
    folder: string,
    files: Express.Multer.File[]
): Promise<S3UploadResult[]> => {
    const results = await Promise.all(
        files.map((file) => uploadToS3({ folder, file }))
    );
    return results;
};
