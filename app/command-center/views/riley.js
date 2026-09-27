// Command Center → Team → Riley (AI phone) — bl_voice_0458 (26 Sep 2026)
//
// One screen for the AI phone line. Live and recent calls with recording, transcript and the post-call analysis;
// the two prompts (inbound / outbound) edited and PUBLISHED from here; the WhatsApp line → Riley switch; the
// Retell wiring check. Reads are RPCs (cc_riley_*). Anything that touches Retell goes through the staff-gated
// retell-admin edge function (api.rileyAdmin). Polls every 5 s while the tab is visible, like Phones & live calls.
//
// Popups are openDrawer (CLAUDE.md §8). The Riley phone number is never rendered here as a contact (§7).

import { el, mount } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { sectionHead, openDrawer, askConfirm, askReason } from '../../shared/ui/components.js';
import { ccRileyCalls, ccRileySettingsGet, ccRileySettingsSet, ccRileyPromptsGet, ccRileyPromptSave, ccRileyPromptRestore, ccRileyCallbackDone, ccRileyPlans, ccRileyPlan, ccRileyPlanSet, ccRileyPlanBook, ccRileyFollowupAct, rileyAdmin, rileyRecordingBlob } from '../../shared/api.js';
import { PLAN_STATUS, PLAN_REASON_LABEL, NEXT_ACTION } from './rileyPlanFlow.js';   // bl_voice_0483 — call plans (+0485 booking / next step)
import { humanizeError, toast } from '../../shared/errors.js';

const ET = 'America/New_York';
const addTo = (host, ...xs) => host.append(...xs.flat().filter((x) => x != null && x !== false && x !== ''));   // Node.append(null) would print "null"
const LOW_BALANCE_USD = 10;   // bl_voice_0484 — below this the Riley page warns (typed Retell balance)
const digits = (s) => String(s || '').replace(/[^0-9]/g, '');
const pretty = (n) => { const d = digits(n); const k = d.length === 11 && d[0] === '1' ? d.slice(1) : d; return k.length === 10 ? '(' + k.slice(0, 3) + ') ' + k.slice(3, 6) + '-' + k.slice(6) : String(n || '—'); };
const mmss = (s) => { s = Math.max(0, Math.round(Number(s || 0))); const m = Math.floor(s / 60); return String(m) + ':' + String(s % 60).padStart(2, '0'); };
const et = (v) => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString('en-US', { timeZone: ET, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'; };
const ago = (v) => { if (!v) return ''; const s = Math.round((Date.now() - new Date(v).getTime()) / 1000); if (s < 60) return s + 's ago'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' d ago'; };
const STAT = {
  'in-progress': ['On call', 'g'], dialing: ['Ringing…', 'a'], scheduled: ['Scheduled', 'b'], ended: ['Answered', 'g'], analyzed: ['Answered', 'g'],
  'no-answer': ['No answer', 'm'], 'no-result': ['No result', 'm'], cancelled: ['Cancelled', 'm'],
};
const INTEREST = { hot: ['🔥 Hot', 'r'], warm: ['Warm', 'a'], cold: ['Cold', 'm'], not_interested: ['Not interested', 'm'], wrong_number: ['Wrong number', 'm'] };
const ROLE = { carrier: 'Carrier', broker: 'Broker', shipper: 'Shipper', dispatcher: 'Dispatcher', agent: 'Agent' };
const KEYS = { inbound: 'Inbound — answers the line', outbound: 'Outbound — callbacks' };

const CSS = `
.ry{--n:#10223B;--b:#0883F7;--o:#FC5305;--g:#22c55e;--r:#ef4444;--a:#f59e0b;--tx:#e8eefc;--mu:#93a4c3;--ln:rgba(255,255,255,.09)}
.ry-board{border-radius:18px;padding:18px;color:var(--tx);background:linear-gradient(160deg,#12284a,#0b1830 55%,#08111f);box-shadow:0 18px 50px rgba(8,20,45,.25);margin-bottom:16px}
.ry-board h3{margin:0 0 12px;font-size:13px;letter-spacing:1.4px;text-transform:uppercase;color:var(--mu);display:flex;align-items:center;gap:8px}
.ry-pulse{width:9px;height:9px;border-radius:50%;background:var(--g);box-shadow:0 0 0 0 rgba(34,197,94,.6);animation:ryp 1.6s infinite}
@keyframes ryp{70%{box-shadow:0 0 0 10px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}
.ry-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:14px}
.ry-kpi{background:rgba(255,255,255,.05);border:1px solid var(--ln);border-radius:14px;padding:12px 14px}
.ry-kpi b{display:block;font-size:24px;font-weight:700;color:#fff;font-variant-numeric:tabular-nums}.ry-kpi span{font-size:11px;color:var(--mu);text-transform:uppercase;letter-spacing:.8px}
.ry-live{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
.ry-lc{border-radius:14px;padding:13px 14px;background:rgba(255,255,255,.05);border:1px solid var(--ln);border-left:3px solid var(--g);cursor:pointer}
.ry-lc.dialing{border-left-color:var(--a)}
.ry-lc .top{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--mu)}
.ry-lc .who{font-size:15px;font-weight:700;color:#fff;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ry-lc .sub{font-size:12.5px;color:var(--mu);margin-top:1px}
.ry-lc .t{font-size:20px;font-weight:700;margin-top:8px;font-variant-numeric:tabular-nums;color:#cfe3ff}
.ry-none{color:var(--mu);font-size:13.5px;padding:8px 2px}
.ry-card{background:var(--card,#fff);border:1px solid var(--line,#e5e9f2);border-radius:16px;padding:16px;margin-bottom:16px}
.ry-card h3{margin:0 0 4px;font-size:16px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.ry-card .hint{color:var(--mut,#64748b);font-size:13px;margin:0 0 12px}
.ry-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.ry-tab{border:1px solid var(--line,#d8dee9);background:var(--card,#fff);color:inherit;border-radius:999px;padding:7px 14px;font:inherit;font-weight:600;cursor:pointer}
.ry-tab.on{background:var(--n,#10223B);border-color:var(--n,#10223B);color:#fff}
.ry-t{width:100%;border-collapse:collapse;font-size:13.5px}
.ry-t th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:var(--mut,#64748b);padding:8px 10px;border-bottom:1px solid var(--line,#e5e9f2);white-space:nowrap}
.ry-t td{padding:10px;border-bottom:1px solid var(--line,#eef1f6);vertical-align:middle}
.ry-t tr:last-child td{border-bottom:0}.ry-t tr.click{cursor:pointer}.ry-t tr.click:hover td{background:rgba(8,131,247,.05)}
.ry-t tr.hit td{background:rgba(8,131,247,.09)}
.ry-pill{display:inline-block;font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px;white-space:nowrap}
.ry-pill.g{background:rgba(34,197,94,.14);color:#15803d}.ry-pill.r{background:rgba(239,68,68,.13);color:#b91c1c}.ry-pill.a{background:rgba(245,158,11,.16);color:#b45309}.ry-pill.b{background:rgba(8,131,247,.13);color:#0369a1}.ry-pill.m{background:rgba(100,116,139,.15);color:#475569}
.ry-btn{border:1px solid var(--line,#d8dee9);background:var(--card,#fff);color:inherit;border-radius:10px;padding:8px 13px;font:inherit;font-weight:600;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
.ry-btn.done{background:rgba(34,197,94,.12);border-color:rgba(34,197,94,.35);color:#15803d}.ry-btn.done[disabled]{opacity:1;cursor:default}
.ry-btn:hover{filter:brightness(.97)}.ry-btn.p{background:var(--b,#0883F7);border-color:var(--b,#0883F7);color:#fff}.ry-btn.o{background:var(--o,#FC5305);border-color:var(--o,#FC5305);color:#fff}.ry-btn.sm{padding:5px 10px;font-size:12.5px}.ry-btn[disabled]{opacity:.5;cursor:not-allowed}
.ry-filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center}
.ry-in{border:1px solid var(--line,#d8dee9);background:var(--card,#fff);color:inherit;border-radius:10px;padding:8px 11px;font:inherit;min-width:0}
.ry-ta{width:100%;min-height:420px;border:1px solid var(--line,#d8dee9);background:var(--card,#fff);color:inherit;border-radius:12px;padding:12px;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical;box-sizing:border-box}
.ry-warn{border-radius:14px;padding:13px 15px;margin-bottom:16px;background:rgba(252,83,5,.09);border:1px solid rgba(252,83,5,.3);font-size:13.5px}
.ry-warn b{display:block;margin-bottom:3px}
.ry-ok{border-radius:14px;padding:11px 15px;margin-bottom:16px;background:rgba(34,197,94,.09);border:1px solid rgba(34,197,94,.3);font-size:13.5px}
.ry-kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px 14px;font-size:13.5px}
.ry-kv div{padding:8px 10px;border:1px solid var(--line,#eef1f6);border-radius:10px}.ry-kv small{display:block;color:var(--mut,#64748b);font-size:11px;text-transform:uppercase;letter-spacing:.6px}
.ry-tr{white-space:pre-wrap;font-size:13px;line-height:1.55;max-height:50vh;overflow:auto;padding:12px;border-radius:12px;background:rgba(100,116,139,.07)}
.ry-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.ry-play{min-width:96px;justify-content:center;font-variant-numeric:tabular-nums}.ry-play.ld{opacity:.75}.ry-play.on{background:var(--b,#0883F7);border-color:var(--b,#0883F7);color:#fff}.ry-play.ps{border-color:var(--b,#0883F7);color:var(--b,#0883F7)}
.ry-play.ld .cc-ico{animation:ry-spin 1s linear infinite}@keyframes ry-spin{to{transform:rotate(360deg)}}
.ry-sw{display:inline-flex;align-items:center;gap:8px;font-weight:600;cursor:pointer}.ry-sw input{width:18px;height:18px}
@media (max-width:640px){.ry-board{padding:14px;border-radius:14px}.ry-kpi b{font-size:20px}.ry-ta{min-height:300px}}
@media (prefers-reduced-motion:reduce){.ry-pulse{animation:none}}
`;

export async function renderRiley(host, query) {
  if (!document.getElementById('ry-css')) { const s = document.createElement('style'); s.id = 'ry-css'; s.textContent = CSS; document.head.appendChild(s); }
  const root = el('div', { class: 'ry' });
  const warnEl = el('div'), boardEl = el('div'), tabsEl = el('div'), bodyEl = el('div');
  mount(host, root);
  root.append(
    sectionHead('Riley — AI phone line', 'Every call Riley takes or makes, live. Recording, transcript and the lead grade per call. Prompts are edited and published from here.',
      [el('button', { class: 'ry-btn', onClick: () => { loadAll(true); } }, [icon('refresh', 16), 'Refresh'])]),
    warnEl, boardEl, tabsEl, bodyEl);

  let data = { calls: [], wa_legs: [], wa_callbacks: [], stats: {} }, settings = {}, prompts = null, status = null;
  const wanted = (() => { try { return query && query.get ? query.get('tab') : null; } catch (_) { return null; } })();
  let tab = ['calls', 'plans', 'prompts', 'wa', 'settings'].includes(wanted) ? wanted : 'calls', timer = null, tick = null, busy = false, statusBusy = false;
  let plans = null, plansBusy = false;   // bl_voice_0483: CC → Riley → Call plans (cc_riley_plans)
  const PF = { status: '' };
  let focusPlan = (() => { try { return query && query.get ? query.get('id') : null; } catch (_) { return null; } })();
  const F = { q: '', dir: '', days: '30' };
  const can = () => !!settings.can_manage;

  async function loadAll(withStatus) {
    if (busy) return; busy = true;
    try {
      const [c, s] = await Promise.all([ccRileyCalls(200), ccRileySettingsGet()]);
      if (c && c.error) throw new Error(c.error);
      if (s && s.error) throw new Error(s.error);
      data = c; settings = s;
      paintBoard(); paintWarn(); if (tab !== 'plans') paintBody();
    } catch (e) { mount(boardEl, el('div', { class: 'ry-card' }, humanizeError(e))); }
    busy = false;
    if (withStatus) loadStatus();
    if (tab === 'plans') loadPlans();
  }
  async function loadPlans() {
    if (plansBusy) return; plansBusy = true;
    try { const r = await ccRileyPlans(PF.status || null, 150); if (r && r.error) throw new Error(r.error); plans = r; if (tab === 'plans') paintPlans(); }
    catch (e) { if (tab === 'plans') mount(bodyEl, el('div', { class: 'ry-card' }, humanizeError(e))); }
    plansBusy = false;
  }
  async function loadStatus() {
    if (statusBusy) return; statusBusy = true;
    try { status = await rileyAdmin('status'); } catch (e) { status = { error: humanizeError(e) }; }
    statusBusy = false; paintWarn(); if (tab === 'settings') paintBody();
  }
  async function loadPrompts() {
    try { const p = await ccRileyPromptsGet(); if (p && p.error) throw new Error(p.error); prompts = p; }
    catch (e) { toast(humanizeError(e), 'error'); }
  }

  // ---------- warnings: the things that silently break the line
  function paintWarn() {
    const m = [];
    if (!settings.retell_key_set) m.push('Retell is not configured on this environment (no API key in retell_config).');
    if (settings.retell_balance_usd != null && Number(settings.retell_balance_usd) < LOW_BALANCE_USD) m.push('Retell balance was $' + Number(settings.retell_balance_usd).toFixed(2) + ' at the last reading (' + et(settings.retell_balance_as_of) + '). Top up on the Retell dashboard before Riley stops answering, then update Settings → Retell balance.');
    if (status && !status.error && status.phone && status.expected) {
      if (status.phone.inbound_agent_id && status.expected.inbound_agent_id && status.phone.inbound_agent_id !== status.expected.inbound_agent_id)
        m.push('The Retell number answers with the WRONG agent (' + status.phone.inbound_agent_id + '). Settings → “Fix number wiring”.');
      if (status.phone.outbound_agent_id && status.expected.outbound_agent_id && status.phone.outbound_agent_id !== status.expected.outbound_agent_id)
        m.push('The Retell number’s default outbound agent is not Riley Outbound. Callbacks are protected by override_agent_id, but fix it anyway: Settings → “Fix number wiring”.');
    }
    if (prompts && (prompts.prompts || []).some((p) => p.dirty)) m.push('A prompt has unpublished changes. Riley is still running the previously published version.');
    if (!settings.riley_wa_enabled) m.push('Riley is NOT answering the WhatsApp line yet. Switch it on under “WhatsApp line” once the Telnyx number’s voice is pointed at the LoadBoot Inbound app.');
    if (settings.allow_unsigned_webhook) m.push('Retell webhooks run in observe mode (unsigned deliveries accepted). Enforce after one clean signed call — see docs/voice-agent/RILEY-0458.md.');
    mount(warnEl, m.length ? el('div', { class: 'ry-warn' }, [el('b', null, 'Needs attention'), m.map((x) => el('div', null, '• ' + x))]) : null);
  }

  // ---------- live board
  function liveCalls() { return (data.calls || []).filter((c) => c.status === 'in-progress' || c.status === 'dialing'); }
  function paintBoard() {
    const st = data.stats || {}, live = liveCalls();
    const kp = [[live.length, 'On a call now'], [st.today ?? 0, 'Calls today'], [(st.today_min ?? 0) + ' min', 'Talk today'], [st.week ?? 0, 'Calls · 7 days'], [st.answered_week ?? 0, 'Answered · 7 days'], [st.hot_week ?? 0, '🔥 Hot leads · 7 days']];
    mount(boardEl, el('div', { class: 'ry-board' }, [
      el('h3', null, [el('i', { class: 'ry-pulse' }), 'Riley live — US Eastern ', new Date().toLocaleTimeString('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' }),
        settings.riley_wa_enabled ? el('span', { class: 'ry-pill g', style: 'margin-left:auto' }, 'WhatsApp line → Riley ON') : el('span', { class: 'ry-pill a', style: 'margin-left:auto' }, 'WhatsApp line → Riley OFF')]),
      el('div', { class: 'ry-kpis' }, kp.map(([v, l]) => el('div', { class: 'ry-kpi' }, [el('b', null, String(v)), el('span', null, l)]))),
      live.length ? el('div', { class: 'ry-live' }, live.map((c) => el('div', { class: 'ry-lc ' + c.status, onClick: () => openCall(c) }, [
        el('div', { class: 'top' }, [el('span', null, c.direction === 'inbound' ? '↙ Inbound' : '↗ Callback · ' + (c.source || '')), el('span', null, STAT[c.status] ? STAT[c.status][0] : c.status)]),
        el('div', { class: 'who' }, c.name || pretty(c.direction === 'inbound' ? c.from_number : c.to_number)),
        el('div', { class: 'sub' }, [ROLE[c.role] || c.role || '', c.topic ? ' · ' + c.topic : ''].join('')),
        el('div', { class: 't', 'data-since': c.updated_at || c.at }, mmss((Date.now() - new Date(c.updated_at || c.at).getTime()) / 1000)),
      ]))) : el('div', { class: 'ry-none' }, 'Nobody is on the line with Riley right now.'),
    ]));
  }

  // ---------- tabs
  function paintTabs() {
    const nPlanning = plans && plans.counts ? Number(plans.counts.planning || 0) + Number(plans.counts.ready || 0) : 0;
    const T = [['calls', 'Calls'], ['plans', 'Call plans' + (nPlanning ? ' · ' + nPlanning : '')], ['prompts', 'Prompts'], ['wa', 'WhatsApp line'], ['settings', 'Settings & wiring']];
    mount(tabsEl, el('div', { class: 'ry-tabs' }, T.map(([k, l]) => el('button', { class: 'ry-tab' + (tab === k ? ' on' : ''), onClick: async () => { tab = k; paintTabs(); if (k === 'prompts' && !prompts) await loadPrompts(); if (k === 'settings' && !status) loadStatus(); if (k === 'plans') { if (!plans) { mount(bodyEl, el('div', { class: 'ry-card' }, 'Loading call plans…')); loadPlans(); return; } } paintBody(); } }, l))));
  }
  function paintBody() {
    if (tab === 'calls') paintCalls(); else if (tab === 'plans') paintPlans(); else if (tab === 'prompts') paintPrompts(); else if (tab === 'wa') paintWa(); else paintSettings();
  }

  // ---------- one recording at a time (0458d). State lives HERE, not in the DOM: loadAll repaints the calls table
  // every 5 s, which destroyed the old inline <audio> mid-play (the "no sound" report). The bytes come through
  // retell-admin `recording` (CloudFront serves octet-stream with no CORS, which iOS will not play from a src).
  const P = { id: null, phase: '', a: null, u: null };   // phase: loading | playing | paused
  function pStop() { if (P.a) { try { P.a.pause(); } catch (_) {} } if (P.u) { try { URL.revokeObjectURL(P.u); } catch (_) {} } P.id = null; P.phase = ''; P.a = null; P.u = null; }
  function pLabel(id) {
    if (P.id !== id) return ['play', 'Play', '', 'Play the recording'];
    if (P.phase === 'loading') return ['refresh', 'Loading…', ' ld', 'Fetching the recording from Retell'];
    const dur = P.a && isFinite(P.a.duration) && P.a.duration > 0 ? ' / ' + mmss(P.a.duration) : '';
    const t = P.a ? mmss(P.a.currentTime) + dur : '';
    return P.phase === 'playing' ? ['pause', t || 'Playing', ' on', 'Playing — tap to pause'] : ['play', 'Resume ' + t, ' ps', 'Paused — tap to resume'];
  }
  function pFill(b, id) { const [ic, txt, cls, title] = pLabel(id); b.className = 'ry-btn sm ry-play' + cls; b.disabled = P.id === id && P.phase === 'loading'; b.title = title; b.setAttribute('aria-label', title); b.replaceChildren(icon(ic, 14), document.createTextNode(txt)); }
  function pPaintAll() { document.querySelectorAll('.ry-play[data-id]').forEach((b) => pFill(b, b.getAttribute('data-id'))); }
  async function pToggle(id) {
    if (P.id === id && P.a) {                                      // same row: pause / resume
      try { if (P.a.paused) { await P.a.play(); P.phase = 'playing'; } else { P.a.pause(); P.phase = 'paused'; } } catch (_) {}
      pPaintAll(); return;
    }
    pStop(); P.id = id; P.phase = 'loading'; pPaintAll();
    try {
      const blob = await rileyRecordingBlob(id);
      if (P.id !== id) return;                                     // another row was tapped while this one loaded
      const u = URL.createObjectURL(blob); const a = new Audio(u); P.a = a; P.u = u;
      a.onended = () => { if (P.a === a) { pStop(); pPaintAll(); } };
      a.onpause = () => { if (P.a === a && !a.ended && P.phase === 'playing') { P.phase = 'paused'; pPaintAll(); } };
      a.onplay = () => { if (P.a === a) { P.phase = 'playing'; pPaintAll(); } };
      await a.play(); P.phase = 'playing';
    } catch (e) {
      if (P.id === id) pStop();
      toast('Recording could not be loaded — ' + humanizeError(e), 'error');
    }
    pPaintAll();
  }
  // c needs the Retell call_id (Calls rows have it; a WhatsApp leg uses its matched Calls row)
  const playBtn = (c) => { if (!c || !c.call_id || !c.recording_url) return null; const b = el('button', { class: 'ry-btn sm ry-play', 'data-id': c.call_id, onClick: (e) => { e.stopPropagation(); pToggle(c.call_id); } }); pFill(b, c.call_id); return b; };

  // ---------- calls
  function paintCalls() {
    const keep = document.activeElement && document.activeElement.id === 'ry-q';
    const cutoff = Date.now() - Number(F.days) * 86400000;
    const rows = (data.calls || []).filter((c) => {
      if (F.dir && c.direction !== F.dir) return false;
      if (F.days !== 'all' && new Date(c.at).getTime() < cutoff) return false;
      if (F.q) { const q = F.q.toLowerCase(), d = digits(F.q); const hay = [c.name, c.topic, c.summary, c.role, c.source].join(' ').toLowerCase(); if (!hay.includes(q) && !(d && (digits(c.from_number).includes(d) || digits(c.to_number).includes(d)))) return false; }
      return true;
    });
    mount(bodyEl, el('div', { class: 'ry-card' }, [
      el('div', { class: 'ry-filters' }, [
        el('input', { class: 'ry-in', id: 'ry-q', type: 'search', placeholder: 'Search name, number, topic, summary', value: F.q, style: 'flex:1;min-width:200px', onInput: (e) => { F.q = e.target.value; paintCalls(); } }),
        el('select', { class: 'ry-in', value: F.dir, onChange: (e) => { F.dir = e.target.value; paintCalls(); } }, [['', 'Inbound + callbacks'], ['inbound', 'Inbound only'], ['outbound', 'Callbacks only']].map(([v, l]) => el('option', { value: v, selected: F.dir === v }, l))),
        el('select', { class: 'ry-in', value: F.days, onChange: (e) => { F.days = e.target.value; paintCalls(); } }, [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['all', 'Everything loaded']].map(([v, l]) => el('option', { value: v, selected: F.days === v }, l))),
        el('span', { style: 'color:var(--mut,#64748b);font-size:12.5px' }, rows.length + ' calls'),
      ]),
      rows.length ? el('div', { style: 'overflow-x:auto' }, el('table', { class: 'ry-t' }, [
        el('thead', null, el('tr', null, ['When', '', 'Who', 'About', 'Result', 'Length', 'Lead', ''].map((x) => el('th', null, x)))),
        el('tbody', null, rows.map((c) => {
          const st = STAT[c.status] || [c.status, 'm']; const an = c.analysis || {}; const il = INTEREST[an.interest_level];
          const num = c.direction === 'inbound' ? c.from_number : c.to_number;
          return el('tr', { class: 'click', onClick: () => openCall(c) }, [
            el('td', { style: 'white-space:nowrap' }, [et(c.at), el('div', { style: 'font-size:11.5px;opacity:.65' }, ago(c.at))]),
            el('td', { title: c.direction }, c.direction === 'inbound' ? '↙' : '↗'),
            el('td', null, [el('b', null, c.name && c.name !== 'there' ? c.name : pretty(num)), el('div', { style: 'font-size:12px;opacity:.7' }, [c.name && c.name !== 'there' ? pretty(num) : '', ROLE[an.caller_type || c.role] ? ' · ' + ROLE[an.caller_type || c.role] : '', an.company_name ? ' · ' + an.company_name : ''].join(''))]),
            el('td', { style: 'max-width:360px' }, [el('div', null, c.topic || (c.direction === 'inbound' ? 'Inbound call' : 'Callback')), c.summary ? el('div', { style: 'font-size:12px;opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:360px' }, c.summary) : null]),
            el('td', null, [el('span', { class: 'ry-pill ' + st[1] }, st[0]), c.sentiment ? el('div', { style: 'font-size:11.5px;opacity:.7' }, c.sentiment) : null]),
            el('td', { style: 'white-space:nowrap;font-variant-numeric:tabular-nums' }, c.duration_sec ? mmss(c.duration_sec) : '—'),
            el('td', null, [il ? el('span', { class: 'ry-pill ' + il[1] }, il[0]) : null, an.needs_human === true ? el('div', { style: 'font-size:11.5px;color:#b91c1c;font-weight:700' }, 'needs a human') : null]),
            el('td', { style: 'white-space:nowrap' }, [
              playBtn(c),
              el('button', { class: 'ry-btn sm', onClick: (e) => { e.stopPropagation(); openCall(c); } }, 'Open')]),
          ]);
        })),
      ])) : el('div', { style: 'opacity:.7;padding:8px 0' }, 'No calls match.'),
    ]));
    if (keep) { const i = bodyEl.querySelector('#ry-q'); if (i) { i.focus(); try { i.setSelectionRange(i.value.length, i.value.length); } catch (_) {} } }
  }

  function openCall(c) {
    const an = c.analysis || {}; const st = STAT[c.status] || [c.status, 'm']; const il = INTEREST[an.interest_level];
    const num = c.direction === 'inbound' ? c.from_number : c.to_number;
    const body = el('div', { style: 'display:grid;gap:14px' });
    const audioEl = el('div');
    const paintAudio = (url) => mount(audioEl, url ? el('div', { class: 'ry-row' }, [playBtn({ call_id: c.call_id, recording_url: url }), el('span', { style: 'font-size:12.5px;opacity:.7' }, c.duration_sec ? 'Recording · ' + mmss(c.duration_sec) : 'Recording')]) : el('div', { style: 'opacity:.7;font-size:13px' }, c.status === 'in-progress' ? 'Recording appears here after the call ends.' : 'No recording on file for this call.'));
    paintAudio(c.recording_url);
    const kv = (k, v) => el('div', null, [el('small', null, k), el('span', null, v == null || v === '' ? '—' : String(v))]);
    addTo(body,
      el('div', { class: 'ry-row' }, [el('span', { class: 'ry-pill ' + st[1] }, st[0]), il ? el('span', { class: 'ry-pill ' + il[1] }, il[0]) : null,
        an.needs_human === true ? el('span', { class: 'ry-pill r' }, 'needs a human') : null,
        el('span', { style: 'font-size:13px;opacity:.75' }, [c.direction === 'inbound' ? 'Inbound' : 'Callback (' + (c.source || 'cc') + ')', ' · ', et(c.at), c.duration_sec ? ' · ' + mmss(c.duration_sec) : ''].join(''))]),
      audioEl,
      el('div', { class: 'ry-kv' }, [
        kv('Caller', an.caller_name || (c.name && c.name !== 'there' ? c.name : '')), kv('Number', pretty(num)), kv('Company', an.company_name), kv('Type', ROLE[an.caller_type || c.role] || an.caller_type || c.role),
        kv('MC / DOT', an.mc_number), kv('Email', an.contact_email), kv('Equipment', an.equipment_type), kv('Trucks', an.truck_count),
        kv('Lanes', an.preferred_lanes), kv('Sentiment', c.sentiment), kv('Next step', an.next_step), kv('Topic', c.topic),
      ]),
      c.summary ? el('div', null, [el('b', null, 'Summary'), el('div', { style: 'font-size:13.5px;line-height:1.5;margin-top:4px' }, c.summary)]) : null,
      c.context ? el('details', null, [el('summary', { style: 'cursor:pointer;font-weight:600' }, 'Briefing Riley had before the call'), el('div', { class: 'ry-tr', style: 'margin-top:8px' }, c.context)]) : null,
      el('div', null, [el('b', null, 'Transcript'), el('div', { class: 'ry-tr', style: 'margin-top:6px' }, c.transcript || (c.status === 'in-progress' ? 'Live call — transcript arrives when it ends.' : 'No transcript.'))]),
      el('div', { class: 'ry-row' }, [
        c.lead_id ? el('a', { class: 'ry-btn', href: '#/crm?lead=' + c.lead_id }, 'Open lead in CRM') : null,
        c.call_id ? el('button', { class: 'ry-btn', onClick: async (e) => {
          const b = e.currentTarget; b.disabled = true;
          try { const r = await rileyAdmin('get_call', { call_id: c.call_id }); if (r.recording_url) paintAudio(r.recording_url); if (r.transcript && !c.transcript) { c.transcript = r.transcript; } toast(r.recording_url ? 'Fresh recording link loaded from Retell.' : 'Retell has no recording for this call.'); }
          catch (err) { toast(humanizeError(err), 'error'); } b.disabled = false;
        } }, 'Refresh from Retell') : null,
      ]),
    );
    openDrawer((c.name && c.name !== 'there' ? c.name : pretty(num)) + ' — Riley call', body, { size: 'lg', subtitle: 'Recording, analysis and transcript' });
  }


  // ---------- call plans (bl_voice_0483) — the brain's briefing BEFORE a call; booking + next step since bl_voice_0485
  const planUsd = (n) => '$' + Number(n || 0).toFixed(2);
  const canPlan = () => !!(plans && plans.can_manage);
  const bookingState = (dial) => !dial || !dial.enabled || dial.status !== 'live' || dial.mode === 'deny'
    ? ['Riley booking OFF', 'm'] : dial.mode === 'auto' ? ['Riley booking ON · auto follow-ups', 'g'] : ['Riley booking ON · staff book', 'g'];
  function paintPlans() {
    if (!plans) { mount(bodyEl, el('div', { class: 'ry-card' }, 'Loading call plans…')); return; }
    const keep = document.activeElement && document.activeElement.id === 'ry-pf';
    const rows = plans.plans || [], cnt = plans.counts || {}, dial = plans.dial_tool || {};
    const bs = bookingState(dial);
    const nextReady = rows.filter((p) => p.followup_status === 'proposed').length;
    mount(bodyEl, el('div', null, [
      el('div', { class: 'ry-card' }, [
        el('h3', null, ['Call plans', el('span', { class: 'ry-pill ' + (plans.source_on ? 'g' : 'a') }, plans.source_on ? 'Brain source.voice ON' : 'Brain source.voice OFF'),
          el('span', { class: 'ry-pill ' + bs[1] }, bs[0])]),
        el('p', { class: 'hint' }, 'Start from a carrier: Carrier 360 → “Plan a Riley call”, or Carrier choices → “Plan a Riley call”. The Ops Brain writes Riley’s briefing; you read it here, then press “Book with Riley”. Riley calls Mon–Fri 9:00–18:30 in the carrier’s time zone, one call per carrier per day. After the call the brain proposes the next step — a second call, an email or a task — and you approve it. ' + (bs[1] === 'm' ? 'Booking is off until tool.schedule_riley_call is switched on under AI Brain → Permissions.' : '')),
        el('div', { class: 'ry-kv', style: 'margin-top:10px' }, [
          el('div', null, [el('small', null, 'Ready to call'), el('span', null, String(cnt.ready || 0))]),
          el('div', null, [el('small', null, 'Booked / calling'), el('span', null, String((cnt.scheduled || 0) + (cnt.dialing || 0)))]),
          el('div', null, [el('small', null, 'Called'), el('span', null, String(cnt.called || 0))]),
          el('div', null, [el('small', null, 'No answer'), el('span', null, String(cnt.no_answer || 0))]),
          el('div', null, [el('small', null, 'Next step waiting'), el('span', null, String(nextReady))]),
          el('div', null, [el('small', null, 'Brain cost · 30 days'), el('span', null, planUsd(plans.usd_30d))]),
          el('div', null, [el('small', null, 'Retell when placed'), el('span', null, '≈ $0.13 / min')]),
        ]),
      ]),
      el('div', { class: 'ry-card' }, [
        el('div', { class: 'ry-filters' }, [
          el('select', { class: 'ry-in', id: 'ry-pf', value: PF.status, onChange: (e) => { PF.status = e.target.value; plans = null; mount(bodyEl, el('div', { class: 'ry-card' }, 'Loading…')); loadPlans(); } },
            [['', 'Every status'], ['planning', 'Planning'], ['ready', 'Ready'], ['failed', 'Failed'], ['scheduled', 'Call booked'], ['dialing', 'Riley is calling'], ['called', 'Called'], ['no_answer', 'No answer'], ['cancelled', 'Cancelled']].map(([v, l]) => el('option', { value: v, selected: PF.status === v ? 'selected' : undefined }, l))),
          el('span', { style: 'color:var(--mut,#64748b);font-size:12.5px' }, rows.length + ' plans'),
          el('a', { class: 'ry-btn sm', href: '#/carriers', style: 'margin-left:auto' }, [icon('truck', 14), 'Carriers']),
        ]),
        rows.length ? el('div', { style: 'overflow-x:auto' }, el('table', { class: 'ry-t' }, [
          el('thead', null, el('tr', null, ['When', 'Carrier', 'Why', 'Status', 'Goal / next step', 'Cost', ''].map((x) => el('th', null, x)))),
          el('tbody', null, rows.map((p) => {
            const st = PLAN_STATUS[p.status] || [p.status, 'm']; const pl = p.plan || {}; const f = p.followup || {};
            return el('tr', { class: 'click' + (focusPlan && String(p.id) === String(focusPlan) ? ' hit' : ''), 'data-plan': p.id, onClick: () => openPlan(p) }, [
              el('td', { style: 'white-space:nowrap' }, [et(p.created_at), el('div', { style: 'font-size:11.5px;opacity:.65' }, ago(p.created_at))]),
              el('td', null, [el('b', null, p.org_name || '—'), el('div', { style: 'font-size:12px;opacity:.7' }, [p.contact_name || '', p.contact_name ? ' · ' : '', pretty(p.to_number)].join(''))]),
              el('td', null, [PLAN_REASON_LABEL[p.reason] || p.reason, p.attempt > 1 ? el('div', { style: 'font-size:11.5px;opacity:.7' }, 'attempt ' + p.attempt + ' of 3') : null, p.lang === 'es' ? el('div', { style: 'font-size:11.5px;opacity:.7' }, 'Spanish') : null]),
              el('td', null, [el('span', { class: 'ry-pill ' + st[1] }, st[0]),
                p.status === 'scheduled' && p.scheduled_local ? el('div', { style: 'font-size:11.5px;opacity:.75' }, p.scheduled_local) : null,
                p.followup_status === 'proposed' ? el('div', { style: 'font-size:11.5px;color:#1d4ed8;font-weight:700' }, 'next step ready') : null,
                p.dnc ? el('div', { style: 'font-size:11.5px;color:#b91c1c;font-weight:700' }, 'do-not-call') : null,
                p.review_note && p.status === 'ready' ? el('div', { style: 'font-size:11.5px;color:#b45309;font-weight:700' }, 'check first') : null,
                p.confidence != null && p.status === 'ready' ? el('div', { style: 'font-size:11.5px;opacity:.7' }, 'confidence ' + Math.round(Number(p.confidence) * 100) + '%') : null]),
              el('td', { style: 'max-width:380px' }, p.status === 'failed' ? el('span', { style: 'color:#b91c1c' }, p.error || 'failed')
                : p.followup_status === 'proposed' ? [el('b', null, (NEXT_ACTION[f.action] || f.action || '') + ': '), f.why || f.outcome || '']
                : (pl.goal || (p.status === 'planning' ? 'The brain is writing the plan…' : '—'))),
              el('td', { style: 'white-space:nowrap;font-variant-numeric:tabular-nums' }, p.cost ? planUsd(p.cost.est_total) : '—'),
              el('td', { style: 'white-space:nowrap' }, el('button', { class: 'ry-btn sm', onClick: (e) => { e.stopPropagation(); openPlan(p); } }, 'Open')),
            ]);
          })),
        ])) : el('div', { style: 'opacity:.7;padding:8px 0' }, 'No call plans yet. Open a carrier and press “Plan a Riley call”.'),
      ]),
    ]));
    if (keep) { const i = bodyEl.querySelector('#ry-pf'); if (i) i.focus(); }
    if (focusPlan) { const hit = rows.find((p) => String(p.id) === String(focusPlan)); focusPlan = null; if (hit) openPlan(hit); }
  }

  let planDr = null;   // the open plan popup, so an action can refresh it in place
  const reopen = (r) => { if (planDr) { try { planDr.close(); } catch (_) {} } if (r && r.id) openPlan(r); };
  async function planAct(p, action, note, okMsg) {
    try { const r = await ccRileyPlanSet(p.id, action, note); if (r && r.error) throw new Error(r.error); toast(okMsg); plans = null; await loadPlans(); return r; }
    catch (e) { toast(humanizeError(e), 'error'); return null; }
  }
  async function followAct(p, action, payload, okMsg) {
    try { const r = await ccRileyFollowupAct(p.id, action, payload); if (r && r.error) throw new Error(r.error); toast(okMsg); plans = null; loadPlans(); return r; }
    catch (e) { toast(humanizeError(e), 'error'); return null; }
  }
  async function openPlanById(id) {
    try { const r = await ccRileyPlan(id); if (r && r.error) throw new Error(r.error); reopen(r); } catch (e) { toast(humanizeError(e), 'error'); }
  }

  // Book with Riley (tool.schedule_riley_call executor). The server picks the slot inside calling hours and re-checks at dial time.
  function bookFlow(p) {
    const when = el('input', { type: 'datetime-local', class: 'ry-in', style: 'min-width:220px' });
    const pickNow = el('input', { type: 'radio', name: 'ry-bk', checked: true });
    const pickAt = el('input', { type: 'radio', name: 'ry-bk' });
    when.addEventListener('focus', () => { pickAt.checked = true; });
    const go = async (force) => {
      const at = pickAt.checked && when.value ? new Date(when.value).toISOString() : null;
      try {
        const r = await ccRileyPlanBook(p.id, at, force);
        if (r && r.needs_confirm && !force) {
          const ok = await askConfirm('Book it anyway?', { body: r.error, confirmLabel: 'Book anyway' });
          if (ok) return go(true); return;
        }
        if (r && r.error) throw new Error(r.error);
        dr.close(); toast('Booked — Riley calls ' + (r.scheduled_local || 'at the next allowed time') + '.'); plans = null; loadPlans(); reopen(r);
      } catch (e) { toast(humanizeError(e), 'error'); }
    };
    const dr = openDrawer('Book with Riley — ' + (p.org_name || ''), el('div', { style: 'display:grid;gap:12px' }, [
      el('p', { class: 'hint' }, 'Riley calls ' + pretty(p.to_number) + ' with this briefing. Calls only go out Mon–Fri 9:00–18:30 in the carrier’s time zone' + (p.tz ? ' (' + p.tz.replace('_', ' ') + ')' : ' (unknown zone → 11:00–18:30 Eastern)') + ', one per carrier per day. Every rule is checked again right before dialling.'),
      el('label', { class: 'ry-row' }, [pickNow, 'Next allowed time' + (p.gate && p.gate.next_slot ? ' — ' + et(p.gate.next_slot) : '')]),
      el('label', { class: 'ry-row' }, [pickAt, 'At (your local time):', when]),
      el('div', { class: 'ry-row' }, [el('button', { class: 'ry-btn o', onClick: () => go(false) }, [icon('phone', 14), 'Book the call'])]),
    ]), { size: 'sm' });
  }

  function emailFlow(p) {
    const f = p.followup || {};
    const subj = el('input', { class: 'ry-in', style: 'width:100%', maxlength: '140' }); subj.value = f.email_subject || '';
    const body = el('textarea', { class: 'ry-ta', rows: '12', style: 'width:100%' }); body.value = f.email_body || '';
    const dr2 = openDrawer('Follow-up email — ' + (p.org_name || ''), el('div', { style: 'display:grid;gap:10px' }, [
      el('p', { class: 'hint' }, 'Goes to the carrier’s account email as “riley.followup” (Email catalog, compliance group). Unsubscribes are checked first; the signature and contact line are added automatically. Edit anything before sending.'),
      subj, body,
      el('div', { class: 'ry-row' }, [el('button', { class: 'ry-btn o', onClick: async () => {
        const r = await followAct(p, 'email', { subject: subj.value.trim(), body: body.value.trim() }, 'Email sent.'); if (r) { dr2.close(); reopen(r); }
      } }, 'Send email')]),
    ]), { size: 'lg' });
  }

  function nextStepCard(p) {
    const fs = p.followup_status; if (!fs && !['called', 'no_answer'].includes(p.status)) return null;
    const f = p.followup || {}; const done = p.followup_done || {};
    const sug = f.action || 'none';
    const btn = (key, label, fn) => el('button', { class: 'ry-btn' + (sug === key && fs === 'proposed' ? ' o' : ''), disabled: !canPlan(), onClick: fn }, label);
    const actions = canPlan() && ['proposed', 'failed'].includes(fs) ? el('div', { class: 'ry-row', style: 'flex-wrap:wrap' }, [
      p.attempt < 3 && !p.dnc ? btn('second_call', 'Plan 2nd call', async () => {
        const n = await askReason('Second call — what must Riley cover?', { value: f.call_note || '', submitLabel: 'Ask the brain for the plan', subtitle: 'Attempt ' + (p.attempt + 1) + ' of 3 · the brain writes a new briefing; you book it after reading' });
        if (n == null) return; const r = await followAct(p, 'second_call', { note: n }, 'Follow-up plan requested.'); if (r) reopen(r);
      }) : null,
      p.email_on_file ? btn('email', 'Review & send email', () => emailFlow(p)) : null,
      btn('staff_task', 'Create task', async () => {
        const n = await askReason('Task for a person', { value: f.staff_task || '', submitLabel: 'Create task', subtitle: 'Lands in the task list, due tomorrow' });
        if (n == null) return; const r = await followAct(p, 'staff_task', { title: n }, 'Task created.'); if (r) reopen(r);
      }),
      el('button', { class: 'ry-btn', onClick: async () => { const r = await followAct(p, 'dismiss', {}, 'Next step dismissed.'); if (r) reopen(r); } }, 'Dismiss'),
    ]) : null;
    return el('div', { class: 'ry-card', style: 'margin:0;border:1px solid var(--line,#e2e8f0)' }, [
      el('h3', null, ['Next step', fs === 'proposed' ? el('span', { class: 'ry-pill b' }, (f.source === 'rule' ? 'rule · ' : 'AI · ') + (NEXT_ACTION[sug] || sug))
        : fs === 'done' ? el('span', { class: 'ry-pill g' }, 'done') : fs === 'dismissed' ? el('span', { class: 'ry-pill m' }, 'dismissed')
        : fs === 'failed' ? el('span', { class: 'ry-pill r' }, 'no suggestion') : el('span', { class: 'ry-pill a' }, 'thinking…')]),
      ['pending', 'thinking'].includes(fs) ? el('p', { class: 'hint' }, fs === 'pending' ? 'Waiting for Retell’s call analysis (the brain starts within 10 minutes either way).' : 'The brain is reading the call…') : null,
      fs === 'failed' ? el('div', { class: 'ry-warn' }, (f.error || 'The brain returned nothing.') + ' Pick the next step yourself below.') : null,
      f.outcome ? el('div', { style: 'font-size:14px;line-height:1.5' }, [el('b', null, 'What happened: '), f.outcome]) : null,
      f.why ? el('div', { style: 'font-size:13.5px;line-height:1.5;margin-top:4px' }, [el('b', null, 'Why: '), f.why]) : null,
      f.suggested_at || f.when ? el('div', { style: 'font-size:13px;opacity:.8;margin-top:4px' }, 'When: ' + (f.suggested_at ? et(f.suggested_at) : '') + (f.when ? (f.suggested_at ? ' · ' : '') + f.when : '')) : null,
      f.overridden ? el('div', { style: 'font-size:12.5px;color:#b45309;margin-top:4px' }, 'Changed by the rules: ' + f.overridden) : null,
      sug === 'email' && f.email_subject ? el('details', { style: 'margin-top:6px' }, [el('summary', { style: 'cursor:pointer;font-weight:600' }, 'Draft email: ' + f.email_subject), el('div', { class: 'ry-tr', style: 'margin-top:6px' }, f.email_body || '')]) : null,
      fs === 'done' ? el('div', { style: 'font-size:13.5px;margin-top:6px' }, done.kind === 'email' ? 'Email sent to ' + (done.to || 'the carrier') + ' · ' + et(done.at)
        : done.kind === 'second_call' ? ['Second-call plan ', el('a', { href: '#', onClick: (e) => { e.preventDefault(); openPlanById(done.plan_id); } }, '#' + done.plan_id), done.auto ? ' (auto)' : '', ' · ' + et(done.at)]
        : done.kind === 'staff_task' ? 'Task created for a person' + (done.auto ? ' (auto)' : '') + ' · ' + et(done.at) : done.kind === 'dismissed' ? 'Dismissed · ' + et(done.at) : et(done.at)) : null,
      actions,
    ]);
  }

  function openPlan(p) {
    const st = PLAN_STATUS[p.status] || [p.status, 'm']; const pl = p.plan || {}; const c = p.consent || {}; const cost = p.cost || {}; const job = p.job || {}; const dial = p.dial_tool || {};
    const bs = bookingState(dial); const gate = p.gate || {}; const out = p.outcome || {};
    const editable = ['planning', 'ready', 'failed'].includes(p.status);
    const kv = (k, v) => el('div', null, [el('small', null, k), el('span', null, v == null || v === '' ? '—' : String(v))]);
    const list = (title, arr, ordered) => (arr && arr.length) ? el('div', null, [el('b', null, title), el(ordered ? 'ol' : 'ul', { style: 'margin:4px 0 0;padding-left:22px;line-height:1.55;font-size:13.5px' }, arr.map((x) => el('li', null, x)))]) : null;
    const body = el('div', { style: 'display:grid;gap:14px' });
    const secs = pl.parsed ? el('div', { style: 'display:grid;gap:12px' }, [
      pl.goal ? el('div', null, [el('b', null, 'Goal'), el('div', { style: 'font-size:14px;line-height:1.5;margin-top:3px' }, pl.goal)]) : null,
      pl.opener ? el('div', null, [el('b', null, 'Opener'), el('div', { class: 'ry-tr', style: 'margin-top:4px' }, pl.opener)]) : null,
      list('Talking points', pl.points, true), list('Confirm with the carrier', pl.confirm, false), list('Do not say', pl.do_not_say, false),
      el('div', { class: 'ry-kv' }, [kv('Best time', pl.best_time), kv('Language', pl.language)]),
    ]) : (p.plan_text ? el('div', { class: 'ry-tr' }, p.plan_text) : null);
    const canBook = p.status === 'ready' && canPlan() && gate.ok;
    addTo(body,
      el('div', { class: 'ry-row' }, [el('span', { class: 'ry-pill ' + st[1] }, st[0]),
        p.attempt > 1 ? el('span', { class: 'ry-pill m' }, 'attempt ' + p.attempt + ' of 3') : null,
        p.confidence != null ? el('span', { class: 'ry-pill ' + (Number(p.confidence) >= 0.6 ? 'g' : 'a') }, 'confidence ' + Math.round(Number(p.confidence) * 100) + '%') : null,
        p.dnc ? el('span', { class: 'ry-pill r' }, 'do-not-call') : null,
        el('span', { style: 'font-size:13px;opacity:.75' }, ['Requested ', et(p.created_at), p.created_by_name ? ' by ' + p.created_by_name : (p.parent_id ? ' by the brain (follow-up)' : ''), job.model ? ' · ' + job.model : '', job.secs != null ? ' · ' + job.secs + ' s' : ''].join(''))]),
      p.dnc ? el('div', { class: 'ry-warn' }, [el('b', null, 'On the Riley do-not-call list'), el('div', null, p.dnc.reason + ' · ' + et(p.dnc.at)),
        canPlan() ? el('button', { class: 'ry-btn sm', style: 'margin-top:6px', onClick: async () => {
          const n = await askReason('Remove from do-not-call — why is calling OK again?', { submitLabel: 'Remove', subtitle: 'Only when the carrier asked us to call again' });
          if (n == null) return; const r = await followAct(p, 'dnc_clear', { reason: n }, 'Removed from the do-not-call list.'); if (r) reopen(r);
        } }, 'Remove from do-not-call') : null]) : null,
      p.review_note && editable ? el('div', { class: 'ry-warn' }, [el('b', null, 'The brain wants a person to check first'), el('div', null, p.review_note)]) : null,
      p.status === 'failed' ? el('div', { class: 'ry-warn' }, [el('b', null, 'No plan'), el('div', null, p.error || job.error || 'The brain returned nothing.')]) : null,
      p.status === 'ready' && p.error ? el('div', { class: 'ry-warn' }, p.error) : null,
      p.status === 'planning' ? el('div', { style: 'opacity:.8' }, 'The brain is writing the plan — close and reopen in a few seconds.') : null,
      ['scheduled', 'dialing'].includes(p.status) ? el('div', { class: 'ry-card', style: 'margin:0;border:1px solid var(--line,#e2e8f0)' }, [
        el('h3', null, [p.status === 'dialing' ? 'Riley is calling now' : 'Booked', el('span', { class: 'ry-pill b' }, p.scheduled_local || et(p.scheduled_for))]),
        el('div', { style: 'font-size:13px;opacity:.8' }, 'Booked ' + et(p.booked_at) + (p.booked_by_name ? ' by ' + p.booked_by_name : '') + '. Every rule is checked again right before Riley dials; if one fails, the plan comes back here as ready with the reason.'),
      ]) : null,
      ['called', 'no_answer'].includes(p.status) ? el('div', { class: 'ry-card', style: 'margin:0;border:1px solid var(--line,#e2e8f0)' }, [
        el('h3', null, ['The call', el('span', { class: 'ry-pill ' + (p.status === 'called' ? 'g' : 'a') }, p.status === 'called' ? mmss(out.duration_sec) + ' min' : 'not reached')]),
        el('div', { class: 'ry-kv' }, [kv('When', et(p.called_at)), kv('Sentiment', out.sentiment), kv('Interest', out.interest), kv('Riley’s next step', out.next_step)]),
        out.summary ? el('div', { style: 'font-size:14px;line-height:1.5;margin-top:6px' }, out.summary) : null,
        el('div', { class: 'ry-row', style: 'margin-top:8px' }, [
          el('button', { class: 'ry-btn', onClick: () => {
            const row = (data.calls || []).find((x) => String(x.id) === String(p.call_id));
            if (row) { if (planDr) { try { planDr.close(); } catch (_) {} } openCall(row); return; }
            if (planDr) { try { planDr.close(); } catch (_) {} }
            tab = 'calls'; paintTabs(); paintBody(); toast('Open the call in the list — it is the ' + (p.org_name || 'carrier') + ' call on ' + et(p.called_at) + '.');
          } }, [icon('phone', 14), p.call && p.call.has_recording ? 'Recording & transcript' : 'Open the call']),
          el('span', { style: 'font-size:12.5px;opacity:.7' }, p.call && p.call.has_recording ? 'Plays here; also under Riley → Calls.' : 'The recording appears once Retell sends it (usually within a minute).'),
        ]),
      ]) : null,
      nextStepCard(p),
      (p.children || []).length ? el('div', { style: 'font-size:13.5px' }, [el('b', null, 'Follow-up plans: '), ...(p.children || []).map((ch) => el('a', { href: '#', style: 'margin-right:10px', onClick: (e) => { e.preventDefault(); openPlanById(ch.id); } }, '#' + ch.id + ' · ' + ((PLAN_STATUS[ch.status] || [ch.status])[0])))]) : null,
      p.parent_id ? el('div', { style: 'font-size:13.5px' }, ['Follow-up to ', el('a', { href: '#', onClick: (e) => { e.preventDefault(); openPlanById(p.parent_id); } }, 'plan #' + p.parent_id)]) : null,
      el('div', { class: 'ry-kv' }, [
        kv('Carrier', p.org_name), kv('Contact', p.contact_name), kv('Number', pretty(p.to_number)), kv('Why', PLAN_REASON_LABEL[p.reason] || p.reason),
        kv('Call language', p.lang === 'es' ? 'Spanish' : 'English'), kv('Carrier time zone', p.tz ? p.tz.replace('_', ' ') : 'unknown → Eastern window'),
        kv('Consent basis', c.basis ? (c.basis + (c.sms_consent ? ' · SMS consent on file' : '')) : '—'),
        kv('Cost', cost.est_total != null ? planUsd(cost.est_total) + ' (brain ' + planUsd(cost.brain_usd) + ' + Retell ≈ ' + (out.duration_sec ? mmss(out.duration_sec) : cost.est_minutes + ' min') + ' × $' + cost.retell_per_min + '/min)' : '—'),
        kv('Staff note', p.note),
      ]),
      secs,
      p.plan_text && pl.parsed ? el('details', null, [el('summary', { style: 'cursor:pointer;font-weight:600' }, 'Briefing as Riley will read it (verbatim)'), el('div', { class: 'ry-tr', style: 'margin-top:8px' }, p.plan_text)]) : null,
      p.status === 'ready' && !gate.ok && bs[1] !== 'm' ? el('div', { style: 'font-size:12.5px;color:#b45309' }, 'Cannot book right now: ' + (gate.reason || '—')) : null,
      el('div', { class: 'ry-row', style: 'flex-wrap:wrap' }, [
        el('a', { class: 'ry-btn', href: '#/carrier?id=' + encodeURIComponent(p.org_id || '') }, [icon('truck', 14), 'Open carrier']),
        p.plan_text ? el('button', { class: 'ry-btn', onClick: async () => { try { await navigator.clipboard.writeText(p.plan_text); toast('Briefing copied.'); } catch (_) { toast('Copy failed — select the text instead.', 'error'); } } }, 'Copy briefing') : null,
        editable && p.plan_text && canPlan() ? el('button', { class: 'ry-btn', onClick: () => {
          const ta = el('textarea', { class: 'ry-ta', rows: '16', style: 'width:100%' }); ta.value = p.plan_text;
          const dr2 = openDrawer('Edit the briefing — ' + (p.org_name || ''), el('div', { style: 'display:grid;gap:10px' }, [
            el('p', { class: 'hint' }, 'Keep the seven headers (GOAL, OPENER, TALKING POINTS, CONFIRM, DO NOT SAY, BEST TIME, LANGUAGE) so the card still reads it. Riley gets exactly this text.'),
            ta, el('div', { class: 'ry-row' }, [el('button', { class: 'ry-btn', onClick: async () => { const r = await planAct(p, 'edit', ta.value, 'Briefing saved.'); if (r) { dr2.close(); reopen(r); } } }, 'Save')])]), { size: 'lg' });
        } }, 'Edit briefing') : null,
        editable && canPlan() ? el('button', { class: 'ry-btn', onClick: async () => {
          const n = await askReason('Redo the plan — what should change?', { placeholder: 'e.g. focus on the insurance certificate; the owner speaks Spanish; skip the trial talk', submitLabel: 'Ask the brain again', subtitle: 'A new brain job; the old text is replaced' });
          if (n == null) return; const r = await planAct(p, 'redo', n, 'Asked the brain for a new plan.'); if (r) reopen(r);
        } }, 'Redo plan') : null,
        editable && canPlan() ? el('button', { class: 'ry-btn done', onClick: async () => {
          const n = await askReason('Mark as called — what happened?', { placeholder: 'One or two lines: reached / voicemail / agreed next step', submitLabel: 'Mark called', subtitle: 'Someone called by hand — recorded on the plan for the next person' });
          if (n == null) return; const r = await planAct(p, 'called', n, 'Marked as called.'); if (r) reopen(r);
        } }, 'Mark called') : null,
        (editable || p.status === 'scheduled') && canPlan() ? el('button', { class: 'ry-btn', onClick: async () => { const ok = await askConfirm(p.status === 'scheduled' ? 'Cancel the booked call?' : 'Cancel this call plan?', { body: p.status === 'scheduled' ? 'Riley will not call. The plan text stays on record.' : 'The text stays on record; nobody calls.', confirmLabel: 'Cancel' }); if (!ok) return; const r = await planAct(p, 'cancel', null, 'Cancelled.'); if (r) reopen(r); } }, p.status === 'scheduled' ? 'Cancel booking' : 'Cancel plan') : null,
        p.status === 'ready' ? el('button', { class: 'ry-btn' + (canBook ? ' o' : ''), disabled: !canBook, title: canBook ? 'Book this call with Riley' : (gate.reason || 'Booking is off'), onClick: () => bookFlow(p) },
          [icon('phone', 14), canBook ? 'Book with Riley' : (bs[1] === 'm' ? 'Book with Riley — off' : 'Book with Riley — blocked')]) : null,
        !p.dnc && canPlan() && p.to_number ? el('button', { class: 'ry-btn', onClick: async () => {
          const n = await askReason('Put this number on the Riley do-not-call list?', { placeholder: 'e.g. asked us not to call; prefers email', submitLabel: 'Do not call', subtitle: 'Anything booked to this number is cancelled at once' });
          if (n == null) return; const r = await followAct(p, 'dnc', { reason: n }, 'Riley will never call this number.'); if (r) reopen(r);
        } }, 'Do not call') : null,
      ]),
    );
    planDr = openDrawer((p.org_name || 'Carrier') + ' — call plan', body, { size: 'lg', subtitle: 'Riley’s briefing, the booking, the call and the next step · staff only' });
  }

  // ---------- prompts
  function paintPrompts() {
    if (!prompts) { mount(bodyEl, el('div', { class: 'ry-card' }, 'Loading prompts…')); loadPrompts().then(paintPrompts); return; }
    const cards = (prompts.prompts || []).map((p) => {
      const ta = el('textarea', { class: 'ry-ta', spellcheck: false }, p.general_prompt || '');
      const bm = el('input', { class: 'ry-in', style: 'width:100%;box-sizing:border-box', placeholder: p.agent_key === 'inbound' ? 'Empty = Riley opens from the prompt (known vs unknown caller)' : 'First line Riley says', value: p.begin_message || '' });
      const stEl = el('div', { style: 'font-size:12.5px;color:var(--mut,#64748b)' }, [
        p.published_at ? 'Published ' + et(p.published_at) + ' (Retell llm v' + (p.published_llm_version ?? '?') + ', agent v' + (p.published_agent_version ?? '?') + ')' : 'Never published from CC — Riley is still on whatever the Retell dashboard holds.',
        p.dirty ? el('span', { class: 'ry-pill a', style: 'margin-left:8px' }, 'saved, not published yet') : el('span', { class: 'ry-pill g', style: 'margin-left:8px' }, 'published · live'),
      ]);
      const count = el('span', { style: 'font-size:12px;opacity:.7' }, (p.general_prompt || '').length.toLocaleString() + ' chars');
      // Button state machine (owner ask, 26 Sep): the buttons must SAY where the prompt stands.
      //   editing  → "Save draft" live, Publish locked (save first), "Discard changes" shown
      //   saved, unpublished changes → "Saved ✓" locked, "Publish to Retell" live
      //   saved and live → "Saved ✓" locked, "Published · live" locked
      const saveBtn = el('button', { class: 'ry-btn p', onClick: () => save() }, [icon('check', 16), 'Save draft']);
      const pubBtn = el('button', { class: 'ry-btn o', onClick: () => publish() }, [icon('upload', 16), 'Publish to Retell']);
      const discardBtn = el('button', { class: 'ry-btn', onClick: () => { ta.value = p.general_prompt || ''; bm.value = p.begin_message || ''; count.textContent = ta.value.length.toLocaleString() + ' chars'; syncButtons(); } }, 'Discard changes');
      const edited = () => ta.value !== (p.general_prompt || '') || (bm.value || '') !== (p.begin_message || '');
      function syncButtons() {
        const e = edited(), m = can();
        saveBtn.disabled = !m || !e;
        saveBtn.textContent = ''; saveBtn.append(icon('check', 16), e ? 'Save draft' : 'Saved ✓');
        saveBtn.classList.toggle('p', e); saveBtn.classList.toggle('done', !e);
        pubBtn.disabled = !m || e || !p.dirty;
        pubBtn.textContent = ''; pubBtn.append(icon('upload', 16), e ? 'Save first, then publish' : (p.dirty ? 'Publish to Retell' : 'Published · live'));
        pubBtn.classList.toggle('o', !e && p.dirty); pubBtn.classList.toggle('done', !e && !p.dirty);
        pubBtn.title = e ? 'Save the draft before publishing' : (p.dirty ? 'Make this draft live for the very next call' : 'Retell is running exactly this text');
        discardBtn.hidden = !e;
      }
      ta.addEventListener('input', () => { count.textContent = ta.value.length.toLocaleString() + ' chars'; syncButtons(); });
      bm.addEventListener('input', syncButtons);
      const save = async () => {
        try { const r = await ccRileyPromptSave(p.agent_key, bm.value, ta.value); if (r && r.error) throw new Error(r.error); toast('Saved. Not live yet — press Publish when you are ready.'); await loadPrompts(); paintPrompts(); paintWarn(); }
        catch (e) { toast(humanizeError(e), 'error'); }
      };
      const publish = async () => {
        if (ta.value !== (p.general_prompt || '') || (bm.value || '') !== (p.begin_message || '')) { toast('Save first, then publish.', 'error'); return; }
        const ok = await askConfirm('Publish ' + KEYS[p.agent_key] + '?', { body: 'This updates the Retell agent and makes it live for the very next call. The previous version stays in Retell’s history and in the history list below.', confirmLabel: 'Publish to Retell' });
        if (!ok) return;
        try { const r = await rileyAdmin('publish', { key: p.agent_key }); toast('Published. Retell llm v' + r.llm_version + ', agent v' + r.agent_version + ' is live.'); await loadPrompts(); paintPrompts(); paintWarn(); status = null; }
        catch (e) { toast(humanizeError(e), 'error'); }
      };
      const compare = async () => {
        try {
          const r = await rileyAdmin('get_llm', { key: p.agent_key });
          const same = (r.general_prompt || '') === (p.general_prompt || '');
          openDrawer('Live in Retell — ' + KEYS[p.agent_key], el('div', { style: 'display:grid;gap:10px' }, [
            el('div', { class: 'ry-kv' }, [el('div', null, [el('small', null, 'Retell llm'), r.llm_id + ' · draft v' + r.llm_version]), el('div', null, [el('small', null, 'Agent draft'), 'v' + r.agent_version]), el('div', null, [el('small', null, 'Model'), r.model || '—']), el('div', null, [el('small', null, 'Same as saved here?'), same ? 'Yes' : 'No — differs']), el('div', null, [el('small', null, 'Tools'), (r.general_tools || []).map((t) => t.name || t.type).join(', ') || '—'])]),
            el('div', null, [el('b', null, 'Opening line'), el('div', { class: 'ry-tr' }, r.begin_message == null ? '(dynamic — generated from the prompt)' : r.begin_message)]),
            el('div', null, [el('b', null, 'Prompt currently in Retell'), el('div', { class: 'ry-tr' }, r.general_prompt || '(empty)')]),
          ]), { size: 'lg' });
        } catch (e) { toast(humanizeError(e), 'error'); }
      };
      const card = el('div', { class: 'ry-card' }, [
        el('h3', null, [KEYS[p.agent_key] || p.agent_key, count]),
        el('p', { class: 'hint' }, p.agent_key === 'inbound'
          ? 'Every inbound caller — carrier, broker, shipper, dispatcher — is handled by this ONE prompt through its role playbooks. Riley receives {{name}}, {{role}}, {{topic}} and {{context}} from the inbound webhook before she speaks.'
          : 'Website “call me”, chat callbacks and CC callbacks. Riley receives {{name}}, {{role}}, {{topic}}, {{context}} and {{source}}.'),
        stEl,
        el('label', { style: 'display:grid;gap:5px;font-size:12.5px;font-weight:600;margin-top:10px' }, ['Opening line', bm]),
        el('label', { style: 'display:grid;gap:5px;font-size:12.5px;font-weight:600;margin-top:10px' }, ['System prompt', ta]),
        el('div', { class: 'ry-row', style: 'margin-top:10px' }, [
          saveBtn, pubBtn, discardBtn,
          el('button', { class: 'ry-btn', onClick: compare }, 'Show what Retell has now'),
          el('span', { style: 'font-size:12px;opacity:.7' }, 'Canonical copies: docs/voice-agent/prompts/. Never type the Riley phone number into a prompt.'),
        ]),
      ]);
      syncButtons();
      return card;
    });
    const hist = (prompts.history || []);
    cards.push(el('div', { class: 'ry-card' }, [
      el('h3', null, 'History'), el('p', { class: 'hint' }, 'Every save and publish. Restore puts a version back into the draft — it is not live until you publish.'),
      hist.length ? el('table', { class: 'ry-t' }, [el('thead', null, el('tr', null, ['When', 'Agent', 'Note', 'Size', ''].map((x) => el('th', null, x)))),
        el('tbody', null, hist.map((h) => el('tr', null, [el('td', { style: 'white-space:nowrap' }, et(h.saved_at)), el('td', null, KEYS[h.agent_key] || h.agent_key), el('td', null, h.note || ''), el('td', null, (h.chars || 0).toLocaleString() + ' chars'),
          el('td', null, el('button', { class: 'ry-btn sm', disabled: !can(), onClick: async () => { const ok = await askConfirm('Restore this version into the draft?', { body: 'The current draft is kept in history too.', confirmLabel: 'Restore' }); if (!ok) return; try { const r = await ccRileyPromptRestore(h.id); if (r && r.error) throw new Error(r.error); toast('Restored into the draft.'); await loadPrompts(); paintPrompts(); } catch (e) { toast(humanizeError(e), 'error'); } } }, 'Restore'))])))]) : el('div', { style: 'opacity:.7' }, 'No history yet.'),
    ]));
    mount(bodyEl, el('div', null, cards));
  }

  // ---------- WhatsApp line
  function paintWa() {
    const legs = data.wa_legs || [], cbs = data.wa_callbacks || [];
    const LS = { ringing: ['Ringing Riley', 'a'], forwarded: ['Riley answered', 'g'], voicemail: ['Voicemail (Riley did not pick up)', 'r'], missed: ['Missed', 'r'], ended: ['Ended', 'm'], failed: ['Failed', 'r'] };
    mount(bodyEl, el('div', null, [
      el('div', { class: 'ry-card' }, [
        el('h3', null, ['WhatsApp / contact line → Riley', el('span', { class: 'ry-pill ' + (settings.riley_wa_enabled ? 'g' : 'a') }, settings.riley_wa_enabled ? 'ON' : 'OFF')]),
        el('p', { class: 'hint' }, 'Calls to ' + pretty(settings.wa_number) + ' (the number every email, page and template shows) are handed to Riley the moment they arrive. Callers never see or hear the Riley number. If Riley cannot pick up, the caller gets the LoadBoot voicemail and the message lands below.'),
        el('label', { class: 'ry-sw' }, [el('input', { type: 'checkbox', checked: !!settings.riley_wa_enabled, disabled: !can(), onChange: async (e) => {
          const on = e.target.checked;
          try { const r = await ccRileySettingsSet({ riley_wa_enabled: on }); if (r && r.error) throw new Error(r.error); settings = r; toast(on ? 'Riley now answers the WhatsApp line.' : 'Riley is off the WhatsApp line. Calls fall to the dialer chain / voicemail.'); paintBoard(); paintWarn(); paintWa(); }
          catch (err) { toast(humanizeError(err), 'error'); e.target.checked = !on; }
        } }), 'Riley answers the WhatsApp line']),
        el('label', { class: 'ry-sw', style: 'margin-left:18px' }, [el('input', { type: 'checkbox', checked: settings.riley_route_to_dispatcher !== false, disabled: !can(), onChange: async (e) => {
          const on = e.target.checked;
          try { const r = await ccRileySettingsSet({ riley_route_to_dispatcher: on }); if (r && r.error) throw new Error(r.error); settings = r; toast(on ? 'Known carriers ring their own dispatcher first; Riley if unanswered.' : 'Everyone goes straight to Riley.'); paintWa(); }
          catch (err) { toast(humanizeError(err), 'error'); e.target.checked = !on; }
        } }), 'Known carrier → their dispatcher first']),
        el('div', { style: 'font-size:12.5px;color:var(--mut,#64748b);margin-top:8px' }, 'A carrier we recognise by phone number, whose dispatcher contact has been released (' + (settings.released_carriers ?? 0) + ' today), rings that dispatcher\u2019s LoadBoot line: browser \u2192 their mobile \u2192 Riley \u2192 voicemail. Riley\u2019s briefing names the dispatcher either way.' + (settings.fallback_is_riley ? '' : ' Note: the dialer fallback number is not the Riley line, so unanswered dispatcher calls do not reach Riley.')),
        el('div', { style: 'font-size:12.5px;color:var(--mut,#64748b);margin-top:10px' }, 'One-time Telnyx step (owner): Numbers → ' + pretty(settings.wa_number) + ' → Voice → connection = the “LoadBoot Inbound” Voice API application (the same one the dispatcher lines use). Without it Telnyx never tells us the call exists.'),
      ]),
      el('div', { class: 'ry-card' }, [
        el('h3', null, 'Open callbacks from the line'), el('p', { class: 'hint' }, 'Callers Riley could not take (voicemail or missed). Nobody else sees these — they belong to this screen.'),
        cbs.length ? el('table', { class: 'ry-t' }, [el('thead', null, el('tr', null, ['When', 'Number', 'Why', ''].map((x) => el('th', null, x)))),
          el('tbody', null, cbs.map((k) => el('tr', null, [el('td', { style: 'white-space:nowrap' }, et(k.created_at)), el('td', null, pretty(k.number)), el('td', null, k.reason),
            el('td', null, el('button', { class: 'ry-btn sm', disabled: !can(), onClick: async () => { try { const r = await ccRileyCallbackDone(k.id, null); if (r && r.error) throw new Error(r.error); toast('Marked done.'); loadAll(); } catch (e) { toast(humanizeError(e), 'error'); } } }, 'Done'))])))]) : el('div', { style: 'opacity:.7' }, 'Nothing open.'),
      ]),
      el('div', { class: 'ry-card' }, [
        el('h3', null, 'Telnyx legs on the line'), el('p', { class: 'hint' }, 'Every call to the WhatsApp number as Telnyx saw it, matched to Riley\u2019s recording of the same call. Play here, or open the transcript and analysis.'),
        legs.length ? el('div', { style: 'overflow-x:auto' }, el('table', { class: 'ry-t' }, [el('thead', null, el('tr', null, ['When', 'Caller', 'Outcome', 'Length', 'Recording', ''].map((x) => el('th', null, x)))),
          el('tbody', null, legs.map((d) => {
            const s = LS[d.status] || [d.status, 'm']; const an = d.analysis || {}; const il = INTEREST[an.interest_level];
            const full = d.lc_call_id ? (data.calls || []).find((c) => c.id === d.lc_call_id) : null;
            return el('tr', { class: full ? 'click' : '', onClick: () => { if (full) openCall(full); } }, [
              el('td', { style: 'white-space:nowrap' }, [et(d.started_at), el('div', { style: 'font-size:11.5px;opacity:.65' }, ago(d.started_at))]),
              el('td', null, [el('b', null, d.riley_name && d.riley_name !== 'there' ? d.riley_name : (d.contact_name || pretty(d.from_number))), el('div', { style: 'font-size:12px;opacity:.7' }, [(d.riley_name && d.riley_name !== 'there') || d.contact_name ? pretty(d.from_number) : '', ROLE[an.caller_type] ? ' · ' + ROLE[an.caller_type] : ''].join(''))]),
              el('td', null, [el('span', { class: 'ry-pill ' + s[1] }, s[0]), il ? el('div', { style: 'margin-top:4px' }, el('span', { class: 'ry-pill ' + il[1] }, il[0])) : null, el('div', { style: 'font-size:11.5px;opacity:.65' }, d.hangup_cause || '')]),
              el('td', { style: 'white-space:nowrap;font-variant-numeric:tabular-nums' }, d.duration_sec ? mmss(d.duration_sec) : '—'),
              el('td', null, d.recording_url && full ? playBtn(full) : d.recording_url ? el('span', { style: 'font-size:12px;opacity:.6' }, 'recording is under Calls') : el('span', { style: 'font-size:12px;opacity:.6' }, d.status === 'ringing' ? 'call in progress' : d.status === 'forwarded' ? 'recording arrives when Retell finishes analysing' : 'no Riley recording (call never reached her)')),
              el('td', { style: 'white-space:nowrap' }, full ? el('button', { class: 'ry-btn sm', onClick: (e) => { e.stopPropagation(); openCall(full); } }, 'Transcript') : null),
            ]);
          }))])) : el('div', { style: 'opacity:.7' }, 'No calls on the line yet.'),
      ]),
    ]));
  }

  // ---------- Retell balance (bl_voice_0484). Retell has no balance API, so it is typed from the Retell dashboard;
  // the usage line counts our own Riley calls since that reading. No guessed dollars.
  function balanceCard(s) {
    const has = s.retell_balance_usd != null; const u = s.retell_usage_since || {};
    const kvLine = (k, v) => el('div', null, [el('small', null, k), el('span', null, v)]);
    const low = has && Number(s.retell_balance_usd) < LOW_BALANCE_USD;
    const stale = has && s.retell_balance_as_of && (Date.now() - new Date(s.retell_balance_as_of).getTime()) > 7 * 86400e3;
    const amt = el('input', { class: 'ry-in', inputmode: 'decimal', placeholder: 'e.g. 27.40', value: has ? Number(s.retell_balance_usd).toFixed(2) : '', style: 'width:120px' });
    const save = async (v) => { try { const r = await ccRileySettingsSet({ retell_balance_usd: v }); if (r && r.error) throw new Error(r.error); settings = r; toast(v === '' ? 'Balance cleared.' : 'Balance saved as of now.'); paintWarn(); paintSettings(); } catch (e) { toast(humanizeError(e), 'error'); } };
    return el('div', { class: 'ry-card' }, [
      el('h3', null, ['Retell balance', has ? el('span', { class: 'ry-pill ' + (low ? 'r' : stale ? 'a' : 'g') }, '$' + Number(s.retell_balance_usd).toFixed(2) + (low ? ' · low' : stale ? ' · old reading' : '')) : el('span', { class: 'ry-pill m' }, 'not entered')]),
      el('p', { class: 'hint' }, 'Retell does not publish the balance through its API, so this is the figure from the Retell dashboard (Billing), typed here by hand. Below it: Riley calls since that reading, from our own call log.'),
      has ? el('div', { class: 'ry-kv' }, [
        kvLine('As of', et(s.retell_balance_as_of) + (s.retell_balance_set_by ? ' · by ' + s.retell_balance_set_by : '')),
        kvLine('Since then', (u.calls ?? 0) + ' Riley call' + (u.calls === 1 ? '' : 's') + ' · ' + (u.minutes ?? 0) + ' min'),
      ]) : null,
      el('div', { class: 'ry-row', style: 'margin-top:10px' }, [el('span', null, '$'), amt,
        el('button', { class: 'ry-btn', disabled: !can(), onClick: () => save(amt.value.trim()) }, 'Save reading'),
        has ? el('button', { class: 'ry-btn', disabled: !can(), onClick: () => save('') }, 'Clear') : null]),
    ]);
  }
  // ---------- settings & wiring
  function paintSettings() {
    const s = settings; const st = status;
    const kv = (k, v, cls) => el('div', null, [el('small', null, k), cls ? el('span', { class: 'ry-pill ' + cls }, v) : el('span', null, v == null || v === '' ? '—' : String(v))]);
    const agentRow = (key) => { const a = st && st.agents && st.agents[key]; if (!a) return kv(KEYS[key], st ? 'not found in Retell' : 'checking…', st ? 'r' : null); return el('div', null, [el('small', null, KEYS[key]), el('div', null, [el('b', null, a.agent_name || key), ' · published v' + (a.published_version ?? '—') + ' (llm v' + (a.published_llm_version ?? '—') + ')', a.draft_version != null && a.draft_version !== a.published_version ? ' · draft v' + a.draft_version : '']), el('div', { style: 'font-size:11.5px;opacity:.7;word-break:break-all' }, a.agent_id)]); };
    const okIn = st && st.phone && st.expected && st.phone.inbound_agent_id === st.expected.inbound_agent_id;
    const okOut = st && st.phone && st.expected && st.phone.outbound_agent_id === st.expected.outbound_agent_id;
    const esc = el('input', { class: 'ry-in', placeholder: '+1 …  (empty = Riley never transfers)', value: s.escalation_number || '', style: 'min-width:220px' });
    mount(bodyEl, el('div', null, [
      el('div', { class: 'ry-card' }, [
        el('h3', null, ['Retell number wiring', st && !st.error ? el('span', { class: 'ry-pill ' + (okIn && okOut ? 'g' : 'r') }, okIn && okOut ? 'correct' : 'WRONG') : el('span', { class: 'ry-pill m' }, st && st.error ? 'unreachable' : 'checking…')]),
        el('p', { class: 'hint' }, 'Which agent Retell runs when the Riley number rings, and which one it uses for callbacks. Read live from Retell every time you open this tab.'),
        st && st.error ? el('div', { class: 'ry-warn' }, st.error) : null,
        el('div', { class: 'ry-kv' }, [
          kv('Inbound agent on the number', st && st.phone ? (okIn ? 'Riley Inbound ✓' : (st.phone.inbound_agent_id || 'none')) : '…', st && st.phone ? (okIn ? 'g' : 'r') : null),
          kv('Outbound agent on the number', st && st.phone ? (okOut ? 'Riley Outbound ✓' : (st.phone.outbound_agent_id || 'none')) : '…', st && st.phone ? (okOut ? 'g' : 'r') : null),
          kv('Inbound webhook', st && st.phone && st.phone.inbound_webhook_url ? (st.phone.inbound_webhook_url.includes('retell-inbound-hook') ? 'retell-inbound-hook ✓' : 'unexpected URL') : '—', st && st.phone && st.phone.inbound_webhook_url ? (st.phone.inbound_webhook_url.includes('retell-inbound-hook') ? 'g' : 'r') : null),
          agentRow('inbound'), agentRow('outbound'),
        ]),
        el('div', { class: 'ry-row', style: 'margin-top:12px' }, [
          el('button', { class: 'ry-btn o', disabled: !can() || !st || st.error, onClick: async () => {
            const ok = await askConfirm('Point the Retell number at Riley Inbound / Riley Outbound?', { body: 'Takes effect on the very next call.', confirmLabel: 'Fix wiring' }); if (!ok) return;
            try { await rileyAdmin('set_phone_agents'); toast('Number wiring fixed.'); status = null; await loadStatus(); paintSettings(); } catch (e) { toast(humanizeError(e), 'error'); }
          } }, 'Fix number wiring'),
          el('button', { class: 'ry-btn', onClick: async () => { status = null; paintSettings(); await loadStatus(); paintSettings(); } }, 'Re-check'),
        ]),
      ]),
      el('div', { class: 'ry-card' }, [
        el('h3', null, 'Escalation'), el('p', { class: 'hint' }, 'Riley is written to never transfer. If you ever want a human fallback, put a mobile here and re-publish the prompts; Riley gets a transfer tool pointed at it. Never the Riley line, never the WhatsApp line.'),
        el('div', { class: 'ry-row' }, [esc, el('button', { class: 'ry-btn', disabled: !can(), onClick: async () => { try { const r = await ccRileySettingsSet({ escalation_number: esc.value }); if (r && r.error) throw new Error(r.error); settings = r; toast(r.escalation_number ? 'Escalation number saved. Publish both prompts to attach the transfer tool.' : 'Escalation cleared. Publish both prompts to remove the transfer tool.'); paintSettings(); } catch (e) { toast(humanizeError(e), 'error'); } } }, 'Save')]),
      ]),
      balanceCard(s),
      el('div', { class: 'ry-card' }, [
        el('h3', null, 'Security checks'),
        el('div', { class: 'ry-kv' }, [
          kv('Retell API key', s.retell_key_set ? 'set' : 'missing', s.retell_key_set ? 'g' : 'r'),
          kv('Webhook signing key', s.signing_key_set ? 'set' : 'not set (api_key fallback)', s.signing_key_set ? 'g' : 'a'),
          kv('Unsigned webhooks', s.allow_unsigned_webhook ? 'accepted (observe mode)' : 'refused (enforce)', s.allow_unsigned_webhook ? 'a' : 'g'),
          kv('Calls recorded by Retell', 'yes — data_storage_setting: everything', 'g'),
          kv('Dialer (Telnyx) enabled', s.dialer_enabled ? 'yes' : 'no', s.dialer_enabled ? 'g' : 'r'),
        ]),
        el('p', { class: 'hint', style: 'margin-top:10px' }, 'Enforce mode is flipped in SQL after one clean signed inbound delivery — see docs/voice-agent/RILEY-0458.md.'),
      ]),
    ]));
  }

  // ---------- timers
  function tickTimers() { if (P.phase === 'playing') pPaintAll(); bodyEl.querySelectorAll && boardEl.querySelectorAll('.ry-lc .t').forEach((n) => { const s = n.getAttribute('data-since'); if (s) n.textContent = mmss((Date.now() - new Date(s).getTime()) / 1000); }); }
  const start = () => { stop(); timer = setInterval(() => { if (document.hidden) return; loadAll(); }, 5000); tick = setInterval(tickTimers, 1000); };
  const stop = () => { clearInterval(timer); clearInterval(tick); };
  const mo = new MutationObserver(() => { if (!document.body.contains(root)) { stop(); pStop(); mo.disconnect(); } });
  mo.observe(document.body, { childList: true, subtree: true });

  paintTabs();
  await loadAll(true);
  start();
}

export default renderRiley;
