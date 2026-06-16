/* global firebase */
importScripts('https://www.gstatic.com/firebasejs/12.14.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.14.0/firebase-messaging-compat.js');

const params = new URL(self.location.href).searchParams;
const firebaseConfig = {
  apiKey: params.get('apiKey'),
  authDomain: params.get('authDomain'),
  projectId: params.get('projectId'),
  storageBucket: params.get('storageBucket'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
};

if (firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.messagingSenderId && firebaseConfig.appId) {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const data = payload.data || {};
    self.registration.showNotification(
      payload.notification?.title || data.title || 'New notification',
      {
        body: payload.notification?.body || data.body || '',
        data,
        tag: data.notificationId || payload.messageId,
      },
    );
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const rideId = data.rideId;
  const bookingId = data.bookingId;
  const deepLink = data.deepLink || '';
  let targetUrl = '/profile/notifications';

  if (rideId && deepLink.startsWith('app://driver/booking-request/')) {
    targetUrl = `/rides/${rideId}/manage${bookingId ? `?bookingId=${bookingId}` : ''}`;
  } else if (rideId) {
    targetUrl = `/rides/${rideId}${bookingId ? `?bookingId=${bookingId}` : ''}`;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    }),
  );
});
