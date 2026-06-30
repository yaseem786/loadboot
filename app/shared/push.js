// push.js — Web Push subscribe/unsubscribe helper (Phase 5). Requires a registered service
// worker (the Pocket app's pocket-sw.js or the Command Center SW) that handles 'push' events.
// The VAPID public key is safe to ship; the private key lives only in Supabase secrets.
import { savePushSubscription, revokePushSubscription, VAPID_PUBLIC_KEY } from './api.js';

function urlB64ToUint8(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported() {
  return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
}

export async function enablePush(label) {
  if (!pushSupported()) throw new Error('Push notifications are not supported on this device/browser.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notification permission was not granted.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  await savePushSubscription({ endpoint: sub.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, label: label || 'This device', ua: navigator.userAgent });
  return true;
}

export async function disablePush() {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) { const ep = sub.endpoint; try { await sub.unsubscribe(); } catch (_) {} try { await revokePushSubscription(ep); } catch (_) {} }
  return true;
}

export async function isPushEnabled() {
  if (!pushSupported()) return false;
  try { const reg = await navigator.serviceWorker.ready; return !!(await reg.pushManager.getSubscription()); } catch (_) { return false; }
}
