import { Response } from 'express';
import { AuthRequest } from '../../types/auth.js';
import { HttpStatus, sendError, sendSuccess } from '../../utils/index.js';
import { logError } from '../../utils/logger.js';
import * as TrackerService from './tracker.service.js';

export const listTickets = async (req: AuthRequest, res: Response) => {
    try {
        const tickets = await TrackerService.listTickets(req.query.productArea as 'WEBAPP' | 'MOBILE_APP' | undefined);
        return sendSuccess(res, { message: 'Tracker tickets fetched', data: tickets });
    } catch (error) {
        logError('[TRACKER] list tickets failed', error, { productArea: req.query.productArea });
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to fetch tracker tickets' });
    }
};

export const getTicket = async (req: AuthRequest, res: Response) => {
    try {
        const ticket = await TrackerService.getTicket(req.params.id as string);
        return sendSuccess(res, { message: 'Tracker ticket fetched', data: ticket });
    } catch (error: any) {
        if (error.message === 'TICKET_NOT_FOUND') {
            return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Tracker ticket not found' });
        }
        logError('[TRACKER] get ticket failed', error, { ticketId: req.params.id });
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to fetch tracker ticket' });
    }
};

export const createTicket = async (req: AuthRequest, res: Response) => {
    try {
        const ticket = await TrackerService.createTicket(req.body, req.user?.id ?? null);
        return sendSuccess(res, { status: HttpStatus.CREATED, message: 'Tracker ticket created', data: ticket });
    } catch (error) {
        logError('[TRACKER] create ticket failed', error, { body: req.body });
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to create tracker ticket' });
    }
};

export const updateTicket = async (req: AuthRequest, res: Response) => {
    try {
        const ticket = await TrackerService.updateTicket(req.params.id as string, req.body, req.user?.id ?? null);
        return sendSuccess(res, { message: 'Tracker ticket updated', data: ticket });
    } catch (error: any) {
        if (error.message === 'TICKET_NOT_FOUND') {
            return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Tracker ticket not found' });
        }
        logError('[TRACKER] update ticket failed', error, { ticketId: req.params.id });
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to update tracker ticket' });
    }
};

export const addComment = async (req: AuthRequest, res: Response) => {
    try {
        const comment = await TrackerService.addComment(req.params.id as string, req.body.body, req.user?.id ?? null);
        return sendSuccess(res, { status: HttpStatus.CREATED, message: 'Tracker comment created', data: comment });
    } catch (error: any) {
        if (error.message === 'TICKET_NOT_FOUND') {
            return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Tracker ticket not found' });
        }
        logError('[TRACKER] add comment failed', error, { ticketId: req.params.id });
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to add tracker comment' });
    }
};

export const addAttachment = async (req: AuthRequest, res: Response) => {
    try {
        const attachment = await TrackerService.addAttachment(req.params.id as string, req.body, req.user?.id ?? null);
        return sendSuccess(res, { status: HttpStatus.CREATED, message: 'Tracker attachment added', data: attachment });
    } catch (error: any) {
        if (error.message === 'TICKET_NOT_FOUND') {
            return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Tracker ticket not found' });
        }
        logError('[TRACKER] add attachment failed', error, { ticketId: req.params.id });
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to add tracker attachment' });
    }
};

export const addChecklistItem = async (req: AuthRequest, res: Response) => {
    try {
        const item = await TrackerService.addChecklistItem(req.params.id as string, req.body);
        return sendSuccess(res, { status: HttpStatus.CREATED, message: 'Checklist item added', data: item });
    } catch (error: any) {
        if (error.message === 'TICKET_NOT_FOUND') {
            return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Tracker ticket not found' });
        }
        logError('[TRACKER] add checklist item failed', error, { ticketId: req.params.id });
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to add checklist item' });
    }
};

export const updateChecklistItem = async (req: AuthRequest, res: Response) => {
    try {
        const item = await TrackerService.updateChecklistItem(req.params.itemId as string, req.body);
        return sendSuccess(res, { message: 'Checklist item updated', data: item });
    } catch (error: any) {
        if (error.code === 'P2025') {
            return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Checklist item not found' });
        }
        logError('[TRACKER] update checklist item failed', error, { ticketId: req.params.id, itemId: req.params.itemId });
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to update checklist item' });
    }
};

export const deleteChecklistItem = async (req: AuthRequest, res: Response) => {
    try {
        const result = await TrackerService.deleteChecklistItem(req.params.itemId as string);
        return sendSuccess(res, { message: 'Checklist item deleted', data: result });
    } catch (error: any) {
        if (error.code === 'P2025') {
            return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Checklist item not found' });
        }
        logError('[TRACKER] delete checklist item failed', error, { ticketId: req.params.id, itemId: req.params.itemId });
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to delete checklist item' });
    }
};

export const deleteComment = async (req: AuthRequest, res: Response) => {
    try {
        const result = await TrackerService.deleteComment(req.params.commentId as string);
        return sendSuccess(res, { message: 'Comment deleted', data: result });
    } catch (error: any) {
        if (error.code === 'P2025') {
            return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Comment not found' });
        }
        logError('[TRACKER] delete comment failed', error, { ticketId: req.params.id, commentId: req.params.commentId });
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to delete comment' });
    }
};

export const deleteAttachment = async (req: AuthRequest, res: Response) => {
    try {
        const result = await TrackerService.deleteAttachment(req.params.attachmentId as string);
        return sendSuccess(res, { message: 'Attachment deleted', data: result });
    } catch (error: any) {
        if (error.code === 'P2025') {
            return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Attachment not found' });
        }
        logError('[TRACKER] delete attachment failed', error, { ticketId: req.params.id, attachmentId: req.params.attachmentId });
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to delete attachment' });
    }
};
