import { SendMailPayload } from './mail.types.js';
import { mailQueue } from './mail.queue.js';
import { bullRedis } from '../../queue/redisConnection.js';
import { sendMail as sendMailDirect } from '../../services/mailService.js';

export const sendMail = async (payload: SendMailPayload) => {
  const queueUnavailable = bullRedis.status !== 'ready';

  if (queueUnavailable) {
    await sendMailDirect(payload);
    return;
  }

  try {
    await mailQueue.add('send-mail', payload, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    });
  } catch {
    await sendMailDirect(payload);
  }
};
