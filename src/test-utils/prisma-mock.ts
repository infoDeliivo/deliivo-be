/**
 * Test-only helper for the hand-written `prisma` mocks in this repo.
 *
 * Those mocks list one entry per model/method a test happens to need, so any new prisma call in
 * the code under test fails with `prisma.x.y is not a function` — a mock gap that reads like a
 * product bug. This wraps a mock so an unlisted model or method resolves to a shape-correct empty
 * result instead of throwing, while every explicitly defined mock still wins.
 *
 * Only the gaps are filled, and they are filled with "nothing found" — never with invented rows.
 */

type UnknownRecord = Record<string, unknown>;

/** Empty-but-correctly-shaped result for a prisma method, keyed by its name. */
const emptyResultFor = (method: string): unknown => {
  if (method === 'findMany' || method === 'groupBy') return [];
  if (method === 'count') return 0;
  if (method === 'aggregate') return { _sum: {}, _avg: {}, _min: {}, _max: {}, _count: { _all: 0 } };
  if (method === 'createMany' || method === 'updateMany' || method === 'deleteMany') {
    return { count: 0 };
  }
  // findUnique/findFirst and their OrThrow variants, plus anything unrecognised.
  return null;
};

const isPlainNamespace = (value: unknown): boolean =>
  typeof value === 'object'
  && value !== null
  && !Array.isArray(value)
  && typeof (value as UnknownRecord).then !== 'function';

/**
 * Wrap a prisma mock so unlisted models and methods resolve empty instead of throwing.
 *
 * `$transaction` is filled in when the mock omits it: the real client either runs a callback with
 * a transactional client or resolves an array of promises, and tests that never stub it otherwise
 * crash on the callback form.
 */
export const withPrismaFallback = <T extends UnknownRecord>(mock: T): T => {
  const modelCache = new Map<string, UnknownRecord>();

  const wrapModel = (model: UnknownRecord): UnknownRecord =>
    new Proxy(model, {
      get(target, method: string) {
        if (method in target) return target[method];
        // Cached on the target so repeated access returns one stable fn, which keeps
        // `expect(prisma.x.y).not.toHaveBeenCalled()` meaningful.
        const key = `__fallback_${method}`;
        if (!(key in target)) {
          target[key] = jest.fn(async () => emptyResultFor(method));
        }
        return target[key];
      },
    });

  const modelFor = (prop: string, value?: unknown): UnknownRecord => {
    const cached = modelCache.get(prop);
    if (cached) return cached;
    const wrapped = wrapModel((value as UnknownRecord) ?? {});
    modelCache.set(prop, wrapped);
    return wrapped;
  };

  const proxy = new Proxy(mock, {
    get(target, prop: string) {
      if (prop === '$transaction' && !(prop in target)) {
        return async (arg: unknown) => {
          if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(proxy);
          if (Array.isArray(arg)) return Promise.all(arg);
          return arg;
        };
      }

      if (prop in target) {
        const value = target[prop];
        // Only model namespaces get wrapped — not $-helpers, jest.fn()s or thenables.
        if (typeof value !== 'function' && !prop.startsWith('$') && isPlainNamespace(value)) {
          return modelFor(prop, value);
        }
        return value;
      }

      // Unknown $-helper: leave undefined so a test asserting on it still fails loudly.
      if (prop.startsWith('$')) return undefined;
      // Symbol lookups (promise unwrapping, util.inspect) must not mint a fake model.
      if (typeof prop !== 'string') return undefined;

      return modelFor(prop);
    },
  }) as T;

  return proxy;
};
