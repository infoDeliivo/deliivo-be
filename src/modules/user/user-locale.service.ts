import { prisma } from '../../config/index.js';
import { cacheKeys, deleteCache, getCache, setCache } from '../../services/cache.service.js';
import { logWarn } from '../../utils/logger.js';
import { matchSupportedLocale, resolveRequestLocale, type SupportedLocale } from '../../utils/locale.js';

/** How long a synced language is trusted before it is checked against the database again. */
const LOCALE_SYNC_TTL_SECONDS = 60 * 60 * 24;

const localeSyncKey = (userId: string) => `user:${userId}:locale-synced`;

/**
 * Learn `User.preferredLocale` from the language a request is being made in — but only once.
 *
 * Detection fills in what we do not know yet: users who registered before the column existed, and
 * anyone who arrives on a localised URL without ever touching the switcher.
 *
 * It deliberately does NOT keep overwriting a language we already know. The website's own routing
 * falls back to English whenever a link carries no locale prefix (see the webapp's `src/proxy.ts`),
 * so a user reading the site in Latvian who clicks one unprefixed link starts sending
 * `Accept-Language: en` — and a follow-the-latest-request rule silently rewrote their language to
 * English within one polling interval. A language we already hold changes only when the user says
 * so, through {@link setPreferredLocale}.
 *
 * `protect` deliberately never loads the user row — it only verifies the token — so the last
 * synced language is remembered in Redis instead. A request whose language already matches that
 * marker costs one Redis GET and touches the database not at all, which makes this safe to run on
 * every authenticated request. The write itself is a single guarded UPDATE, so it needs no read
 * either, and affects zero rows when the stored value is already correct.
 *
 * A request that carries no recognisable language never writes: an unsupported or absent
 * `Accept-Language` means "we learned nothing", never "forget what you knew".
 *
 * `explicitLocale` is for callers that receive the language as a field rather than a header — the
 * same precedence as signup, where what the website states outranks what the browser asked for.
 */
export const syncPreferredLocale = async (
  userId: string | undefined,
  acceptLanguage: string | string[] | undefined,
  explicitLocale?: string,
): Promise<void> => {
  if (!userId) return;

  const header = Array.isArray(acceptLanguage) ? acceptLanguage[0] : acceptLanguage;
  const locale = resolveRequestLocale(explicitLocale, header);
  if (!locale) return;

  try {
    const alreadySynced = await getCache<string>(localeSyncKey(userId));
    if (alreadySynced === locale) return;

    // Backfill only: matches the row solely while its language is still unknown. That single
    // condition is what stops an English fallback page from overwriting a real choice, and it
    // makes the write idempotent — every later request matches nothing and costs one index probe.
    const { count } = await prisma.user.updateMany({
      where: { id: userId, preferredLocale: null },
      data: { preferredLocale: locale },
    });

    await setCache(localeSyncKey(userId), locale, LOCALE_SYNC_TTL_SECONDS);

    if (count > 0) {
      // GET /users/me is cached, so the old language would otherwise be served back.
      await deleteCache(cacheKeys.user(userId));
    }
  } catch (error) {
    // A failed language sync must never break the request it rode in on.
    logWarn('Could not sync preferred locale', {
      userId,
      locale,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Record a language the user just chose, deliberately.
 *
 * This is the switcher's path: it fires the moment the language changes rather than waiting for
 * whatever request happens next, so an admin sees the new language immediately even if the user
 * then goes idle. Unlike the passive sync it is unguarded — an explicit choice always wins — and it
 * refreshes the sync marker so the next request does not repeat the work.
 *
 * Returns the stored locale, or null when the value names no language we support.
 */
export const setPreferredLocale = async (
  userId: string,
  requested: string,
): Promise<SupportedLocale | null> => {
  const locale = matchSupportedLocale(requested);
  if (!locale) return null;

  await prisma.user.update({
    where: { id: userId },
    data: { preferredLocale: locale },
  });

  await setCache(localeSyncKey(userId), locale, LOCALE_SYNC_TTL_SECONDS);
  await deleteCache(cacheKeys.user(userId));

  return locale;
};

/**
 * Forget everything cached about a user's language.
 *
 * Called when an account is deleted: the sync marker would otherwise outlive the row it describes
 * for up to a day. Harmless — a guarded update on a missing id matches nothing — but the key
 * format lives here, so the cleanup does too.
 */
export const clearPreferredLocaleCache = async (userId: string): Promise<void> => {
  await deleteCache(localeSyncKey(userId));
  await deleteCache(cacheKeys.user(userId));
};
