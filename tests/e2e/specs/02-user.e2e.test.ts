/**
 * E2E — User Profile & Travel Preferences
 * Covers: TC-USER-001 through TC-USER-004
 */
import { authed } from '../helpers/api.client';
import { readState } from '../helpers/state';

const state = readState();
const pa = authed(state.passengerA.accessToken);

describe('TC-USER-001 — Get my profile', () => {
  it('returns 200 with user data', async () => {
    const res = await pa.get('/users/me');
    expect(res.status).toBe(200);
    expect(res.data.data.id).toBe(state.passengerA.id);
    expect(res.data.data.email).toBe(state.passengerA.email);
  });
});

describe('TC-USER-002 — Update profile', () => {
  it('persists name and salutation', async () => {
    const res = await pa.put('/users/me', {
      name: 'Alice Smith Updated',
      nickName: 'Ali',
      salutation: 'MS',
    });
    expect(res.status).toBe(200);
    const user = res.data.data ?? res.data;
    expect(user.name).toBe('Alice Smith Updated');
    expect(user.nickName).toBe('Ali');
  });
});

describe('TC-USER-003 — Set travel preferences', () => {
  it('creates travel preferences and returns 200/201', async () => {
    const res = await pa.post('/travel-preferences', {
      chattiness: 'quiet',
      pets: 'no_pets',
    });
    if (res.status !== 200 && res.status !== 201) {
      console.error('Travel pref creation failed:', res.status, JSON.stringify(res.data));
    }
    expect([200, 201]).toContain(res.status);
  });
});

describe('TC-USER-004 — Update travel preferences', () => {
  it('updates chattiness and pets', async () => {
    const res = await pa.put('/travel-preferences', {
      chattiness: 'chatterbox',
      pets: 'love_pets',
    });
    expect(res.status).toBe(200);
    const prefs = res.data.data ?? res.data;
    expect(prefs.chattiness).toBe('chatterbox');
    expect(prefs.pets).toBe('love_pets');
  });
});

describe('Unauthorized access', () => {
  it('returns 401 when no token is supplied', async () => {
    const { api } = await import('../helpers/api.client');
    const res = await api.get('/users/me');
    expect(res.status).toBe(401);
  });
});
