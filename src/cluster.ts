import cluster from 'node:cluster';
import os from 'node:os';
import logger from './utils/logger.js';

const WORKERS = parseInt(process.env.WEB_CONCURRENCY || String(Math.min(os.cpus().length, 4)));
const MAX_CRASHES = 5;
const CRASH_WINDOW_MS = 60_000;

if (cluster.isPrimary) {
  logger.info(`Primary process ${process.pid} starting ${WORKERS} workers`);

  const crashTimestamps: number[] = [];

  for (let i = 0; i < WORKERS; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    logger.warn(`Worker ${worker.process.pid} died (${signal || code}), respawning...`);

    const now = Date.now();
    crashTimestamps.push(now);

    // Keep only crashes within the window
    while (crashTimestamps.length > 0 && crashTimestamps[0] < now - CRASH_WINDOW_MS) {
      crashTimestamps.shift();
    }

    if (crashTimestamps.length >= MAX_CRASHES) {
      logger.error(`${MAX_CRASHES} worker crashes in ${CRASH_WINDOW_MS / 1000}s — halting respawn to prevent crash loop`);
      process.exit(1);
    }

    cluster.fork();
  });
} else {
  import('./server.js');
}
