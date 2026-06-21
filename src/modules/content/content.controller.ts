import { Request, Response } from 'express';
import { sendError, sendSuccess, HttpStatus } from '../../utils/index.js';
import { deletePost, listAllPosts, listPublishedPosts, upsertPost } from './content.service.js';
import { AuthRequest } from '../../types/auth.js';

export const listPublished = async (req: Request, res: Response) => {
    try {
        const posts = await listPublishedPosts(req.query.locale as string | undefined);
        return sendSuccess(res, { message: 'Published posts fetched', data: posts });
    } catch {
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to fetch published posts' });
    }
};

export const listAdminPosts = async (req: AuthRequest, res: Response) => {
    try {
        const posts = await listAllPosts();
        return sendSuccess(res, { message: 'Content posts fetched', data: posts });
    } catch {
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to fetch content posts' });
    }
};

export const saveAdminPost = async (req: AuthRequest, res: Response) => {
    try {
        const post = await upsertPost(req.body, req.user.id);
        return sendSuccess(res, { message: 'Content post saved', data: post });
    } catch (error: any) {
        if (error.message === 'SLUG_EXISTS') {
            return sendError(res, { status: HttpStatus.CONFLICT, message: 'Slug already exists' });
        }
        if (error.message === 'POST_NOT_FOUND') {
            return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Content post not found' });
        }
        if (error.message === 'INVALID_SLUG') {
            return sendError(res, { status: HttpStatus.BAD_REQUEST, message: 'Invalid slug' });
        }
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to save content post' });
    }
};

export const removeAdminPost = async (req: AuthRequest, res: Response) => {
    try {
        const result = await deletePost(req.params.id as string);
        return sendSuccess(res, { message: 'Content post deleted', data: result });
    } catch (error: any) {
        if (error.message === 'POST_NOT_FOUND') {
            return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Content post not found' });
        }
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to delete content post' });
    }
};
