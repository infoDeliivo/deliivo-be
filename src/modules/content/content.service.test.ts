const mockPrisma = {
    contentPost: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
    },
    contentPostAudit: {
        create: jest.fn(),
    },
    $executeRawUnsafe: jest.fn(),
};

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: mockPrisma,
}));

import { getPublishedPostBySlug, listPublishedPosts } from './content.service';

const publishedPost = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'post-1',
    slug: 'sample-post',
    title: 'Sample post',
    excerpt: 'Excerpt',
    body: 'Body',
    coverImageUrl: null,
    category: 'Rider guide',
    status: 'PUBLISHED',
    publishedAt: new Date('2026-07-01T00:00:00.000Z'),
    readTime: '4 min read',
    locale: 'ee',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    createdBy: 'admin-1',
    updatedBy: 'admin-1',
    ...overrides,
});

describe('content locale handling', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('loads legacy ee posts when the public blog requests et', async () => {
        mockPrisma.contentPost.findMany.mockResolvedValue([publishedPost()]);

        const posts = await listPublishedPosts('et');

        expect(mockPrisma.contentPost.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                locale: { in: expect.arrayContaining(['et', 'ee']) },
            }),
        }));
        expect(posts[0].locale).toBe('et');
    });

    it('falls back to a legacy ee slug lookup after checking canonical et', async () => {
        mockPrisma.contentPost.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(publishedPost());

        const post = await getPublishedPostBySlug('sample-post', 'et');

        expect(mockPrisma.contentPost.findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
            where: expect.objectContaining({ locale: 'et' }),
        }));
        expect(mockPrisma.contentPost.findFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({
            where: expect.objectContaining({
                locale: { in: expect.arrayContaining(['ee']) },
            }),
        }));
        expect(post?.locale).toBe('et');
    });
});
