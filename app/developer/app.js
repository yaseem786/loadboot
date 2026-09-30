// app.js — LoadBoot Developer Portal (bl_dev_0502, 29 Sep 2026).
// Developers sign up here as their OWN persona (role 'developer' → app_private.developer_accounts), never as a
// carrier. Sandbox keys are self-serve; production read keys unlock after staff approve the account in
// CC → API 360; write (posting loads) stays with verified broker accounts. Every rule is enforced in Postgres
// (cc_create_api_key, dev_request_production, dev-api's dev_api_auth) — this screen only explains it.
// Keys are shown once at creation (only a hash is stored) and can be revoked any time.
import ENV from '../shared/env.js';
import { getSession, getUser, signInWithPassword, signUp, signOut, onAuthChange, resetPassword, updatePassword, resendSignupConfirmation } from '../shared/session.js';
import { getClient } from '../shared/supabaseClient.js';
import { createTour, mountHelp } from '../shared/ui/tour.js';   // guided tour + floating "?" help (25 Sep 2026)
import { DEVELOPER_TOUR } from './tour-content.js';
import { createApiKey, listApiKeys, revokeApiKey, myWebhooks, myWebhookCreate, myWebhookDelete } from '../shared/api.js';
import { initTelemetry } from '../shared/telemetry.js';
initTelemetry();  // real-user error + Core Web Vitals capture

// Remember this portal only once a session exists — an accidental tap into the
// developer portal must not hijack where the installed app opens next launch.
import('../shared/session.js').then((s) => s.getSession()).then((sess) => {
  if (sess) { try { localStorage.setItem('lb_last_portal', '/app/developer/'); } catch (_) {} }
}).catch(() => {});

const root = document.getElementById('lb-app');
const API_BASE = ENV.supabaseUrl + '/functions/v1/dev-api';
const PORTAL_URL = location.origin + '/app/developer/';
const SUPPORT_EMAIL = 'hello@loadboot.com';
// The API use terms live in the Terms page (#api). The version is the one the signup screen shows; Postgres records it
// only if it matches app_private.dev_api_terms() (bl_dev_0505), so a stale screen leads to a re-accept, never a false yes.
const API_TERMS_VERSION = 'api-v1.1-2026-09-30';
const API_TERMS_URL = '/terms.html#api';

async function rpc(name, args) {
  const sb = await getClient();
  const { data, error } = await sb.rpc(name, args || {});
  if (error) throw new Error(error.message || 'Request failed');
  return data;
}

const h = (tag, attrs, kids) => {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') e[k.toLowerCase()] = attrs[k];
    else if (attrs[k] != null && attrs[k] !== false) e.setAttribute(k, attrs[k]);
  }
  (Array.isArray(kids) ? kids : kids != null ? [kids] : []).forEach(c => c != null && c !== false && e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c));
  return e;
};
const mount = (el, kids) => { el.innerHTML = ''; (Array.isArray(kids) ? kids : [kids]).forEach(c => c && el.appendChild(c)); };
const fmtDT = (d) => { if (!d) return 'never'; try { return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return '—'; } };
const fmtD = (d) => { if (!d) return '—'; try { return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch (e) { return '—'; } };
const errMsg = (e, fb) => (e && e.message) || fb || 'Something went wrong.';
const copyBtn = (text, label) => h('button', { class: 'cp-btn cp-btn-sm ghost', type: 'button', onClick: (ev) => {
  const b = ev.currentTarget; try { navigator.clipboard && navigator.clipboard.writeText(text); b.textContent = 'Copied ✓'; } catch (_) {}
  setTimeout(() => { b.textContent = label || 'Copy'; }, 1600);
} }, label || 'Copy');
const card = (title, kids, attrs) => h('div', Object.assign({ class: 'cp-card dev-card' }, attrs || {}), [
  title ? h('div', { class: 'cp-cardhead' }, [h('h3', null, title)]) : null,
].concat(kids));
const pill = (text, tone) => h('span', { class: 'cp-pill' + (tone ? ' ' + tone : '') }, text);
const STATUS_TONE = { approved: 'green', pending: 'amber', denied: 'red', suspended: 'red' };
const brandRow = (sub) => h('div', { class: 'cp-auth-brand dev-brand' }, [
  h('img', { src: '/logo-full.png', alt: 'LoadBoot', class: 'dev-brand-logo' }), h('span', { class: 'dev-brand-sub' }, sub || 'Developers'),
]);

// ── auth ─────────────────────────────────────────────────────────────────────────────────────────────────
const VOLUMES = ['Under 1,000 calls / day', '1,000 – 10,000 calls / day', '10,000 – 100,000 calls / day', 'Over 100,000 calls / day', 'Not sure yet'];

function authScreen(initial) {
  let mode = initial || 'signin';
  const f = {
    name: h('input', { class: 'cp-in', placeholder: 'Your full name', autocomplete: 'name' }),
    company: h('input', { class: 'cp-in', placeholder: 'Company or product name', autocomplete: 'organization' }),
    website: h('input', { class: 'cp-in', type: 'url', placeholder: 'https://yourcompany.com', autocomplete: 'url' }),
    use_case: h('textarea', { class: 'cp-in', rows: '3', placeholder: 'e.g. A TMS that shows LoadBoot loads to our carriers' }),
    volume: h('select', { class: 'cp-in' }, [h('option', { value: '' }, 'Expected volume…')].concat(VOLUMES.map(v => h('option', { value: v }, v)))),
    email: h('input', { class: 'cp-in', type: 'email', placeholder: 'you@company.com', autocomplete: 'username' }),
    pass: h('input', { class: 'cp-in', type: 'password', placeholder: 'Password (min 8 characters)', autocomplete: 'current-password' }),
    terms: h('input', { type: 'checkbox', id: 'dev-terms' }),
  };
  const err = h('div', { class: 'cp-err' });
  const title = h('h1');
  const sub = h('p', { class: 'cp-auth-sub' });
  const btn = h('button', { class: 'cp-btn cp-btn-lg', type: 'button' });
  const toggle = h('p', { class: 'cp-auth-toggle' });
  const body = h('div');
  const lbl = (t) => h('label', { class: 'cp-lbl' }, t);
  const say = (t, ok) => { err.className = 'cp-err' + (ok ? ' ok' : ''); err.textContent = t || ''; };
  const link = (t, fn) => h('a', { onClick: fn, href: 'javascript:void 0' }, t);

  const setMode = (m) => {
    mode = m; say('');
    f.pass.setAttribute('autocomplete', m === 'signup' ? 'new-password' : 'current-password');
    if (m === 'signup') {
      title.textContent = 'Create your developer account';
      sub.textContent = 'Free. Start in the sandbox today; production access after a quick review.';
      mount(body, [
        h('div', { class: 'dev-grid2' }, [h('div', null, [lbl('Your name'), f.name]), h('div', null, [lbl('Company'), f.company])]),
        lbl('Website (optional)'), f.website,
        lbl('What are you building?'), f.use_case,
        lbl('Expected volume'), f.volume,
        lbl('Work email'), f.email, lbl('Password'), f.pass,
        h('label', { class: 'dev-check', for: 'dev-terms' }, [f.terms, h('span', null, [
          'I agree to the ', h('a', { href: '/terms.html', target: '_blank', rel: 'noopener' }, 'LoadBoot Terms'),
          ', including the ', h('a', { href: API_TERMS_URL, target: '_blank', rel: 'noopener' }, 'API use section'),
          ': keys stay secret, every load shown from the API carries "via LoadBoot" and links back, and API data is not resold or copied.',
        ])]),
      ]);
      btn.textContent = 'Create account';
      mount(toggle, [document.createTextNode('Already have an account? '), link('Sign in', () => setMode('signin'))]);
    } else if (m === 'forgot') {
      title.textContent = 'Reset your password';
      sub.textContent = 'We will email you a link to choose a new password.';
      mount(body, [lbl('Email'), f.email]);
      btn.textContent = 'Send reset link';
      mount(toggle, [link('← Back to sign in', () => setMode('signin'))]);
    } else {
      title.textContent = 'Developer sign in';
      sub.textContent = 'Keys, usage, docs and webhooks for the LoadBoot API.';
      mount(body, [lbl('Email'), f.email, lbl('Password'), f.pass, h('p', { class: 'dev-forgot' }, link('Forgot password?', () => setMode('forgot')))]);
      btn.textContent = 'Sign in';
      mount(toggle, [document.createTextNode('New here? '), link('Create a developer account', () => setMode('signup'))]);
    }
    btn.disabled = false;
  };

  const confirmSent = (em) => {
    mount(body, [h('div', { class: 'dev-note ok' }, [
      h('b', null, 'Check your inbox'), h('br'),
      'We sent a confirmation link to ', h('b', null, em), '. Open it, then sign in here.',
    ]), h('p', { class: 'dev-forgot' }, link('Resend the link', async (ev) => {
      const a = ev.currentTarget; a.textContent = 'Sending…';
      try { const { error } = await resendSignupConfirmation(em, PORTAL_URL); if (error) throw error; a.textContent = 'Sent again ✓'; }
      catch (e) { a.textContent = 'Resend the link'; say(errMsg(e, 'Could not resend — try again in a minute.')); }
    }))]);
    title.textContent = 'Confirm your email'; sub.textContent = '';
    btn.disabled = false; btn.textContent = 'Go to sign in'; btn.onclick = () => { btn.onclick = submit; setMode('signin'); };
    mount(toggle, []);
  };

  async function submit() {
    say('');
    const em = f.email.value.trim(), pw = f.pass.value;
    if (!em) { say('Enter your email.'); return; }
    if (mode === 'forgot') {
      btn.disabled = true; btn.textContent = 'Sending…';
      try { const { error } = await resetPassword(em); if (error) throw error; say('If that email has an account, a reset link is on its way.', true); }
      catch (e) { say(errMsg(e)); }
      btn.disabled = false; btn.textContent = 'Send reset link'; return;
    }
    if (!pw) { say('Enter your password.'); return; }
    if (mode === 'signup') {
      if (!f.name.value.trim() || !f.company.value.trim()) { say('Add your name and company.'); return; }
      if (!f.use_case.value.trim()) { say('Tell us in a line what you are building.'); return; }
      if (pw.length < 8) { say('Password must be at least 8 characters.'); return; }
      if (!f.terms.checked) { say('Please accept the Terms and the API use section.'); return; }
    }
    btn.disabled = true; btn.textContent = mode === 'signup' ? 'Creating…' : 'Signing in…';
    try {
      if (mode === 'signup') {
        const { data, error } = await signUp(em, pw, {
          role: 'developer', name: f.name.value.trim(), company: f.company.value.trim(), website: f.website.value.trim(),
          use_case: f.use_case.value.trim(), expected_volume: f.volume.value, terms: 'yes', terms_version: API_TERMS_VERSION, redirectTo: PORTAL_URL,
        });
        if (error) throw error;
        // Supabase returns success with an empty identities array when the address is already registered —
        // no error, no email. Without this the person waits for mail that never comes.
        if (data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setMode('signin'); say('That email already has a LoadBoot account. Sign in with its password.'); return;
        }
        if (!data || !data.session) { confirmSent(em); return; }
        boot(); return;
      }
      const { error } = await signInWithPassword(em, pw); if (error) throw error; boot(); return;
    } catch (e) { say(errMsg(e)); btn.disabled = false; btn.textContent = mode === 'signup' ? 'Create account' : 'Sign in'; }
  }
  btn.onclick = submit;
  [f.email, f.pass].forEach((i) => i.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') submit(); }));

  mount(root, h('div', { class: 'cp-auth' }, [h('div', { class: 'cp-auth-card dev-auth-card' }, [
    brandRow(), title, sub, body, err, btn, toggle,
  ])]));
  setMode(mode); root.setAttribute('aria-busy', 'false');
}

function recoveryScreen() {
  const p1 = h('input', { class: 'cp-in', type: 'password', placeholder: 'New password (min 8 characters)', autocomplete: 'new-password' });
  const p2 = h('input', { class: 'cp-in', type: 'password', placeholder: 'Repeat new password', autocomplete: 'new-password' });
  const err = h('div', { class: 'cp-err' });
  const btn = h('button', { class: 'cp-btn cp-btn-lg', type: 'button', onClick: async () => {
    if ((p1.value || '').length < 8) { err.textContent = 'Password must be at least 8 characters.'; return; }
    if (p1.value !== p2.value) { err.textContent = 'Passwords do not match.'; return; }
    btn.disabled = true; btn.textContent = 'Saving…';
    try { const { error } = await updatePassword(p1.value); if (error) throw error;
      history.replaceState(null, '', location.pathname); boot(); }
    catch (e) { err.textContent = errMsg(e, 'Could not update password.'); btn.disabled = false; btn.textContent = 'Set new password'; }
  } }, 'Set new password');
  mount(root, h('div', { class: 'cp-auth' }, h('div', { class: 'cp-auth-card dev-auth-card' }, [
    brandRow(), h('h1', null, 'Set a new password'),
    h('p', { class: 'cp-auth-sub' }, 'You followed a reset link — choose a new password.'),
    p1, p2, err, btn,
  ])));
  root.setAttribute('aria-busy', 'false');
}

// ── signed in ────────────────────────────────────────────────────────────────────────────────────────────
const TABS = [
  ['overview', 'Overview'], ['keys', 'API keys'], ['usage', 'Usage'], ['docs', 'Docs'], ['webhooks', 'Webhooks'], ['account', 'Account'],
];
const S = { user: null, st: null, tab: 'overview' };

async function refreshState() { S.st = await rpc('dev_portal_state'); return S.st; }
const isDev = () => !!(S.st && S.st.is_developer);
const acct = () => (S.st && S.st.account) || {};
const approved = () => acct().status === 'approved';
const partner = () => acct().partner_slug || 'your-slug';

function go(tab) {
  const t = String(tab || '').replace('#', '');
  S.tab = TABS.some(([k]) => k === t) ? t : 'overview';
  if (location.hash !== '#' + S.tab) history.replaceState(null, '', '#' + S.tab);
  render();
}

function shell(content) {
  const nav = h('nav', { class: 'dev-tabs', 'aria-label': 'Developer portal' }, TABS.map(([k, label]) =>
    h('button', { type: 'button', class: 'dev-tab' + (S.tab === k ? ' active' : ''), 'aria-current': S.tab === k ? 'page' : false,
      'data-tour': 'tab-' + k, onClick: () => go(k) }, label)));
  const st = acct().status;
  return h('div', { class: 'cp-shell cp-shell-1col' }, h('main', { class: 'cp-main dev-main' }, [
    h('header', { class: 'cp-top dev-top' }, [
      h('div', { class: 'cp-brandrow dev-brandrow' }, [h('img', { src: '/logo-full.png', alt: 'LoadBoot', class: 'dev-top-logo' }), h('div', null, [
        h('span', { class: 'dev-brand-sub' }, 'Developers'),
        h('div', { class: 'dev-who' }, [(acct().company || (S.user && S.user.email) || ''), st ? pill(st, STATUS_TONE[st]) : null]),
      ])]),
      h('button', { class: 'cp-btn cp-btn-sm ghost', type: 'button', onClick: async () => { await signOut(); boot(); } }, 'Sign out'),
    ]),
    nav,
    h('div', { class: 'cp-content' }, content),
  ]));
}

function render() {
  const views = { overview: overviewView, keys: keysView, usage: usageView, docs: docsView, webhooks: webhooksView, account: accountView };
  let content;
  if (!isDev() && S.st && S.st.can_create_profile && S.tab !== 'account' && S.tab !== 'docs') content = [profileSetupCard()];
  else content = (views[S.tab] || overviewView)();
  if (termsOwed()) content = [termsCard()].concat(content);
  mount(root, shell(content));
  root.setAttribute('aria-busy', 'false');
  try { if (window.__lbTourHelp) window.__lbTourHelp.onRoute(S.tab); } catch (_) {}
}

// API use terms (bl_dev_0505). Shown on top of every tab until the developer accepts the version Postgres serves.
// Existing keys keep working meanwhile; production access cannot be requested until it is accepted.
const termsOwed = () => !!(isDev() && S.st && S.st.terms && S.st.terms.needs_accept);
function termsCard() {
  const t = S.st.terms || {};
  const tick = h('input', { type: 'checkbox', id: 'dev-api-terms' });
  const err = h('div', { class: 'cp-err' });
  const btn = h('button', { class: 'cp-btn', type: 'button', onClick: async () => {
    err.textContent = '';
    if (!tick.checked) { err.textContent = 'Tick the box to accept the API use terms.'; return; }
    btn.disabled = true; btn.textContent = 'Saving…';
    try { S.st = await rpc('dev_accept_api_terms', { p_version: t.version }); render(); }
    catch (e) { err.textContent = errMsg(e); btn.disabled = false; btn.textContent = 'Accept'; }
  } }, 'Accept');
  return card(t.accepted_version ? 'The API use terms were updated' : 'Please accept the API use terms', [
    h('p', { class: 'dev-p' }, 'The LoadBoot Terms now have an API use section. The short version:'),
    h('ul', { class: 'dev-terms-list' }, (t.points || []).map(p => h('li', null, p))),
    h('p', { class: 'dev-p' }, ['Read the full text: ', h('a', { href: t.url || API_TERMS_URL, target: '_blank', rel: 'noopener' }, 'Terms → API use'), ' (version ' + (t.version || '') + ').']),
    h('label', { class: 'dev-check', for: 'dev-api-terms' }, [tick, h('span', null, 'I have read and accept the API use section of the LoadBoot Terms.')]),
    err, btn,
  ], { 'data-tour': 'dev-terms' });
}

// A bare login that reached the portal without a developer profile (older signup) completes it once.
function profileSetupCard() {
  const f = {
    name: h('input', { class: 'cp-in', placeholder: 'Your full name' }), company: h('input', { class: 'cp-in', placeholder: 'Company or product name' }),
    website: h('input', { class: 'cp-in', type: 'url', placeholder: 'https://yourcompany.com' }),
    use_case: h('textarea', { class: 'cp-in', rows: '3', placeholder: 'What are you building?' }),
    volume: h('select', { class: 'cp-in' }, [h('option', { value: '' }, 'Expected volume…')].concat(VOLUMES.map(v => h('option', { value: v }, v)))),
  };
  const err = h('div', { class: 'cp-err' });
  const btn = h('button', { class: 'cp-btn', type: 'button', onClick: async () => {
    if (!f.name.value.trim() || !f.company.value.trim() || !f.use_case.value.trim()) { err.textContent = 'Name, company and what you are building are required.'; return; }
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      S.st = await rpc('dev_profile_save', { p: { name: f.name.value.trim(), company: f.company.value.trim(), website: f.website.value.trim(), use_case: f.use_case.value.trim(), expected_volume: f.volume.value, terms_version: API_TERMS_VERSION } });
      go('overview');
    } catch (e) { err.textContent = errMsg(e); btn.disabled = false; btn.textContent = 'Save and continue'; }
  } }, 'Save and continue');
  return card('Complete your developer profile', [
    h('p', { class: 'dev-p' }, 'Tell us who you are so we can open your sandbox and review production access.'),
    h('div', { class: 'dev-grid2' }, [f.name, f.company]), f.website, f.use_case, f.volume,
    h('p', { class: 'dev-p' }, ['By continuing you accept the ', h('a', { href: '/terms.html', target: '_blank', rel: 'noopener' }, 'LoadBoot Terms'), ', including the ', h('a', { href: API_TERMS_URL, target: '_blank', rel: 'noopener' }, 'API use section'), ' (keys stay secret; "via LoadBoot" + link-back on every load; no reselling or copying API data).']),
    err, btn,
  ]);
}

// Overview: account status + getting-started checklist + production request
function overviewView() {
  const st = S.st || {}; const a = acct(); const keys = st.keys || {};
  const reqs = st.requests || []; const openReq = reqs.find(r => r.status === 'pending'); const lastReq = reqs[0];
  const out = [];
  if (!isDev()) {
    out.push(card('Signed in with a LoadBoot account', [h('p', { class: 'dev-p' },
      'This login belongs to a LoadBoot carrier, partner or staff account. Keys you create here work under that account. For a separate developer profile, sign up with a different email.')]));
  } else {
    const msg = {
      pending: openReq ? 'Your production request is with our team (sent ' + fmtD(openReq.created_at) + '). The sandbox is open meanwhile.'
        : 'Your sandbox is open. When your integration works against it, request production access below.',
      approved: 'Production access is approved. Create a production read key on the API keys tab.',
      denied: 'Production access was not approved' + (a.status_reason ? ': ' + a.status_reason : '.') + ' Your sandbox keeps working; you can send a new request.',
      suspended: 'API access is suspended' + (a.status_reason ? ': ' + a.status_reason : '.') + ' All keys are stopped. Write to ' + SUPPORT_EMAIL + '.',
    }[a.status] || '';
    out.push(card('Account status', [
      h('div', { class: 'dev-status' }, [pill(a.status || '—', STATUS_TONE[a.status]), h('span', null, msg)]),
    ], { 'data-tour': 'dev-status' }));
  }
  const steps = [
    ['Confirm your email', true],
    ['Create a sandbox key', (keys.sandbox || 0) > 0 || (keys.production || 0) > 0, 'keys'],
    ['Make your first call', (st.calls_total || 0) > 0 || (keys.used || 0) > 0, 'docs'],
  ];
  if (isDev()) {
    steps.push(['Request production access', approved() || reqs.length > 0]);
    steps.push(['Create a production read key', (keys.production || 0) > 0, 'keys']);
  }
  out.push(card('Getting started', [h('ol', { class: 'dev-check-list' }, steps.map(([t, done, tab]) => h('li', { class: done ? 'done' : '' }, [
    h('span', { class: 'dev-tick', 'aria-hidden': 'true' }, done ? '✓' : ''), h('span', null, t),
    !done && tab ? h('a', { class: 'dev-go', href: '#' + tab, onClick: (ev) => { ev.preventDefault(); go(tab); } }, 'Open →') : null,
  ])))], { 'data-tour': 'dev-checklist' }));
  if (isDev() && !approved() && a.status !== 'suspended') out.push(productionRequestCard(openReq, lastReq));
  return out;
}

function productionRequestCard(openReq, lastReq) {
  const a = acct();
  if (openReq) return card('Production access', [h('p', { class: 'dev-p' }, 'Request sent ' + fmtD(openReq.created_at) + '. We review every request by hand and email you the answer.')]);
  if (termsOwed()) return card('Request production access', [h('div', { class: 'dev-note' }, 'Accept the API use terms above first — then you can request production access.')]);
  const f = {
    use_case: h('textarea', { class: 'cp-in', rows: '3' }), volume: h('select', { class: 'cp-in' }, [h('option', { value: '' }, 'Expected volume…')].concat(VOLUMES.map(v => h('option', { value: v }, v)))),
    url: h('input', { class: 'cp-in', type: 'url', placeholder: 'Where the loads will show (URL or app name)' }),
    msg: h('textarea', { class: 'cp-in', rows: '2', placeholder: 'Anything else we should know (optional)' }),
  };
  f.use_case.value = a.use_case || ''; if (a.expected_volume) f.volume.value = a.expected_volume;
  const err = h('div', { class: 'cp-err' });
  const btn = h('button', { class: 'cp-btn', type: 'button', onClick: async () => {
    err.className = 'cp-err'; err.textContent = '';
    if (!f.use_case.value.trim()) { err.textContent = 'Tell us what you are building.'; return; }
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      S.st = await rpc('dev_request_production', { p: { use_case: f.use_case.value.trim(), expected_volume: f.volume.value, integration_url: f.url.value.trim(), message: f.msg.value.trim() } });
      render();
    } catch (e) { err.textContent = errMsg(e); btn.disabled = false; btn.textContent = 'Request production access'; }
  } }, 'Request production access');
  return card('Request production access', [
    lastReq && lastReq.status === 'denied' ? h('div', { class: 'dev-note' }, 'Last request (' + fmtD(lastReq.created_at) + ') was not approved' + (lastReq.decision_note ? ': ' + lastReq.decision_note : '.')) : null,
    h('p', { class: 'dev-p' }, 'Production keys return the live LoadBoot board. We check who you are and where the loads will be shown — every load must carry "via LoadBoot" and link back.'),
    h('label', { class: 'cp-lbl' }, 'What you are building'), f.use_case,
    h('div', { class: 'dev-grid2' }, [h('div', null, [h('label', { class: 'cp-lbl' }, 'Expected volume'), f.volume]), h('div', null, [h('label', { class: 'cp-lbl' }, 'Where loads will show'), f.url])]),
    h('label', { class: 'cp-lbl' }, 'Message'), f.msg, err, btn,
  ], { 'data-tour': 'dev-request' });
}

// Keys
function keysView() {
  const listHost = h('div', { class: 'cp-tablewrap' }, h('div', { class: 'lb-state lb-loading' }, 'Loading…'));
  const nameIn = h('input', { class: 'cp-in', placeholder: 'Key name, e.g. "Staging server"' });
  const canProd = !isDev() || approved();
  const suspended = acct().status === 'suspended';
  const scopeSel = h('select', { class: 'cp-in dev-scope' }, [
    h('option', { value: 'sandbox' }, 'Sandbox (test loads)'),
    h('option', { value: 'read', disabled: canProd ? false : 'disabled' }, 'Production — read' + (canProd ? '' : ' (after approval)')),
  ]);
  if (!isDev()) scopeSel.value = 'read';
  const revealHost = h('div');
  const err = h('div', { class: 'cp-err' });
  const createBtn = h('button', { class: 'cp-btn', type: 'button', disabled: suspended ? 'disabled' : false, onClick: async () => {
    err.textContent = '';
    if (!nameIn.value.trim()) { err.textContent = 'Give the key a name.'; return; }
    createBtn.disabled = true; createBtn.textContent = 'Creating…';
    try {
      const r = await createApiKey(nameIn.value.trim(), [scopeSel.value]);
      nameIn.value = '';
      mount(revealHost, h('div', { class: 'dev-reveal' }, [
        h('div', { class: 'dev-reveal-h' }, '⚠ Copy your key now — it won’t be shown again.'),
        h('code', { class: 'dev-key' }, r.key),
        copyBtn(r.key, 'Copy key'),
      ]));
      refreshState().catch(() => {});
      load();
    } catch (e) { err.textContent = errMsg(e, 'Could not create the key.'); }
    createBtn.disabled = false; createBtn.textContent = 'Create key';
  } }, 'Create key');

  async function load() {
    try {
      const rows = await listApiKeys();
      if (!rows || !rows.length) { mount(listHost, h('div', { class: 'lb-state' }, 'No API keys yet. Create a sandbox key above.')); return; }
      mount(listHost, h('table', { class: 'cp-table dev-table' }, [
        h('thead', null, h('tr', null, ['Name', 'Prefix', 'Type', 'Created', 'Last used', 'Status', ''].map(t => h('th', null, t)))),
        h('tbody', null, rows.map(k => h('tr', null, [
          h('td', { 'data-l': 'Name' }, h('b', null, k.name)), h('td', { 'data-l': 'Prefix' }, h('code', null, k.prefix)),
          h('td', { 'data-l': 'Type' }, (k.scopes || []).includes('sandbox') ? pill('sandbox', 'violet') : pill((k.scopes || []).join(' + ') || '—', 'blue')),
          h('td', { 'data-l': 'Created' }, fmtD(k.created_at)), h('td', { 'data-l': 'Last used' }, fmtDT(k.last_used_at)),
          h('td', { 'data-l': 'Status' }, k.revoked_at ? pill('revoked', 'red') : pill('active', 'green')),
          h('td', null, k.revoked_at ? '' : h('button', { class: 'cp-btn cp-btn-sm ghost', type: 'button', onClick: async (ev) => {
            const b = ev.currentTarget;
            if (!confirm('Revoke ' + k.prefix + '? Calls with this key will fail immediately.')) return;
            b.disabled = true;
            try { await revokeApiKey(k.id); load(); refreshState().catch(() => {}); } catch (e2) { b.disabled = false; alert(errMsg(e2)); }
          } }, 'Revoke')),
        ]))),
      ]));
    } catch (e) { mount(listHost, h('div', { class: 'lb-state lb-error' }, errMsg(e, 'Could not load keys.'))); }
  }
  load();
  return [
    card('Create an API key', [
      suspended ? h('div', { class: 'dev-note bad' }, 'Your account is suspended — new keys are blocked.') : null,
      h('div', { class: 'dev-createrow' }, [nameIn, scopeSel, createBtn]), err, revealHost,
      h('p', { class: 'dev-p' }, isDev()
        ? (canProd ? 'Sandbox keys return fixed test loads; production read keys return the live board. Posting loads (write) is for verified broker accounts — write to ' + SUPPORT_EMAIL + '.'
                   : 'Sandbox keys return fixed "SANDBOX TEST" loads so you can build safely. Production read keys unlock after we approve your account (Overview → Request production access).')
        : 'Keys created here belong to this LoadBoot account.'),
    ], { 'data-tour': 'dev-create' }),
    card('Your API keys', [listHost], { 'data-tour': 'dev-keys' }),
  ];
}

// Usage
function usageView() {
  let days = 7;
  const host = h('div', null, h('div', { class: 'lb-state lb-loading' }, 'Loading…'));
  const seg = h('div', { class: 'dev-seg' });
  const drawSeg = () => mount(seg, [7, 30].map(d => h('button', { type: 'button', class: 'dev-seg-b' + (d === days ? ' active' : ''), onClick: () => { days = d; drawSeg(); load(); } }, d + ' days')));
  async function load() {
    try {
      const u = await rpc('dev_usage', { p_days: days });
      const daily = u.daily || []; const max = Math.max(1, ...daily.map(d => d.calls || 0));
      const total = daily.reduce((s, d) => s + (d.calls || 0), 0), errs = daily.reduce((s, d) => s + (d.errors || 0), 0);
      mount(host, [
        h('div', { class: 'dev-kpis' }, [
          h('div', { class: 'dev-kpi' }, [h('b', null, String(total)), h('span', null, 'calls')]),
          h('div', { class: 'dev-kpi' }, [h('b', null, String(errs)), h('span', null, 'errors')]),
          h('div', { class: 'dev-kpi' }, [h('b', null, String((S.st && S.st.settings && S.st.settings.rate_limit_per_min) || '—')), h('span', null, 'requests / min / key')]),
        ]),
        h('div', { class: 'dev-bars', role: 'img', 'aria-label': 'Calls per day, last ' + days + ' days' }, daily.map(d => h('div', { class: 'dev-bar', title: d.day + ': ' + d.calls + ' calls, ' + d.errors + ' errors' }, [
          h('i', { style: 'height:' + Math.round(((d.calls || 0) / max) * 100) + '%' }, d.errors ? h('em', { style: 'height:' + Math.round((d.errors / Math.max(1, d.calls)) * 100) + '%' }) : null),
          days === 7 ? h('span', null, new Date(d.day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' })) : null,
        ]))),
        h('p', { class: 'dev-legend' }, [h('i', { class: 'ok' }), ' calls  ', h('i', { class: 'bad' }), ' errors (4xx/5xx)']),
        h('h4', { class: 'dev-h4' }, 'Per key'),
        (u.keys || []).length ? h('div', { class: 'cp-tablewrap' }, h('table', { class: 'cp-table dev-table' }, [
          h('thead', null, h('tr', null, ['Key', 'Calls', 'Errors', 'Last call'].map(t => h('th', null, t)))),
          h('tbody', null, u.keys.map(k => h('tr', null, [h('td', { 'data-l': 'Key' }, [h('b', null, k.name), ' ', h('code', null, k.prefix)]), h('td', { 'data-l': 'Calls' }, String(k.calls)), h('td', { 'data-l': 'Errors' }, String(k.errors)), h('td', { 'data-l': 'Last call' }, fmtDT(k.last_call))]))),
        ])) : h('div', { class: 'lb-state' }, 'No active keys.'),
        h('h4', { class: 'dev-h4' }, 'Recent calls'),
        (u.recent || []).length ? h('div', { class: 'cp-tablewrap' }, h('table', { class: 'cp-table dev-table' }, [
          h('thead', null, h('tr', null, ['Time', 'Call', 'Status', 'ms', 'Key'].map(t => h('th', null, t)))),
          h('tbody', null, u.recent.map(r => h('tr', null, [
            h('td', { 'data-l': 'Time' }, fmtDT(r.at)), h('td', { 'data-l': 'Call' }, [h('code', null, r.method + ' ' + r.endpoint), r.sandbox ? pill('sandbox', 'violet') : null]),
            h('td', { 'data-l': 'Status' }, pill(String(r.status), r.status >= 500 || r.status === 429 ? 'red' : r.status >= 400 ? 'amber' : 'green')),
            h('td', { 'data-l': 'ms' }, String(r.latency_ms ?? '—')), h('td', { 'data-l': 'Key' }, r.prefix ? h('code', null, r.prefix) : '—'),
          ]))),
        ])) : h('div', { class: 'lb-state' }, 'No calls yet. Try the example on the Docs tab.'),
      ]);
    } catch (e) { mount(host, h('div', { class: 'lb-state lb-error' }, errMsg(e, 'Could not load usage.'))); }
  }
  drawSeg(); load();
  return [card('Usage', [seg, host], { 'data-tour': 'dev-usage' })];
}

// Docs — mirrors the public API page (build_site.py API_PAGE). Keep both in sync.
function docsView() {
  const rl = (S.st && S.st.settings && S.st.settings.rate_limit_per_min) || 60;
  const link = 'https://loadboot.com/app/carrier/?src=' + partner() + '&ref={ref}';
  const code = (t) => h('pre', { class: 'dev-pre' }, t);
  const row = (a, b) => h('tr', null, [h('td', null, h('code', null, a)), h('td', null, b)]);
  const table = (head, rows) => h('div', { class: 'cp-tablewrap' }, h('table', { class: 'cp-table' }, [h('thead', null, h('tr', null, head.map(t => h('th', null, t)))), h('tbody', null, rows)]));
  return [
    card('Quickstart', [
      h('p', { class: 'dev-p' }, 'Base URL'), h('div', { class: 'dev-copyrow' }, [code(API_BASE), copyBtn(API_BASE)]),
      h('p', { class: 'dev-p' }, 'Send your key in the Authorization header on every call:'), code('Authorization: Bearer lb_YOUR_KEY'),
      h('p', { class: 'dev-p' }, '1 — who am I:'), code('curl -H "Authorization: Bearer lb_..." \\\n  "' + API_BASE + '?resource=me"'),
      h('p', { class: 'dev-p' }, '2 — list loads (filters optional):'), code('curl -H "Authorization: Bearer lb_..." \\\n  "' + API_BASE + '?resource=loads&limit=25&equipment=Reefer&origin_state=TX"'),
      h('p', { class: 'dev-p' }, 'A sandbox key answers the same calls with fixed "SANDBOX TEST" loads (refs start with SBX). Nothing you do with it touches the real board.'),
    ], { 'data-tour': 'dev-quickstart' }),
    card('Endpoints', [table(['Call', 'What it does'], [
      row('GET ?resource=me', 'The key\'s owner, scopes, sandbox flag, account status and your rate limit.'),
      row('GET ?resource=loads', 'Public load opportunities, newest first. limit 1–50 (default 25). Filters: equipment (text match), origin_state, dest_state (2-letter codes). Scope: read, or a sandbox key.'),
      row('POST ?resource=loads', 'Post freight to the board — one object, {"loads":[…]} or an array, up to 50 per request. Scope: write (verified broker accounts only). A sandbox key validates the body and posts nothing.'),
    ])]),
    card('Load fields (GET)', [table(['Field', 'Meaning'], [
      row('ref', 'LoadBoot load reference — use it in the link-back URL'), row('origin / destination', 'City, ST'), row('equipment', 'Dry Van, Reefer, Flatbed, …'),
      row('miles / rate / rpm', 'Distance, all-in rate (USD) and rate per mile'), row('pickup_date', 'YYYY-MM-DD'), row('posted / expires_at', 'Timestamps'),
      row('commodity / weight', 'As posted'), row('posted_by', '"Broker partner" or "LoadBoot dispatch"'), row('url', 'Your link-back for this load — already includes ?src and ref'),
    ])]),
    card('Posting loads (POST)', [
      h('p', { class: 'dev-p' }, ['Required: ', h('code', null, 'origin'), ' ', h('code', null, 'destination'), ' ', h('code', null, 'pickup_date'), ' ', h('code', null, 'hazmat'), ' (boolean — we never infer it). Recommended: equipment, rate, miles, weight, commodity, reference, idempotency_key.']),
      h('p', { class: 'dev-p' }, 'Retries are safe: send idempotency_key per load or an Idempotency-Key header and a repeat returns the original load. Detention, layover, TONU and lumper default to LoadBoot published terms when omitted. Responses: 200 all posted, 207 some rejected (read results[]), 400 none posted.'),
      h('p', { class: 'dev-p' }, 'No ghost loads: every posting must come from a verified brokerage, and covered freight comes down immediately.'),
    ]),
    card('Errors & limits', [table(['Status', 'Meaning'], [
      row('401', 'Missing, invalid or revoked key'), row('403', 'Key lacks the scope, or the account is suspended'),
      row('400', 'Bad JSON, empty batch, more than 50 loads, or a bad filter value'), row('404', 'Unknown resource'),
      row('429', 'Rate limit: ' + rl + ' requests per minute per key. Wait the seconds in the Retry-After header.'),
      row('207', 'Batch partly posted — check each item in results[]'),
    ]), h('p', { class: 'dev-p' }, 'Every response carries X-RateLimit-Limit and X-RateLimit-Remaining.')]),
    card('Attribution & link-back (required)', [
      h('p', { class: 'dev-p' }, 'Show "via LoadBoot" only on loads whose ref came from this API, and link each one back to LoadBoot with its ref. The API already puts the right link in each load\'s url field:'),
      h('div', { class: 'dev-copyrow' }, [code(link), copyBtn(link)]),
      h('p', { class: 'dev-p' }, 'Carriers who tap it land on the load in LoadBoot, and the visit is credited to you.'),
    ], { 'data-tour': 'dev-attribution' }),
    card('Event catalog', [
      h('p', { class: 'dev-p' }, 'Register an https endpoint on the Webhooks tab and every matching event is delivered to it automatically, with retries.'),
      table(['Event', 'When it fires'], [
        ['load.assigned', 'A load is assigned to a carrier'], ['trip.status', 'A trip moves forward (in_transit / delivered)'],
        ['trip.exception', 'A carrier/driver reports a trip exception (detention, TONU, accident, …)'], ['trip.exception.resolved', 'Staff resolve a trip exception'],
        ['pod.uploaded', 'A proof-of-delivery document is uploaded'], ['pod.reviewed', 'Staff approve or reject a POD'],
        ['invoice.prep_requested', 'An approved POD triggers invoice preparation'], ['form.submitted', 'A website form is submitted (lead)'],
        ['plugin.installed', 'A plugin is installed'], ['plugin.uninstalled', 'A plugin is uninstalled'],
      ].map(([ev, d]) => row(ev, d))),
    ], { 'data-tour': 'dev-events' }),
  ];
}

// Webhooks — self-serve, unchanged behaviour (my_webhooks / my_webhook_create / my_webhook_delete)
function webhooksView() {
  const listHost = h('div', { class: 'dev-wh-list' }, h('div', { class: 'dev-p' }, 'Loading endpoints…'));
  const nameIn = h('input', { class: 'cp-in', placeholder: 'Name (e.g. My TMS)' });
  const urlIn = h('input', { class: 'cp-in', type: 'url', placeholder: 'https://your-server.com/loadboot-webhook' });
  const evIn = h('input', { class: 'cp-in', placeholder: 'Events (comma-separated, blank = all)' });
  const msg = h('div', { class: 'cp-err' });
  const draw = async () => {
    let rows = [];
    try { rows = await myWebhooks(); } catch (e) { mount(listHost, h('div', { class: 'dev-p' }, errMsg(e, 'Could not load.'))); return; }
    if (!rows.length) { mount(listHost, h('div', { class: 'dev-p' }, 'No endpoints yet — add one above and events start flowing within ~2 minutes.')); return; }
    mount(listHost, rows.map((r) => h('div', { class: 'dev-wh' }, [
      h('div', { class: 'dev-wh-main' }, [
        h('b', null, r.name || 'endpoint'), h('div', { class: 'dev-wh-url' }, r.url),
        h('div', { class: 'dev-wh-meta' }, [
          ((r.event_types && r.event_types.length) ? r.event_types.join(', ') : 'all events') + ' · ',
          pill((r.delivered || 0) + ' delivered', 'green'), ' ', (r.failed || 0) ? pill(r.failed + ' failed', 'red') : null,
        ]),
      ]),
      r.active ? h('button', { class: 'cp-btn cp-btn-sm ghost', type: 'button', onClick: async (ev) => {
        const b = ev.currentTarget; if (!confirm('Remove this endpoint? Deliveries to it stop.')) return; b.disabled = true; b.textContent = '…';
        try { await myWebhookDelete(r.id); draw(); } catch (e) { b.disabled = false; b.textContent = 'Remove'; msg.textContent = errMsg(e, 'Failed.'); }
      } }, 'Remove') : pill('removed'),
    ])));
  };
  const addBtn = h('button', { class: 'cp-btn', type: 'button', onClick: async (ev) => {
    const b = ev.currentTarget; b.disabled = true; const t = b.textContent; b.textContent = 'Adding…'; msg.className = 'cp-err'; msg.textContent = '';
    try {
      await myWebhookCreate(nameIn.value.trim(), urlIn.value.trim(), evIn.value.trim() ? evIn.value.split(',').map((x) => x.trim()).filter(Boolean) : []);
      nameIn.value = ''; urlIn.value = ''; evIn.value = ''; msg.className = 'cp-err ok'; msg.textContent = '✓ Endpoint registered — deliveries start within ~2 minutes.'; draw();
    } catch (e) { msg.textContent = errMsg(e, 'Could not register that endpoint.'); }
    b.disabled = false; b.textContent = t;
  } }, '+ Add webhook endpoint');
  draw();
  return [card('Webhooks — self-serve', [
    h('p', { class: 'dev-p' }, 'Register an https endpoint and LoadBoot POSTs every matching event to it automatically, with retries. Up to 5 endpoints per account. Event names are on the Docs tab.'),
    h('div', { class: 'dev-grid3' }, [nameIn, urlIn, evIn]),
    h('div', { class: 'dev-actions' }, addBtn), msg, listHost,
  ], { 'data-tour': 'dev-webhooks' })];
}

// Account & support
function accountView() {
  const out = [];
  const a = acct();
  if (isDev()) {
    const f = {
      name: h('input', { class: 'cp-in', value: a.name || '' }), company: h('input', { class: 'cp-in', value: a.company || '' }),
      website: h('input', { class: 'cp-in', type: 'url', value: a.website || '' }),
      use_case: h('textarea', { class: 'cp-in', rows: '3' }), volume: h('select', { class: 'cp-in' }, [h('option', { value: '' }, 'Expected volume…')].concat(VOLUMES.map(v => h('option', { value: v }, v)))),
    };
    f.use_case.value = a.use_case || ''; if (a.expected_volume) f.volume.value = a.expected_volume;
    const err = h('div', { class: 'cp-err' });
    const btn = h('button', { class: 'cp-btn', type: 'button', onClick: async () => {
      btn.disabled = true; err.className = 'cp-err'; err.textContent = '';
      try { S.st = await rpc('dev_profile_save', { p: { name: f.name.value, company: f.company.value, website: f.website.value, use_case: f.use_case.value, expected_volume: f.volume.value } });
        err.className = 'cp-err ok'; err.textContent = '✓ Saved.'; }
      catch (e) { err.textContent = errMsg(e); }
      btn.disabled = false;
    } }, 'Save profile');
    out.push(card('Your profile', [
      h('div', { class: 'dev-grid2' }, [h('div', null, [h('label', { class: 'cp-lbl' }, 'Name'), f.name]), h('div', null, [h('label', { class: 'cp-lbl' }, 'Company'), f.company])]),
      h('label', { class: 'cp-lbl' }, 'Website'), f.website, h('label', { class: 'cp-lbl' }, 'What you are building'), f.use_case,
      h('label', { class: 'cp-lbl' }, 'Expected volume'), f.volume,
      h('p', { class: 'dev-p' }, ['Partner id in your link-back: ', h('code', null, partner()), ' (set by LoadBoot).']),
      h('p', { class: 'dev-p' }, ['API use terms: ', (S.st.terms && !S.st.terms.needs_accept)
        ? 'accepted ' + fmtD(S.st.terms.accepted_at) + ' (version ' + S.st.terms.accepted_version + ')' : 'not accepted yet',
        ' · ', h('a', { href: API_TERMS_URL, target: '_blank', rel: 'noopener' }, 'read')]),
      err, btn,
    ]));
  }
  const pwMsg = h('div', { class: 'cp-err' });
  out.push(card('Sign-in', [
    h('p', { class: 'dev-p' }, ['Signed in as ', h('b', null, (S.user && S.user.email) || '')]),
    h('div', { class: 'dev-actions' }, [
      h('button', { class: 'cp-btn cp-btn-sm ghost', type: 'button', onClick: async (ev) => {
        const b = ev.currentTarget; b.disabled = true;
        try { const { error } = await resetPassword((S.user && S.user.email) || ''); if (error) throw error; pwMsg.className = 'cp-err ok'; pwMsg.textContent = '✓ Reset link sent to your email.'; }
        catch (e) { pwMsg.className = 'cp-err'; pwMsg.textContent = errMsg(e, 'Could not send — try again later.'); b.disabled = false; }
      } }, 'Email me a password-reset link'),
      h('button', { class: 'cp-btn cp-btn-sm ghost', type: 'button', onClick: async () => { await signOut(); boot(); } }, 'Sign out'),
    ]), pwMsg,
  ]));
  out.push(card('Support', [
    h('p', { class: 'dev-p' }, ['Questions, a sandbox for your network or TMS, or write access for a brokerage: ', h('a', { href: 'mailto:' + SUPPORT_EMAIL }, SUPPORT_EMAIL), '.']),
  ], { 'data-tour': 'dev-support' }));
  return out;
}

function startTour() {
  // Guided tour + floating "?" help. Engine: ../shared/ui/tour.js, copy: ./tour-content.js. Stops name the tab they
  // live on (route); navigate switches tabs. Progress is localStorage only (lb_tour.developer.v2).
  try {
    if (!window.__lbTour) {
      const tour = createTour({ key: 'developer', version: 2, role: 'developer', flows: DEVELOPER_TOUR.flows, screens: DEVELOPER_TOUR.screens, navigate: (r) => go(r), currentRoute: () => S.tab });
      const help = mountHelp(tour, { supportRoute: '#account', navigate: (r) => go(r) });
      window.__lbTour = tour; window.__lbTourHelp = help;
      help.onRoute(S.tab);
      setTimeout(() => { try { tour.autoStart(); } catch (_) {} }, 500);
    }
  } catch (_) {}
}

let _hadSession = false, _watching = false;
function watchAuth() { if (_watching) return; _watching = true; onAuthChange((s) => { if (s) { _hadSession = true; return; } if (_hadSession) { _hadSession = false; location.reload(); } }); }
async function boot() {
  root.setAttribute('aria-busy', 'true');
  if (/type=recovery/.test(location.hash || '')) {
    // The recovery link signs the person in first; give the client a moment to read the token from the URL.
    try { await getSession(); } catch (_) {}
    recoveryScreen(); return;
  }
  let session = null; try { session = await getSession(); } catch (_) {}
  if (!session) { authScreen(/signup/.test(location.hash || '') ? 'signup' : 'signin'); return; }
  _hadSession = true; watchAuth();
  try { S.user = await getUser(); } catch (_) {}
  try { await refreshState(); }
  catch (e) { mount(root, h('div', { class: 'cp-auth' }, h('div', { class: 'cp-auth-card' }, [brandRow(), h('p', { class: 'cp-err' }, errMsg(e, 'Could not load your account.')), h('button', { class: 'cp-btn', type: 'button', onClick: () => boot() }, 'Try again')]))); root.setAttribute('aria-busy', 'false'); return; }
  const t = (location.hash || '').replace('#', '');
  S.tab = TABS.some(([k]) => k === t) ? t : 'overview';
  render();
  startTour();
}
window.addEventListener('hashchange', () => {
  if (!S.st) return;
  const t = (location.hash || '').replace('#', '');
  if (TABS.some(([k]) => k === t) && t !== S.tab) go(t);
});
boot();
