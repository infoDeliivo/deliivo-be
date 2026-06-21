import express from 'express';
import { validate } from '../../middlewares/index.js';
import { createSosSchema } from './safety.validator.js';
import { createSos } from './safety.controller.js';

const router = express.Router();

router.post('/sos', validate({ body: createSosSchema }), createSos as unknown as express.RequestHandler);

export default router;
