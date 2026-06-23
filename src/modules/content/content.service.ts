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

function normalizeLocale(input?: string) {
    return (input || 'en').trim().toLowerCase();
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

let ensureContentTablesPromise: Promise<void> | null = null;

async function createContentTables() {
    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "ContentPost" (
            "id" TEXT PRIMARY KEY,
            "slug" TEXT NOT NULL UNIQUE,
            "title" TEXT NOT NULL,
            "excerpt" TEXT NOT NULL,
            "body" TEXT NOT NULL,
            "category" TEXT NOT NULL,
            "status" TEXT NOT NULL DEFAULT 'DRAFT',
            "publishedAt" TIMESTAMP(3),
            "readTime" TEXT NOT NULL,
            "locale" TEXT NOT NULL,
            "createdBy" TEXT NOT NULL,
            "updatedBy" TEXT NOT NULL,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ContentPost_status_locale_publishedAt_idx" ON "ContentPost" ("status", "locale", "publishedAt");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ContentPost_updatedAt_idx" ON "ContentPost" ("updatedAt");`);

    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "ContentPostAudit" (
            "id" TEXT PRIMARY KEY,
            "postId" TEXT NOT NULL,
            "action" TEXT NOT NULL,
            "actorId" TEXT NOT NULL,
            "snapshot" JSONB,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ContentPostAudit_postId_createdAt_idx" ON "ContentPostAudit" ("postId", "createdAt");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ContentPostAudit_action_createdAt_idx" ON "ContentPostAudit" ("action", "createdAt");`);
}

async function ensureContentTables() {
    if (!ensureContentTablesPromise) {
        ensureContentTablesPromise = createContentTables().catch((error) => {
            ensureContentTablesPromise = null;
            throw error;
        });
    }
    await ensureContentTablesPromise;
}

export async function listPublishedPosts(locale?: string) {
    const normalizedLocale = locale ? normalizeLocale(locale) : undefined;
    try {
        const posts = await prisma.contentPost.findMany({
            where: {
                status: 'PUBLISHED',
                ...(normalizedLocale ? { locale: normalizedLocale } : {}),
            },
            orderBy: [
                { publishedAt: 'desc' },
                { updatedAt: 'desc' },
            ],
        });

        return posts.map(toContentPost);
    } catch (error) {
        if (isMissingContentTableError(error)) {
            await ensureContentTables();
            const posts = await prisma.contentPost.findMany({
                where: {
                    status: 'PUBLISHED',
                    ...(normalizedLocale ? { locale: normalizedLocale } : {}),
                },
                orderBy: [
                    { publishedAt: 'desc' },
                    { updatedAt: 'desc' },
                ],
            });
            return posts.map(toContentPost);
        }
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
        if (isMissingContentTableError(error)) {
            await ensureContentTables();
            const posts = await prisma.contentPost.findMany({
                orderBy: { updatedAt: 'desc' },
            });
            return posts.map(toContentPost);
        }
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
            await ensureContentTables();
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
        if (isMissingContentTableError(error)) {
            await ensureContentTables();
            return [];
        }
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
    await ensureContentTables();
    const slug = sanitizeSlug(input.slug || input.title);
    const locale = normalizeLocale(input.locale);
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
                locale,
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
            locale,
            createdBy: actorId,
            updatedBy: actorId,
        },
    });

    const payload = toContentPost(created);
    await writeAudit('CREATE', payload, actorId);
    return payload;
}

export async function deletePost(postId: string, actorId: string) {
    await ensureContentTables();
    const existing = await prisma.contentPost.findUnique({ where: { id: postId } });
    if (!existing) {
        throw new Error('POST_NOT_FOUND');
    }

    const payload = toContentPost(existing);
    await prisma.contentPost.delete({ where: { id: postId } });
    await writeAudit('DELETE', payload, actorId);
    return { id: postId, deleted: true };
}
