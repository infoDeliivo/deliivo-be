import { prisma } from '../../config/index.js';
import { cacheKeys, deleteCache, getCache, setCache } from '../../services/cache.service.js';
import { logWarn } from '../../utils/logger.js';
import { resolveCountryFromIp } from '../../utils/geoip.js';

/** How long a detected country is trusted before it is checked against the database again. */
const COUNTRY_SYNC_TTL_SECONDS = 60 * 60 * 24;

const countrySyncKey = (userId: string) => `user:${userId}:country-synced`;

/**
 * Record the country a user appears to be connecting from.
 *
 * Unlike the language, this follows the newest observation rather than only filling a blank: no
 * one picks their country in the UI, so there is no user intent to protect, and someone who moves
 * or travels should show up where they are. A request whose address resolves to nothing — a
 * private network, a country the database does not cover — writes nothing at all, so a known
 * country is never wiped by a request we could not place.
 *
 * The same Redis-marker trick as the language sync keeps this off the hot path: a request from an
 * address in the country we already recorded costs one Redis GET and no database work.
 */
export const syncDetectedCountry = async (
  userId: string | undefined,
  ip: string | undefined,
): Promise<void> => {
  if (!userId) return;

  const country = resolveCountryFromIp(ip);
  if (!country) return;

  try {
    const alreadySynced = await getCache<string>(countrySyncKey(userId));
    if (alreadySynced === country) return;

    // The explicit null branch matters: in SQL `detectedCountry != 'EE'` is unknown for NULL, so a
    // user we have never placed would not be matched by the inequality alone.
    const { count } = await prisma.user.updateMany({
      where: {
        id: userId,
        OR: [{ detectedCountry: null }, { detectedCountry: { not: country } }],
      },
      data: { detectedCountry: country },
    });

    await setCache(countrySyncKey(userId), country, COUNTRY_SYNC_TTL_SECONDS);

    if (count > 0) {
      await deleteCache(cacheKeys.user(userId));
    }
  } catch (error) {
    // A failed lookup must never break the request it rode in on.
    logWarn('Could not sync detected country', {
      userId,
      country,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Forget the cached country marker for a user, for the account-deletion path.
 */
export const clearDetectedCountryCache = async (userId: string): Promise<void> => {
  await deleteCache(countrySyncKey(userId));
};
