import { Router } from 'express';
import type { RequestHandler } from 'express';
import { validate } from '../../middlewares/validate.js';
import * as controller from './uploads.controller.js';
import { presignSchema, confirmSchema, readSchema, deleteSchema } from './uploads.validator.js';

const router = Router();

// Step 1: get a presigned PUT URL for a staged (tmp/) object.
router.post('/presign', validate({ body: presignSchema }), controller.getPresign as unknown as RequestHandler);

// Step 2: verify the uploaded object, promote it, and persist to DB.
router.post('/confirm', validate({ body: confirmSchema }), controller.confirmUpload as unknown as RequestHandler);

// Read a private object via a short-lived signed GET URL.
router.get('/read', validate({ query: readSchema }), controller.readUrl as unknown as RequestHandler);

// Delete a persisted image (avatar / vehicle image / vehicle document).
router.delete('/', validate({ query: deleteSchema }), controller.deleteUpload as unknown as RequestHandler);

export default router;
