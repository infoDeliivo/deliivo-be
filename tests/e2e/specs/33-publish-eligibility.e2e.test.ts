/**
 * E2E — Publish eligibility and the vehicle admin review queue.
 *
 * Every publish requirement is checked at the START of the wizard, not only at the
 * end, so a driver is never walked through twelve steps before being rejected.
 * Covers the eligibility checklist endpoint, the entry-point gate, the Estonian
 * document requirement, and the admin approve path unblocking publish.
 *
 * Self-contained: creates its own driver so the shared fixture driver is untouched.
 * The DB is used only to flip verification state an admin would otherwise set.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { authed } from '../helpers/api.client';
import { readState } from '../helpers/state';
import { signupAndVerifyEmail, toAccountState } from '../helpers/auth.helper';

const state = readState();

let driverToken: string;
let driverId: string;
let ready = false;

function getDb(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
  return new PrismaClient({ adapter });
}

const requirement = (body: any, key: string) =>
  (body.data?.requirements ?? []).find((item: any) => item.key === key);

const setDriver = async (data: Record<string, unknown>) => {
  const db = getDb();
  try {
    await db.user.update({ where: { id: driverId }, data });
  } finally {
    await db.$disconnect();
  }
};

const setVehicleStatus = async (status: 'PENDING' | 'APPROVED' | 'REJECTED') => {
  const db = getDb();
  try {
    await db.vehicle.updateMany({
      where: { userId: driverId, deletedAt: null },
      data: { verificationStatus: status, isVerified: status === 'APPROVED' },
    });
  } finally {
    await db.$disconnect();
  }
};

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    console.warn('[33-publish-eligibility] DATABASE_URL not set — tests will skip.');
    return;
  }

  const email = `e2e-eligibility-driver-${state.runId}@test.local`;
  const account = toAccountState(await signupAndVerifyEmail(email), email);
  driverToken = account.accessToken;
  driverId = account.id;

  await authed(driverToken).put('/users/me', { firstName: 'Eligibility', lastName: 'Driver', salutation: 'MR' });
  ready = true;
});

describe('TC-ELG-001 — eligibility checklist', () => {
  it('lists the outstanding requirements for a brand-new driver', async () => {
    if (!ready) return;

    const res = await authed(driverToken).get('/publish-ride/eligibility');

    expect(res.status).toBe(200);
    expect(res.data.data.eligible).toBe(false);
    // ToS is reported so the app can show it, even though it only blocks at publish.
    expect(requirement(res.data, 'TOS')).toMatchObject({ satisfied: false });
    expect(requirement(res.data, 'VEHICLE')).toMatchObject({
      satisfied: false,
      reason: 'VEHICLE_REQUIRED',
    });
  });

  it('marks each gate either satisfied or blocked with a reason, never both', async () => {
    if (!ready) return;

    const res = await authed(driverToken).get('/publish-ride/eligibility');

    // The server's own bypass configuration is reported through `skipped`, so the
    // assertion holds whichever flags the server under test was started with.
    for (const item of res.data.data.requirements) {
      if (item.satisfied) {
        expect(item.reason).toBeNull();
      } else {
        expect(typeof item.reason).toBe('string');
        expect(item.skipped).toBe(false);
      }
    }
  });
});

describe('TC-ELG-002 — the wizard is gated at its entry point', () => {
  it('rejects POST /draft/origin before a vehicle exists', async () => {
    if (!ready) return;

    const res = await authed(driverToken).post('/publish-ride/draft/origin', {
      originPlaceId: 'ChIJdd4hrwug2EcRmSrV3Vo6llI',
      originAddress: 'Tallinn, Estonia',
      originLat: 59.437,
      originLng: 24.7536,
    });

    // 400 VEHICLE_REQUIRED — the draft is never created.
    expect(res.status).toBe(400);
    expect(String(res.data.message)).toMatch(/vehicle/i);
  });
});

describe('TC-ELG-003 — Estonian vehicles must carry the full document set', () => {
  it('rejects a save with no documents and names what is missing', async () => {
    if (!ready) return;

    const draftRes = await authed(driverToken).post('/vehicles/draft', {
      licenseCountry: 'EE',
      licenseNumber: 'EE 123 ABC',
    });
    if (draftRes.status !== 200 && draftRes.status !== 201) return;

    await authed(driverToken).put('/vehicles/draft/vehicle-details', {
      brand: 'Skoda',
      model_name: 'Octavia',
      model_num: '2020',
      type: 'sedan',
      color: 'Grey',
      year: 2020,
    });

    const res = await authed(driverToken).post('/vehicles/draft/save', {});

    expect(res.status).toBe(400);
    expect(String(res.data.message)).toContain('VEHICLE_IMAGE_FRONT');
  });

  it('saves a non-Estonian vehicle without documents', async () => {
    if (!ready) return;

    await authed(driverToken).post('/vehicles/draft', {
      licenseCountry: 'GB',
      licenseNumber: 'AB12 CDE',
    });
    await authed(driverToken).put('/vehicles/draft/vehicle-details', {
      brand: 'Ford',
      model_name: 'Focus',
      model_num: '2019',
      type: 'hatchback',
      color: 'Black',
      year: 2019,
    });

    const res = await authed(driverToken).post('/vehicles/draft/save', {});

    expect([200, 201]).toContain(res.status);
  });
});

describe('TC-ELG-004 — vehicle review state controls publishing', () => {
  it('blocks the wizard while the vehicle is PENDING, and unblocks once approved', async () => {
    if (!ready) return;

    await setDriver({ tosAcceptedAt: new Date(), dlVerified: true, stripeOnboardingComplete: true });
    await setVehicleStatus('PENDING');

    // Ask the server whether the approval gate is enabled rather than guessing from
    // the test process env — the flag belongs to the server under test.
    const checklist = await authed(driverToken).get('/publish-ride/eligibility');
    const bypassed = requirement(checklist.data, 'VEHICLE_VERIFICATION')?.skipped === true;

    const origin = {
      originPlaceId: 'ChIJdd4hrwug2EcRmSrV3Vo6llI',
      originAddress: 'Tallinn, Estonia',
      originLat: 59.437,
      originLng: 24.7536,
    };

    // Assert on the eligibility gate itself, not on draft creation — the origin
    // placeId still has to clear Google's Baltic-country check, which is not what
    // this test is about.
    const pending = await authed(driverToken).post('/publish-ride/draft/origin', origin);
    if (bypassed) {
      expect(String(pending.data.message ?? '')).not.toMatch(/approval/i);
    } else {
      expect(pending.status).toBe(403);
      expect(String(pending.data.message)).toMatch(/approval/i);
    }

    await setVehicleStatus('APPROVED');

    const approved = await authed(driverToken).post('/publish-ride/draft/origin', origin);
    expect(approved.status).not.toBe(403);

    // The checklist is the authoritative view of the gate.
    const beforeApproval = await (async () => {
      await setVehicleStatus('PENDING');
      return authed(driverToken).get('/publish-ride/eligibility');
    })();
    expect(requirement(beforeApproval.data, 'VEHICLE_VERIFICATION')).toMatchObject(
      bypassed ? { satisfied: true, skipped: true } : { reason: 'VEHICLE_NOT_VERIFIED' },
    );

    await setVehicleStatus('APPROVED');
    const afterApproval = await authed(driverToken).get('/publish-ride/eligibility');
    expect(requirement(afterApproval.data, 'VEHICLE_VERIFICATION')).toMatchObject({
      satisfied: true,
    });
  });

  it('reports every requirement satisfied once the driver is fully onboarded', async () => {
    if (!ready) return;

    await setDriver({ tosAcceptedAt: new Date(), dlVerified: true, stripeOnboardingComplete: true });
    await setVehicleStatus('APPROVED');

    const res = await authed(driverToken).get('/publish-ride/eligibility');

    expect(res.data.data.eligible).toBe(true);
  });
});

describe('TC-ELG-005 — admin review queue', () => {
  it('rejects a review decision from a non-admin', async () => {
    if (!ready) return;

    const res = await authed(driverToken).get('/admin/vehicles?status=PENDING');

    expect(res.status).toBe(403);
  });
});
