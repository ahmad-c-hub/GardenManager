import { api } from './api.js';

/** Browser can do web push (iOS only once the app is installed to the home screen). */
export const pushSupported =
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
export const isStandalone =
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true);

/** VAPID keys are URL-safe base64; PushManager wants the raw bytes. */
function base64UrlToBytes(base64Url) {
  const base64 = (base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function registration() {
  // Resolves once the service worker registered in main.jsx is active.
  return navigator.serviceWorker.ready;
}

/** This device's current subscription, or null. */
export async function currentSubscription() {
  if (!pushSupported) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/**
 * Ask for permission, subscribe this device with the server's VAPID key and
 * store the subscription on the server. Throws an Error with a user-facing message.
 */
export async function enablePush() {
  if (!pushSupported) throw new Error('This browser doesn’t support push notifications.');

  const { enabled, publicKey } = await api.get('/push/public-key');
  if (!enabled) throw new Error('Notifications aren’t set up on the server yet.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notifications are blocked. Allow them for this site in your browser settings, then try again.'
        : 'Notification permission wasn’t granted.',
    );
  }

  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with a different (old) key can't receive our pushes.
  const key = base64UrlToBytes(publicKey);
  if (sub) {
    const existingKey = sub.options?.applicationServerKey && new Uint8Array(sub.options.applicationServerKey);
    if (existingKey && existingKey.join() !== key.join()) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });

  await api.post('/push/subscribe', { subscription: sub.toJSON() });
  return sub;
}

/** Unsubscribe this device locally and on the server. */
export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}
