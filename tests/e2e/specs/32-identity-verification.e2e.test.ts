/**
 * E2E — Veriff DL identity matching (name / DOB / gender) at the webhook.
 *
 * An APPROVED Veriff decision only verifies the user when the document identity
 * matches the entered profile. A mismatch is flagged IDENTITY_MISMATCH and the
 * user stays unverified. Self-contained: seeds a DlVerification row directly in
 * the DB and posts an HMAC-signed webhook — no Veriff/Google/publish involved.
 */
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { api, authed } from '../helpers/api.client';
import { readState } from '../helpers/state';
import { signupAndVerifyEmail, toAccountState } from '../helpers/auth.helper';

const state = readState();
const SHARED_SECRET = process.env.VERIFF_SHARED_SECRET ?? '';

let driverToken: string;
let driverId: string;
let ready = false;

function getDb(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
  return new PrismaClient({ adapter });
}

const signedWebhook = (body: unknown) => {
  const signature = crypto.createHmac('sha256', SHARED_SECRET).update(JSON.stringify(body)).digest('hex');
  return api.post('/dl-verification/webhook', body, { headers: { 'x-hmac-signature': signature } });
};

const seedSession = async (sessionId: string) => {
  const db = getDb();
  try {
    await db.dlVerification.create({
      data: {
        userId: driverId,
        veriffSessionId: sessionId,
        veriffSessionUrl: 'https://veriff.test/session',
        status: 'PENDING',
      },
    });
  } finally {
    await db.$disconnect();
  }
};

const readUserDlVerified = async (): Promise<boolean> => {
  const db = getDb();
  try {
    const u = await db.user.findUnique({ where: { id: driverId }, select: { dlVerified: true } });
    return u?.dlVerified ?? false;
  } finally {
    await db.$disconnect();
  }
};

beforeAll(async () => {
  if (!process.env.DATABASE_URL || !SHARED_SECRET) {
    console.warn('[32-identity] DATABASE_URL or VERIFF_SHARED_SECRET missing — tests will skip.');
    return;
  }
  const email = `e2e-idmatch-${state.runId}@test.local`;
  const account = toAccountState(await signupAndVerifyEmail(email), email);
  driverToken = account.accessToken;
  driverId = account.id;

  // Entered profile name the document will be matched against.
  await authed(driverToken).put('/users/me', { name: 'Alan Turing', salutation: 'MR' });
  ready = true;
});

describe('TC-IDM-001 — approved DL with a mismatching name is blocked', () => {
  it('flags IDENTITY_MISMATCH and leaves the user unverified', async () => {
    if (!ready) return;
    const sessionId = `sess-mismatch-${state.runId}`;
    await seedSession(sessionId);

    const res = await signedWebhook({
      verification: { id: sessionId, status: 'approved', code: 9001, person: { firstName: 'Grace', lastName: 'Hopper' } },
    });
    expect(res.status).toBe(200);

    const statusRes = await authed(driverToken).get('/dl-verification/status');
    expect((statusRes.data.data ?? statusRes.data).status).toBe('IDENTITY_MISMATCH');
    expect(await readUserDlVerified()).toBe(false);
  });
});

describe('TC-IDM-002 — approved DL with a matching name verifies the user', () => {
  it('sets status APPROVED and dlVerified=true', async () => {
    if (!ready) return;
    const sessionId = `sess-match-${state.runId}`;
    await seedSession(sessionId);

    const res = await signedWebhook({
      verification: { id: sessionId, status: 'approved', code: 9001, person: { firstName: 'Alan', lastName: 'Turing' } },
    });
    expect(res.status).toBe(200);

    const statusRes = await authed(driverToken).get('/dl-verification/status');
    expect((statusRes.data.data ?? statusRes.data).status).toBe('APPROVED');
    expect(await readUserDlVerified()).toBe(true);
  });
});
