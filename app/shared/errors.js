// lb-cdn-bump 2026-08-15: force fresh Netlify blob upload (corrupt-deploy recovery) — no code changes.
// errors.js — translate raw RPC/transport errors into safe, human messages.
// Never leak SQL text, stack traces, or internal identifiers to the UI.
export function humanizeError(e) {
  if (!e) return 'Something went wrong.';
  const msg = (e.message || '').toLowerCase();
  if (e.code === '42501' || msg.indexOf('not authorized') >= 0 || msg.indexOf('permission denied') >= 0)
    return 'You do not have permission to do that.';
  if (msg.indexOf('last active owner') >= 0)
    return 'You cannot remove or suspend the last active owner.';
  if (msg.indexOf('your own') >= 0)
    return 'You cannot change your own role or status here.';
  if (msg.indexOf('unknown') >= 0 || e.code === '22023')
    return 'That value is not allowed.';
  if (msg.indexOf('failed to fetch') >= 0 || msg.indexOf('networkerror') >= 0)
    return 'Connection required — this action needs to reach the server.';
  // 29 Aug 2026: an unrecognised failure used to end here as a bare sentence naming
  // nothing, and it cost a whole afternoon. Carrier directory -> Approve was dying on
  // SQLSTATE 22P02 (bl_fix_0304) and the screen only ever said "Something went wrong",
  // so there was no thread to pull. A SQLSTATE is five characters of standard Postgres
  // vocabulary — it is not SQL text, a stack trace or an internal identifier, so it does
  // not breach what this function exists to prevent, and it turns an unreproducible
  // report into a one-line diagnosis.
  if (e.code) return 'Something went wrong. Please try again. (code ' + e.code + ')';
  return 'Something went wrong. Please try again.';
}

/* ---------------------------------------------------------------------------
   rpcMessage(e) — 29 Aug 2026.
   The database raises a small set of NAMED codes (LB001…LB020) and every one of
   them already carries a sentence written for the carrier, not for a developer.
   humanizeError() above deliberately flattens unknown errors so no SQL leaks out;
   the side effect was that these good messages were flattened too — a carrier
   pressed Save and got 'That value is not allowed.', or nothing they understood.
   rpcMessage keeps the server's own wording for the codes we own, and only falls
   back to humanizeError for anything unrecognised. Additive: humanizeError is
   untouched, so no existing call site changes behaviour.
--------------------------------------------------------------------------- */
export const LB_CODE_TITLES = {
  LB001: 'Not on your insurance',
  LB002: 'VIN required',
  LB003: 'Check the payload',
  LB004: 'Certificate of insurance needed first',
  LB010: 'W-9 needs a change',
  LB011: 'W-9 needs a change',
  LB012: 'W-9 needs a change',
  LB013: 'W-9 needs a change',
  LB014: 'Check your profile',
  LB015: 'Check your profile',
  LB016: 'Compliance blocked this',
  LB020: 'Account cannot be reopened',
  '22023': 'Check what you typed',
  '42501': 'Not allowed on this account',
};

export function rpcMessage(e) {
  if (!e) return 'Something went wrong.';
  const code = e.code ? String(e.code) : '';
  const msg = (e.message || '').trim();
  // Codes we own: the server sentence IS the carrier-facing sentence.
  if (msg && (/^LB\d{3}$/.test(code) || code === '22023')) return msg;
  return humanizeError(e);
}

export function rpcTitle(e, fallback) {
  const code = e && e.code ? String(e.code) : '';
  return LB_CODE_TITLES[code] || fallback || 'Could not save';
}

export function toast(message, kind = 'info') {
  let host = document.getElementById('lb-toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'lb-toasts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const t = document.createElement('div');
  t.className = 'lb-toast lb-toast-' + kind;
  t.textContent = message;
  host.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 4200);
}

export default { humanizeError, rpcMessage, rpcTitle, LB_CODE_TITLES, toast };
