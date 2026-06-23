import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  console.log('[postinstall] Skipping Prisma generate because DATABASE_URL is not set.');
  process.exit(0);
}

if (!existsSync('prisma/schema.prisma')) {
  console.log('[postinstall] Skipping Prisma generate because prisma/schema.prisma is missing.');
  process.exit(0);
}

try {
  execFileSync('npx', ['prisma', 'generate'], { stdio: 'inherit' });
} catch (error) {
  process.exit(typeof error?.status === 'number' ? error.status : 1);
}
