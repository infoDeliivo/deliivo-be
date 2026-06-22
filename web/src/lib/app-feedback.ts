'use client';

export type AppFeedbackKind = 'success' | 'error' | 'info';

export type AppFeedbackPayload = {
  kind: AppFeedbackKind;
  title: string;
  message?: string;
};

const EVENT_NAME = 'deliivo:feedback';

export function emitAppFeedback(payload: AppFeedbackPayload) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AppFeedbackPayload>(EVENT_NAME, { detail: payload }));
}

export function showSuccess(title: string, message?: string) {
  emitAppFeedback({ kind: 'success', title, message });
}

export function showError(title: string, message?: string) {
  emitAppFeedback({ kind: 'error', title, message });
}

export function showInfo(title: string, message?: string) {
  emitAppFeedback({ kind: 'info', title, message });
}

export function onAppFeedback(handler: (payload: AppFeedbackPayload) => void) {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event) => handler((event as CustomEvent<AppFeedbackPayload>).detail);
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
