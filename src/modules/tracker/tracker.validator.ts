import { z } from 'zod';

const trackerProductAreaSchema = z.enum(['WEBAPP', 'MOBILE_APP']);
const trackerTicketTypeSchema = z.enum(['BUG', 'STORY', 'TASK', 'CHORE', 'IMPROVEMENT']);
const trackerTicketPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const trackerTicketStatusSchema = z.enum(['TODO', 'IN_PROGRESS', 'IN_TESTING', 'DONE']);

const optionalJsonSchema = z.record(z.string(), z.unknown()).nullable().optional();

export const trackerListQuerySchema = z.object({
    productArea: trackerProductAreaSchema.optional(),
});

export const trackerTicketIdParamSchema = z.object({
    id: z.string().uuid('A valid tracker ticket id is required'),
});

export const trackerChecklistIdParamSchema = z.object({
    ticketId: z.string().uuid('A valid tracker ticket id is required'),
    itemId: z.string().uuid('A valid checklist item id is required'),
});

export const trackerCommentIdParamSchema = z.object({
    ticketId: z.string().uuid('A valid tracker ticket id is required'),
    commentId: z.string().uuid('A valid comment id is required'),
});

export const trackerAttachmentIdParamSchema = z.object({
    ticketId: z.string().uuid('A valid tracker ticket id is required'),
    attachmentId: z.string().uuid('A valid attachment id is required'),
});

const trackerTicketBaseSchema = z.object({
    productArea: trackerProductAreaSchema,
    title: z.string().trim().min(3).max(200),
    summary: z.string().trim().max(500).optional().nullable(),
    ticketType: trackerTicketTypeSchema,
    priority: trackerTicketPrioritySchema.default('MEDIUM').optional(),
    status: trackerTicketStatusSchema.default('TODO').optional(),
    assigneeId: z.string().uuid().optional().nullable(),
    assigneeName: z.string().trim().min(1).max(120).optional().nullable(),
    dueDate: z.string().datetime().optional().nullable(),
    description: z.string().trim().max(8000).optional().nullable(),
    acceptanceCriteria: z.string().trim().max(8000).optional().nullable(),
    notes: z.string().trim().max(8000).optional().nullable(),
    blockerReason: z.string().trim().max(8000).optional().nullable(),
    releaseTarget: z.string().trim().max(200).optional().nullable(),
    externalLinksJson: optionalJsonSchema,
    metadataJson: optionalJsonSchema,
    sortOrder: z.number().int().min(0).optional(),
});

export const trackerTicketCreateSchema = trackerTicketBaseSchema;
export const trackerTicketUpdateSchema = trackerTicketBaseSchema.partial();

export const trackerCommentCreateSchema = z.object({
    body: z.string().trim().min(1).max(8000),
});

export const trackerAttachmentCreateSchema = z.object({
    label: z.string().trim().min(1).max(200),
    url: z.string().trim().url().max(2000),
    mimeType: z.string().trim().max(120).optional().nullable(),
    sizeBytes: z.number().int().nonnegative().optional().nullable(),
});

export const trackerChecklistCreateSchema = z.object({
    label: z.string().trim().min(1).max(300),
    sortOrder: z.number().int().min(0).optional(),
    done: z.boolean().optional(),
});

export const trackerChecklistUpdateSchema = z.object({
    label: z.string().trim().min(1).max(300).optional(),
    sortOrder: z.number().int().min(0).optional(),
    done: z.boolean().optional(),
});

export type TrackerTicketInput = z.infer<typeof trackerTicketCreateSchema>;
export type TrackerTicketUpdateInput = z.infer<typeof trackerTicketUpdateSchema>;
export type TrackerCommentInput = z.infer<typeof trackerCommentCreateSchema>;
export type TrackerAttachmentInput = z.infer<typeof trackerAttachmentCreateSchema>;
export type TrackerChecklistInput = z.infer<typeof trackerChecklistCreateSchema>;
export type TrackerChecklistUpdateInput = z.infer<typeof trackerChecklistUpdateSchema>;
