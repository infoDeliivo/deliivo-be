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

  const [existingByEmail, existingByPhone] = await Promise.all([
    adminEmail ? prisma.user.findUnique({ where: { email: adminEmail } }) : Promise.resolve(null),
    adminPhone ? prisma.user.findUnique({ where: { phone: adminPhone } }) : Promise.resolve(null),
  ]);

  const targetUser = existingByEmail || existingByPhone;
  const phoneBelongsToOtherUser = Boolean(
    adminPhone &&
    existingByPhone &&
    (!targetUser || existingByPhone.id !== targetUser.id)
  );

  if (phoneBelongsToOtherUser) {
    console.warn(
      `Admin seed skipped phone assignment because ${adminPhone} is already used by user ${existingByPhone?.id}.`
    );
  }

  const adminPayload = {
    role: UserRole.ADMIN,
    name: adminName,
    nickName: adminNickName,
    emailVerified: true,
    phoneVerified: !phoneBelongsToOtherUser,
    isVerified: true,
    onboardingStatus: OnboardingStatus.COMPLETED,
    isBanned: false,
    ...(adminEmail ? { email: adminEmail } : {}),
    ...(phoneBelongsToOtherUser ? {} : (adminPhone ? { phone: adminPhone } : {})),
  };

  const admin = targetUser
    ? await prisma.user.update({
        where: { id: targetUser.id },
        data: adminPayload,
      })
    : await prisma.user.create({
        data: adminPayload,
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
