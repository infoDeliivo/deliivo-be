import cluster from 'node:cluster';
import os from 'node:os';
import logger from './utils/logger.js';

const WORKERS = parseInt(process.env.WEB_CONCURRENCY || String(Math.min(os.cpus().length, 4)));

if (cluster.isPrimary) {
  logger.info(`Primary process ${process.pid} starting ${WORKERS} workers`);

  for (let i = 0; i < WORKERS; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    logger.warn(`Worker ${worker.process.pid} died (${signal || code}), respawning...`);
    cluster.fork();
  });
} else {
  import('./server.js');
}
