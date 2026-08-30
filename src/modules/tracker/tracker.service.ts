import { Prisma, TrackerProductArea, TrackerTicketPriority, TrackerTicketStatus, TrackerTicketType } from '@prisma/client';
import { prisma } from '../../config/index.js';

const personSelect = {
    id: true,
    firstName: true,
    lastName: true,
    email: true,
    avatarUrl: true,
} as const;

const boardInclude = {
    assignee: { select: personSelect },
    _count: {
        select: {
            comments: true,
            attachments: true,
            checklistItems: true,
        },
    },
    checklistItems: {
        select: {
            done: true,
        },
    },
} as const;

const detailInclude = {
    assignee: { select: personSelect },
    createdBy: { select: personSelect },
    updatedBy: { select: personSelect },
    comments: {
        orderBy: { createdAt: 'asc' as const },
        include: {
            author: { select: personSelect },
        },
    },
    attachments: {
        orderBy: { createdAt: 'asc' as const },
        include: {
            uploadedBy: { select: personSelect },
        },
    },
    checklistItems: {
        orderBy: { sortOrder: 'asc' as const },
    },
    _count: {
        select: {
            comments: true,
            attachments: true,
            checklistItems: true,
        },
    },
} as const;

type BoardTicketRecord = Prisma.TrackerTicketGetPayload<{ include: typeof boardInclude }>;
type DetailTicketRecord = Prisma.TrackerTicketGetPayload<{ include: typeof detailInclude }>;
type TicketRecordLike = {
    id: string;
    productArea: TrackerProductArea;
    title: string;
    summary: string | null;
    ticketType: TrackerTicketType;
    priority: TrackerTicketPriority;
    status: TrackerTicketStatus;
    assigneeId: string | null;
    assigneeName: string | null;
    assignee: TicketPerson | null;
    dueDate: Date | null;
    description: string | null;
    acceptanceCriteria: string | null;
    notes: string | null;
    blockerReason: string | null;
    releaseTarget: string | null;
    externalLinksJson: Prisma.JsonValue | null;
    metadataJson: Prisma.JsonValue | null;
    sortOrder: number;
    _count: {
        comments: number;
        attachments: number;
        checklistItems: number;
    };
    checklistItems: Array<{ done: boolean }>;
    createdAt: Date;
    updatedAt: Date;
};

type TicketPerson = {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    avatarUrl: string | null;
};

const toPerson = (person: TicketPerson | null | undefined) => person ? {
    id: person.id,
    firstName: person.firstName,
    lastName: person.lastName,
    email: person.email,
    avatarUrl: person.avatarUrl,
} : null;

const fullName = (person: TicketPerson | null | undefined) => {
    if (!person) return null;
    const name = [person.firstName, person.lastName].filter(Boolean).join(' ').trim();
    return name || person.email || person.id;
};

const toBoardTicket = (ticket: TicketRecordLike) => ({
    id: ticket.id,
    productArea: ticket.productArea,
    title: ticket.title,
    summary: ticket.summary,
    ticketType: ticket.ticketType,
    priority: ticket.priority,
    status: ticket.status,
    assigneeId: ticket.assigneeId,
    assigneeName: ticket.assigneeName || fullName(ticket.assignee),
    assignee: toPerson(ticket.assignee),
    dueDate: ticket.dueDate,
    description: ticket.description,
    acceptanceCriteria: ticket.acceptanceCriteria,
    notes: ticket.notes,
    blockerReason: ticket.blockerReason,
    releaseTarget: ticket.releaseTarget,
    externalLinksJson: ticket.externalLinksJson,
    metadataJson: ticket.metadataJson,
    sortOrder: ticket.sortOrder,
    commentsCount: ticket._count.comments,
    attachmentsCount: ticket._count.attachments,
    checklistTotalCount: ticket._count.checklistItems,
    checklistDoneCount: ticket.checklistItems.filter((item) => item.done).length,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
});

const toDetailTicket = (ticket: DetailTicketRecord) => ({
    ...toBoardTicket(ticket),
    createdById: ticket.createdById,
    createdBy: toPerson(ticket.createdBy),
    updatedById: ticket.updatedById,
    updatedBy: toPerson(ticket.updatedBy),
    comments: ticket.comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
        authorId: comment.authorId,
        author: toPerson(comment.author),
        authorName: fullName(comment.author),
    })),
    attachments: ticket.attachments.map((attachment) => ({
        id: attachment.id,
        label: attachment.label,
        url: attachment.url,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        createdAt: attachment.createdAt,
        uploadedById: attachment.uploadedById,
        uploadedBy: toPerson(attachment.uploadedBy),
        uploadedByName: fullName(attachment.uploadedBy),
    })),
    checklistItems: ticket.checklistItems.map((item) => ({
        id: item.id,
        label: item.label,
        done: item.done,
        sortOrder: item.sortOrder,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
    })),
});

const getTicketOrThrow = async (ticketId: string) => {
    const ticket = await prisma.trackerTicket.findUnique({
        where: { id: ticketId },
        include: detailInclude,
    });

    if (!ticket) throw new Error('TICKET_NOT_FOUND');
    return ticket;
};

export const listTickets = async (productArea?: TrackerProductArea) => {
    const tickets = await prisma.trackerTicket.findMany({
        where: productArea ? { productArea } : undefined,
        orderBy: [
            { status: 'asc' },
            { priority: 'desc' },
            { dueDate: 'asc' },
            { sortOrder: 'asc' },
            { updatedAt: 'desc' },
        ],
        include: boardInclude,
    });

    return tickets.map(toBoardTicket);
};

export const getTicket = async (ticketId: string) => {
    const ticket = await getTicketOrThrow(ticketId);
    return toDetailTicket(ticket);
};

type TicketWriteInput = {
    productArea: TrackerProductArea;
    title: string;
    summary?: string | null;
    ticketType: TrackerTicketType;
    priority?: TrackerTicketPriority;
    status?: TrackerTicketStatus;
    assigneeId?: string | null;
    assigneeName?: string | null;
    dueDate?: string | null;
    description?: string | null;
    acceptanceCriteria?: string | null;
    notes?: string | null;
    blockerReason?: string | null;
    releaseTarget?: string | null;
    externalLinksJson?: Prisma.InputJsonValue | null;
    metadataJson?: Prisma.InputJsonValue | null;
    sortOrder?: number;
};

export const createTicket = async (input: TicketWriteInput, actorId: string | null) => {
    const created = await prisma.trackerTicket.create({
        data: {
            productArea: input.productArea,
            title: input.title,
            summary: input.summary?.trim() || null,
            ticketType: input.ticketType,
            priority: input.priority ?? 'MEDIUM',
            status: input.status ?? 'TODO',
            assigneeId: input.assigneeId || null,
            assigneeName: input.assigneeName?.trim() || null,
            dueDate: input.dueDate ? new Date(input.dueDate) : null,
            description: input.description?.trim() || null,
            acceptanceCriteria: input.acceptanceCriteria?.trim() || null,
            notes: input.notes?.trim() || null,
            blockerReason: input.blockerReason?.trim() || null,
            releaseTarget: input.releaseTarget?.trim() || null,
            externalLinksJson: normalizeNullableJson(input.externalLinksJson),
            metadataJson: normalizeNullableJson(input.metadataJson),
            sortOrder: input.sortOrder ?? 0,
            createdById: actorId,
            updatedById: actorId,
        },
        include: detailInclude,
    });

    return toDetailTicket(created);
};

export const updateTicket = async (ticketId: string, input: Partial<TicketWriteInput>, actorId: string | null) => {
    await getTicketOrThrow(ticketId);

    const updated = await prisma.trackerTicket.update({
        where: { id: ticketId },
        data: {
            ...(input.productArea ? { productArea: input.productArea } : {}),
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.summary !== undefined ? { summary: input.summary?.trim() || null } : {}),
            ...(input.ticketType ? { ticketType: input.ticketType } : {}),
            ...(input.priority ? { priority: input.priority } : {}),
            ...(input.status ? { status: input.status } : {}),
            ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId || null } : {}),
            ...(input.assigneeName !== undefined ? { assigneeName: input.assigneeName?.trim() || null } : {}),
            ...(input.dueDate !== undefined ? { dueDate: input.dueDate ? new Date(input.dueDate) : null } : {}),
            ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
            ...(input.acceptanceCriteria !== undefined ? { acceptanceCriteria: input.acceptanceCriteria?.trim() || null } : {}),
            ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
            ...(input.blockerReason !== undefined ? { blockerReason: input.blockerReason?.trim() || null } : {}),
            ...(input.releaseTarget !== undefined ? { releaseTarget: input.releaseTarget?.trim() || null } : {}),
            ...(input.externalLinksJson !== undefined ? { externalLinksJson: normalizeNullableJson(input.externalLinksJson) } : {}),
            ...(input.metadataJson !== undefined ? { metadataJson: normalizeNullableJson(input.metadataJson) } : {}),
            ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
            updatedById: actorId,
        },
        include: detailInclude,
    });

    return toDetailTicket(updated);
};

export const addComment = async (ticketId: string, body: string, actorId: string | null) => {
    await getTicketOrThrow(ticketId);
    const comment = await prisma.trackerComment.create({
        data: {
            ticketId,
            body,
            authorId: actorId,
        },
        include: {
            author: { select: personSelect },
        },
    });

    return {
        id: comment.id,
        body: comment.body,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
        authorId: comment.authorId,
        author: toPerson(comment.author),
        authorName: fullName(comment.author),
    };
};

export const addAttachment = async (
    ticketId: string,
    input: { label: string; url: string; mimeType?: string | null; sizeBytes?: number | null },
    actorId: string | null,
) => {
    await getTicketOrThrow(ticketId);
    const attachment = await prisma.trackerAttachment.create({
        data: {
            ticketId,
            label: input.label,
            url: input.url,
            mimeType: input.mimeType || null,
            sizeBytes: input.sizeBytes ?? null,
            uploadedById: actorId,
        },
        include: {
            uploadedBy: { select: personSelect },
        },
    });

    return {
        id: attachment.id,
        label: attachment.label,
        url: attachment.url,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        createdAt: attachment.createdAt,
        uploadedById: attachment.uploadedById,
        uploadedBy: toPerson(attachment.uploadedBy),
        uploadedByName: fullName(attachment.uploadedBy),
    };
};

export const addChecklistItem = async (ticketId: string, input: { label: string; sortOrder?: number; done?: boolean }) => {
    await getTicketOrThrow(ticketId);
    const item = await prisma.trackerChecklistItem.create({
        data: {
            ticketId,
            label: input.label,
            sortOrder: input.sortOrder ?? 0,
            done: input.done ?? false,
        },
    });

    return {
        id: item.id,
        label: item.label,
        done: item.done,
        sortOrder: item.sortOrder,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
    };
};

export const updateChecklistItem = async (
    itemId: string,
    input: { label?: string; done?: boolean; sortOrder?: number },
) => {
    const item = await prisma.trackerChecklistItem.update({
        where: { id: itemId },
        data: {
            ...(input.label !== undefined ? { label: input.label } : {}),
            ...(input.done !== undefined ? { done: input.done } : {}),
            ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        },
    });

    return {
        id: item.id,
        label: item.label,
        done: item.done,
        sortOrder: item.sortOrder,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
    };
};

export const deleteChecklistItem = async (itemId: string) => {
    await prisma.trackerChecklistItem.delete({ where: { id: itemId } });
    return { deleted: true };
};

export const deleteComment = async (commentId: string) => {
    await prisma.trackerComment.delete({ where: { id: commentId } });
    return { deleted: true };
};

export const deleteAttachment = async (attachmentId: string) => {
    await prisma.trackerAttachment.delete({ where: { id: attachmentId } });
    return { deleted: true };
};

export const ticketEnums = {
    productAreas: ['WEBAPP', 'MOBILE_APP'] as const,
    ticketTypes: ['BUG', 'STORY', 'TASK', 'CHORE', 'IMPROVEMENT'] as const,
    priorities: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const,
    statuses: ['TODO', 'IN_PROGRESS', 'IN_TESTING', 'DONE'] as const,
};

function normalizeNullableJson(value: Prisma.InputJsonValue | null | undefined) {
    if (value === null) return Prisma.DbNull;
    return value;
}
