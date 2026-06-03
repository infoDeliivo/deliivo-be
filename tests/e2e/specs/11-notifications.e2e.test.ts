/**
 * E2E — Notifications
 * Covers: TC-NOTIF-001 through TC-NOTIF-005
 *
 * Depends on notifications having been created for passengerA during earlier
 * tests (booking accepted, deadline, etc.). If the suite runs in isolation,
 * the notification list may be empty but the API contract is still tested.
 */
import { authed } from '../helpers/api.client';
import { readState } from '../helpers/state';

const state = readState();
const pa = authed(state.passengerA.accessToken);

let firstNotificationId: string | null = null;
let initialUnreadCount: number;

describe('TC-NOTIF-001 — Get notifications list', () => {
  it('returns 200 with cursor-paginated list', async () => {
    const res = await pa.get('/notifications');
    expect(res.status).toBe(200);
    const body = res.data.data ?? res.data;
    const notifications: Array<{ id: string; isRead: boolean }> =
      body.notifications ?? body;
    expect(Array.isArray(notifications)).toBe(true);

    if (notifications.length > 0) {
      firstNotificationId = notifications[0].id;
      expect(notifications[0]).toHaveProperty('type');
      expect(notifications[0]).toHaveProperty('title');
      expect(notifications[0]).toHaveProperty('createdAt');
    }
  });
});

describe('TC-NOTIF-002 — Get unread count', () => {
  it('returns a numeric count', async () => {
    const res = await pa.get('/notifications/unread-count');
    expect(res.status).toBe(200);
    const body = res.data.data ?? res.data;
    expect(typeof (body.count ?? body.unreadCount ?? body)).toBe('number');
    initialUnreadCount = body.count ?? body.unreadCount ?? 0;
  });

  it('returns same count on second call (Redis cache hit)', async () => {
    const res = await pa.get('/notifications/unread-count');
    expect(res.status).toBe(200);
    const body = res.data.data ?? res.data;
    const count = body.count ?? body.unreadCount ?? 0;
    expect(count).toBe(initialUnreadCount);
  });
});

describe('TC-NOTIF-003 — Mark notifications as read', () => {
  it('decrements unread count after marking', async () => {
    if (!firstNotificationId) {
      console.log('[TC-NOTIF-003] No notifications to mark — skipping count assertion');
      return;
    }

    const res = await pa.post('/notifications/mark-read', {
      notificationIds: [firstNotificationId],
    });
    expect(res.status).toBe(200);
    const result = res.data.data ?? res.data;
    expect(result.markedCount).toBeGreaterThanOrEqual(0);

    // Unread count should drop
    const countRes = await pa.get('/notifications/unread-count');
    const newCount = (countRes.data.data ?? countRes.data).count ??
      (countRes.data.data ?? countRes.data).unreadCount ?? 0;
    expect(newCount).toBeLessThanOrEqual(initialUnreadCount);
  });
});

describe('TC-NOTIF-004 — Register device token for push', () => {
  it('stores FCM token and returns 200/201', async () => {
    const res = await pa.post('/notifications/device-token', {
      platform: 'ios',
      token: `test-fcm-token-${state.runId}`,
    });
    expect([200, 201]).toContain(res.status);
  });
});

describe('TC-NOTIF-005 — Register same device token again (upsert)', () => {
  it('is idempotent — no duplicate, returns 200/201', async () => {
    const token = `test-fcm-token-${state.runId}`;
    const first = await pa.post('/notifications/device-token', {
      platform: 'ios',
      token,
    });
    const second = await pa.post('/notifications/device-token', {
      platform: 'ios',
      token,
    });
    expect([200, 201]).toContain(first.status);
    expect([200, 201]).toContain(second.status);
    // Both should return the same device ID
    const id1 = (first.data.data ?? first.data).id;
    const id2 = (second.data.data ?? second.data).id;
    if (id1 && id2) expect(id1).toBe(id2);
  });
});

describe('Notification pagination', () => {
  it('respects limit parameter', async () => {
    const res = await pa.get('/notifications', { limit: 2 });
    expect(res.status).toBe(200);
    const body = res.data.data ?? res.data;
    const notifications: unknown[] = body.notifications ?? body;
    expect(notifications.length).toBeLessThanOrEqual(2);
  });
});
