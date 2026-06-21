'use client';

import { useEffect, useState } from 'react';
import { NotificationRecord, notificationsApi } from './api';
import { getSocket, onSocketEvent, NotificationPayload } from './socket';

type NotificationState = {
  items: NotificationRecord[];
  unreadCount: number;
  loading: boolean;
  activeUserId: string | null;
  lastIncoming: NotificationRecord | null;
  lastSyncedAt: string | null;
  lastSyncAttemptAt: string | null;
  lastError: string | null;
};

const STORE_LIMIT = 50;
const REFRESH_INTERVAL_MS = 20000;

let state: NotificationState = {
  items: [],
  unreadCount: 0,
  loading: false,
  activeUserId: null,
  lastIncoming: null,
  lastSyncedAt: null,
  lastSyncAttemptAt: null,
  lastError: null,
};

const listeners = new Set<(nextState: NotificationState) => void>();
let teardown: (() => void) | null = null;
let inflightLoad: Promise<void> | null = null;

function emit() {
  listeners.forEach((listener) => listener(state));
}

function setState(nextState: Partial<NotificationState>) {
  state = { ...state, ...nextState };
  emit();
}

function mapIncomingNotification(payload: NotificationPayload): NotificationRecord {
  return {
    id: payload.data.id,
    type: payload.data.notificationType,
    title: payload.data.title,
    body: payload.data.body,
    data: (payload.data.data || {}) as Record<string, unknown>,
    isRead: false,
    readAt: null,
    createdAt: payload.data.createdAt,
  };
}

function upsertIncoming(item: NotificationRecord) {
  const existing = state.items.find((entry) => entry.id === item.id);
  const nextItems = [item, ...state.items.filter((entry) => entry.id !== item.id)].slice(0, STORE_LIMIT);
  const unreadCount = existing?.isRead
    ? state.unreadCount
    : existing
      ? state.unreadCount
      : state.unreadCount + 1;

  setState({
    items: nextItems,
    unreadCount,
    lastIncoming: item,
  });
}

async function loadNotifications(force = false) {
  if (!state.activeUserId) return;
  if (inflightLoad && !force) return inflightLoad;

  setState({ loading: true, lastSyncAttemptAt: new Date().toISOString() });
  inflightLoad = (async () => {
    try {
      const [listRes, unreadRes] = await Promise.all([
        notificationsApi.list(undefined, STORE_LIMIT),
        notificationsApi.getUnreadCount(),
      ]);
      setState({
        items: listRes.data.notifications || [],
        unreadCount: unreadRes.data.unreadCount || 0,
        loading: false,
        lastSyncedAt: new Date().toISOString(),
        lastSyncAttemptAt: new Date().toISOString(),
        lastError: null,
      });
    } catch (error) {
      setState({
        loading: false,
        lastError: error instanceof Error ? error.message : 'Failed to refresh notifications',
      });
    } finally {
      inflightLoad = null;
    }
  })();

  return inflightLoad;
}

function stopStoreSync(reset = false) {
  teardown?.();
  teardown = null;
  inflightLoad = null;
  if (reset) {
    state = {
      items: [],
      unreadCount: 0,
      loading: false,
      activeUserId: null,
      lastIncoming: null,
      lastSyncedAt: null,
      lastSyncAttemptAt: null,
      lastError: null,
    };
    emit();
  }
}

function startStoreSync(userId: string) {
  if (state.activeUserId === userId && teardown) return;

  stopStoreSync();
  setState({
    activeUserId: userId,
    items: [],
    unreadCount: 0,
    loading: false,
    lastIncoming: null,
    lastSyncedAt: null,
    lastSyncAttemptAt: null,
    lastError: null,
  });

  getSocket();
  void loadNotifications(true);

  const refreshOnFocus = () => {
    if (document.visibilityState === 'visible') {
      void loadNotifications(true);
    }
  };
  const refreshOnWindowFocus = () => {
    void loadNotifications(true);
  };
  const intervalId = window.setInterval(() => {
    void loadNotifications(true);
  }, REFRESH_INTERVAL_MS);

  const socket = getSocket();
  const handleConnect = () => {
    void loadNotifications(true);
  };
  socket?.on('connect', handleConnect);

  const unsubIncoming = onSocketEvent<NotificationPayload>('notification:new', (payload) => {
    upsertIncoming(mapIncomingNotification(payload));
    void loadNotifications(true);
  });

  document.addEventListener('visibilitychange', refreshOnFocus);
  window.addEventListener('focus', refreshOnWindowFocus);
  window.addEventListener('online', refreshOnWindowFocus);

  teardown = () => {
    unsubIncoming();
    socket?.off('connect', handleConnect);
    document.removeEventListener('visibilitychange', refreshOnFocus);
    window.removeEventListener('focus', refreshOnWindowFocus);
    window.removeEventListener('online', refreshOnWindowFocus);
    window.clearInterval(intervalId);
  };
}

export function useNotificationStore(userId?: string) {
  const [snapshot, setSnapshot] = useState(state);

  useEffect(() => {
    const listener = (nextState: NotificationState) => setSnapshot(nextState);
    listeners.add(listener);
    setSnapshot(state);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      stopStoreSync(true);
      return;
    }
    startStoreSync(userId);
  }, [userId]);

  return {
    ...snapshot,
    refresh: () => loadNotifications(true),
    markAllRead: async () => {
      const unreadIds = state.items.filter((item) => !item.isRead).map((item) => item.id);
      if (unreadIds.length === 0) return;
      await notificationsApi.markRead(unreadIds);
      setState({
        items: state.items.map((item) =>
          unreadIds.includes(item.id) ? { ...item, isRead: true, readAt: new Date().toISOString() } : item
        ),
        unreadCount: 0,
      });
    },
  };
}
