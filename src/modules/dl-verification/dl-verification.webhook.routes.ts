import { Router } from 'express';
import * as controller from './dl-verification.controller.js';

// Mounted with express.raw() BEFORE express.json() (see src/app.ts): Veriff signs the
// exact bytes it sends, so the HMAC can only be checked against an unparsed body.
const router = Router();

// Mounted at the full path /api/v1/dl-verification/webhook so that express.raw() is
// scoped to this one route: applying it to the whole module prefix would hand the
// authenticated JSON routes a Buffer instead of a parsed body.
router.post('/', controller.webhook);

export const eventsRouter = Router();

// Veriff's event stream ("started", "submitted"). Signed with the same shared secret, so it
// needs the same unparsed body, but it is mounted on its own path: pointing both streams at
// one route would hand the decision handler flat event payloads it must reject.
eventsRouter.post('/', controller.events);

export default router;
