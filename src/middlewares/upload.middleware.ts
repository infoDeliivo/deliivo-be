import multer from 'multer';
import { Request } from 'express';

/**
 * Memory storage (NO local file saved)
 * File will be available in req.file.buffer
 */
const storage = multer.memoryStorage();

/**
 * Image validation
 */
const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
  ];
  if (!allowedMimeTypes.includes(file.mimetype)) {
    return cb(new Error('Only JPG, PNG, and WEBP images are allowed'));
  }

  cb(null, true);
};

/**
 * Single image upload middleware
 * Field name: "image"
 */
export const uploadSingleImage = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
}).single('image');
