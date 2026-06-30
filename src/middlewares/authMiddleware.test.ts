import { resolveTokenUserId } from './authMiddleware.js';

describe('resolveTokenUserId', () => {
  it('reads the current top-level token payload', () => {
    expect(resolveTokenUserId({ id: 'user-1' })).toBe('user-1');
  });

  it('supports legacy nested token payloads', () => {
    expect(resolveTokenUserId({ user: { id: 'user-2' } })).toBe('user-2');
  });

  it('rejects payloads without a user id', () => {
    expect(resolveTokenUserId({})).toBeNull();
  });
});
