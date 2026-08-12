import { Worker } from 'bullmq';
import transporter, { verifyMailer } from '../../config/mailer.js';
import { bullRedis } from '../../queue/redisConnection.js';
import { SendMailPayload } from './mail.types.js';
import { logInfo, logError, logDebug } from '../../utils/logger.js';
import { loadMailWorkerConfig } from './mail.config.js';

logInfo('Mail worker booting');

const mailConfig = loadMailWorkerConfig();

(async () => {
  await verifyMailer();
})();

bullRedis.ping();
logInfo('Mail worker Redis connected');

const worker = new Worker(
  'mail-queue',
  async (job: any) => {
    logDebug('Mail job received', { jobId: job.id });

    const { to, subject, html, text } = job.data as SendMailPayload;

    const result = await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to,
      subject,
      html,
      text,
    });

    logInfo('Mail sent', { messageId: result.messageId });
  },
  {
    connection: bullRedis,
    concurrency: mailConfig.concurrency,
    ...(mailConfig.limiter ? { limiter: mailConfig.limiter } : {}),
  },
);

worker.on('ready', () => {
  logInfo('Mail worker ready');
});

worker.on('failed', (job: any, err: any) => {
  logError('Mail job failed', err, { jobId: job?.id });
});

process.stdin.resume();
