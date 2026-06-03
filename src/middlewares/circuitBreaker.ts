import CircuitBreaker from 'opossum';
import { logError, logWarn, logInfo } from '../utils/logger.js';

export function createCircuitBreaker(action: (...args: unknown[]) => Promise<unknown>) {
  const breaker = new CircuitBreaker(action, {
    timeout: 15000, // Google can be slow
    errorThresholdPercentage: 50, // % failures before open
    resetTimeout: 30000, // try again after 30s
    rollingCountTimeout: 60000,
    rollingCountBuckets: 10,
    volumeThreshold: 5, // minimum calls before opening
  });

  breaker.on('open', () => {
    logError('Google Routes circuit OPEN');
  });

  breaker.on('halfOpen', () => {
    logWarn('Google Routes circuit HALF-OPEN');
  });

  breaker.on('close', () => {
    logInfo('Google Routes circuit CLOSED');
  });

  return breaker;
}
