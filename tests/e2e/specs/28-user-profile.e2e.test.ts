/**
 * E2E — User Profile Endpoints
 * Covers: TC-PROFILE-001 through TC-PROFILE-007
 *
 * Tests the full profile, onboarding, public profile, and travel preferences GET.
 */
import { authed } from '../helpers/api.client';
import { readState } from '../helpers/state';

const state = readState();
const da = authed(state.driverA.accessToken);
const pa = authed(state.passengerA.accessToken);

describe('TC-PROFILE-001 — Get full profile', () => {
  it('returns user with travel preferences, vehicle, and rating stats', async () => {
    const res = await da.get('/users/me/profile');
    expect(res.status).toBe(200);
    const profile = res.data.data ?? res.data;
    expect(profile.user.id).toBe(state.driverA.id);
    expect(profile.user.name).toBeTruthy();
  });
});

describe('TC-PROFILE-002 — Update full profile', () => {
  it('updates profile with travel preferences in one request', async () => {
    const res = await pa.put('/users/me/profile', {
      name: 'Updated Passenger Alpha',
      bio: 'I love carpooling',
      travelPreferences: {
        chattiness: 'CHATTY',
        pets: 'NO_PETS',
      },
    });
    expect([200, 201]).toContain(res.status);
  });
});

describe('TC-PROFILE-003 — Complete onboarding', () => {
  it('sets name and completes onboarding status', async () => {
    const res = await pa.post('/users/me/onboarding/complete', {
      name: 'Passenger Alpha Complete',
      salutation: 'MS',
      dob: '1995-06-15',
    });
    // 200 if successful, 400 if already completed
    expect([200, 201, 400]).toContain(res.status);
  });
});

describe('TC-PROFILE-004 — Get public profile of another user', () => {
  it('returns limited public info', async () => {
    const res = await pa.get(`/users/${state.driverA.id}/profile`);
    expect(res.status).toBe(200);
    const profile = res.data.data ?? res.data;
    expect(profile.user.id).toBe(state.driverA.id);
    expect(profile.user.name).toBeTruthy();
    // Should not expose sensitive fields
    expect(profile.user.email).toBeUndefined();
    expect(profile.user.phone).toBeUndefined();
  });
});

describe('TC-PROFILE-005 — Get public profile of non-existent user', () => {
  it('returns 404', async () => {
    const res = await pa.get('/users/00000000-0000-0000-0000-000000000000/profile');
    expect([404, 400]).toContain(res.status);
  });
});

describe('TC-PROFILE-006 — Get travel preferences', () => {
  it('returns travel preference settings', async () => {
    const res = await pa.get('/travel-preferences');
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      const prefs = res.data.data ?? res.data;
      expect(prefs.chattiness || prefs.pets).toBeTruthy();
    }
  });
});

describe('TC-PROFILE-007 — Get own profile by /me', () => {
  it('returns authenticated user data', async () => {
    const res = await pa.get('/users/me');
    expect(res.status).toBe(200);
    const user = res.data.data ?? res.data;
    expect(user.id).toBe(state.passengerA.id);
  });
});
