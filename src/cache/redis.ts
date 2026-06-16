import Redis from 'ioredis';

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const REDIS_URL = process.env.REDIS_URL;

const baseRedisOptions = {
  retryStrategy(times: number) {
    return Math.min(times * 50, 2000);
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  connectTimeout: 10000, // 10 seconds
  keepAlive: 30000, // Keep connection alive for 30 seconds
  lazyConnect: false, // Connect immediately
};

// Create Redis client (supports Railway REDIS_URL and local host/port config)
const redis = REDIS_URL
  ? new Redis(REDIS_URL, baseRedisOptions)
  : new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      password: REDIS_PASSWORD,
      ...baseRedisOptions,
    });

export default redis;
// Event listeners
redis.on('connect', () => {
  console.log('✅ Redis connected');
});

redis.on('ready', () => {
  console.log('✅ Redis ready to use');
});

redis.on('error', (err) => {
  console.error('❌ Redis error', err);
});

redis.on('close', () => {
  console.warn('⚠️ Redis connection closed');
});

redis.on('reconnecting', () => {
  console.log('🔄 Redis reconnecting...');
});
