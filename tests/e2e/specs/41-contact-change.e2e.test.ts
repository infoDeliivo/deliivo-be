/**
 * E2E — Add / change email or phone on an authenticated account
 * Covers: TC-CONTACT-001 through TC-CONTACT-008
 *
 * POST /users/me/contact/request sends an OTP to the new value; POST /users/me/contact/verify
 * saves it as verified. The server must expose OTPs in responses (OTP debug mode).
 * All emails stay on @test.local so global teardown removes the users.
 */
import { api, authed, expectOk } from '../helpers/api.client';
import { readState } from '../helpers/state';
import { signupAndVerifyEmail } from '../helpers/auth.helper';

const state = readState();

/** Unique Estonian mobile per run so reruns never collide on the phone unique index. */
const randomPhone = (): string => `+3725${Math.floor(1000000 + Math.random() * 8999999)}`;

type Client = ReturnType<typeof authed>;

async function requestCode(client: Client, method: 'email' | 'phone', identifier: string): Promise<string> {
  const data = expectOk(await client.post('/users/me/contact/request', { method, identifier }));
  if (!data.code) {
    throw new Error('OTP not in contact request response — start the server in OTP debug mode');
  }
  return data.code as string;
}

let userEmail: string;
let user: Client;
let otherEmail: string;
let other: Client;

beforeAll(async () => {
  userEmail = `e2e-contact-${state.runId}@test.local`;
  user = authed((await signupAndVerifyEmail(userEmail)).accessToken);

  otherEmail = `e2e-contact-other-${state.runId}@test.local`;
  other = authed((await signupAndVerifyEmail(otherEmail)).accessToken);
});

describe('Contact change', () => {
  it('TC-CONTACT-001: /users/me exposes per-channel verification flags', async () => {
    const me = expectOk(await user.get('/users/me'));
    expect(me.email).toBe(userEmail);
    expect(me.emailVerified).toBe(true);
    expect(me.phone).toBeNull();
    expect(me.phoneVerified).toBe(false);
  });

  it('TC-CONTACT-002: email signup user adds and verifies a phone', async () => {
    const phone = randomPhone();
    const code = await requestCode(user, 'phone', phone);

    const me = expectOk(await user.post('/users/me/contact/verify', { method: 'phone', identifier: phone, code }));
    expect(me.phone).toBe(phone);
    expect(me.phoneVerified).toBe(true);

    const fresh = expectOk(await user.get('/users/me'));
    expect(fresh.phone).toBe(phone);
  });

  it('TC-CONTACT-003: wrong code is rejected and nothing is saved', async () => {
    const phone = randomPhone();
    const code = await requestCode(other, 'phone', phone);
    const wrong = code === '0000' ? '1111' : '0000';

    const res = await other.post('/users/me/contact/verify', { method: 'phone', identifier: phone, code: wrong });
    expect(res.status).toBe(400);

    const me = expectOk(await other.get('/users/me'));
    expect(me.phone).toBeNull();
  });

  it('TC-CONTACT-004: verifying a value that was never requested is rejected', async () => {
    const res = await other.post('/users/me/contact/verify', {
      method: 'phone',
      identifier: randomPhone(),
      code: '1234',
    });
    expect(res.status).toBe(400);
  });

  it("TC-CONTACT-005: another verified account's email cannot be claimed", async () => {
    const res = await user.post('/users/me/contact/request', { method: 'email', identifier: otherEmail });
    expect(res.status).toBe(409);
  });

  it('TC-CONTACT-006: requesting the current verified email is rejected', async () => {
    const res = await user.post('/users/me/contact/request', {
      method: 'email',
      identifier: userEmail.toUpperCase(),
    });
    expect(res.status).toBe(400);
  });

  it('TC-CONTACT-007: invalid identifiers fail validation', async () => {
    const badPhone = await user.post('/users/me/contact/request', { method: 'phone', identifier: '5551234' });
    expect(badPhone.status).toBe(400);

    const badEmail = await user.post('/users/me/contact/request', { method: 'email', identifier: 'not-an-email' });
    expect(badEmail.status).toBe(400);

    const unauth = await api.post('/users/me/contact/request', { method: 'phone', identifier: randomPhone() });
    expect(unauth.status).toBe(401);
  });

  it('TC-CONTACT-008: changed email becomes the login identifier; old one stops working', async () => {
    const newEmail = `e2e-contact-new-${state.runId}@test.local`;
    const code = await requestCode(user, 'email', newEmail);

    const me = expectOk(await user.post('/users/me/contact/verify', { method: 'email', identifier: newEmail, code }));
    expect(me.email).toBe(newEmail);
    expect(me.emailVerified).toBe(true);

    const oldLogin = await api.post('/auth/login', { method: 'email', identifier: userEmail });
    expect(oldLogin.status).toBe(404);

    const newLogin = await api.post('/auth/login', { method: 'email', identifier: newEmail });
    expect(newLogin.status).toBe(200);
  });
});
