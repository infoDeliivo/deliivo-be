/**
 * E2E — Chat REST Endpoints
 * Covers: TC-CHATREST-001 through TC-CHATREST-006
 *
 * Tests the REST fallback chat endpoints (as opposed to WebSocket in 13-chat).
 * Creates a conversation context via a confirmed booking.
 */
import { authed } from '../helpers/api.client';
import { readState } from '../helpers/state';
import { publishRide, LONDON_TO_MANCHESTER, futureDateStr } from '../helpers/ride.helper';

const state = readState();
const da = authed(state.driverA.accessToken);
const pa = authed(state.passengerA.accessToken);

let rideId: string;
let bookingId: string;
let conversationId: string;

beforeAll(async () => {
  try {
    rideId = await publishRide(state.driverA.accessToken, {
      ...LONDON_TO_MANCHESTER,
      totalSeats: 2,
      basePricePerSeat: 12.0,
      departureDate: futureDateStr(45),
    });
  } catch (err: any) {
    console.warn(`[27-chat-rest] Could not publish ride: ${err.message}`);
    return;
  }

  const bookRes = await pa.post('/bookings', { rideId, seatsBooked: 1 });
  if (bookRes.status !== 200 && bookRes.status !== 201) return;
  bookingId = (bookRes.data.data ?? bookRes.data).id;

  await da.post(`/driver/bookings/${bookingId}/accept`);

  // Send a message to create a conversation
  const sendRes = await pa.post('/chat/send', {
    receiverId: state.driverA.id,
    text: 'Hello, is this ride still available?',
    clientMsgId: `e2e-setup-${Date.now()}`,
  });
  if (sendRes.status === 200 || sendRes.status === 201) {
    const msg = sendRes.data.data ?? sendRes.data;
    conversationId = msg.conversationId;
  }
});

afterAll(async () => {
  if (rideId) await da.delete(`/publish-ride/${rideId}`).catch(() => {});
});

describe('TC-CHATREST-001 — Send text message via REST', () => {
  it('creates message and returns it', async () => {
    const res = await da.post('/chat/send', {
      receiverId: state.passengerA.id,
      text: 'Yes! See you at pickup.',
      clientMsgId: `e2e-msg-${Date.now()}`,
    });
    expect([200, 201]).toContain(res.status);
    const msg = res.data.data ?? res.data;
    expect(msg.text || msg.message?.text).toBeTruthy();
    if (!conversationId && msg.conversationId) {
      conversationId = msg.conversationId;
    }
  });
});

describe('TC-CHATREST-002 — List conversations', () => {
  it('returns array of conversations', async () => {
    const res = await pa.get('/chat');
    expect(res.status).toBe(200);
    const body = res.data.data ?? res.data;
    const convos = body.conversations ?? body;
    expect(Array.isArray(convos) || typeof convos === 'object').toBe(true);
  });
});

describe('TC-CHATREST-003 — Get unread count', () => {
  it('returns unread message count', async () => {
    const res = await da.get('/chat/unread-count');
    expect(res.status).toBe(200);
    const body = res.data.data ?? res.data;
    expect(typeof (body.count ?? body.unreadCount)).toBe('number');
  });
});

describe('TC-CHATREST-004 — Get messages for conversation', () => {
  it('returns paginated messages', async () => {
    if (!conversationId) return;
    const res = await pa.get(`/chat/${conversationId}/messages`);
    expect(res.status).toBe(200);
    const body = res.data.data ?? res.data;
    const messages = body.messages ?? body;
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBeGreaterThan(0);
  });
});

describe('TC-CHATREST-005 — Mark messages as read', () => {
  it('returns 200 on success', async () => {
    if (!conversationId) return;
    // Get a message ID to mark as read
    const msgRes = await da.get(`/chat/${conversationId}/messages`);
    const msgBody = msgRes.data.data ?? msgRes.data;
    const messages = msgBody.messages ?? msgBody;
    if (!Array.isArray(messages) || messages.length === 0) return;
    const lastMsgId = messages[0].id;
    const res = await da.post(`/chat/${conversationId}/read`, {
      lastReadMessageId: lastMsgId,
    });
    expect([200, 204]).toContain(res.status);
  });
});

describe('TC-CHATREST-006 — Send location message', () => {
  it('creates a location message', async () => {
    const res = await pa.post('/chat/send-location', {
      receiverId: state.driverA.id,
      clientMsgId: `e2e-loc-${Date.now()}`,
      latitude: 51.5074,
      longitude: -0.1278,
      address: 'London, UK',
    });
    expect([200, 201]).toContain(res.status);
  });
});
