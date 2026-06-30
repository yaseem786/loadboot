// app.js — Carrier Pocket App bootstrap (mobile PWA shell).
// Flow: validate env -> require session (else login) -> render shell + bottom-nav
// router with safe placeholders. No private data is cached; offline shows a banner
// and disables actions (no mutation queue in 2A).
import { el, mount } from '../shared/ui/dom.js';
import ENV from '../shared/env.js';
import { getSession, getUser, signInWithPassword, signOut, onAuthChange } from '../shared/session.js';
import { isFlagEnabled } from '../shared/api.js';
import { mountOfflineBanner } from '../shared/connectivity.js';
import { createRouter } from '../shared/router.js';
import { humanizeError } from '../shared/errors.js';
import { renderPlaceholder } from '../command-center/views/placeholder.js';
import { registerAppSW } from '../shared/sw-register.js';

registerAppSW();
const root = document.getElementById('lb-app');

function fatal(message) {
  mount(root, el('div', { class: 'ca-content' }, [
    el('div', { class: 'ca-card' }, [el('h3', null, 'Unavailable'), el('p', { style: 'color:var(--lb-muted)' }, message)]),
  ]));
  root.setAttribute('aria-busy', 'false');
}

function renderLogin() {
  const err = el('div', { class: 'err', role: 'alert' });
  const email = el('input', { type: 'email', autocomplete: 'username', required: true });
  const pass = el('input', { type: 'password', autocomplete: 'current-password', required: true });
  const btn = el('button', { class: 'lb-btn lb-btn-primary', type: 'submit' }, 'Sign in');
  const form = el('form', { onSubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      const { error } = await signInWithPassword(email.value.trim(), pass.value);
      if (error) err.textContent = humanizeError(error); else { await boot(); return; }
    } catch (ex) { err.textContent = humanizeError(ex); }
    btn.disabled = false; btn.textContent = 'Sign in';
  } }, [
    el('label', null, 'Email'), email, el('label', null, 'Password'), pass, btn, err,
  ]);
  mount(root, el('div', { class: 'ca-login' }, [
    el('div', { class: 'brand', style: 'display:flex;gap:8px;align-items:center;justify-content:center;font-family:var(--lb-head);font-weight:800;font-size:1.3rem;margin-bottom:8px' },
      [el('span', { class: 'dot', style: 'width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#2563EB,#1e3a8a);color:#fff;display:inline-flex;align-items:center;justify-content:center' }, 'L'), 'LoadBoot']),
    el('p', { style: 'text-align:center;color:var(--lb-muted);font-size:.9rem;margin-bottom:10px' }, 'Carrier sign in'),
    form,
  ]));
  root.setAttribute('aria-busy', 'false');
}

const TABS = [
  { path: '/', label: 'Home', icon: '🏠' },
  { path: '/loads', label: 'Loads', icon: '📦' },
  { path: '/docs', label: 'Documents', icon: '📄' },
  { path: '/pay', label: 'Payments', icon: '💵' },
  { path: '/account', label: 'Account', icon: '👤' },
];

function renderShell(user) {
  const content = el('div', { class: 'ca-content', id: 'ca-content' });
  const tabs = TABS.map(t => el('a', { href: '#' + t.path, dataset: { path: t.path } },
    [el('span', { class: 'ic', 'aria-hidden': 'true' }, t.icon), t.label]));
  mount(root, el('div', { class: 'ca-shell' }, [
    el('header', { class: 'ca-top' }, [
      el('div', { class: 'brand' }, [el('span', { class: 'dot' }, 'L'), 'LoadBoot']),
      el('button', { class: 'sign', onClick: async () => { await signOut(); location.reload(); } }, 'Sign out'),
    ]),
    content,
    el('nav', { class: 'ca-tab' }, tabs),
  ]));
  function setActive(path) { tabs.forEach(a => a.classList.toggle('active', a.dataset.path === path)); }
  return { content, setActive };
}

function home(content, user) {
  mount(content, el('div', null, [
    el('div', { class: 'ca-greeting' }, 'Welcome back'),
    el('div', { class: 'ca-sub' }, (user && user.email) || ''),
    el('div', { class: 'ca-status-banner' },
      'This is the Phase 2A carrier app foundation. Your loads, documents, and payments will appear here as each module ships. For full account management, the web dashboard remains available.'),
    el('div', { class: 'ca-card' }, [el('h3', null, 'Quick links'),
      el('p', { style: 'color:var(--lb-muted);font-size:.88rem' }, 'Use the tabs below to navigate. The existing web dashboard remains fully functional for everything not yet here.')]),
  ]));
}

async function boot() {
  root.setAttribute('aria-busy', 'true');
  const session = await getSession();
  if (!session) { renderLogin(); return; }

  let enabled = true;
  try { enabled = await isFlagEnabled('carrier_app_v2_enabled'); } catch (_) { enabled = false; }
  if (!enabled) {
    fatal('The new carrier app is not enabled yet. Please continue using the web dashboard for now.');
    return;
  }

  const user = await getUser();
  const { content, setActive } = renderShell(user);
  mountOfflineBanner();
  root.setAttribute('aria-busy', 'false');

  const ph = (host, t, d) => renderPlaceholder(host, t, d);
  const router = createRouter({
    '/': () => { setActive('/'); home(content, user); },
    '/loads': () => { setActive('/loads'); ph(content, 'Your loads', 'Active and available loads will appear here in a later phase.'); },
    '/docs': () => { setActive('/docs'); ph(content, 'Documents', 'Upload and track your compliance documents here in a later phase.'); },
    '/pay': () => { setActive('/pay'); ph(content, 'Payments', 'Settlement history and payment status will appear here in a later phase.'); },
    '/account': () => { setActive('/account'); ph(content, 'Account', 'Profile and preferences will appear here in a later phase.'); },
  }, { notFound: () => { setActive('/'); home(content, user); } });
  router.start();

  onAuthChange((s) => { if (!s) location.reload(); });
}

boot().catch((e) => fatal(e && e.lbFatal ? e.message : 'Unexpected error starting the app.'));
