// lb-cdn-bump 2026-08-15: force fresh Netlify blob upload (corrupt-deploy recovery) — no code changes.
// session.js — authentication/session surface for both apps.
// Auth is owned by Supabase Auth. MFA truth = AAL from Auth (addendum §11): we read
// the assurance level from Auth, never from a duplicated profile column.
import { getClient } from './supabaseClient.js';
import { syncShareOwner, clearSharedFiles } from './share-inbox.js';
let logoutInProgress = false, authRevision = 0;
// A manual token purge must also invalidate reads already running in sibling tabs.
if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('storage', event => {
  if (event.newValue === null && event.key && (event.key.startsWith('lb-auth-') || (event.key.startsWith('sb-') && event.key.includes('auth-token')))) {
    logoutInProgress = true; authRevision++;
    clearSharedFiles().catch(() => {});
  }
});

export async function getSession() {
  const revision = authRevision;
  const sb = await getClient();
  const { data, error } = await sb.auth.getSession();
  if (logoutInProgress || revision !== authRevision) return null;
  const session = error ? null : data.session || null;
  try { await syncShareOwner(session?.user?.id); } catch (_) {}
  if (logoutInProgress || revision !== authRevision) return null;
  return session;
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

/* ---- MFA / TOTP (2026-08 audit, owner-approved): real 2FA via Supabase Auth. ----
   Enroll: mfaEnrollTotp() -> { id, totp: { qr_code (SVG string), secret, uri } }
   then mfaVerify(factorId, code) to activate. Login gating: mfaRequired() returns
   the verified factorId when the session is aal1 but the account has aal2. */
export async function mfaListFactors() {
  const sb = await getClient();
  const { data, error } = await sb.auth.mfa.listFactors();
  if (error) throw error;
  return data || { totp: [] };
}
export async function mfaEnrollTotp() {
  const sb = await getClient();
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator app' });
  if (error) throw error;
  return data;
}
export async function mfaVerify(factorId, code) {
  const sb = await getClient();
  const ch = await sb.auth.mfa.challenge({ factorId });
  if (ch.error) throw ch.error;
  const v = await sb.auth.mfa.verify({ factorId, challengeId: ch.data.id, code: String(code || '').trim() });
  if (v.error) throw v.error;
  return true;
}
export async function mfaUnenroll(factorId) {
  const sb = await getClient();
  const { error } = await sb.auth.mfa.unenroll({ factorId });
  if (error) throw error;
  return true;
}
// Returns the verified TOTP factor id when a second factor is REQUIRED to reach aal2.
export async function mfaRequired() {
  try {
    const a = await getAAL();
    if (a.next === 'aal2' && a.current !== 'aal2') {
      const f = await mfaListFactors();
      const t = (f.totp || []).find((x) => x.status === 'verified');
      return t ? t.id : null;
    }
  } catch (_) {}
  return null;
}

// Sign out on EVERY device (revokes all refresh tokens server-side), then local purge.
export async function signOutEverywhere() {
  const result = await signOut('global');
  if (!result.remoteRevoked && typeof window !== 'undefined') window.alert('Signed out on this device. Other devices could not be signed out; reconnect and try again.');
  return result;
}

export async function signInWithPassword(email, password) {
  const sb = await getClient();
  // Mobile keyboards inject trailing spaces / zero-width & RTL marks (suggestion taps,
  // Urdu layouts). Strip whitespace + invisible format chars; normalize digits to ASCII.
  const clean = (v) => String(v || '')
    .replace(/[\u200b-\u200f\u202a-\u202e\ufeff\u00a0]/g, '')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .trim();
  return sb.auth.signInWithPassword({ email: clean(email).toLowerCase(), password: clean(password) });
}

// Carrier self-registration. The backend new-user trigger creates the carrier
// profile (role='carrier') from this auth user; company/name ride along as
// user metadata. If email confirmation is on, data.session is null and the
// caller should ask the user to confirm via email before signing in.
export async function signUp(email, password, meta = {}) {
  const sb = await getClient();
  // IMPORTANT: forward `role` — handle_new_user() branches on raw_user_meta_data->>'role'.
  // role='agent' provisions a referrer + agent_profile (NOT a carrier org); dropping it
  // silently registered every agent-portal signup as a carrier instead of an agent.
  const data = { company: meta.company || '', name: meta.name || '', partner_kind: meta.partner_kind || '', phone: meta.phone || '' };
  if (meta.role) data.role = meta.role;
  // bl_agent_0402 — the track the person chose on the agent portal (dispatcher | referral) and the
  // ?ref= code captured before signup, stored server-side so the referral survives a device change.
  if (meta.intent) data.intent = meta.intent;
  if (meta.ref) data.ref = meta.ref;
  return sb.auth.signUp({ email, password, options: { data } });
}

// Driver invite signup — role='driver' + invite_token tell handle_new_user to SKIP carrier-org
// provisioning; the caller then runs cc_accept_driver_invite to join the inviter's org.
export async function signUpDriver(email, password, token, meta = {}) {
  const sb = await getClient();
  // bl_drv_0344f: emailRedirectTo = the invite page itself, so a confirmation click lands back on the join flow.
  const options = { data: { role: 'driver', invite_token: token || '', name: meta.name || '' } };
  if (meta.redirectTo) options.emailRedirectTo = meta.redirectTo;
  return sb.auth.signUp({ email, password, options });
}

// bl_drv_0344f: re-send the signup confirmation (driver signed up via a shared link, mail got lost).
export async function resendSignupConfirmation(email, redirectTo) {
  const sb = await getClient();
  return sb.auth.resend({ type: 'signup', email, options: redirectTo ? { emailRedirectTo: redirectTo } : undefined });
}

export async function resetPassword(email) {
  const sb = await getClient();
  return sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
}

export async function updatePassword(newPassword) {
  const sb = await getClient();
  return sb.auth.updateUser({ password: newPassword });
}

export async function updateEmail(newEmail) {
  const sb = await getClient();
  return sb.auth.updateUser({ email: newEmail }); // confirmation links go to BOTH addresses
}

export async function signOut(scope = 'global') {
  logoutInProgress = true; authRevision++;
  try { await clearSharedFiles(); } catch (_) {
    if (typeof window !== 'undefined') window.alert('Temporary shared files could not be cleared. Clear LoadBoot site data on this device before another person signs in.');
  }
  // Never let a slow/failed server call keep the user "stuck signed in": race a 3s timeout,
  // then force-purge the local auth tokens so the session dies locally regardless.
  let remoteRevoked = false, timeout;
  try {
    const result = await Promise.race([(async () => { const sb = await getClient(); return sb.auth.signOut({ scope: typeof scope === 'string' ? scope : 'global' }); })(), new Promise(resolve => { timeout = setTimeout(() => resolve(null), 3000); })]);
    remoteRevoked = !!result && !result.error;
  } catch (_) {} finally { clearTimeout(timeout); }
  for (const storeName of ['localStorage', 'sessionStorage']) try {
    const authStore = window[storeName];
    const kill = [];
    for (let i = 0; i < authStore.length; i++) {
      const k = authStore.key(i);
      if (k && (k.indexOf('lb-auth-') === 0 || (k.indexOf('sb-') === 0 && k.indexOf('auth-token') !== -1))) kill.push(k);
    }
    kill.forEach(k => authStore.removeItem(k));
  } catch (_) {}
  // Purge any app caches on logout so no private view survives a session — both
  // directly and via the controlling service worker (LB_PURGE).
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'LB_PURGE' });
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k.indexOf('lb-app') === 0 || k === 'lb-share-inbox' || k === 'lb-share-owner').map(k => caches.delete(k)));
    }
  } catch (_) {}
  return { remoteRevoked };
}

export async function onAuthChange(cb) {
  const sb = await getClient();
  const { data } = sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN') { logoutInProgress = false; authRevision++; }
    if (event === 'SIGNED_OUT') authRevision++;
    syncShareOwner(logoutInProgress ? null : session?.user?.id).catch(() => {});
    cb(session);
  });
  return () => { try { data.subscription.unsubscribe(); } catch (_) {} };
}

// Gate a page on an authenticated session. Returns the session or redirects to `loginUrl`.
export async function requireSession(loginUrl) {
  const s = await getSession();
  if (!s) { window.location.replace(loginUrl); return null; }
  return s;
}

/* ---- bl_inv_0403: phone (SMS) second factor. Requires an SMS provider to be
   configured under Supabase Auth → Phone; until it is, enroll() returns an error
   the UI shows verbatim. Same challenge/verify shape as TOTP. ---- */
export async function mfaEnrollPhone(phone) {
  const sb = await getClient();
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'phone', phone: String(phone || '').trim(), friendlyName: 'Phone' });
  if (error) throw error;
  return data; // { id, type:'phone', phone }
}
export async function mfaChallenge(factorId) {
  const sb = await getClient();
  const { data, error } = await sb.auth.mfa.challenge({ factorId });
  if (error) throw error;
  return data; // { id } — for phone factors this sends the SMS
}
export async function mfaVerifyChallenge(factorId, challengeId, code) {
  const sb = await getClient();
  const { error } = await sb.auth.mfa.verify({ factorId, challengeId, code: String(code || '').trim() });
  if (error) throw error;
  return true;
}
// Any verified factor (totp or phone) that is needed to reach aal2 — returns { id, type } or null.
export async function mfaRequiredAny() {
  try {
    const a = await getAAL();
    if (a.next === 'aal2' && a.current !== 'aal2') {
      const f = await mfaListFactors();
      const all = (f.all || []).concat(f.totp || [], f.phone || []);
      const v = all.find((x) => x.status === 'verified');
      return v ? { id: v.id, type: v.factor_type || v.type || 'totp' } : null;
    }
  } catch (_) {}
  return null;
}
