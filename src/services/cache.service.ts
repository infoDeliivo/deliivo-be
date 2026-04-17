import redis from '../cache/redis.js';

// Default TTL: 5 minutes
const DEFAULT_TTL = 300;

/**
 * Get cached data by key
 */
export const getCache = async <T>(key: string): Promise<T | null> => {
    try {
        const data = await redis.get(key);
        if (!data) return null;
        return JSON.parse(data) as T;
    } catch (error) {
        console.error(`Cache GET error for key ${key}:`, error);
        return null;
    }
};

/**
 * Set cache with optional TTL (default 5 minutes)
 */
export const setCache = async (
    key: string,
    data: unknown,
    ttl: number = DEFAULT_TTL,
): Promise<void> => {
    try {
        await redis.setex(key, ttl, JSON.stringify(data));
    } catch (error) {
        console.error(`Cache SET error for key ${key}:`, error);
    }
};

/**
 * Delete a specific cache key
 */
export const deleteCache = async (key: string): Promise<void> => {
    try {
        await redis.del(key);
    } catch (error) {
        console.error(`Cache DELETE error for key ${key}:`, error);
    }
};

/**
 * Delete multiple cache keys matching a pattern
 */
export const deleteCachePattern = async (pattern: string): Promise<void> => {
    try {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
            await redis.del(...keys);
        }
    } catch (error) {
        console.error(`Cache DELETE PATTERN error for ${pattern}:`, error);
    }
};

// Cache key generators
export const cacheKeys = {
    user: (userId: string) => `user:${userId}`,
    userProfile: (userId: string) => `user:${userId}:profile`,
    publicProfile: (userId: string) => `user:${userId}:public-profile`,
    vehicle: (vehicleId: string) => `vehicle:${vehicleId}`,
    userVehicles: (userId: string) => `user:${userId}:vehicles`,
    vehicleDraft: (userId: string) => `vehicleDraft:${userId}`,
};

