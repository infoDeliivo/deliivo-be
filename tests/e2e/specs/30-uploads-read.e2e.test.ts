/**
 * E2E — Global "view my own private document" read API + vehicle previewKey.
 *
 * GET /uploads/read authorizes purely by the owner id embedded in the key
 * (uploads/<folder>/<ownerId>/...), so it needs no real uploaded object to
 * verify the authorization contract. GET /vehicles/:id now includes documents[].
 */
import { authed } from '../helpers/api.client';
import { readState } from '../helpers/state';

const state = readState();
const da = authed(state.driverA.accessToken);
const db = authed(state.passengerB.accessToken); // "another user"

const ownKey = `uploads/vehicle-documents/${state.driverA.id}/e2e-fake.png`;
const otherKey = `uploads/vehicle-documents/${state.passengerB.id}/e2e-fake.png`;

describe('TC-READ-001 — read a key you own', () => {
  it('authorizes (not 404); returns a signed URL + 300s TTL when signing is configured', async () => {
    const res = await da.get('/uploads/read', { key: ownKey });
    // Authorization must pass for your own key — never 404.
    expect(res.status).not.toBe(404);
    if (res.status === 200) {
      const data = res.data.data ?? res.data;
      expect(typeof data.url).toBe('string');
      expect(data.expiresIn).toBe(300);
    }
  });
});

describe('TC-READ-002 — cannot read a key owned by another user', () => {
  it('returns 404 (no existence leak)', async () => {
    const res = await da.get('/uploads/read', { key: otherKey });
    expect(res.status).toBe(404);
  });
});

describe('TC-READ-003 — malformed / non-permanent keys are rejected', () => {
  it('404 for a tmp/ (staged) key', async () => {
    const res = await da.get('/uploads/read', {
      key: `tmp/vehicle-documents/${state.driverA.id}/x.png`,
    });
    expect(res.status).toBe(404);
  });

  it('400 when key is missing', async () => {
    const res = await da.get('/uploads/read', {});
    expect(res.status).toBe(400);
  });
});

describe('TC-READ-004 — a stranger cannot read your key either', () => {
  it('passengerB gets 404 for a driverA-owned key', async () => {
    const res = await db.get('/uploads/read', { key: ownKey });
    expect(res.status).toBe(404);
  });
});

describe('TC-VEH-DOCS — vehicle response includes a documents array with previewKey', () => {
  it('GET /vehicles/:id exposes documents[]', async () => {
    const listRes = await da.get('/vehicles');
    const raw = listRes.data.data ?? listRes.data;
    const vehicles: Array<{ id: string }> = raw.vehicles ?? raw;
    expect(Array.isArray(vehicles) && vehicles.length > 0).toBe(true);

    const res = await da.get(`/vehicles/${vehicles[0].id}`);
    expect(res.status).toBe(200);
    const vehicle = res.data.data ?? res.data;
    expect(Array.isArray(vehicle.documents)).toBe(true);
    // Every document (if any) carries a previewKey field to feed into /uploads/read.
    for (const doc of vehicle.documents) {
      expect(doc).toHaveProperty('previewKey');
    }
  });
});
