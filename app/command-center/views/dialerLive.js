// dialerLive.js — CC "Phones & live calls" (bl_dial_0351): the control-room view of the dispatcher dialer.
//   · LIVE wallboard — who is on the phone right now, with whom, about what, for how long (polls 4 s while visible)
//   · NUMBERS — the pool of Telnyx numbers LoadBoot owns (bl_dial_0456): add every bought number once, then assign from the pool
//   · LINES — one dedicated US number per dispatcher: assign / change / release, online state, today's scorecard
//   · CALL LOG — every call LoadBoot owns: filter by dispatcher / direction / result / text, play the recording
//   · SETTINGS — master switch, Telnyx connection id, recording + beep notice, ring timeout, missed-call fallback
// Staff-gated by the RPCs themselves (cc_dialer_*). Self-contained scoped styles (dl-): a dark wallboard that reads
// the same in the light and dark CC themes. No alert/confirm/prompt.
import { el, mount } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { sectionHead, openDrawer, askConfirm } from '../../shared/ui/components.js';
import { ccDialerOverview, ccDialerCalls, ccDialerLineUpsert, ccDialerLineRelease, ccDialerNumbers, ccDialerNumberAdd, ccDialerNumberRemove, ccDialerConfigSet, dialerRecordingBlob, ccDialerSms } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { getClient } from '../../shared/supabaseClient.js';

const ET = 'America/New_York';
const digits = (s) => String(s || '').replace(/[^0-9]/g, '');
const pretty = (n) => { const d = digits(n); const k = d.length === 11 && d[0] === '1' ? d.slice(1) : d; return k.length === 10 ? '(' + k.slice(0, 3) + ') ' + k.slice(3, 6) + '-' + k.slice(6) : String(n || '—'); };
const mmss = (s) => { s = Math.max(0, Math.round(Number(s || 0))); const m = Math.floor(s / 60); return (m >= 60 ? Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') : String(m)) + ':' + String(s % 60).padStart(2, '0'); };
const talk = (s) => { s = Number(s || 0); if (s < 60) return s + 's'; const m = Math.round(s / 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; };
const et = (v) => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString('en-US', { timeZone: ET, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'; };
const STAT = { dialing: ['Dialing', 'b'], ringing: ['Ringing', 'a'], active: ['On call', 'g'], ended: ['Connected', 'g'], missed: ['Missed', 'r'], voicemail: ['Voicemail', 'a'], forwarded: ['To Riley', 'a'], busy: ['Busy', 'm'], no_answer: ['No answer', 'm'], canceled: ['Canceled', 'm'], failed: ['Failed', 'r'] };

const CSS = `
.dl{--n:#10223B;--b:#0883F7;--o:#FC5305;--g:#22c55e;--r:#ef4444;--a:#f59e0b;--tx:#e8eefc;--mu:#93a4c3;--ln:rgba(255,255,255,.09)}
.dl-board{border-radius:18px;padding:18px;color:var(--tx);background:linear-gradient(160deg,#12284a,#0b1830 55%,#08111f);box-shadow:0 18px 50px rgba(8,20,45,.25);margin-bottom:16px}
.dl-board h3{margin:0 0 12px;font-size:13px;letter-spacing:1.4px;text-transform:uppercase;color:var(--mu);display:flex;align-items:center;gap:8px}
.dl-pulse{width:9px;height:9px;border-radius:50%;background:var(--g,#22c55e);box-shadow:0 0 0 0 rgba(34,197,94,.6);animation:dlp 1.6s infinite}
@keyframes dlp{70%{box-shadow:0 0 0 10px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}
.dl-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:14px}
.dl-kpi{background:rgba(255,255,255,.05);border:1px solid var(--ln);border-radius:14px;padding:12px 14px}
.dl-kpi b{display:block;font-size:24px;font-weight:700;color:#fff;font-variant-numeric:tabular-nums}.dl-kpi span{font-size:11px;color:var(--mu);text-transform:uppercase;letter-spacing:.8px}
.dl-live{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
.dl-lc{border-radius:14px;padding:13px 14px;background:rgba(255,255,255,.05);border:1px solid var(--ln);border-left:3px solid var(--b)}
.dl-lc.active{border-left-color:var(--g,#22c55e)}.dl-lc.ringing,.dl-lc.voicemail{border-left-color:var(--a,#f59e0b)}
.dl-lc .top{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--mu)}
.dl-lc .who{font-size:15px;font-weight:700;color:#fff;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dl-lc .sub{font-size:12.5px;color:var(--mu);margin-top:1px}
.dl-lc .t{font-size:20px;font-weight:700;margin-top:8px;font-variant-numeric:tabular-nums;color:#cfe3ff}
.dl-none{color:var(--mu);font-size:13.5px;padding:8px 2px}
.dl-card{background:var(--card,#fff);border:1px solid var(--line,#e5e9f2);border-radius:16px;padding:16px;margin-bottom:16px}
.dl-card h3{margin:0 0 4px;font-size:16px}.dl-card .hint{color:var(--mut,#64748b);font-size:13px;margin:0 0 12px}
.dl-tw{overflow:auto}
.dl-t{width:100%;border-collapse:collapse;font-size:13.5px}
.dl-t th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:var(--mut,#64748b);padding:8px 10px;border-bottom:1px solid var(--line,#e5e9f2);white-space:nowrap}
.dl-t td{padding:10px;border-bottom:1px solid var(--line,#eef1f6);vertical-align:middle}
.dl-t tr:last-child td{border-bottom:0}
.dl-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#94a3b8;margin-right:6px}.dl-dot.on{background:var(--g,#22c55e);box-shadow:0 0 6px rgba(34,197,94,.7)}
.dl-pill{display:inline-block;font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px;white-space:nowrap}
.dl-pill.g{background:rgba(34,197,94,.14);color:#15803d}.dl-pill.r{background:rgba(239,68,68,.13);color:#b91c1c}.dl-pill.a{background:rgba(245,158,11,.16);color:#b45309}.dl-pill.b{background:rgba(8,131,247,.13);color:#0369a1}.dl-pill.m{background:rgba(100,116,139,.15);color:#475569}
.dl-btn{border:1px solid var(--line,#d8dee9);background:var(--card,#fff);color:inherit;border-radius:10px;padding:8px 13px;font:inherit;font-weight:600;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
.dl-btn:hover{filter:brightness(.97)}.dl-btn.p{background:var(--b,#0883F7);border-color:var(--b,#0883F7);color:#fff}.dl-btn.o{background:var(--o,#FC5305);border-color:var(--o,#FC5305);color:#fff}.dl-btn.sm{padding:5px 10px;font-size:12.5px}.dl-btn[disabled]{opacity:.5;cursor:not-allowed}
.dl-filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.dl-in{border:1px solid var(--line,#d8dee9);background:var(--card,#fff);color:inherit;border-radius:10px;padding:8px 11px;font:inherit;min-width:0}
.dl-form{display:grid;gap:12px}.dl-form label{display:grid;gap:5px;font-size:12.5px;font-weight:600}.dl-form .row{display:flex;align-items:center;gap:10px;font-weight:600;font-size:14px}
.dl-form small{font-weight:400;color:var(--mut,#64748b)}
.dl-warn{border-radius:14px;padding:13px 15px;margin-bottom:16px;background:rgba(252,83,5,.09);border:1px solid rgba(252,83,5,.3);font-size:13.5px}
.dl-warn b{display:block;margin-bottom:3px}
@media (max-width:640px){.dl-board{padding:14px;border-radius:14px}.dl-kpi b{font-size:20px}}
@media (prefers-reduced-motion:reduce){.dl-pulse{animation:none}}
`;

export async function renderDialerLive(host) {
  if (!document.getElementById('dl-css')) { const s = document.createElement('style'); s.id = 'dl-css'; s.textContent = CSS; document.head.appendChild(s); }
  const root = el('div', { class: 'dl' });
  const boardEl = el('div'), warnEl = el('div'), numsEl = el('div'), linesEl = el('div'), logEl = el('div'), smsEl = el('div');
  mount(host, root);
  let ov = null, nums = [], rows = [], timer = null, tick = null, busy = false;
  const F = { dispatcher: '', direction: '', status: '', q: '', days: '7' };

  root.append(
    sectionHead('Phones & live calls', 'Every dispatcher has one dedicated US number. Every call they make or receive is recorded here — live.',
      [el('button', { class: 'dl-btn', onClick: () => settings() }, [icon('cog', 16), 'Phone settings'])]),
    warnEl, boardEl, numsEl, linesEl, logEl, smsEl);

  let terms = null;
  async function setTermsGate(on) {
    try { const sb = await getClient(); const r = await sb.rpc('cc_dialer_terms_required', { p_required: !!on }); if (r.error || !r.data || r.data.error) throw new Error((r.data && r.data.error) || (r.error && r.error.message) || 'failed'); toast(on ? 'Phone Terms gate is ON — a line connects only after the dispatcher accepts.' : 'Phone Terms gate is OFF.'); load(true); } catch (e) { toast(humanizeError(e)); }
  }
  async function load(quiet) {
    if (busy) return; busy = true;
    try {
      const r = await ccDialerOverview();
      if (r && r.error) throw new Error(r.error);
      ov = r;
      // bl_dial_0362: Phone Terms acceptance per dispatcher (current version) + whether the gate is enforced
      try { const sb = await getClient(); const t = await sb.rpc('cc_dialer_terms_status'); if (t.data && t.data.ok) terms = t.data; } catch (_) {}
      // bl_dial_0456: the number pool
      try { const n = await ccDialerNumbers(); nums = (n && n.rows) || []; } catch (_) { nums = []; }
      paintWarn(); paintBoard(); paintNumbers(); paintLines();
    } catch (e) { if (!quiet) mount(boardEl, el('div', { class: 'dl-card' }, humanizeError(e))); }
    busy = false;
  }
  async function loadLog() {
    try { const r = await ccDialerCalls({ dispatcher: F.dispatcher, direction: F.direction, status: F.status, q: F.q, days: F.days, limit: 100 }); if (r && r.error) throw new Error(r.error); rows = r.rows || []; }
    catch (e) { rows = []; toast(humanizeError(e), 'error'); }
    paintLog(); loadSms();
  }

  // ---- text messages log (bl_dial_0352): every text a dispatcher sent or received, newest first
  let smsRows = [], smsQ = '', smsT = null;
  async function loadSms() {
    try { const r = await ccDialerSms({ dispatcher: F.dispatcher, q: smsQ, limit: 100 }); if (r && r.error) throw new Error(r.error); smsRows = (r && r.messages) || []; }
    catch (e) { smsRows = []; }
    paintSms();
  }
  function paintSms() {
    const SS = { queued: ['sending', 'a'], sent: ['sent', 'b'], delivered: ['delivered', 'g'], failed: ['not sent', 'r'], received: ['received', 'm'] };
    const keep = document.activeElement && document.activeElement.id === 'dl-smsq';
    mount(smsEl, el('div', { class: 'dl-card', style: 'margin-top:14px' }, [
      el('div', { class: 'dl-filters' }, [
        el('b', { style: 'align-self:center;margin-right:6px' }, 'Text messages'),
        el('input', { class: 'dl-in', id: 'dl-smsq', type: 'search', placeholder: 'Search number, name or text', 'aria-label': 'Search texts', value: smsQ, style: 'flex:1;min-width:180px', onInput: (e) => { smsQ = e.target.value; clearTimeout(smsT); smsT = setTimeout(loadSms, 350); } }),
      ]),
      smsRows.length ? el('div', { style: 'overflow-x:auto' }, el('table', { class: 'dl-tbl' }, [
        el('thead', null, el('tr', null, ['When', 'Dispatcher', '', 'Who', 'Message', 'Status'].map((x) => el('th', null, x)))),
        el('tbody', null, smsRows.map((m) => { const st = SS[m.status] || [m.status, 'm']; return el('tr', null, [
          el('td', { style: 'white-space:nowrap' }, et(m.at)), el('td', null, m.dispatcher || '—'), el('td', { title: m.direction }, m.direction === 'inbound' ? '↙' : '↗'),
          el('td', null, [el('b', null, m.contact_name || pretty(m.number)), el('div', { style: 'font-size:12px;opacity:.7' }, [m.contact_name ? pretty(m.number) : '', m.contact_kind ? ' · ' + m.contact_kind : ''].join(''))]),
          el('td', { style: 'max-width:420px;white-space:pre-wrap' }, m.body || (m.media ? '[picture]' : '')),
          el('td', null, [el('span', { class: 'dl-pill ' + st[1] }, st[0]), m.error ? el('div', { style: 'font-size:12px;opacity:.75;max-width:220px' }, m.error) : null]),
        ]); })),
      ])) : el('div', { style: 'opacity:.7;padding:8px 0' }, smsQ ? 'No texts match that search.' : 'No text messages yet.'),
    ]));
    if (keep) { const i = smsEl.querySelector('#dl-smsq'); if (i) { i.focus(); try { i.setSelectionRange(i.value.length, i.value.length); } catch (_) {} } }
  }

  function paintWarn() {
    const c = ov.config || {}; const msgs = [];
    if (!c.telnyx_connection_id) msgs.push('The Telnyx WebRTC connection id is not set — dispatchers cannot get a phone token yet. Open Phone settings.');
    if (!c.enabled) msgs.push('The dialer is switched OFF. Dispatchers do not see the phone until you switch it on in Phone settings.');
    if (c.enabled && !(ov.dispatchers || []).some((d) => d.number)) msgs.push(nums.length ? 'No dispatcher has a number yet. Use “Assign” next to a free number below.' : 'No numbers yet. Buy a number in Telnyx, then click “Add number” below.');
    mount(warnEl, msgs.length ? el('div', { class: 'dl-warn' }, [el('b', null, 'Setup is not finished'), msgs.map((m) => el('div', null, '• ' + m))]) : null);
  }
  function paintBoard() {
    const live = ov.live || [], ds = ov.dispatchers || [];
    const sum = (k) => ds.reduce((a, d) => a + Number(d[k] || 0), 0);
    const kp = [[live.filter((c) => c.status === 'active').length, 'On a call now'], [ds.filter((d) => d.online).length + ' / ' + ds.filter((d) => d.number).length, 'Phones online'], [sum('calls'), 'Calls today'], [sum('connected'), 'Connected'], [talk(sum('talk_sec')), 'Talk time'], [sum('missed'), 'Missed'], [sum('open_callbacks'), 'Callbacks open']];
    mount(boardEl, el('div', { class: 'dl-board' }, [
      el('h3', null, [el('i', { class: 'dl-pulse' }), 'Live — US Eastern ', new Date().toLocaleTimeString('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' })]),
      el('div', { class: 'dl-kpis' }, kp.map(([v, l]) => el('div', { class: 'dl-kpi' }, [el('b', null, String(v)), el('span', null, l)]))),
      live.length ? el('div', { class: 'dl-live' }, live.map((c) => {
        const since = c.answered_at || c.started_at;
        return el('div', { class: 'dl-lc ' + c.status }, [
          el('div', { class: 'top' }, [el('span', null, c.dispatcher || 'Dispatcher'), el('span', null, (c.direction === 'inbound' ? '↙ incoming · ' : '↗ outgoing · ') + (STAT[c.status] || [c.status])[0])]),
          el('div', { class: 'who' }, c.contact_name || pretty(c.number)),
          el('div', { class: 'sub' }, [c.contact_name ? pretty(c.number) + ' · ' : '', 'line ' + pretty(c.line)]),
          el('div', { class: 't', 'data-since': since }, mmss((Date.now() - new Date(since).getTime()) / 1000)),
        ]);
      })) : el('div', { class: 'dl-none' }, 'No one is on the phone right now.'),
    ]));
  }
  // bl_dial_0456 — every Telnyx number LoadBoot owns. Free numbers first; a held number shows its dispatcher.
  function paintNumbers() {
    const free = nums.filter((n) => !n.line_id);
    mount(numsEl, el('div', { class: 'dl-card' }, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap' }, [
        el('h3', null, 'LoadBoot numbers'),
        el('button', { class: 'dl-btn p sm', onClick: () => addNumber(null) }, [icon('plus', 14), 'Add number']),
      ]),
      el('p', { class: 'hint' }, 'Every number bought in Telnyx goes in here once. Each dispatcher gets one dedicated number from this pool — assign it from the row, or from “Assign number” in the lines table. ' + (nums.length ? free.length + ' free of ' + nums.length + '.' : '')),
      nums.length ? el('div', { class: 'dl-tw' }, el('table', { class: 'dl-t' }, [
        el('thead', null, el('tr', null, ['Number', 'Label', 'Telnyx id', 'SMS', 'Held by', 'Calls', ''].map((x) => el('th', null, x)))),
        el('tbody', null, nums.map((n) => el('tr', null, [
          el('td', null, [el('b', null, pretty(n.number)), n.note ? el('div', { style: 'font-size:12px;opacity:.7' }, n.note) : null]),
          el('td', null, n.label || '—'),
          el('td', null, el('span', { style: 'font-size:12px;opacity:.75;font-family:monospace' }, n.telnyx_number_id || '—')),
          el('td', null, n.sms_ready ? el('span', { class: 'dl-pill g' }, 'ready') : el('span', { class: 'dl-pill m', title: 'Attach the number to the 10DLC campaign + messaging profile in Telnyx, then tick “SMS ready” in Edit' }, 'not yet')),
          el('td', null, n.line_id ? [el('i', { class: 'dl-dot' + (n.online ? ' on' : '') }), el('b', null, n.assigned_to || '—'), el('div', { style: 'font-size:12px;opacity:.7' }, n.assigned_status || '')]
            : [el('span', { class: 'dl-pill b' }, 'free'), n.last_holder ? el('div', { style: 'font-size:12px;opacity:.7' }, 'was ' + n.last_holder) : null]),
          el('td', null, String(n.calls_total || 0)),
          el('td', { style: 'text-align:right;white-space:nowrap' }, [
            el('button', { class: 'dl-btn sm', onClick: () => addNumber(n) }, 'Edit'), ' ',
            n.line_id ? el('button', { class: 'dl-btn sm', onClick: () => { const d = (ov.dispatchers || []).find((x) => x.user_id === n.assigned_user_id); if (d) release(d); } }, 'Release')
              : [el('button', { class: 'dl-btn sm p', onClick: () => assignFromPool(n) }, 'Assign'), ' ', el('button', { class: 'dl-btn sm', 'aria-label': 'Remove ' + pretty(n.number) + ' from the pool', onClick: () => removeNumber(n) }, 'Remove')],
          ]),
        ]))),
      ])) : el('div', { style: 'opacity:.7' }, 'No numbers yet. Buy one in Telnyx (Numbers → Buy numbers), attach it to the LoadBoot Voice-API application, then add it here.'),
    ]));
  }
  // add a bought number to the pool, or edit one (n = existing row)
  function addNumber(n) {
    const num = el('input', { class: 'dl-in', type: 'tel', placeholder: '+1 469 457 9556', value: (n && n.number) || '' });
    const label = el('input', { class: 'dl-in', placeholder: 'e.g. Dallas 469', value: (n && n.label) || '' });
    const tid = el('input', { class: 'dl-in', placeholder: 'optional — Telnyx number id', value: (n && n.telnyx_number_id) || '' });
    const note = el('input', { class: 'dl-in', placeholder: 'optional — e.g. bought 26 Sep for Aziz', value: (n && n.note) || '' });
    const sms = el('input', { type: 'checkbox', checked: !!(n && n.sms_ready) });
    const err = el('div', { style: 'color:#b91c1c;font-size:13px' });
    const save = el('button', { class: 'dl-btn p', onClick: async () => {
      save.disabled = true; err.textContent = '';
      try { const r = await ccDialerNumberAdd({ id: n ? n.id : '', number: num.value, label: label.value, telnyx_number_id: tid.value, note: note.value, sms_ready: sms.checked }); if (r && r.error) throw new Error(r.error); dr.close(); toast(pretty(r.number) + (r.new ? ' added to the pool' : ' updated')); await load(); }
      catch (e) { err.textContent = humanizeError(e); save.disabled = false; }
    } }, n ? 'Save' : 'Add number');
    const dr = openDrawer(n ? 'Edit number — ' + pretty(n.number) : 'Add a LoadBoot number', el('div', { class: 'dl-form' }, [
      el('div', { class: 'dl-warn' }, [el('b', null, 'Before you save'), 'The number must already be bought in your Telnyx account and attached to the LoadBoot Voice-API application (inbound calls) — see docs/DIALER-SETUP.md. For texts it must also be on the 10DLC campaign and the messaging profile. Adding it here only registers it in LoadBoot — it does not assign it to anyone yet.']),
      el('label', null, ['US number', num]), el('label', null, ['Label', label]), el('label', null, ['Telnyx number id', tid]), el('label', null, ['Note', note]),
      el('label', { class: 'row' }, [sms, el('span', null, ['SMS ready ', el('small', null, '— tick once the number is attached to the 10DLC campaign and the messaging profile in Telnyx')])]),
      err, save,
    ]));
  }
  async function removeNumber(n) {
    const ok = await askConfirm('Remove ' + pretty(n.number) + ' from the pool?', { body: 'Only the LoadBoot list changes — the number stays in your Telnyx account until you release it there. Call history stays.', confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    try { const r = await ccDialerNumberRemove(n.id); if (r && r.error) throw new Error(r.error); toast('Removed from the pool'); await load(); } catch (e) { toast(humanizeError(e), 'error'); }
  }
  // give a free pool number to a dispatcher (forward-to-mobile is left as it is)
  function assignFromPool(n) {
    const ds = (ov.dispatchers || []);
    if (!ds.length) { toast('No dispatchers in trial, verified or active yet.', 'error'); return; }
    const who = el('select', { class: 'dl-in' }, ds.map((d) => el('option', { value: d.user_id }, (d.name || '—') + ' · ' + d.status + (d.number ? ' · now ' + pretty(d.number) : ' · no line'))));
    const firstFree = ds.find((d) => !d.number); if (firstFree) who.value = firstFree.user_id;
    const err = el('div', { style: 'color:#b91c1c;font-size:13px' });
    const save = el('button', { class: 'dl-btn p', onClick: async () => {
      save.disabled = true; err.textContent = '';
      const d = ds.find((x) => x.user_id === who.value);
      try { const r = await ccDialerLineUpsert({ dispatcher_user_id: who.value, number: n.number, label: n.label || '', telnyx_number_id: n.telnyx_number_id || '' }); if (r && r.error) throw new Error(r.error); dr.close(); toast('Line ' + pretty(r.number) + ' assigned to ' + (d ? d.name : 'dispatcher')); await load(); }
      catch (e) { err.textContent = humanizeError(e); save.disabled = false; }
    } }, 'Assign line');
    const dr = openDrawer('Assign ' + pretty(n.number), el('div', { class: 'dl-form' }, [
      el('label', null, ['Dispatcher', who, el('small', null, 'A dispatcher who already has a line gets this one instead — the old number is released back to the pool and the dispatcher is e-mailed the change.')]),
      err, save,
    ]));
  }
  function paintLines() {
    const ds = ov.dispatchers || [];
    mount(linesEl, el('div', { class: 'dl-card' }, [
      el('h3', null, 'Dispatcher lines & today’s scorecard'),
      el('p', { class: 'hint' }, 'One number per dispatcher. The number belongs to LoadBoot — if a dispatcher leaves, release the line and the brokers’ callbacks stay with you.'),
      terms ? el('p', { class: 'hint', style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, ['Phone Terms v' + terms.version + ' — gate is ', el('b', null, terms.required ? 'ON' : 'OFF'), terms.required ? ' (a line connects only after the dispatcher accepts)' : ' (dispatchers are not asked yet)', el('button', { class: 'dl-btn sm', onClick: () => setTermsGate(!terms.required) }, terms.required ? 'Switch off' : 'Switch on')]) : null,
      ds.length ? el('div', { class: 'dl-tw' }, el('table', { class: 'dl-t' }, [
        el('thead', null, el('tr', null, ['Dispatcher', 'Number', 'Phone', 'Calls', 'Connected', 'Talk', 'Missed', 'Untagged', 'Callbacks', ''].map((x) => el('th', null, x)))),
        el('tbody', null, ds.map((d) => el('tr', null, [
          el('td', null, [el('b', null, d.name || '—'), el('div', { style: 'font-size:12px;opacity:.7' }, d.status), terms && d.number ? el('div', { style: 'font-size:12px;color:' + (terms.accepted[d.user_id] ? '#4ade80' : '#fbbf24') }, terms.accepted[d.user_id] ? 'Terms accepted: ' + new Date(terms.accepted[d.user_id]).toLocaleDateString() : 'Terms not accepted yet') : null]),
          el('td', null, d.number ? [el('b', null, pretty(d.number)), (d.label || d.forward_number) ? el('div', { style: 'font-size:12px;opacity:.7' }, [d.label || '', d.forward_number ? (d.label ? ' · ' : '') + '→ mobile ' + d.forward_number : '']) : null] : el('span', { class: 'dl-pill m' }, 'no line')),
          el('td', null, d.number ? [el('i', { class: 'dl-dot' + (d.online ? ' on' : '') }), d.online ? 'Online' : (d.ready ? 'Offline' : 'Never connected')] : '—'),
          el('td', null, String(d.calls || 0)), el('td', null, String(d.connected || 0) + (d.calls ? ' (' + Math.round(100 * d.connected / d.calls) + '%)' : '')), el('td', null, talk(d.talk_sec)),
          el('td', null, d.missed ? el('span', { class: 'dl-pill r' }, String(d.missed)) : '0'), el('td', null, d.untagged ? el('span', { class: 'dl-pill a' }, String(d.untagged)) : '0'), el('td', null, String(d.open_callbacks || 0)),
          el('td', { style: 'text-align:right;white-space:nowrap' }, [
            el('button', { class: 'dl-btn sm', onClick: () => { F.dispatcher = d.user_id; loadLog(); logEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, 'Calls'), ' ',
            el('button', { class: 'dl-btn sm ' + (d.number ? '' : 'p'), onClick: () => assign(d) }, d.number ? 'Change' : 'Assign number'),
            d.line_id ? [' ', el('button', { class: 'dl-btn sm', 'aria-label': 'Release line of ' + d.name, onClick: () => release(d) }, 'Release')] : null,
          ]),
        ]))),
      ])) : el('div', { style: 'opacity:.7' }, 'No dispatchers in trial, verified or active yet.'),
    ]));
  }
  function paintLog() {
    const ds = (ov && ov.dispatchers) || [];
    const sel = (key, opts) => el('select', { class: 'dl-in', 'aria-label': key, onChange: (e) => { F[key] = e.target.value; loadLog(); } }, opts.map(([v, l]) => el('option', { value: v, selected: F[key] === v }, l)));
    let qt = null;
    mount(logEl, el('div', { class: 'dl-card' }, [
      el('h3', null, 'Call log'),
      el('div', { class: 'dl-filters' }, [
        sel('dispatcher', [['', 'All dispatchers']].concat(ds.map((d) => [d.user_id, d.name || d.user_id]))),
        sel('direction', [['', 'In + out'], ['outbound', 'Outgoing'], ['inbound', 'Incoming']]),
        sel('status', [['', 'Any result'], ['connected', 'Connected'], ['missed', 'Missed / voicemail'], ['no_answer', 'No answer'], ['busy', 'Busy'], ['failed', 'Failed']]),
        sel('days', [['1', 'Last 24 h'], ['7', '7 days'], ['30', '30 days'], ['', 'All time']]),
        el('input', { class: 'dl-in', type: 'search', placeholder: 'Search broker, number, note', 'aria-label': 'Search calls', value: F.q, style: 'flex:1;min-width:180px', onInput: (e) => { F.q = e.target.value; clearTimeout(qt); qt = setTimeout(async () => { await loadLog(); const i = logEl.querySelector('input[type=search]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 400); } }),
      ]),
      rows.length ? el('div', { class: 'dl-tw' }, el('table', { class: 'dl-t' }, [
        el('thead', null, el('tr', null, ['When', 'Dispatcher', '', 'Who', 'Result', 'Talk', 'Outcome', 'Note', ''].map((x) => el('th', null, x)))),
        el('tbody', null, rows.map((c) => { const s = STAT[c.status] || [c.status, 'm']; return el('tr', null, [
          el('td', { style: 'white-space:nowrap' }, et(c.started_at)), el('td', null, c.dispatcher || '—'), el('td', { title: c.direction }, c.direction === 'inbound' ? '↙' : '↗'),
          el('td', null, [el('b', null, c.contact_name || pretty(c.number)), el('div', { style: 'font-size:12px;opacity:.7' }, [c.contact_name ? pretty(c.number) + ' ' : '', c.contact_kind ? el('span', { class: 'dl-pill ' + (c.contact_kind === 'broker' ? 'b' : 'g') }, c.contact_kind) : null])]),
          el('td', null, el('span', { class: 'dl-pill ' + s[1] }, s[0])), el('td', null, c.duration_sec ? mmss(c.duration_sec) : '—'),
          el('td', null, c.outcome ? el('span', { class: 'dl-pill b' }, c.outcome) : (c.answered_at ? el('span', { class: 'dl-pill a' }, 'untagged') : '—')),
          el('td', { style: 'max-width:280px' }, c.note || ''),
          el('td', null, c.has_recording ? el('button', { class: 'dl-btn sm', 'data-rec': c.id, 'aria-label': isPlaying(c.id) ? 'Pause recording' : 'Play recording', onClick: (e) => play(c.id, e.currentTarget) }, [icon(isPlaying(c.id) ? 'pause' : 'play', 14), isPlaying(c.id) ? 'Pause' : 'Play']) : null),
        ]); })),
      ])) : el('div', { style: 'opacity:.7;padding:8px 0' }, 'No calls match these filters.'),
    ]));
  }

  let playing = null;
  const isPlaying = (id) => !!(playing && playing.id === id && !playing.a.paused);
  function stopPlaying() { if (!playing) return; try { playing.a.pause(); URL.revokeObjectURL(playing.u); } catch (_) {} playing = null; }
  function syncPlayBtns() {
    root.querySelectorAll('[data-rec]').forEach((b) => { const on = isPlaying(b.getAttribute('data-rec')); b.setAttribute('aria-label', on ? 'Pause recording' : 'Play recording'); mount(b, [icon(on ? 'pause' : 'play', 14), on ? 'Pause' : 'Play']); });
  }
  // one recording at a time: the same row toggles pause / resume, another row stops the first and starts its own
  async function play(id, btn) {
    if (playing && playing.id === id) { try { if (playing.a.paused) await playing.a.play(); else playing.a.pause(); } catch (_) {} syncPlayBtns(); return; }
    stopPlaying(); syncPlayBtns();
    try {
      btn.disabled = true; const blob = await dialerRecordingBlob(id); stopPlaying();
      const u = URL.createObjectURL(blob); const a = new Audio(u); playing = { a, u, id };
      a.onended = () => { try { URL.revokeObjectURL(u); } catch (_) {} if (playing && playing.a === a) playing = null; syncPlayBtns(); };
      await a.play();
    } catch (e) { toast(humanizeError(e), 'error'); } finally { btn.disabled = false; syncPlayBtns(); }
  }

  function assign(d) {
    const num = el('input', { class: 'dl-in', type: 'tel', placeholder: '+1 469 555 0100', value: d.number || '' });
    const label = el('input', { class: 'dl-in', placeholder: 'e.g. Dallas 469', value: d.label || '' });
    const tid = el('input', { class: 'dl-in', placeholder: 'optional — Telnyx number id' });
    // bl_dial_0456: pick a free number from the pool (or keep typing a new one — it is added to the pool on save)
    const free = nums.filter((n) => !n.line_id || n.assigned_user_id === d.user_id);
    const pick = free.length ? el('select', { class: 'dl-in', onChange: () => { const n = free.find((x) => x.id === pick.value); if (n) { num.value = n.number; label.value = n.label || ''; tid.value = n.telnyx_number_id || ''; } } }, [
      el('option', { value: '' }, '— type a number below —'),
      free.map((n) => el('option', { value: n.id, selected: n.number === d.number }, pretty(n.number) + (n.label ? ' · ' + n.label : '') + (n.line_id ? ' · current' : ' · free'))),
    ]) : null;
    const fwd = el('input', { class: 'dl-in', type: 'tel', placeholder: 'optional — e.g. +92 300 1234567', value: d.forward_number || '' });
    const err = el('div', { style: 'color:#b91c1c;font-size:13px' });
    const save = el('button', { class: 'dl-btn p', onClick: async () => {
      save.disabled = true; err.textContent = '';
      try { const r = await ccDialerLineUpsert({ dispatcher_user_id: d.user_id, number: num.value, label: label.value, telnyx_number_id: tid.value, forward_number: fwd.value }); if (r && r.error) throw new Error(r.error); dr.close(); toast('Line ' + pretty(r.number) + ' assigned to ' + d.name); await load(); }
      catch (e) { err.textContent = humanizeError(e); save.disabled = false; }
    } }, 'Save line');
    const dr = openDrawer((d.number ? 'Change number — ' : 'Assign number — ') + (d.name || ''), el('div', { class: 'dl-form' }, [
      el('div', { class: 'dl-warn' }, [el('b', null, 'Before you save'), 'The number must already be bought in your Telnyx account and attached to the LoadBoot Voice-API application (inbound calls) — see docs/DIALER-SETUP.md. Saving here only tells LoadBoot which dispatcher owns it.']),
      pick ? el('label', null, ['From the number pool', pick]) : null,
      el('label', null, ['US number', num]), el('label', null, ['Label', label]), el('label', null, ['Telnyx number id', tid]),
      el('label', null, ['Forward unanswered calls to the dispatcher’s mobile', fwd, el('small', null, 'If the portal is closed or nobody answers in the browser, the call rings this phone next (works with the screen locked), then goes to Riley / voicemail. Full number with country code. A non-US number is billed at Telnyx’s international per-minute rate and its country must be allowed on the Telnyx outbound voice profile. Leave empty to skip.')]), err, save,
    ]));
  }
  async function release(d) {
    const ok = await askConfirm('Release ' + pretty(d.number) + ' from ' + d.name + '?', { body: 'They will not be able to call or receive calls. The call history stays. The number itself stays in your Telnyx account — you can assign it to someone else.', confirmLabel: 'Release line', danger: true });
    if (!ok) return;
    try { const r = await ccDialerLineRelease(d.line_id); if (r && r.error) throw new Error(r.error); toast('Line released'); await load(); } catch (e) { toast(humanizeError(e), 'error'); }
  }
  function settings() {
    const c = (ov && ov.config) || {};
    const chk = (v) => el('input', { type: 'checkbox', checked: !!v });
    const en = chk(c.enabled), rec = chk(c.record_calls), beep = chk(c.recording_notice), intl = chk(c.allow_international);
    const conn = el('input', { class: 'dl-in', value: c.telnyx_connection_id || '', placeholder: 'e.g. 2781234567890123456' });
    const ring = el('input', { class: 'dl-in', type: 'number', min: '5', max: '60', value: String(c.ring_timeout_secs || 25) });
    const fb = el('input', { class: 'dl-in', type: 'tel', value: c.fallback_number || '', placeholder: 'empty = voicemail · or Riley’s number' });
    const vm = el('textarea', { class: 'dl-in', rows: '3' }, c.voicemail_greeting || '');
    const cap = el('input', { class: 'dl-in', type: 'number', min: '1', max: '500', value: String(c.max_calls_per_hour || 60) });
    const sms = chk(c.sms_enabled);
    const mprof = el('input', { class: 'dl-in', value: c.telnyx_messaging_profile_id || '', placeholder: 'optional — Telnyx messaging profile id' });
    const err = el('div', { style: 'color:#b91c1c;font-size:13px' });
    const save = el('button', { class: 'dl-btn p', onClick: async () => {
      save.disabled = true; err.textContent = '';
      try {
        const r = await ccDialerConfigSet({ sms_enabled: sms.checked, telnyx_messaging_profile_id: mprof.value, enabled: en.checked, telnyx_connection_id: conn.value, record_calls: rec.checked, recording_notice: beep.checked, ring_timeout_secs: Number(ring.value) || 25, fallback_number: fb.value, voicemail_greeting: vm.value, max_calls_per_hour: Number(cap.value) || 60, allow_international: intl.checked });
        if (r && r.error) throw new Error(r.error); dr.close(); toast('Phone settings saved'); await load();
      } catch (e) { err.textContent = humanizeError(e); save.disabled = false; }
    } }, 'Save settings');
    const dr = openDrawer('Phone settings', el('div', { class: 'dl-form' }, [
      el('label', { class: 'row' }, [en, el('span', null, ['Dialer switched on ', el('small', null, '— dispatchers see the phone')])]),
      el('label', null, ['Telnyx WebRTC (credential) connection id', conn, el('small', null, 'Telnyx portal → Voice → SIP Connections → the “LoadBoot WebRTC” connection → its id. Not a secret. The API key is NOT entered here — it lives in the Supabase function secrets.')]),
      el('label', { class: 'row' }, [rec, el('span', null, ['Record calls ', el('small', null, '— dual-channel mp3, kept in Telnyx')])]),
      el('label', { class: 'row' }, [beep, el('span', null, ['Play a beep when recording starts ', el('small', null, '— some US states require all parties to know a call is recorded; keep this on unless your lawyer says otherwise')])]),
      el('label', null, ['Ring the dispatcher for (seconds)', ring]),
      el('label', { class: 'row' }, [sms, el('span', null, ['Text messages (SMS) switched on ', el('small', null, '— only after the 10DLC campaign is APPROVED and every dispatcher number is attached to it; before that carriers block the texts')])]),
      el('label', null, ['Telnyx messaging profile id', mprof, el('small', null, 'Telnyx portal → Messaging → Messaging Profiles → “LoadBoot Dispatch” → its id. Not a secret. Its inbound webhook must point to the same telnyx-hook URL as the voice apps.')]),
      el('label', null, ['If the dispatcher does not answer, send the caller to', fb, el('small', null, 'Leave empty for voicemail. Either way the dispatcher gets a callback task.')]),
      el('label', null, ['Voicemail greeting (spoken)', vm]),
      el('label', null, ['Max outgoing calls per dispatcher per hour', cap]),
      el('label', { class: 'row' }, [intl, el('span', null, ['Allow international & Caribbean numbers ', el('small', null, '— off = toll-fraud guard')])]),
      err, save,
    ]), { subtitle: 'Applies to every dispatcher immediately.' });
  }

  await load(); await loadLog();
  timer = setInterval(() => { if (document.visibilityState === 'visible') load(true); }, 4000);
  tick = setInterval(() => { root.querySelectorAll('[data-since]').forEach((n) => { n.textContent = mmss((Date.now() - new Date(n.getAttribute('data-since')).getTime()) / 1000); }); }, 1000);
  const mo = new MutationObserver(() => { if (!document.body.contains(root)) { clearInterval(timer); clearInterval(tick); if (playing) { try { playing.a.pause(); } catch (_) {} } mo.disconnect(); } });
  mo.observe(document.body, { childList: true, subtree: true });
}
export default renderDialerLive;
