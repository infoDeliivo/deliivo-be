import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/index.js';

export type ContentPostCategory = 'Rider guide' | 'Driver guide' | 'Safety' | 'Product update';
export type ContentPostStatus = 'DRAFT' | 'PUBLISHED';

export interface ContentPost {
    id: string;
    slug: string;
    title: string;
    excerpt: string;
    body: string;
    category: ContentPostCategory;
    status: ContentPostStatus;
    publishedAt: string | null;
    readTime: string;
    locale: string;
    createdAt: string;
    updatedAt: string;
    createdBy: string;
    updatedBy: string;
}

export interface ContentAuditLog {
    id: string;
    postId: string;
    action: 'CREATE' | 'UPDATE' | 'DELETE';
    actorId: string;
    snapshot: ContentPost | null;
    createdAt: string;
}

function sanitizeSlug(input: string) {
    return input
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120);
}

function toContentPost(row: {
    id: string;
    slug: string;
    title: string;
    excerpt: string;
    body: string;
    category: string;
    status: string;
    publishedAt: Date | null;
    readTime: string;
    locale: string;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string;
    updatedBy: string;
}): ContentPost {
    return {
        ...row,
        category: row.category as ContentPostCategory,
        status: row.status as ContentPostStatus,
        publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

function isMissingContentTableError(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2021';
}

export async function listPublishedPosts(locale?: string) {
    try {
        const posts = await prisma.contentPost.findMany({
            where: {
                status: 'PUBLISHED',
                ...(locale ? { locale } : {}),
            },
            orderBy: [
                { publishedAt: 'desc' },
                { updatedAt: 'desc' },
            ],
        });

        return posts.map(toContentPost);
    } catch (error) {
        if (isMissingContentTableError(error)) return [];
        throw error;
    }
}

export async function listAllPosts() {
    try {
        const posts = await prisma.contentPost.findMany({
            orderBy: { updatedAt: 'desc' },
        });

        return posts.map(toContentPost);
    } catch (error) {
        if (isMissingContentTableError(error)) return [];
        throw error;
    }
}

export async function getContentSummary() {
    try {
        const [posts, published, drafts] = await Promise.all([
            prisma.contentPost.findMany({
                select: { locale: true, updatedAt: true },
                orderBy: { updatedAt: 'desc' },
            }),
            prisma.contentPost.count({ where: { status: 'PUBLISHED' } }),
            prisma.contentPost.count({ where: { status: 'DRAFT' } }),
        ]);

        const locales = Array.from(new Set(posts.map((post) => post.locale))).sort();
        return {
            total: posts.length,
            published,
            drafts,
            locales,
            updatedAt: posts[0]?.updatedAt.toISOString() || null,
        };
    } catch (error) {
        if (isMissingContentTableError(error)) {
            return {
                total: 0,
                published: 0,
                drafts: 0,
                locales: [],
                updatedAt: null,
            };
        }
        throw error;
    }
}

export async function listContentAudit(postId?: string, limit = 20): Promise<ContentAuditLog[]> {
    try {
        const audit = await prisma.contentPostAudit.findMany({
            where: postId ? { postId } : undefined,
            orderBy: { createdAt: 'desc' },
            take: Math.max(1, Math.min(100, limit)),
        });

        return audit.map((row) => ({
            id: row.id,
            postId: row.postId,
            action: row.action as 'CREATE' | 'UPDATE' | 'DELETE',
            actorId: row.actorId,
            snapshot: row.snapshot ? (row.snapshot as unknown as ContentPost) : null,
            createdAt: row.createdAt.toISOString(),
        }));
    } catch (error) {
        if (isMissingContentTableError(error)) return [];
        throw error;
    }
}

async function writeAudit(action: 'CREATE' | 'UPDATE' | 'DELETE', post: ContentPost, actorId: string) {
    await prisma.contentPostAudit.create({
        data: {
            id: randomUUID(),
            postId: post.id,
            action,
            actorId,
            snapshot: post as unknown as Prisma.InputJsonValue,
        },
    });
}

export async function upsertPost(
    input: Partial<ContentPost> & Pick<ContentPost, 'title' | 'excerpt' | 'body' | 'category' | 'readTime' | 'locale'>,
    actorId: string,
) {
    const slug = sanitizeSlug(input.slug || input.title);
    if (!slug) {
        throw new Error('INVALID_SLUG');
    }

    const now = new Date();

    if (input.id) {
        const existing = await prisma.contentPost.findUnique({ where: { id: input.id } });
        if (!existing) throw new Error('POST_NOT_FOUND');

        const duplicate = await prisma.contentPost.findFirst({
            where: { slug, id: { not: input.id } },
            select: { id: true },
        });
        if (duplicate) throw new Error('SLUG_EXISTS');

        const nextStatus = (input.status || existing.status) as ContentPostStatus;
        const nextPublishedAt = nextStatus === 'PUBLISHED' ? (existing.publishedAt || now) : null;

        const updated = await prisma.contentPost.update({
            where: { id: input.id },
            data: {
                slug,
                title: input.title,
                excerpt: input.excerpt,
                body: input.body,
                category: input.category,
                status: nextStatus,
                publishedAt: nextPublishedAt,
                readTime: input.readTime,
                locale: input.locale,
                updatedBy: actorId,
            },
        });

        const payload = toContentPost(updated);
        await writeAudit('UPDATE', payload, actorId);
        return payload;
    }

    const duplicate = await prisma.contentPost.findUnique({ where: { slug } });
    if (duplicate) throw new Error('SLUG_EXISTS');

    const status: ContentPostStatus = (input.status || 'DRAFT') as ContentPostStatus;
    const created = await prisma.contentPost.create({
        data: {
            id: input.id || randomUUID(),
            slug,
            title: input.title,
            excerpt: input.excerpt,
            body: input.body,
            category: input.category,
            status,
            publishedAt: status === 'PUBLISHED' ? now : null,
            readTime: input.readTime,
            locale: input.locale,
            createdBy: actorId,
            updatedBy: actorId,
        },
    });

    const payload = toContentPost(created);
    await writeAudit('CREATE', payload, actorId);
    return payload;
}

export async function deletePost(postId: string, actorId: string) {
    const existing = await prisma.contentPost.findUnique({ where: { id: postId } });
    if (!existing) {
        throw new Error('POST_NOT_FOUND');
    }

    const payload = toContentPost(existing);
    await prisma.contentPost.delete({ where: { id: postId } });
    await writeAudit('DELETE', payload, actorId);
    return { id: postId, deleted: true };
}
