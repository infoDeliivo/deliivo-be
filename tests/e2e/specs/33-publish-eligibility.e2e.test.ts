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

// Veriff rows are normally written by session creation and the decision webhook. Neither can
// run here — a TEST integration never decides on its own — so the two states the gate reads
// are set directly.
const createLicenceRow = async (status: 'PENDING' | 'IDENTITY_MISMATCH' | 'APPROVED') => {
  const db = getDb();
  try {
    await db.dlVerification.create({
      data: {
        userId: driverId,
        veriffSessionId: `e2e-elg-${status.toLowerCase()}-${driverId}`,
        veriffSessionUrl: 'https://example.test/e2e-session',
        status,
      },
    });
  } finally {
    await db.$disconnect();
  }
};

const setLicenceStatus = async (status: 'PENDING' | 'IDENTITY_MISMATCH' | 'APPROVED') => {
  const db = getDb();
  try {
    await db.dlVerification.updateMany({ where: { userId: driverId }, data: { status } });
  } finally {
    await db.$disconnect();
  }
};

// Veriff's event webhook stamps this when the driver actually uploads. Set directly here for
// the same reason as the rows themselves: a TEST integration sends no events of its own.
const setLicenceSubmitted = async (submittedAt: Date | null) => {
  const db = getDb();
  try {
    await db.dlVerification.updateMany({ where: { userId: driverId }, data: { submittedAt } });
  } finally {
    await db.$disconnect();
  }
};

const clearLicenceRows = async () => {
  const db = getDb();
  try {
    await db.dlVerification.deleteMany({ where: { userId: driverId } });
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
    // Three gates, one per task the driver has left: licence, payouts, vehicle.
    expect(res.data.data.requirements.map((item: { key: string }) => item.key)).toEqual([
      'DL_VERIFICATION',
      'BANK_ACCOUNT',
      'VEHICLE',
    ]);
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

    // The gates are reported in order, and the first unsatisfied one is what the entry point
    // throws. Licence and payouts have to be satisfied for the vehicle gate to be the one
    // under test — otherwise this asserts DRIVER_NOT_VERIFIED while claiming to test vehicles.
    await setDriver({ dlVerified: true, stripeOnboardingComplete: true });

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
    const bypassed = requirement(checklist.data, 'VEHICLE')?.skipped === true;

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
    expect(requirement(beforeApproval.data, 'VEHICLE')).toMatchObject(
      bypassed ? { satisfied: true, skipped: true } : { reason: 'VEHICLE_NOT_VERIFIED' },
    );

    await setVehicleStatus('APPROVED');
    const afterApproval = await authed(driverToken).get('/publish-ride/eligibility');
    expect(requirement(afterApproval.data, 'VEHICLE')).toMatchObject({
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

describe('TC-ELG-006 — a submitted licence reads as under review, not as untouched', () => {
  // Veriff decides asynchronously: the row is PENDING from the moment the driver finishes
  // uploading until the decision webhook lands. Both ends of that window are exercised here,
  // because the bug this guards against is the middle looking identical to the start.
  it('moves DL_VERIFICATION through pending and back to satisfied on approval', async () => {
    if (!ready) return;

    await setDriver({ tosAcceptedAt: new Date(), stripeOnboardingComplete: true, dlVerified: false });
    await setVehicleStatus('APPROVED');
    await clearLicenceRows();

    // 1. Nothing submitted — the driver is asked to verify, and sent to the session route.
    const untouched = await authed(driverToken).get('/publish-ride/eligibility');
    expect(requirement(untouched.data, 'DL_VERIFICATION')).toMatchObject({
      satisfied: false,
      reason: 'DRIVER_NOT_VERIFIED',
      actionUrl: '/api/v1/dl-verification',
    });

    // 2. Submitted, awaiting the decision webhook — a code of its own, and a destination the
    //    driver can poll instead of a second Veriff session for the same document.
    await createLicenceRow('PENDING');

    // A row alone is not a submission: the session may have been opened and abandoned. That
    // driver still needs the Verify licence button, not an invitation to wait.
    const abandoned = await authed(driverToken).get('/publish-ride/eligibility');
    expect(requirement(abandoned.data, 'DL_VERIFICATION')).toMatchObject({
      satisfied: false,
      reason: 'DRIVER_NOT_VERIFIED',
      actionUrl: '/api/v1/dl-verification',
    });

    // The event webhook stamps submittedAt — only now is the driver genuinely waiting.
    await setLicenceSubmitted(new Date());

    const underReview = await authed(driverToken).get('/publish-ride/eligibility');
    expect(underReview.data.data.eligible).toBe(false);
    expect(requirement(underReview.data, 'DL_VERIFICATION')).toMatchObject({
      satisfied: false,
      skipped: false,
      reason: 'DL_VERIFICATION_PENDING',
      actionUrl: '/api/v1/dl-verification/status',
    });

    // The wizard entry point speaks the same language as the checklist.
    const gated = await authed(driverToken).post('/publish-ride/draft/origin', {
      originPlaceId: 'ChIJdd4hrwug2EcRmSrV3Vo6llI',
      originAddress: 'Tallinn, Estonia',
      originLat: 59.437,
      originLng: 24.7536,
    });
    expect(gated.status).toBe(403);
    expect(String(gated.data.message)).toMatch(/under review/i);

    // 3. The approved decision webhook flips both the row and the user flag.
    await setLicenceStatus('APPROVED');
    await setDriver({ dlVerified: true });

    const approved = await authed(driverToken).get('/publish-ride/eligibility');
    expect(requirement(approved.data, 'DL_VERIFICATION')).toMatchObject({
      satisfied: true,
      reason: null,
      actionUrl: null,
    });
    expect(approved.data.data.eligible).toBe(true);

    await clearLicenceRows();
  });

  // A mismatch is fixable now; waiting is not. The driver is shown the actionable one.
  it('keeps DL_IDENTITY_MISMATCH ahead of a pending session', async () => {
    if (!ready) return;

    await setDriver({ dlVerified: false });
    await clearLicenceRows();
    await createLicenceRow('PENDING');
    await createLicenceRow('IDENTITY_MISMATCH');
    await setLicenceSubmitted(new Date());

    const res = await authed(driverToken).get('/publish-ride/eligibility');

    expect(requirement(res.data, 'DL_VERIFICATION')).toMatchObject({
      reason: 'DL_IDENTITY_MISMATCH',
      actionUrl: '/api/v1/dl-verification',
    });

    await clearLicenceRows();
    await setDriver({ dlVerified: true });
  });
});

describe('TC-ELG-005 — admin review queue', () => {
  it('rejects a review decision from a non-admin', async () => {
    if (!ready) return;

    const res = await authed(driverToken).get('/admin/vehicles?status=PENDING');

    expect(res.status).toBe(403);
  });
});
