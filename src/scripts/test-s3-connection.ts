import { ListBucketsCommand } from "@aws-sdk/client-s3";
import s3 from "../config/s3.config";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const testS3Connection = async () => {
    try {
        console.log("Testing S3 connection...");
        console.log("Region:", process.env.AWS_REGION);
        console.log("Bucket:", process.env.AWS_S3_BUCKET_NAME);

        const command = new ListBucketsCommand({});
        const response = await s3.send(command);

        console.log("Successfully connected to S3!");
        console.log("Buckets:", response.Buckets?.map(b => b.Name).join(", ") || "No buckets found");

        // Also try to check if we can access the specific bucket
        const bucketName = process.env.AWS_S3_BUCKET_NAME;
        if (bucketName) {
            const bucketExists = response.Buckets?.some(b => b.Name === bucketName);
            if (bucketExists) {
                console.log(`Verified: Bucket '${bucketName}' exists and is accessible.`);
            } else {
                console.warn(`Warning: Bucket '${bucketName}' not found in the list of buckets.`);
            }
        } else {
            console.error("Error: AWS_S3_BUCKET_NAME is not defined in .env");
        }

    } catch (error) {
        console.error("Error connecting to S3:", error);
    }
};

testS3Connection();
