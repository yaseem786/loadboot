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
  return 'Something went wrong. Please try again.';
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

export default { humanizeError, toast };
