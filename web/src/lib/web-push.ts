'use client';

import { initializeApp, getApp, getApps } from 'firebase/app';
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { notificationsApi } from './api';

type BrowserNotificationStatus =
  | 'unsupported'
  | 'not-configured'
  | 'permission-default'
  | 'permission-denied'
  | 'enabled';

type BrowserNotification = {
  id: string;
  title: string;
  body: string;
  data?: Record<string, string>;
};

let foregroundMessageListenerRegistered = false;

function getFirebaseConfig() {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  if (!config.apiKey || !config.projectId || !config.messagingSenderId || !config.appId) {
    return null;
  }

  return config;
}

function isSecureBrowserContext() {
  if (typeof window === 'undefined') return false;
  return window.isSecureContext || ['localhost', '127.0.0.1'].includes(window.location.hostname);
}

export function getBrowserNotificationStatus(): BrowserNotificationStatus {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (!getFirebaseConfig() || !process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY) return 'not-configured';
  if (Notification.permission === 'denied') return 'permission-denied';
  if (Notification.permission === 'granted') return 'enabled';
  return 'permission-default';
}

function getNotificationTarget(data?: Record<string, string>) {
  const rideId = data?.rideId;
  const bookingId = data?.bookingId;
  if (!rideId) return '/profile/notifications';

  const deepLink = data?.deepLink || '';
  if (deepLink.startsWith('app://driver/booking-request/')) {
    return `/rides/${rideId}/manage${bookingId ? `?bookingId=${bookingId}` : ''}`;
  }

  return `/rides/${rideId}${bookingId ? `?bookingId=${bookingId}` : ''}`;
}

export function showBrowserNotification(notification: BrowserNotification) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    const browserNotification = new Notification(notification.title, {
      body: notification.body,
      tag: notification.id,
      data: notification.data,
    });

    browserNotification.onclick = () => {
      window.focus();
      window.location.href = getNotificationTarget(notification.data);
      browserNotification.close();
    };
  } catch {
    // Browser notification support varies by platform; in-app toast still renders.
  }
}

function buildServiceWorkerUrl(config: NonNullable<ReturnType<typeof getFirebaseConfig>>) {
  const params = new URLSearchParams();
  Object.entries(config).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return `/firebase-messaging-sw.js?${params.toString()}`;
}

export async function registerBrowserPushDevice(): Promise<BrowserNotificationStatus> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (!('serviceWorker' in navigator) || !isSecureBrowserContext()) return 'unsupported';

  const config = getFirebaseConfig();
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!config || !vapidKey) return 'not-configured';

  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'permission-denied';
  if (permission !== 'granted') return 'permission-default';

  const supported = await isSupported();
  if (!supported) return 'unsupported';

  const app = getApps().length ? getApp() : initializeApp(config);
  const messaging = getMessaging(app);
  const registration = await navigator.serviceWorker.register(buildServiceWorkerUrl(config));
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });

  if (!token) return 'permission-default';

  await notificationsApi.registerDevice('web', token);

  if (!foregroundMessageListenerRegistered) {
    foregroundMessageListenerRegistered = true;
    onMessage(messaging, (payload) => {
      showBrowserNotification({
        id: payload.data?.notificationId || payload.messageId || crypto.randomUUID(),
        title: payload.notification?.title || payload.data?.title || 'New notification',
        body: payload.notification?.body || payload.data?.body || '',
        data: payload.data as Record<string, string> | undefined,
      });
    });
  }

  return 'enabled';
}
