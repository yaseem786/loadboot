// app.js — LoadBoot Developer Portal. Any signed-in user can mint API keys and
// call the public developer API (the dev-api edge function). Keys are shown once
// at creation (only a hash is stored server-side) and can be revoked any time.
import ENV from '../shared/env.js';
import { getSession, getUser, signInWithPassword, signUp, signOut, onAuthChange } from '../shared/session.js';
import { createApiKey, listApiKeys, revokeApiKey } from '../shared/api.js';


// PWA real-app behaviour: remember this portal so the installed app opens here next launch.
try { localStorage.setItem('lb_last_portal', '/app/developer/'); } catch (_) {}

const root = document.getElementById('lb-app');
const API_BASE = ENV.supabaseUrl + '/functions/v1/dev-api';

const h = (tag, attrs, kids) => {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') e[k.toLowerCase()] = attrs[k];
    else if (attrs[k] != null && attrs[k] !== false) e.setAttribute(k, attrs[k]);
  }
  (Array.isArray(kids) ? kids : kids != null ? [kids] : []).forEach(c => c != null && e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return e;
};
const mount = (el, kids) => { el.innerHTML = ''; (Array.isArray(kids) ? kids : [kids]).forEach(c => c && el.appendChild(c)); };
const fmtDT = (d) => { if (!d) return 'never'; try { return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return '—'; } };
const LOGO_SVG = '<img src="/icon-512.png" width="34" height="34" alt="LoadBoot" style="border-radius:22%;display:block">';
const brandMark = (dark) => h('span', { class: 'cp-logo', html: '<img src="' + (dark ? '/logo-icon-dark.png' : '/icon-512.png') + '" width="34" height="34" alt="LoadBoot" style="display:block">' });

function authScreen() {
  let signup = false;
  const email = h('input', { class: 'cp-in', type: 'email', placeholder: 'you@company.com', autocomplete: 'username' });
  const pass = h('input', { class: 'cp-in', type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
  const err = h('div', { class: 'cp-err' });
  const title = h('h1', null, 'Developer sign in');
  const sub = h('p', { class: 'cp-auth-sub' }, 'Manage your API keys and integrate with LoadBoot.');
  const btn = h('button', { class: 'cp-btn cp-btn-lg' }, 'Sign in');
  const toggle = h('p', { class: 'cp-auth-toggle' });
  const setMode = (s) => {
    signup = s; title.textContent = s ? 'Create your account' : 'Developer sign in';
    btn.textContent = s ? 'Create account' : 'Sign in'; err.textContent = ''; err.className = 'cp-err';
    mount(toggle, s ? [document.createTextNode('Already have an account? '), h('a', { onClick: () => setMode(false) }, 'Sign in')]
      : [document.createTextNode('New here? '), h('a', { onClick: () => setMode(true) }, 'Create an account')]);
  };
  btn.onclick = async () => {
    err.textContent = ''; err.className = 'cp-err';
    const em = email.value.trim(), pw = pass.value;
    if (!em || !pw) { err.textContent = 'Enter your email and password.'; return; }
    btn.disabled = true; btn.textContent = signup ? 'Creating…' : 'Signing in…';
    try {
      if (signup) {
        const { data, error } = await signUp(em, pw, {});
        if (error) throw error;
        if (!data || !data.session) { err.className = 'cp-err ok'; err.textContent = 'Account created! Check your email to confirm, then sign in.'; setMode(false); btn.disabled = false; return; }
        boot(); return;
      }
      const { error } = await signInWithPassword(em, pw); if (error) throw error; boot(); return;
    } catch (e) { err.textContent = (e && e.message) || 'Something went wrong.'; btn.disabled = false; btn.textContent = signup ? 'Create account' : 'Sign in'; }
  };
  mount(root, h('div', { class: 'cp-auth' }, [h('div', { class: 'cp-auth-card' }, [
    h('div', { class: 'cp-auth-brand' }, [h('img', { src: '/logo-full.png', alt: 'LoadBoot', style: 'height:31px;width:auto;display:block' }), h('span', { class: 'cp-brand-sub', style: 'color:#60A5FA;font-weight:500;letter-spacing:0;text-transform:none' }, 'Developers')]),
    title, sub, h('label', { class: 'cp-lbl' }, 'Email'), email, h('label', { class: 'cp-lbl' }, 'Password'), pass, err, btn, toggle,
  ])]));
  setMode(false); root.setAttribute('aria-busy', 'false');
}

function appView(user) {
  const listHost = h('div', { class: 'cp-tablewrap' }, h('div', { class: 'lb-state lb-loading' }, 'Loading…'));
  const nameIn = h('input', { class: 'cp-in', placeholder: 'e.g. My integration' });
  const revealHost = h('div');
  const err = h('div', { class: 'cp-err' });
  const createBtn = h('button', { class: 'cp-btn', onClick: async () => {
    err.textContent = ''; err.className = 'cp-err';
    if (!nameIn.value.trim()) { err.textContent = 'Give the key a name.'; return; }
    createBtn.disabled = true; createBtn.textContent = 'Creating…';
    try {
      const r = await createApiKey(nameIn.value.trim(), ['read']);
      nameIn.value = '';
      mount(revealHost, h('div', { class: 'dev-reveal' }, [
        h('div', { class: 'dev-reveal-h' }, '⚠ Copy your key now — it won’t be shown again.'),
        h('code', { class: 'dev-key' }, r.key),
        h('button', { class: 'cp-btn cp-btn-sm', onClick: () => { navigator.clipboard && navigator.clipboard.writeText(r.key); createBtn.textContent = 'Copied ✓'; } }, 'Copy'),
      ]));
      load();
    } catch (e) { err.textContent = (e && e.message) || 'Could not create the key.'; }
    createBtn.disabled = false; createBtn.textContent = 'Create key';
  } }, 'Create key');

  async function load() {
    try {
      const rows = await listApiKeys();
      if (!rows || !rows.length) { mount(listHost, h('div', { class: 'lb-state' }, 'No API keys yet. Create one above.')); return; }
      mount(listHost, h('table', { class: 'cp-table' }, [
        h('thead', null, h('tr', null, ['Name', 'Prefix', 'Scopes', 'Last used', 'Status', ''].map(t => h('th', null, t)))),
        h('tbody', null, rows.map(k => h('tr', null, [
          h('td', null, h('b', null, k.name)), h('td', null, h('code', null, k.prefix)),
          h('td', null, (k.scopes || []).join(', ')), h('td', null, fmtDT(k.last_used_at)),
          h('td', null, k.revoked_at ? h('span', { class: 'cp-pill red' }, 'revoked') : h('span', { class: 'cp-pill green' }, 'active')),
          h('td', null, k.revoked_at ? '' : h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async (ev) => { ev.currentTarget.disabled = true; try { await revokeApiKey(k.id); load(); } catch (_) { ev.currentTarget.disabled = false; } } }, 'Revoke')),
        ]))),
      ]));
    } catch (e) { mount(listHost, h('div', { class: 'lb-state lb-error' }, (e && e.message) || 'Could not load keys.')); }
  }

  const curl = 'curl -H "Authorization: Bearer lb_..." \\\n  "' + API_BASE + '?resource=loads&limit=25"';
  mount(root, h('div', { class: 'cp-shell cp-shell-1col' }, h('main', { class: 'cp-main dev-main' }, [
    h('header', { class: 'cp-top' }, [
      h('div', { class: 'cp-brandrow', style: 'gap:10px' }, [h('img', { src: '/logo-full.png', alt: 'LoadBoot', style: 'height:29px;width:auto;display:block' }), h('div', null, [
        h('span', { class: 'cp-brand-sub', style: 'color:#60A5FA;font-weight:500;letter-spacing:0;text-transform:none' }, 'Developers'),
        h('div', { class: 'cp-carrier-name', style: 'font-size:.82rem' }, (user && user.email) || ''),
      ])]),
      h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async () => { await signOut(); boot(); } }, 'Sign out'),
    ]),
    h('div', { class: 'cp-content' }, [
      h('div', { class: 'cp-card' }, [
        h('div', { class: 'cp-cardhead' }, [h('h3', null, 'Create an API key')]),
        h('div', { class: 'dev-createrow' }, [nameIn, createBtn]), err, revealHost,
      ]),
      h('div', { class: 'cp-card', style: 'margin-top:16px' }, [h('div', { class: 'cp-cardhead' }, [h('h3', null, 'Your API keys')]), listHost]),
      h('div', { class: 'cp-card', style: 'margin-top:16px' }, [
        h('div', { class: 'cp-cardhead' }, [h('h3', null, 'Quickstart')]),
        h('p', { class: 'dev-p' }, 'Base URL'), h('pre', { class: 'dev-pre' }, API_BASE),
        h('p', { class: 'dev-p' }, 'Authenticate with your key in the Authorization header. Example — fetch public load opportunities:'),
        h('pre', { class: 'dev-pre' }, curl),
        h('p', { class: 'dev-p' }, 'Endpoints'),
        h('ul', { class: 'dev-ul' }, [
          h('li', null, [h('code', null, '?resource=me'), document.createTextNode(' — who the key belongs to + scopes')]),
          h('li', null, [h('code', null, '?resource=loads&limit=25'), document.createTextNode(' — public load opportunities (read scope)')]),
        ]),
      ]),
      h('div', { class: 'cp-card', style: 'margin-top:16px' }, [
        h('div', { class: 'cp-cardhead' }, [h('h3', null, 'Event catalog')]),
        h('p', { class: 'dev-p' }, 'The platform emits these domain events. Webhook subscriptions (coming soon) will deliver them to your endpoint; each is already recorded on the internal event stream today.'),
        h('table', { class: 'cp-table' }, [
          h('thead', null, h('tr', null, ['Event', 'When it fires'].map(t => h('th', null, t)))),
          h('tbody', null, [
            ['load.assigned', 'A load is assigned to a carrier'],
            ['trip.status', 'A trip moves forward (in_transit / delivered)'],
            ['trip.exception', 'A carrier/driver reports a trip exception (detention, TONU, accident, …)'],
            ['trip.exception.resolved', 'Staff resolve a trip exception'],
            ['pod.uploaded', 'A proof-of-delivery document is uploaded'],
            ['pod.reviewed', 'Staff approve or reject a POD'],
            ['invoice.prep_requested', 'An approved POD triggers invoice preparation'],
            ['form.submitted', 'A website form is submitted (lead)'],
            ['plugin.installed', 'A plugin is installed'],
            ['plugin.uninstalled', 'A plugin is uninstalled'],
          ].map(([ev, desc]) => h('tr', null, [h('td', null, h('code', null, ev)), h('td', null, desc)]))),
        ]),
      ]),
    ]),
  ])));
  root.setAttribute('aria-busy', 'false');
  load();
}

let _hadSession = false, _watching = false;
function watchAuth() { if (_watching) return; _watching = true; onAuthChange((s) => { if (s) { _hadSession = true; return; } if (_hadSession) { _hadSession = false; location.reload(); } }); }
async function boot() {
  root.setAttribute('aria-busy', 'true');
  let session = null; try { session = await getSession(); } catch (_) {}
  if (!session) { authScreen(); return; }
  _hadSession = true; watchAuth();
  let user = null; try { user = await getUser(); } catch (_) {}
  appView(user);
}
boot();
