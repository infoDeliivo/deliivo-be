import { Router } from 'express';
import { authorize } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import * as controller from './tracker.controller.js';
import {
    trackerAttachmentCreateSchema,
    trackerAttachmentIdParamSchema,
    trackerChecklistCreateSchema,
    trackerChecklistIdParamSchema,
    trackerChecklistUpdateSchema,
    trackerCommentCreateSchema,
    trackerCommentIdParamSchema,
    trackerListQuerySchema,
    trackerTicketCreateSchema,
    trackerTicketIdParamSchema,
    trackerTicketUpdateSchema,
} from './tracker.validator.js';

const router = Router();

router.use(authorize('ADMIN') as any);

router.get('/tickets', validate({ query: trackerListQuerySchema }), controller.listTickets as any);
router.get('/tickets/:id', validate({ params: trackerTicketIdParamSchema }), controller.getTicket as any);
router.post('/tickets', validate({ body: trackerTicketCreateSchema }), controller.createTicket as any);
router.put('/tickets/:id', validate({ params: trackerTicketIdParamSchema, body: trackerTicketUpdateSchema }), controller.updateTicket as any);
router.post('/tickets/:id/comments', validate({ params: trackerTicketIdParamSchema, body: trackerCommentCreateSchema }), controller.addComment as any);
router.post('/tickets/:id/attachments', validate({ params: trackerTicketIdParamSchema, body: trackerAttachmentCreateSchema }), controller.addAttachment as any);
router.delete('/tickets/:id/comments/:commentId', validate({ params: trackerCommentIdParamSchema }), controller.deleteComment as any);
router.delete('/tickets/:id/attachments/:attachmentId', validate({ params: trackerAttachmentIdParamSchema }), controller.deleteAttachment as any);
router.post('/tickets/:id/checklist-items', validate({ params: trackerTicketIdParamSchema, body: trackerChecklistCreateSchema }), controller.addChecklistItem as any);
router.patch('/tickets/:id/checklist-items/:itemId', validate({ params: trackerChecklistIdParamSchema, body: trackerChecklistUpdateSchema }), controller.updateChecklistItem as any);
router.delete('/tickets/:id/checklist-items/:itemId', validate({ params: trackerChecklistIdParamSchema }), controller.deleteChecklistItem as any);

export default router;
