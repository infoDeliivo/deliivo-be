import { Router } from 'express';
import { localUploadReceiver } from './uploads.local.js';

// Mounted with express.raw() and WITHOUT `protect` — the URL token is the auth.
const router = Router();

router.put('/:token', localUploadReceiver);

export default router;
