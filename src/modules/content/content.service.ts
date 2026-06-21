import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

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
    updatedBy: string;
}

const contentFilePath = path.resolve(process.cwd(), 'content', 'blog-posts.json');

async function ensureContentFile() {
    const dir = path.dirname(contentFilePath);
    await fs.mkdir(dir, { recursive: true });
    try {
        await fs.access(contentFilePath);
    } catch {
        await fs.writeFile(contentFilePath, '[]\n', 'utf-8');
    }
}

async function readPosts(): Promise<ContentPost[]> {
    await ensureContentFile();
    const raw = await fs.readFile(contentFilePath, 'utf-8');
    const parsed = JSON.parse(raw) as ContentPost[];
    return parsed.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

async function writePosts(posts: ContentPost[]) {
    await ensureContentFile();
    await fs.writeFile(contentFilePath, `${JSON.stringify(posts, null, 2)}\n`, 'utf-8');
}

function sanitizeSlug(input: string) {
    return input
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120);
}

export async function listPublishedPosts(locale?: string) {
    const posts = await readPosts();
    return posts
        .filter((post) => post.status === 'PUBLISHED' && (!locale || post.locale === locale))
        .sort((a, b) => new Date(b.publishedAt || b.updatedAt).getTime() - new Date(a.publishedAt || a.updatedAt).getTime());
}

export async function listAllPosts() {
    return readPosts();
}

export async function getContentSummary() {
    const posts = await readPosts();
    const published = posts.filter((post) => post.status === 'PUBLISHED').length;
    const drafts = posts.filter((post) => post.status === 'DRAFT').length;
    const locales = Array.from(new Set(posts.map((post) => post.locale))).sort();
    return {
        total: posts.length,
        published,
        drafts,
        locales,
        updatedAt: posts[0]?.updatedAt || null,
    };
}

export async function upsertPost(input: Partial<ContentPost> & Pick<ContentPost, 'title' | 'excerpt' | 'body' | 'category' | 'readTime' | 'locale'>, actorId: string) {
    const posts = await readPosts();
    const now = new Date().toISOString();
    const slug = sanitizeSlug(input.slug || input.title);

    if (!slug) {
        throw new Error('INVALID_SLUG');
    }

    const duplicate = posts.find((post) => post.slug === slug && post.id !== input.id);
    if (duplicate) {
        throw new Error('SLUG_EXISTS');
    }

    if (input.id) {
        const existingIndex = posts.findIndex((post) => post.id === input.id);
        if (existingIndex === -1) throw new Error('POST_NOT_FOUND');
        const existing = posts[existingIndex];
        const nextStatus = input.status || existing.status;
        const nextPublishedAt = nextStatus === 'PUBLISHED'
            ? (existing.publishedAt || now)
            : null;
        const updated: ContentPost = {
            ...existing,
            ...input,
            slug,
            status: nextStatus,
            publishedAt: nextPublishedAt,
            updatedAt: now,
            updatedBy: actorId,
        };
        posts[existingIndex] = updated;
        await writePosts(posts);
        return updated;
    }

    const status: ContentPostStatus = input.status || 'DRAFT';
    const created: ContentPost = {
        id: randomUUID(),
        slug,
        title: input.title,
        excerpt: input.excerpt,
        body: input.body,
        category: input.category,
        status,
        publishedAt: status === 'PUBLISHED' ? now : null,
        readTime: input.readTime,
        locale: input.locale,
        createdAt: now,
        updatedAt: now,
        updatedBy: actorId,
    };
    await writePosts([created, ...posts]);
    return created;
}

export async function deletePost(postId: string) {
    const posts = await readPosts();
    const nextPosts = posts.filter((post) => post.id !== postId);
    if (nextPosts.length === posts.length) {
        throw new Error('POST_NOT_FOUND');
    }
    await writePosts(nextPosts);
    return { id: postId, deleted: true };
}
