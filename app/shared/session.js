// session.js — authentication/session surface for both apps.
// Auth is owned by Supabase Auth. MFA truth = AAL from Auth (addendum §11): we read
// the assurance level from Auth, never from a duplicated profile column.
import { getClient } from './supabaseClient.js';

export async function getSession() {
  const sb = await getClient();
  const { data, error } = await sb.auth.getSession();
  if (error) return null;
  return data.session || null;
}

export async function getUser() {
  const s = await getSession();
  return s ? s.user : null;
}

// Resolve the Authenticator Assurance Level from Auth (aal1 = password, aal2 = MFA).
// Enforcement is deferred (owner decision D5); this exposes the truth for display/gating.
export async function getAAL() {
  const sb = await getClient();
  try {
    const { data, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) return { current: null, next: null };
    return { current: data.currentLevel, next: data.nextLevel };
  } catch (_) {
    return { current: null, next: null };
  }
}

export async function signInWithPassword(email, password) {
  const sb = await getClient();
  return sb.auth.signInWithPassword({ email, password });
}

// Carrier self-registration. The backend new-user trigger creates the carrier
// profile (role='carrier') from this auth user; company/name ride along as
// user metadata. If email confirmation is on, data.session is null and the
// caller should ask the user to confirm via email before signing in.
export async function signUp(email, password, meta = {}) {
  const sb = await getClient();
  return sb.auth.signUp({ email, password, options: { data: { company: meta.company || '', name: meta.name || '' } } });
}

export async function signOut() {
  const sb = await getClient();
  try { await sb.auth.signOut(); } catch (_) {}
  // Purge any app caches on logout so no private view survives a session — both
  // directly and via the controlling service worker (LB_PURGE).
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'LB_PURGE' });
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k.indexOf('lb-app') === 0).map(k => caches.delete(k)));
    }
  } catch (_) {}
}

export async function onAuthChange(cb) {
  const sb = await getClient();
  const { data } = sb.auth.onAuthStateChange((_event, session) => cb(session));
  return () => { try { data.subscription.unsubscribe(); } catch (_) {} };
}

// Gate a page on an authenticated session. Returns the session or redirects to `loginUrl`.
export async function requireSession(loginUrl) {
  const s = await getSession();
  if (!s) { window.location.replace(loginUrl); return null; }
  return s;
}
