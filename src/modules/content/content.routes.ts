import { Router } from 'express';
import { authorize } from '../../middlewares/auth.js';
import * as controller from './content.controller.js';

export const contentRouter = Router();
contentRouter.get('/posts', controller.listPublished);

export const adminContentRouter = Router();
adminContentRouter.use(authorize('ADMIN') as any);
adminContentRouter.get('/posts', controller.listAdminPosts as any);
adminContentRouter.get('/audit', controller.listAdminContentAudit as any);
adminContentRouter.post('/posts', controller.saveAdminPost as any);
adminContentRouter.delete('/posts/:id', controller.removeAdminPost as any);
