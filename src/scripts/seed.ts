import { prisma } from '../config/index.js';
import { UserRole, OnboardingStatus } from '@prisma/client';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

async function main() {
  const adminEmail = process.env.ADMIN_SEED_EMAIL || 'admin@test.dev';
  const adminPhone = process.env.ADMIN_SEED_PHONE || '+37251009999';
  const adminName = process.env.ADMIN_SEED_NAME || 'Admin Baltic';
  const adminNickName = process.env.ADMIN_SEED_NICKNAME || 'admin-baltic';

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      role: UserRole.ADMIN,
      phone: adminPhone,
      name: adminName,
      nickName: adminNickName,
      emailVerified: true,
      phoneVerified: true,
      isVerified: true,
      onboardingStatus: OnboardingStatus.COMPLETED,
      isBanned: false,
    },
    create: {
      email: adminEmail,
      phone: adminPhone,
      role: UserRole.ADMIN,
      name: adminName,
      nickName: adminNickName,
      emailVerified: true,
      phoneVerified: true,
      isVerified: true,
      onboardingStatus: OnboardingStatus.COMPLETED,
      isBanned: false,
    },
  });

  console.log(`Seeded admin user: ${admin.email} (${admin.id})`);

  const contentFilePath = path.resolve(process.cwd(), 'content', 'blog-posts.json');
  try {
    const raw = await fs.readFile(contentFilePath, 'utf-8');
    const posts = JSON.parse(raw) as Array<{
      id: string;
      slug: string;
      title: string;
      excerpt: string;
      body: string;
      category: string;
      status: 'DRAFT' | 'PUBLISHED';
      publishedAt: string | null;
      readTime: string;
      locale: string;
      createdAt: string;
      updatedAt: string;
      updatedBy: string;
    }>;

    for (const post of posts) {
      const created = await prisma.contentPost.upsert({
        where: { id: post.id },
        update: {
          slug: post.slug,
          title: post.title,
          excerpt: post.excerpt,
          body: post.body,
          category: post.category,
          status: post.status,
          publishedAt: post.publishedAt ? new Date(post.publishedAt) : null,
          readTime: post.readTime,
          locale: post.locale,
          updatedBy: post.updatedBy || 'seed',
        },
        create: {
          id: post.id,
          slug: post.slug,
          title: post.title,
          excerpt: post.excerpt,
          body: post.body,
          category: post.category,
          status: post.status,
          publishedAt: post.publishedAt ? new Date(post.publishedAt) : null,
          readTime: post.readTime,
          locale: post.locale,
          createdBy: post.updatedBy || 'seed',
          updatedBy: post.updatedBy || 'seed',
          createdAt: post.createdAt ? new Date(post.createdAt) : new Date(),
          updatedAt: post.updatedAt ? new Date(post.updatedAt) : new Date(),
        },
      });

      if (created) {
        const exists = await prisma.contentPostAudit.findFirst({
          where: { postId: post.id, action: 'CREATE' },
          select: { id: true },
        });
        if (!exists) {
          await prisma.contentPostAudit.create({
            data: {
              id: randomUUID(),
              postId: post.id,
              action: 'CREATE',
              actorId: post.updatedBy || 'seed',
              snapshot: {
                ...post,
                publishedAt: post.publishedAt,
                createdBy: post.updatedBy || 'seed',
                updatedBy: post.updatedBy || 'seed',
              } as unknown as import('@prisma/client').Prisma.InputJsonValue,
            },
          });
        }
      }
    }

    console.log(`Seeded ${posts.length} content posts from ${contentFilePath}`);
  } catch (error) {
    console.warn('Content seed skipped:', error instanceof Error ? error.message : error);
  }
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
