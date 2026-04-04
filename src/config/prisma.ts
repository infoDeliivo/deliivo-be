import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import logger from '../utils/logger.js';

const connectionString = `${process.env.DATABASE_URL}`;
const adapter = new PrismaPg({ connectionString });

export const prisma = new PrismaClient({ adapter });

const getDatabaseUrl = () => process.env.DATABASE_URL?.trim() || '';

const isPlaceholderDatabaseUrl = (databaseUrl: string): boolean =>
  databaseUrl.includes('user:password@localhost:5432/carpooling');

const getDatabaseLogDetails = () => {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return { host: 'unknown', database: 'unknown', user: 'unknown' };
  }

  try {
    const parsedDatabaseUrl = new URL(databaseUrl);
    return {
      host: parsedDatabaseUrl.hostname || 'unknown',
      database: parsedDatabaseUrl.pathname.replace(/^\//, '') || 'unknown',
      user: parsedDatabaseUrl.username || 'unknown',
    };
  } catch {
    return { host: 'unknown', database: 'unknown', user: 'unknown' };
  }
};

const validateDatabaseUrl = (): void => {
  const databaseUrl = getDatabaseUrl();

  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is missing. Set a valid PostgreSQL connection string in .env (for example: postgresql://USER:PASSWORD@HOST:PORT/DB?schema=public or socket-based local URL).',
    );
  }

  if (isPlaceholderDatabaseUrl(databaseUrl)) {
    throw new Error(
      'DATABASE_URL still has example credentials (user:password). Replace it with a real PostgreSQL connection string.',
    );
  }

  try {
    const parsedDatabaseUrl = new URL(databaseUrl);
    if (!parsedDatabaseUrl.protocol.startsWith('postgres')) {
      throw new Error(
        'DATABASE_URL must use the postgres/postgresql protocol.',
      );
    }
    const databaseName = parsedDatabaseUrl.pathname.replace(/^\//, '');
    if (!databaseName) {
      throw new Error('DATABASE_URL must include a database name.');
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('must use the postgres/postgresql protocol') ||
        error.message.includes('must include a database name'))
    ) {
      throw error;
    }

    throw new Error(
      'DATABASE_URL is not a valid URL. Use a valid PostgreSQL URL (for example: postgresql://USER:PASSWORD@HOST:PORT/DB?schema=public).',
    );
  }
};

export const verifyDatabaseConnection = async () => {
  validateDatabaseUrl();
  const details = getDatabaseLogDetails();

  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    logger.info(`PostgreSQL connected successfully (${details.host}/${details.database})`, {
      user: details.user,
    });
  } catch (error) {
    const rawMessage =
      error instanceof Error ? error.message : typeof error === 'string' ? error : '';

    if (rawMessage.includes('28P01') || rawMessage.toLowerCase().includes('authentication failed')) {
      logger.error(`PostgreSQL authentication failed (${details.host}/${details.database})`, {
        user: details.user,
        hint: 'Check DATABASE_URL username/password and database user privileges.',
      });
      throw new Error(
        `PostgreSQL authentication failed for user "${details.user}" on ${details.host}/${details.database}. Check DATABASE_URL credentials.`,
      );
    }

    logger.error(`PostgreSQL connection failed (${details.host}/${details.database})`, error);
    throw error;
  }
};
