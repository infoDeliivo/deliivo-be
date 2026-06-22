/**
 * E2E — Vehicle Management
 * Covers: TC-VEH-001 through TC-VEH-005
 */
import { authed } from '../helpers/api.client';
import { readState } from '../helpers/state';

const state = readState();
const da = authed(state.driverA.accessToken);
const db = authed(state.passengerB.accessToken); // used as "another user"

let createdVehicleId: string;

// The global setup creates a vehicle for the driver. Delete it first so the
// per-user limit (1) does not block TC-VEH-001.
beforeAll(async () => {
  const listRes = await da.get('/vehicles');
  const raw = listRes.data.data ?? listRes.data;
  const vehicles: Array<{ id: string }> = raw.vehicles ?? raw;
  if (Array.isArray(vehicles)) {
    for (const v of vehicles) {
      await da.delete(`/vehicles/${v.id}`);
    }
  }
});

// Re-create a vehicle for driverA so subsequent tests (publish-ride etc.) still work.
afterAll(async () => {
  await da.post('/vehicles/draft', { licenseCountry: 'GB', licenseNumber: 'AB12 CDE' });
  await da.put('/vehicles/draft/vehicle-details', {
    brand: 'Toyota', model_num: 'NHW20', model_name: 'Prius',
    type: 'sedan', color: 'Silver', year: 2021,
  });
  await da.post('/vehicles/draft/save', {});
});

describe('TC-VEH-001 — Add a vehicle', () => {
  it('creates vehicle with isVerified=false', async () => {
    // Step 1: create draft with license info
    const draftRes = await da.post('/vehicles/draft', {
      licenseCountry: 'GB',
      licenseNumber: 'XY99 ZZZ',
    });
    expect([200, 201]).toContain(draftRes.status);

    // Step 2: fill in vehicle details
    const detailsRes = await da.put('/vehicles/draft/vehicle-details', {
      brand: 'Honda',
      model_num: 'FK8',
      model_name: 'Civic',
      type: 'hatchback',
      color: 'Blue',
      year: 2020,
    });
    expect(detailsRes.status).toBe(200);

    // Step 3: save draft as active vehicle
    const saveRes = await da.post('/vehicles/draft/save', {});
    expect([200, 201]).toContain(saveRes.status);
    const vehicle = saveRes.data.data ?? saveRes.data;
    expect(vehicle.id).toBeTruthy();
    expect(vehicle.isVerified).toBe(false);
    createdVehicleId = vehicle.id;
  });
});

describe('TC-VEH-002 — List my vehicles', () => {
  it('includes the newly created vehicle', async () => {
    const res = await da.get('/vehicles');
    expect(res.status).toBe(200);
    const raw = res.data.data ?? res.data;
    const vehicles: Array<{ id: string }> = raw.vehicles ?? raw;
    expect(vehicles.some((v) => v.id === createdVehicleId)).toBe(true);
  });
});

describe('TC-VEH-005 — Delete vehicle belonging to another user', () => {
  it('returns 403 or 404', async () => {
    const res = await db.delete(`/vehicles/${createdVehicleId}`);
    expect([403, 404]).toContain(res.status);

    // Confirm vehicle still exists for the real owner
    const listRes = await da.get('/vehicles');
    const raw2 = listRes.data.data ?? listRes.data;
    const vehicles2: Array<{ id: string }> = raw2.vehicles ?? raw2;
    expect(vehicles2.some((v) => v.id === createdVehicleId)).toBe(true);
  });
});

describe('TC-VEH-004 — Soft delete vehicle', () => {
  it('returns 200 and vehicle disappears from list', async () => {
    const res = await da.delete(`/vehicles/${createdVehicleId}`);
    expect(res.status).toBe(200);

    const listRes = await da.get('/vehicles');
    const raw3 = listRes.data.data ?? listRes.data;
    const vehicles: Array<{ id: string }> = raw3.vehicles ?? raw3;
    const stillPresent = vehicles.some((v) => v.id === createdVehicleId);
    expect(stillPresent).toBe(false);
  });
});
