'use client';

import { io, Socket } from 'socket.io-client';
import { getTokens } from './api';

let socket: Socket | null = null;

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || '';

export function getSocket(): Socket | null {
  if (typeof window === 'undefined') return null;
  if (socket?.connected) return socket;

  const tokens = getTokens();
  if (!tokens?.accessToken || !SOCKET_URL) return null;

  socket = io(SOCKET_URL, {
    auth: { token: tokens.accessToken },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
  });

  socket.on('connect', () => {
    console.log('[Socket] Connected:', socket?.id);
  });

  socket.on('disconnect', (reason) => {
    console.log('[Socket] Disconnected:', reason);
  });

  socket.on('connect_error', (err) => {
    console.warn('[Socket] Connection error:', err.message);
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

// Event listener helpers
export function onSocketEvent<T = unknown>(event: string, handler: (data: T) => void) {
  const s = getSocket();
  if (!s) return () => {};
  s.on(event, handler);
  return () => { s.off(event, handler); };
}

export function emitSocketEvent(event: string, data?: unknown) {
  const s = getSocket();
  if (!s) return;
  s.emit(event, data);
}

// Typed events for the app
export interface LocationUpdate {
  rideId: string;
  lat: number;
  lng: number;
  timestamp: string;
}

export interface NotificationPayload {
  id: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  createdAt: string;
}
