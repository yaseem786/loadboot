// lb-cdn-bump 2026-08-15: force fresh Netlify blob upload (corrupt-deploy recovery) — no code changes.
// login.js — staff sign-in. Auth only; authorization (is_staff) is checked after.
// We never create accounts or set passwords here — staff arrive via invitation.
import { el, mount } from '../../shared/ui/dom.js';
import { signInWithPassword, resetPassword } from '../../shared/session.js';
import { humanizeError } from '../../shared/errors.js';
import { brandLogo, BRAND_TAGLINE } from '../../shared/ui/components.js';

export function renderLogin(root, onSignedIn) {
  const err = el('div', { class: 'err', role: 'alert' });
  const email = el('input', { type: 'email', autocomplete: 'username', required: true });
  const pass = el('input', { type: 'password', autocomplete: 'current-password', required: true });
  const btn = el('button', { class: 'lb-btn lb-btn-primary', type: 'submit' }, 'Sign in');

  const form = el('form', { onSubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      const { error } = await signInWithPassword(email.value.trim(), pass.value);
      if (error) { err.textContent = humanizeError(error); }
      else { await onSignedIn(); return; }
    } catch (ex) {
      err.textContent = humanizeError(ex);
    }
    btn.disabled = false; btn.textContent = 'Sign in';
  } }, [
    el('label', null, 'Work email'), email,
    el('label', null, 'Password'), pass,
    btn, err,
    el('button', { type: 'button', style: 'background:none;border:0;color:#0883F7;font-weight:700;font-size:.82rem;cursor:pointer;padding:8px 0 0;text-align:left', onClick: async (ev) => {
      const em = email.value.trim();
      if (!em || em.indexOf('@') < 1) { err.textContent = 'Type your work email above first, then tap "Forgot password?".'; return; }
      const b = ev.currentTarget; b.disabled = true;
      try { const r = await resetPassword(em); if (r && r.error) throw r.error; err.textContent = ''; b.textContent = '✓ Reset link sent to ' + em; }
      catch (ex) { err.textContent = humanizeError(ex); b.disabled = false; }
    } }, 'Forgot password?'),
    el('p', { style: 'margin-top:14px;font-size:.82rem;color:var(--lb-muted)' },
      'Staff accounts are created by invitation. Contact an owner if you need access.'),
  ]);

  mount(root, el('div', { class: 'cc-login' }, [
    el('div', { class: 'lb-card' }, [
      el('a', { href: '/app/?choose=1', style: 'display:inline-flex;align-items:center;gap:6px;color:#64748b;font-weight:700;font-size:.82rem;text-decoration:none;margin-bottom:12px' }, '\u2190 All portals'),
      brandLogo({ dark: false, sub: 'Command Center' }),
      el('p', { class: 'cc-login-tag' }, BRAND_TAGLINE),
      el('p', { style: 'color:var(--lb-muted);font-size:.9rem;margin:16px 0 6px' }, 'Sign in to your operator console'),
      form,
    ]),
  ]));
}

export default renderLogin;
