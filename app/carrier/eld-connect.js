// eld-connect.js — carrier portal "ELD & telematics" card (replaces the inline eldCard9 in app.js).
//
// What changed on 29 Aug 2026 and why:
//   • The old card called carrier_eld_setup('generic') just to RENDER — so every carrier who opened the
//     Fleet page got a phantom 'generic' integration row. This card reads carrier_eld_status() (read-only)
//     and only writes when the carrier clicks Connect / Show webhook.
//   • The old card showed "✓ Provider API token on file — polling active" for ANY string. A carrier pasted
//     a 128-char hex value as a "Samsara token"; the poller got 401 every 5 minutes; nobody was told.
//     Now: the token is checked LIVE against the provider (edge fn eld-test) BEFORE it is saved, the card
//     shows the org name the provider returned, and the poller's failures (bl_eld_0297 last_error) are
//     shown here with the provider's own wording.
//   • Guided steps are the vendors' published steps (Samsara Help Center "Get Started with the Samsara
//     API", Motive Help Center "How to Create an API Key?"), not guesses — see STEPS below; keep them in
//     sync with those pages if the vendors move menus.
import { carrierEldStatus, carrierEldSetup, carrierEldDisconnect } from '../shared/api.js';
import { el, mount } from '../shared/ui/dom.js';
import { icon } from '../shared/ui/icons.js';

const h = el;
const ago = (v) => { if (!v) return ''; const m = Math.round((Date.now() - new Date(v).getTime()) / 60000); if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; const hh = Math.round(m / 60); if (hh < 48) return hh + ' h ago'; return Math.round(hh / 24) + ' d ago'; };

// Vendor-published steps. Samsara: kb.samsara.com "Get Started with the Samsara API" + developers.samsara.com
// Authentication. Motive: helpcenter.gomotive.com "How to Create an API Key?" + developer-docs.gomotive.com.
const STEPS = {
  samsara: {
    label: 'Samsara', who: 'Needs a Samsara Full Admin or Standard Admin login for the ENTIRE organization (a tag-level admin or a driver login cannot create tokens).',
    steps: [
      'Sign in at cloud.samsara.com on a computer.',
      'Click the Settings (gear) icon at the bottom of the left menu, then click API Tokens.',
      'Click + Add an API Token.',
      'Name it "LoadBoot". Tag access: Entire organization. Scopes: set Read on Vehicles, Drivers, and Hours of Service (read-only is enough — LoadBoot never writes to your Samsara).',
      'Click Save, then copy the token right away — Samsara hides it after the page refreshes. It starts with samsara_api_.',
      'Paste it below and click Test & connect.',
    ],
    format: (t) => /^samsara_api_/.test(t) ? null : 'Samsara tokens start with samsara_api_ — what you pasted does not. It may be a different key (Enterprise, a phone app, an ELD serial). We will still ask Samsara, but expect a rejection.',
    placeholder: 'samsara_api_…',
  },
  motive: {
    label: 'Motive (formerly KeepTruckin)', who: 'Needs a Motive Fleet Admin login. A driver login cannot create keys.',
    steps: [
      'Sign in to the Motive Fleet Dashboard (web) as a Fleet Admin.',
      'Click Admin at the bottom of the left menu.',
      'In the Admin menu click Developers.',
      'Click Create API Key (on some accounts the button says "+ Request API Key" — it creates the key instantly).',
      'Name it "LoadBoot" and click Save. Leave Test Mode UNCHECKED — with Test Mode on, LoadBoot cannot read your live trucks.',
      'Copy the key, paste it below and click Test & connect.',
    ],
    format: (t) => /\s/.test(t) ? 'The key has spaces in it — copy only the key.' : null,
    placeholder: 'Paste the Motive API key',
  },
  generic: {
    label: 'Other ELD / webhook', who: 'For any device or telematics platform that can POST a position to a URL (Garmin, Geotab add-ins, custom).',
    steps: [
      'Click Show webhook below to get your private ingest URL and token.',
      'In your telematics platform, add a webhook/HTTP push for vehicle location and paste the URL. Send JSON {"p_token":"…","p_lat":<lat>,"p_lng":<lng>} with the apikey header shown.',
      'Positions are routed to your active LoadBoot trip automatically. Rotate the token any time if it leaks.',
    ],
    format: () => null, placeholder: '',
  },
};

async function liveTest(provider, token) {
  const { getClient } = await import('../shared/supabaseClient.js');
  const sb = await getClient(); const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('Sign in again and retry.');
  const env = window.__LB_ENV || {};
  const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 45000);
  const r = await fetch(env.supabaseUrl + '/functions/v1/eld-test', { method: 'POST', signal: ctrl.signal,
    headers: { 'Content-Type': 'application/json', apikey: env.supabaseAnonKey, Authorization: 'Bearer ' + session.access_token },
    body: JSON.stringify({ provider, api_token: token }) });
  clearTimeout(tm);
  const j = await r.json().catch(() => null);
  if (!j) throw new Error('The test service did not answer (HTTP ' + r.status + '). Try again in a minute.');
  return j;
}

export async function mountEldCard(host, opts = {}) {
  const toast = opts.toast || (() => {});
  const head = () => h('div', { class: 'cp-cardhead' }, [h('div', null, [h('h3', null, [icon('gps', 15), ' ELD & telematics']), h('span', { class: 'cp-cardhead-sub' }, 'device GPS + drive-time feed your trips and your dispatcher')])]);
  let rows = []; let prov = 'samsara';

  const statusLine = (r) => {
    if (!r || r.status !== 'active') return h('div', { class: 'cp-row-s' }, 'Not connected.');
    if (r.last_error) return h('div', { style: 'background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.4);border-radius:11px;padding:9px 12px;color:#fca5a5;line-height:1.5' }, [h('b', null, 'Connection failing'), ' — ', r.last_error, r.last_error_at ? ' (' + ago(r.last_error_at) + ')' : '', '. Reconnect with a fresh token below.']);
    if (r.last_ok_at) return h('div', { style: 'background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.35);border-radius:11px;padding:9px 12px;color:#86efac;line-height:1.5' }, [h('b', null, 'Connected'), r.org_name ? ' · ' + r.org_name : '', ' · last successful sync ' + ago(r.last_ok_at), '. LoadBoot polls every 5 minutes.']);
    if (r.has_api_token) return h('div', { style: 'background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.35);border-radius:11px;padding:9px 12px;color:#fcd9a2;line-height:1.5' }, [h('b', null, 'Token saved'), r.org_name ? ' · ' + r.org_name : '', ' · waiting for the first 5-minute poll' + (r.updated_at ? ' (saved ' + ago(r.updated_at) + ')' : '') + '.']);
    return h('div', { class: 'cp-row-s' }, 'Webhook active' + (r.last_ping_at ? ' · last position ' + ago(r.last_ping_at) : ' · no positions received yet') + '.');
  };

  async function paint() {
    try { rows = await carrierEldStatus(); if (!Array.isArray(rows)) rows = []; } catch (_) { rows = []; }
    const active = rows.filter((r) => r.status === 'active' && (r.has_api_token || r.provider === 'generic'));
    const S = STEPS[prov];
    const tokIn = h('input', { class: 'cp-in', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: S.placeholder, style: 'flex:1;min-width:240px' });
    const eye = h('button', { class: 'cp-btn-ghost cp-btn-sm', type: 'button', onClick: () => { tokIn.type = tokIn.type === 'password' ? 'text' : 'password'; } }, 'Show');
    const result = h('div', { style: 'margin-top:8px;line-height:1.55' });
    const provSel = h('select', { class: 'cp-in', style: 'max-width:260px' }, Object.keys(STEPS).map((k) => h('option', { value: k, selected: k === prov ? 'selected' : null }, STEPS[k].label)));
    provSel.onchange = () => { prov = provSel.value; paint(); };
    const mine = rows.find((r) => r.provider === prov);

    const connectBtn = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => {
      const b = ev.currentTarget; const tok = tokIn.value.trim();
      if (!tok) { toast('Paste the token from your ' + S.label + ' dashboard first.', 'urgent', 'Token'); return; }
      const fmt = S.format(tok);
      mount(result, h('div', { class: 'cp-muted' }, (fmt ? fmt + ' ' : '') + 'Asking ' + S.label + '…'));
      b.disabled = true;
      try {
        const t = await liveTest(prov, tok);
        if (!t.ok) {
          mount(result, h('div', { style: 'background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.4);border-radius:11px;padding:10px 12px;color:#fca5a5' }, [h('b', null, 'Not connected. '), t.error || 'Rejected.', t.hint ? h('div', { style: 'margin-top:4px;color:#fecaca' }, t.hint) : null]));
          b.disabled = false; return;
        }
        const saved = await carrierEldSetup(prov, false, tok, t.org || null);
        if (saved && saved.error) throw new Error(saved.error);
        const bits = [];
        if (t.org) bits.push(t.org);
        if (t.vehicles != null) bits.push(t.vehicles + ' vehicle' + (t.vehicles === 1 ? '' : 's'));
        if (t.hos_drivers != null) bits.push(t.hos_drivers + ' driver clock' + (t.hos_drivers === 1 ? '' : 's'));
        if (t.region === 'EU') bits.push('EU region');
        mount(result, h('div', { style: 'background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.35);border-radius:11px;padding:10px 12px;color:#86efac' }, [h('b', null, 'Connected to ' + S.label + '. '), bits.join(' · '), (t.warnings || []).length ? h('ul', { style: 'margin:6px 0 0;padding-left:18px;color:#fcd9a2' }, t.warnings.map((w) => h('li', null, w))) : null]));
        toast('LoadBoot will pull positions and drive-time every 5 minutes.', 'success', 'ELD connected');
        tokIn.value = '';
        setTimeout(paint, 1500);
      } catch (e) { mount(result, h('div', { class: 'cp-err' }, e.message || 'Could not connect.')); b.disabled = false; }
    } }, 'Test & connect');

    const webhookBox = () => {
      const g = rows.find((r) => r.provider === 'generic' && r.status === 'active');
      if (!g || !g.token) return h('button', { class: 'cp-btn cp-btn-sm', onClick: async () => { try { await carrierEldSetup('generic', false, null, null); paint(); } catch (e) { toast(e.message, 'urgent', 'Webhook'); } } }, 'Show webhook');
      const env = window.__LB_ENV || {};
      const url = (env.supabaseUrl || '') + '/rest/v1/rpc/eld_ingest';
      return h('div', null, [
        h('div', { style: 'background:rgba(8,131,247,.08);border:1px solid rgba(8,131,247,.3);border-radius:11px;padding:10px 13px;font-family:ui-monospace,Menlo,monospace;font-size:.72rem;line-height:1.8;user-select:all;word-break:break-all' }, 'POST ' + url + '\nbody: {"p_token":"' + g.token + '","p_lat":<lat>,"p_lng":<lng>}\nheader: apikey: ' + (env.supabaseAnonKey || '<anon key>')),
        h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' }, [
          h('button', { class: 'cp-btn-ghost cp-btn-sm', onClick: () => { try { navigator.clipboard.writeText(String(g.token)); toast('Ingest token copied.', 'success', 'Copied'); } catch (_) {} } }, 'Copy token'),
          h('button', { class: 'cp-btn-ghost cp-btn-sm', onClick: async () => { if (!confirm('Rotate the token? The old one stops working immediately.')) return; await carrierEldSetup('generic', true, null, null); paint(); } }, 'Rotate token'),
          h('button', { class: 'cp-btn-ghost cp-btn-sm', onClick: async () => { await carrierEldDisconnect('generic'); paint(); } }, 'Disconnect'),
        ]),
      ]);
    };

    mount(host, [head(),
      active.length ? h('div', { style: 'display:flex;flex-direction:column;gap:6px;margin-bottom:10px' }, active.map((r) => h('div', null, [h('div', { class: 'cp-row-t', style: 'font-size:.8rem;margin-bottom:3px' }, STEPS[r.provider] ? STEPS[r.provider].label : r.provider), statusLine(r),
        r.provider !== 'generic' ? h('button', { class: 'cp-link', style: 'margin-top:4px', onClick: async () => { if (!confirm('Disconnect ' + STEPS[r.provider].label + '? LoadBoot stops polling and forgets the token.')) return; await carrierEldDisconnect(r.provider); toast('Disconnected.', 'action', STEPS[r.provider].label); paint(); } }, 'Disconnect') : null]))) : h('div', { class: 'cp-row-s', style: 'margin-bottom:10px;line-height:1.6' }, 'Connect your ELD once and LoadBoot reads truck positions and each driver’s remaining drive time every 5 minutes — your trips track themselves with the app closed, and your dispatcher plans from real hours instead of asking.'),
      h('div', { style: 'border-top:1px solid rgba(255,255,255,.08);padding-top:10px' }, [
        h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px' }, [h('span', { class: 'cp-row-t', style: 'font-size:.85rem' }, 'Provider'), provSel]),
        h('div', { class: 'cp-row-s', style: 'margin-bottom:6px' }, [icon('shield', 13), ' ', S.who]),
        h('ol', { style: 'margin:0 0 10px;padding-left:20px;line-height:1.7;font-size:.86rem;color:#c9d4e5' }, S.steps.map((s) => h('li', null, s))),
        prov === 'generic' ? webhookBox() : h('div', null, [
          h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [tokIn, eye, connectBtn]),
          mine && mine.status === 'active' && mine.has_api_token ? h('div', { class: 'cp-muted', style: 'margin-top:4px;font-size:.78rem' }, 'Pasting a new token replaces the saved one after it passes the test.') : null,
          result,
          h('div', { class: 'cp-muted', style: 'margin-top:8px;font-size:.76rem;line-height:1.5' }, 'Read-only. LoadBoot never changes anything in your ELD, never shares the token, and you can disconnect any time. Renting a truck? The ELD inside a rental belongs to the rental company — use your own account, or skip this and keep your dispatcher updated in the group.'),
        ]),
      ]),
    ]);
  }
  await paint();
}

export default mountEldCard;
