// smsCenter.js — CC "Text messages" (bl_dial_0547): the control room for every SMS LoadBoot sends.
//   · GO-LIVE TRACK — five switches in the order they must be thrown (Telnyx SMS → main line → test text → document
//     texts → every carrier). Each step says what it is, whether it is done, and has its own button. Going live is
//     refused by the server until a test text was actually sent (cc_doc_sms_config_set).
//   · WHO SENDS WHAT — document decisions go from the MAIN line (815); a dispatcher's text goes from the number of the
//     dispatcher who is sending it. Replies and STOPs to the main line are recorded (dialer_sms_hook).
//   · TEST NUMBERS — the only phones that get document texts while test mode is on; "Send test" goes through the real
//     queue → doc-sms-worker → Telnyx path.
//   · LIVE FEED — every document text: sent / waiting / held / not sent (with the exact reason) / failed.
// Data: cc_sms_center (read), cc_doc_sms_config_set / cc_doc_sms_test (write, audited), cc_dialer_config_set (master
// SMS switch). Staff only (disp_is_staff). Scoped styles (sc-). No alert/confirm/prompt.
import { el, mount } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { sectionHead, openDrawer, askConfirm } from '../../shared/ui/components.js';
import { ccSmsCenter, ccDocSmsConfigSet, ccDocSmsTest, ccDialerConfigSet } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';

const ET = 'America/New_York';
const digits = (s) => String(s || '').replace(/[^0-9]/g, '');
const pretty = (n) => { const d = digits(n); const k = d.length === 11 && d[0] === '1' ? d.slice(1) : d; return k.length === 10 ? '+1 (' + k.slice(0, 3) + ') ' + k.slice(3, 6) + '-' + k.slice(6) : String(n || '—'); };
const ago = (v) => {
  if (!v) return '—'; const s = Math.round((Date.now() - new Date(v).getTime()) / 1000);
  if (s < 45) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return new Date(v).toLocaleString('en-US', { timeZone: ET, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';
};
const clock = (v) => v ? new Date(v).toLocaleTimeString('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' }) + ' ET' : '—';
const DOC = { insurance_coi: 'COI', mc_authority: 'MC authority', w9: 'W-9', dispatch_agreement: 'Dispatch agreement', hazmat_registration: 'Hazmat registration', hazmat_endorsement: 'Hazmat endorsement', hazmat_insurance: 'Hazmat COI', bank_verification: 'Bank verification' };

// status → [label, tone]
function stateOf(r) {
  if (r.status === 'sent') return r.msg_status === 'delivered' ? ['Delivered', 'g'] : r.msg_status === 'failed' ? ['Carrier rejected', 'r'] : ['Sent', 'g'];
  if (r.status === 'sending') return ['Sending', 'b'];
  if (r.status === 'ready') return ['Going now', 'b'];
  if (r.status === 'collecting' || r.status === 'pending') return [r.reason ? 'Held' : 'Waiting', 'a'];
  if (r.status === 'failed') return ['Failed', 'r'];
  return ['Not sent', 'm'];
}

const STEPS = {
  sms:    { n: 1, t: 'Text messaging (Telnyx)', d: 'The master SMS switch. It also lets dispatchers text from their own lines.' },
  sender: { n: 2, t: 'Main line', d: 'The number document texts come from.' },
  test:   { n: 3, t: 'Test text to your phone', d: 'One real text through the real path, to a number on the test list.' },
  doc:    { n: 4, t: 'Document texts', d: 'Approve / reject in CC → the carrier gets one summary text 10 min later.' },
  email:  { n: 5, t: 'Email texts', d: 'A carrier email whose catalog row has a text also goes as that SMS (CC → Email catalog).' },   // bl_dial_0550
  live:   { n: 6, t: 'Every carrier', d: 'Off = test mode: only test numbers get texts.' },
};

const CSS = `
.sc{--n:#10223B;--b:#0883F7;--o:#FC5305;--g:#16a34a;--r:#dc2626;--a:#d97706;--mu2:#93a4c3}
.sc-hero{border-radius:20px;padding:22px;color:#e8eefc;background:radial-gradient(120% 140% at 0% 0%,#1b3a6b 0%,#0e1f3d 45%,#08111f 100%);box-shadow:0 20px 60px rgba(8,20,45,.28);margin-bottom:18px;position:relative;overflow:hidden}
.sc-hero:after{content:"";position:absolute;right:-80px;top:-80px;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle,rgba(8,131,247,.35),transparent 70%);pointer-events:none}
.sc-top{display:flex;flex-wrap:wrap;gap:18px;align-items:flex-start;justify-content:space-between;position:relative}
.sc-mode{font-size:12px;letter-spacing:1.4px;text-transform:uppercase;color:var(--mu2);display:flex;align-items:center;gap:8px}
.sc-big{font-size:28px;font-weight:800;letter-spacing:-.4px;margin:6px 0 4px;color:#fff;display:flex;align-items:center;gap:10px}
.sc-sub{color:#b8c6e0;font-size:14px;max-width:560px;line-height:1.5}
.sc-orb{width:12px;height:12px;border-radius:50%;background:#64748b;flex:none}
.sc-orb.live{background:#22c55e;box-shadow:0 0 0 0 rgba(34,197,94,.6);animation:scp 1.8s infinite}.sc-orb.test{background:#f59e0b}.sc-orb.off{background:#64748b}
@keyframes scp{70%{box-shadow:0 0 0 12px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}
.sc-kpis{display:grid;grid-template-columns:repeat(5,minmax(92px,1fr));gap:10px;min-width:min(100%,520px)}
.sc-kpi{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:11px 13px}
.sc-kpi b{display:block;font-size:24px;font-weight:800;color:#fff;font-variant-numeric:tabular-nums;line-height:1.1}
.sc-kpi span{font-size:10.5px;color:var(--mu2);text-transform:uppercase;letter-spacing:.8px}
.sc-kpi.r b{color:#fca5a5}.sc-kpi.a b{color:#fcd34d}
.sc-track{display:grid;grid-template-columns:repeat(6,1fr);gap:0;margin-top:22px;position:relative}
.sc-step{position:relative;padding:0 10px 0 0}
.sc-step .bar{position:absolute;top:15px;left:34px;right:0;height:2px;background:rgba(255,255,255,.12)}
.sc-step.ok .bar{background:linear-gradient(90deg,#22c55e,rgba(34,197,94,.35))}
.sc-step:last-child .bar{display:none}
.sc-dot{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:13px;background:rgba(255,255,255,.08);border:2px solid rgba(255,255,255,.18);color:#cbd5e1;position:relative;z-index:1}
.sc-step.ok .sc-dot{background:#22c55e;border-color:#22c55e;color:#06210f}
.sc-step.next .sc-dot{border-color:var(--o);color:#fff;background:rgba(252,83,5,.18);box-shadow:0 0 0 5px rgba(252,83,5,.14)}
.sc-step h4{margin:10px 0 3px;font-size:13.5px;color:#fff}.sc-step p{margin:0 0 9px;font-size:12px;color:var(--mu2);line-height:1.45;min-height:34px}
.sc-hb{border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.07);color:#fff;border-radius:10px;padding:6px 11px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.sc-hb:hover{background:rgba(255,255,255,.14)}.sc-hb.o{background:var(--o);border-color:var(--o)}.sc-hb.o:hover{filter:brightness(1.07)}
.sc-hb[disabled]{opacity:.45;cursor:not-allowed}
.sc-hb.off{background:transparent;color:#cbd5e1}
.sc-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.35fr);gap:16px;margin-bottom:16px;align-items:start}
.sc-grid>*{min-width:0}.sc-card{min-width:0}
.sc-card{background:var(--card,#fff);border:1px solid var(--line,#e5e9f2);border-radius:18px;padding:18px;box-shadow:0 1px 2px rgba(16,34,59,.04)}
.sc-card h3{margin:0;font-size:16px;display:flex;align-items:center;gap:8px}
.sc-card .hint{color:var(--mut,#64748b);font-size:13px;margin:4px 0 14px;line-height:1.5}
.sc-route{display:flex;gap:14px;align-items:center;padding:14px;border-radius:14px;background:linear-gradient(135deg,rgba(8,131,247,.07),rgba(252,83,5,.05));border:1px solid var(--line,#e5e9f2)}
.sc-ico{width:44px;height:44px;border-radius:13px;display:grid;place-items:center;background:var(--n);color:#fff;flex:none}
.sc-num{font-size:21px;font-weight:800;letter-spacing:-.2px;font-variant-numeric:tabular-nums}
.sc-what{list-style:none;padding:0;margin:14px 0 0;display:grid;gap:8px;font-size:13.5px}
.sc-what li{display:flex;gap:8px;align-items:flex-start;line-height:1.45}.sc-what li svg{flex:none;margin-top:2px;color:var(--g)}
.sc-t{width:100%;border-collapse:collapse;font-size:13.5px}
.sc-t th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.8px;color:var(--mut,#64748b);padding:8px 10px;border-bottom:1px solid var(--line,#e5e9f2);white-space:nowrap;font-weight:700}
.sc-t td{padding:11px 10px;border-bottom:1px solid var(--line,#eef1f6);vertical-align:middle}.sc-t tr:last-child td{border-bottom:0}
.sc-t .num{font-variant-numeric:tabular-nums;text-align:right}
.sc-tw{overflow:auto;margin:0 -4px}
.sc-on{display:inline-block;width:8px;height:8px;border-radius:50%;background:#94a3b8;margin-right:7px;vertical-align:middle}.sc-on.y{background:#22c55e;box-shadow:0 0 6px rgba(34,197,94,.7)}
.sc-pill{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:700;padding:3px 10px;border-radius:999px;white-space:nowrap}
.sc-pill.g{background:rgba(22,163,74,.12);color:#15803d}.sc-pill.r{background:rgba(220,38,38,.11);color:#b91c1c}.sc-pill.a{background:rgba(217,119,6,.13);color:#b45309}.sc-pill.b{background:rgba(8,131,247,.12);color:#0369a1}.sc-pill.m{background:rgba(100,116,139,.13);color:#475569}
.sc-btn{border:1px solid var(--line,#d8dee9);background:var(--card,#fff);color:inherit;border-radius:10px;padding:8px 13px;font:inherit;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
.sc-btn:hover{border-color:var(--b)}.sc-btn.p{background:var(--b);border-color:var(--b);color:#fff}.sc-btn.o{background:var(--o);border-color:var(--o);color:#fff}.sc-btn.sm{padding:5px 10px;font-size:12.5px}.sc-btn[disabled]{opacity:.5;cursor:not-allowed}
.sc-in{border:1px solid var(--line,#d8dee9);background:var(--card,#fff);color:inherit;border-radius:10px;padding:9px 12px;font:inherit;min-width:0}
.sc-chips{display:flex;flex-direction:column;gap:8px;margin-bottom:12px}
.sc-chip{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--line,#e5e9f2);border-radius:12px}
.sc-chip b{font-variant-numeric:tabular-nums;flex:1}
.sc-x{border:0;background:transparent;color:var(--mut,#64748b);cursor:pointer;padding:4px;border-radius:8px;display:grid;place-items:center}.sc-x:hover{background:rgba(220,38,38,.1);color:#b91c1c}
.sc-add{display:flex;gap:8px}.sc-add .sc-in{flex:1}
.sc-empty{color:var(--mut,#64748b);font-size:13.5px;padding:18px 4px;text-align:center}
.sc-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:2px 0 12px}
.sc-tab{border:1px solid var(--line,#e5e9f2);background:transparent;color:inherit;border-radius:999px;padding:6px 12px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer}
.sc-tab.on{background:var(--n);border-color:var(--n);color:#fff}
.sc-tab i{font-style:normal;opacity:.6;margin-left:4px}
.sc-feed{display:grid;gap:10px}
.sc-row{display:grid;grid-template-columns:92px minmax(0,1fr) auto;gap:14px;align-items:flex-start;padding:13px 14px;border:1px solid var(--line,#e5e9f2);border-radius:14px;border-left:3px solid var(--line,#e5e9f2)}
.sc-row.g{border-left-color:#22c55e}.sc-row.r{border-left-color:#ef4444}.sc-row.a{border-left-color:#f59e0b}.sc-row.b{border-left-color:var(--b)}
.sc-when{font-size:12px;color:var(--mut,#64748b);line-height:1.4}.sc-when b{display:block;color:inherit;font-size:13px}
.sc-who{font-weight:700;font-size:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.sc-who a{color:inherit;text-decoration:none}.sc-who a:hover{color:var(--b);text-decoration:underline}
.sc-docs{font-size:12px;color:var(--mut,#64748b);font-weight:600}
.sc-bubble{margin-top:7px;background:rgba(8,131,247,.07);border:1px solid rgba(8,131,247,.15);border-radius:4px 14px 14px 14px;padding:9px 12px;font-size:13px;line-height:1.5;max-width:640px;white-space:pre-wrap;word-break:break-word}
.sc-why{margin-top:7px;font-size:12.5px;color:var(--mut,#64748b);display:flex;gap:6px;align-items:flex-start;line-height:1.45}
.sc-why.r{color:#b91c1c}
.sc-meta{text-align:right;font-size:12px;color:var(--mut,#64748b);display:grid;gap:6px;justify-items:end}
.sc-adv{margin-top:6px}.sc-adv summary{cursor:pointer;font-weight:700;font-size:13.5px;padding:6px 0}
.sc-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-top:10px}
.sc-form label{display:grid;gap:5px;font-size:12.5px;font-weight:700}.sc-form small{font-weight:400;color:var(--mut,#64748b);line-height:1.4}
.sc-warn{border-radius:14px;padding:12px 14px;margin-top:12px;background:rgba(252,83,5,.07);border:1px solid rgba(252,83,5,.25);font-size:13px;line-height:1.5;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.sc-skel{height:14px;border-radius:7px;background:linear-gradient(90deg,rgba(148,163,184,.15),rgba(148,163,184,.3),rgba(148,163,184,.15));background-size:200% 100%;animation:scs 1.2s infinite}
@keyframes scs{to{background-position:-200% 0}}
@media (max-width:980px){.sc-grid{grid-template-columns:minmax(0,1fr)}.sc-kpis{grid-template-columns:repeat(3,1fr)}}
@media (max-width:760px){.sc-track{grid-template-columns:1fr;gap:14px}.sc-step{display:grid;grid-template-columns:32px 1fr;column-gap:12px;padding:0}.sc-step .bar{display:none}.sc-step h4{margin-top:4px}.sc-step p{min-height:0}.sc-step>div:last-child{grid-column:2}
  .sc-hero{padding:16px;border-radius:16px}.sc-big{font-size:22px}.sc-kpis{grid-template-columns:repeat(2,1fr);min-width:0;width:100%}
  .sc-row{grid-template-columns:1fr}.sc-meta{text-align:left;justify-items:start;grid-auto-flow:column;justify-content:start}}
@media (prefers-reduced-motion:reduce){.sc-orb.live,.sc-skel{animation:none}}
`;

export async function renderSmsCenter(host) {
  if (!document.getElementById('sc-css')) { const s = document.createElement('style'); s.id = 'sc-css'; s.textContent = CSS; document.head.appendChild(s); }
  const root = el('div', { class: 'sc' });
  const heroEl = el('div'), routeEl = el('div', { class: 'sc-grid' }), feedEl = el('div');
  let D = null, busy = false, timer = null, filter = 'all', advOpen = false;
  mount(host, root);
  root.append(
    sectionHead('Text messages', 'Who texts carriers, from which number — and every document text, live.',
      [el('button', { class: 'sc-btn', onClick: () => load() }, [icon('refresh', 15), 'Refresh'])]),
    heroEl, routeEl, feedEl);
  mount(heroEl, el('div', { class: 'sc-hero' }, [el('div', { class: 'sc-skel', style: 'width:40%;margin-bottom:12px' }), el('div', { class: 'sc-skel', style: 'width:70%' })]));

  async function load() {
    if (busy) return; busy = true;
    try {
      const r = await ccSmsCenter();
      if (!r || r.error) throw new Error((r && r.error) || 'Could not load text messages.');
      D = r; paint();
    } catch (e) { mount(heroEl, el('div', { class: 'sc-card' }, humanizeError(e))); }
    busy = false;
  }
  async function save(p, okMsg) {
    try { const r = await ccDocSmsConfigSet(p); if (!r || r.error) throw new Error((r && r.error) || 'Not saved.'); if (okMsg) toast(okMsg); await load(); return true; }
    catch (e) { toast(humanizeError(e), 'error'); return false; }
  }
  const stepOk = (k) => !!((D.steps || []).find((s) => s.key === k) || {}).ok;

  // ---------------------------------------------------------------- hero: mode + KPIs + go-live track
  function paintHero() {
    const c = D.config || {}, k = D.kpi || {};
    const live = stepOk('sms') && stepOk('sender') && c.enabled && c.allow_all;
    const test = stepOk('sms') && stepOk('sender') && c.enabled && !c.allow_all;
    const mode = live ? ['live', 'Live for every carrier', 'Every approve / reject in CC sends the carrier one summary text from the main line, 10 minutes after the last decision.']
      : test ? ['test', 'Test mode', 'Document texts are on, but only the phones on the test list receive them. Every other carrier shows "Test mode" in the feed below.']
      : ['off', 'Document texts are off', 'Nothing is texted to carriers yet. Decisions are still queued and shown below with the reason they did not go.'];
    const firstOpen = ['sms', 'sender', 'test', 'doc', 'email', 'live'].find((x) => !stepOk(x));
    const kpi = (v, l, tone) => el('div', { class: 'sc-kpi' + (tone && v ? ' ' + tone : '') }, [el('b', null, String(v || 0)), el('span', null, l)]);
    mount(heroEl, el('div', { class: 'sc-hero' }, [
      el('div', { class: 'sc-top' }, [
        el('div', null, [
          el('div', { class: 'sc-mode' }, ['Document texts']),
          el('div', { class: 'sc-big' }, [el('span', { class: 'sc-orb ' + mode[0] }), mode[1]]),
          el('div', { class: 'sc-sub' }, mode[2]),
        ]),
        el('div', { class: 'sc-kpis' }, [kpi(k.sent_24h, 'Sent 24 h'), kpi(k.sent_7d, 'Sent 7 days'), kpi(k.waiting, 'Waiting'), kpi(k.skipped_7d, 'Not sent 7 d', 'a'), kpi(k.failed_7d, 'Failed 7 d', 'r')]),
      ]),
      el('div', { class: 'sc-track' }, ['sms', 'sender', 'test', 'doc', 'email', 'live'].map((key) => {
        const S = STEPS[key], ok = stepOk(key);
        return el('div', { class: 'sc-step' + (ok ? ' ok' : '') + (key === firstOpen ? ' next' : '') }, [
          el('div', { class: 'bar' }),
          el('div', { class: 'sc-dot' }, ok ? icon('check', 16) : String(S.n)),
          el('div', null, [el('h4', null, S.t), el('p', null, stepDetail(key)), stepAction(key, ok)]),
        ]);
      })),
    ]));
  }
  function stepDetail(key) {
    const c = D.config || {};
    if (key === 'sender') return c.from_e164 ? pretty(c.from_e164) + ' — document texts come from here.' : STEPS.sender.d;
    if (key === 'test') return D.last_test_at ? 'Last test text sent ' + ago(D.last_test_at) + '.' : STEPS.test.d;
    if (key === 'live') return c.allow_all ? 'On — every carrier with SMS consent gets document texts.' : STEPS.live.d;
    return STEPS[key].d;
  }
  function stepAction(key, ok) {
    const c = D.config || {}, dl = D.dialer || {};
    if (key === 'sms') return el('button', { class: 'sc-hb' + (ok ? ' off' : ' o'), onClick: () => toggleMaster(!ok) }, ok ? 'Turn off' : 'Turn on');
    if (key === 'sender') return el('button', { class: 'sc-hb' + (ok ? ' off' : ' o'), onClick: () => editMainLine() }, ok ? 'Change' : 'Set main line');
    if (key === 'test') return el('button', { class: 'sc-hb' + (ok ? ' off' : ' o'), disabled: !(dl.enabled && dl.sms_enabled) || null, onClick: () => document.getElementById('sc-tests')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, ok ? 'Send another' : 'Send a test');
    if (key === 'doc') return el('button', { class: 'sc-hb' + (c.enabled ? ' off' : ' o'), onClick: () => toggleDoc(!c.enabled) }, c.enabled ? 'Turn off' : 'Turn on');
    if (key === 'email') return el('button', { class: 'sc-hb' + (c.email_enabled ? ' off' : ' o'), onClick: () => toggleEmail(!c.email_enabled) }, c.email_enabled ? 'Turn off' : 'Turn on');
    return el('button', { class: 'sc-hb' + (c.allow_all ? ' off' : ' o'), disabled: (!c.allow_all && !D.last_test_at) || null,
      title: !c.allow_all && !D.last_test_at ? 'Unlocks after one test text is sent' : null, onClick: () => toggleLive(!c.allow_all) },
      c.allow_all ? 'Back to test mode' : 'Go live');
  }
  async function toggleMaster(on) {
    const ok = await askConfirm(on ? 'Turn on text messaging?' : 'Turn off ALL text messaging?', {
      body: on ? 'This is the master SMS switch for LoadBoot. Dispatchers will be able to text consenting contacts from their own lines, and document texts can go once steps 2–4 are done. Every text still needs the contact\'s SMS consent, and STOP is always honoured.'
               : 'Every LoadBoot text stops at once — document texts AND dispatcher texts. Calls are not affected.',
      confirmLabel: on ? 'Turn on' : 'Turn off', danger: !on });
    if (!ok) return;
    try { const r = await ccDialerConfigSet({ sms_enabled: on }); if (!r || r.error) throw new Error((r && r.error) || 'Not saved.'); toast(on ? 'Text messaging is on.' : 'Text messaging is off.'); load(); }
    catch (e) { toast(humanizeError(e), 'error'); }
  }
  async function toggleDoc(on) {
    if (!on) { const ok = await askConfirm('Turn off document texts?', { body: 'Carriers stop getting texts about document decisions. Emails are not affected.', confirmLabel: 'Turn off', danger: true }); if (!ok) return; }
    save({ enabled: on }, on ? (D.config.allow_all ? 'Document texts are on for every carrier.' : 'Document texts are on — test mode.') : 'Document texts are off.');
  }
  // bl_dial_0550: texts that ride with carrier emails. Which emails, and their words, live on each Email-catalog row.
  async function toggleEmail(on) {
    const ok = await askConfirm(on ? 'Turn on email texts?' : 'Turn off email texts?', {
      body: on ? 'A carrier email whose Email-catalog row has "Text message too" on also goes as that short text from the main line. Same rules as document texts: SMS consent, STOP, 8 am – 9 pm their time, max ' + ((D.config || {}).max_per_day || 3) + ' texts a day (account notices are never held back). Marketing and outreach emails never get a text.' + ((D.config || {}).allow_all ? '' : ' Test mode is on, so only the test numbers get them.')
               : 'Carriers stop getting texts with their emails. The emails themselves are not affected.',
      confirmLabel: on ? 'Turn on' : 'Turn off', danger: !on });
    if (!ok) return;
    save({ email_enabled: on }, on ? 'Email texts are on.' : 'Email texts are off.');
  }
  async function toggleLive(on) {
    if (on) {
      const ok = await askConfirm('Go live for every carrier?', { body: 'From now on every carrier who ticked the SMS box gets one summary text from ' + pretty(D.config.from_e164) + ' after their documents are reviewed, and with the emails that have a text (max ' + (D.config.max_per_day || 3) + ' a day, 8 am – 9 pm their time, STOP always honoured).', confirmLabel: 'Go live' });
      if (!ok) return;
    }
    save({ allow_all: on }, on ? 'Live — every carrier gets document texts.' : 'Back to test mode.');
  }
  function editMainLine() {
    const c = D.config || {};
    const inp = el('input', { class: 'sc-in', value: pretty(c.from_e164 || D.main_number || ''), inputmode: 'tel', style: 'width:100%' });
    const prof = el('input', { class: 'sc-in', value: c.messaging_profile_id || '', placeholder: 'Leave empty — Telnyx uses the number\'s own profile', style: 'width:100%' });
    const go = el('button', { class: 'sc-btn o' }, 'Save main line');
    const dr = openDrawer('Main line', el('div', { style: 'display:grid;gap:14px' }, [
      el('p', { style: 'margin:0;line-height:1.6' }, ['Document texts go from this number. It must be on the carrier SMS campaign (CS3VIAJ) in Telnyx. LoadBoot\'s public number is ', el('b', null, pretty(D.main_number || '')), ' — the same one on every email and the website, so a carrier who calls or texts back reaches LoadBoot.']),
      el('label', { style: 'display:grid;gap:6px;font-weight:700;font-size:13px' }, ['Number', inp]),
      el('label', { style: 'display:grid;gap:6px;font-weight:700;font-size:13px' }, ['Telnyx messaging profile id (optional)', prof]),
      el('div', null, go),
    ]), { subtitle: 'Where document texts come from', size: 'sm' });
    go.addEventListener('click', async () => { go.disabled = true; if (await save({ from_e164: inp.value, messaging_profile_id: prof.value }, 'Main line saved.')) dr.close(); go.disabled = false; });
  }

  // ---------------------------------------------------------------- who sends what + test numbers
  function paintRoute() {
    const c = D.config || {}, lines = D.lines || [];
    const numbers = (c.test_numbers || []);
    const smsOn = D.dialer && D.dialer.enabled && D.dialer.sms_enabled;
    const addIn = el('input', { class: 'sc-in', placeholder: 'Your mobile, e.g. (469) 555-0142', inputmode: 'tel' });
    const add = async () => { const v = addIn.value.trim(); if (!v) return; if (await save({ test_numbers: numbers.concat([v]) }, 'Test number added.')) addIn.value = ''; };
    addIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    const sendTest = async (n, b) => {
      b.disabled = true;
      try { const r = await ccDocSmsTest(n); if (!r || r.error) throw new Error((r && r.error) || 'Not sent.'); toast('Test text is on its way to ' + pretty(n) + '. Watch the feed below.'); setTimeout(load, 4000); setTimeout(load, 12000); }
      catch (e) { toast(humanizeError(e), 'error'); }
      b.disabled = false;
    };
    mount(routeEl, [
      el('div', { style: 'display:grid;gap:16px;align-content:start' }, [
        el('div', { class: 'sc-card' }, [
          el('h3', null, [icon('zap', 17), 'Document texts — main line']),
          el('div', { class: 'hint' }, 'Approvals, rejections and "You\'re fully approved" go from LoadBoot\'s main number — never a dispatcher\'s.'),
          el('div', { class: 'sc-route' }, [
            el('div', { class: 'sc-ico' }, icon('phone', 20)),
            el('div', { style: 'flex:1;min-width:0' }, [el('div', { class: 'sc-num' }, c.from_e164 ? pretty(c.from_e164) : 'Not set'), el('div', { class: 'sc-docs' }, 'Main line · call, WhatsApp & document texts')]),
            el('button', { class: 'sc-btn sm', onClick: () => editMainLine() }, 'Change'),
          ]),
          el('ul', { class: 'sc-what' }, [
            el('li', null, [icon('check', 15), 'One summary text per review — 10 min after the last decision, so 3 decisions = 1 text.']),
            el('li', null, [icon('check', 15), 'Only to carriers who ticked the SMS box. 8 am – 9 pm their time, max ' + (c.max_per_day || 3) + ' a day.']),
            el('li', null, [icon('check', 15), 'Replies and STOP to this number are recorded (' + (D.main_in_7d || 0) + ' in 7 days) and land in the SMS inbox.']),
          ]),
        ]),
        el('div', { class: 'sc-card', id: 'sc-tests' }, [
          el('h3', null, [icon('shield', 17), 'Test numbers']),
          el('div', { class: 'hint' }, c.allow_all ? 'Live mode is on, so every carrier gets texts. Test numbers still work for "Send test".' : 'While test mode is on, only these phones get document texts. A test number needs SMS consent too (tick the text box on a test carrier account, or log your verbal yes).'),
          numbers.length ? el('div', { class: 'sc-chips' }, numbers.map((n) => {
            const b = el('button', { class: 'sc-btn sm p', disabled: !smsOn || null, title: smsOn ? null : 'Turn on step 1 first' }, [icon('send', 13), 'Send test']);
            b.addEventListener('click', () => sendTest(n, b));
            return el('div', { class: 'sc-chip' }, [icon('phone', 15), el('b', null, pretty(n)), b,
              el('button', { class: 'sc-x', title: 'Remove', 'aria-label': 'Remove ' + pretty(n), onClick: () => save({ test_numbers: numbers.filter((x) => x !== n) }, 'Test number removed.') }, icon('x', 15))]);
          })) : el('div', { class: 'sc-empty', style: 'padding:6px 0 12px;text-align:left' }, 'No test number yet — add your own mobile.'),
          el('div', { class: 'sc-add' }, [addIn, el('button', { class: 'sc-btn', onClick: add }, [icon('plus', 14), 'Add'])]),
        ]),
      ]),
      el('div', { class: 'sc-card' }, [
        el('h3', null, [icon('users', 17), 'Dispatcher texts — each from their own line']),
        el('div', { class: 'hint' }, 'When a dispatcher texts a carrier or broker, it goes from the number of the dispatcher who is sending it. A reply comes back to that same number.'),
        lines.length ? el('div', { class: 'sc-tw' }, el('table', { class: 'sc-t' }, [
          el('thead', null, el('tr', null, ['Dispatcher', 'Their number', 'Sent 7 d', 'Received 7 d', 'Last text'].map((h, i) => el('th', { class: i === 2 || i === 3 ? 'num' : null }, h)))),
          el('tbody', null, lines.map((l) => {
            const online = l.last_seen_at && (Date.now() - new Date(l.last_seen_at).getTime()) < 5 * 60 * 1000;
            return el('tr', null, [
              el('td', null, [el('span', { class: 'sc-on' + (online ? ' y' : ''), title: online ? 'Online now' : 'Last seen ' + ago(l.last_seen_at) }), el('b', null, l.dispatcher)]),
              el('td', { style: 'font-variant-numeric:tabular-nums;white-space:nowrap' }, pretty(l.number)),
              el('td', { class: 'num' }, String(l.out_7d || 0)),
              el('td', { class: 'num' }, String(l.in_7d || 0)),
              el('td', { style: 'white-space:nowrap;color:var(--mut,#64748b)' }, ago(l.last_text_at)),
            ]);
          })),
        ])) : el('div', { class: 'sc-empty' }, 'No dispatcher has a line yet — assign one in Phones & live calls.'),
        el('details', { class: 'sc-adv', open: advOpen || null, onToggle: (e) => { advOpen = e.currentTarget.open; } }, [
          el('summary', null, 'Advanced'),
          advanced(),
        ]),
      ]),
    ]);
  }
  function advanced() {
    const c = D.config || {}, dl = D.dialer || {};
    const deb = el('input', { class: 'sc-in', type: 'number', min: '1', max: '120', value: String(c.debounce_minutes || 10) });
    const cap = el('input', { class: 'sc-in', type: 'number', min: '1', max: '10', value: String(c.max_per_day || 3) });
    const b = el('button', { class: 'sc-btn p', style: 'align-self:end' }, 'Save');
    b.addEventListener('click', async () => { b.disabled = true; await save({ debounce_minutes: deb.value, max_per_day: cap.value }, 'Saved.'); b.disabled = false; });
    return el('div', null, [
      el('div', { class: 'sc-form' }, [
        el('label', null, ['Wait after the last decision (min)', deb, el('small', null, 'Decisions inside this window become one text.')]),
        el('label', null, ['Max texts per carrier / day (all kinds)', cap, el('small', null, 'Document + email texts, counted over 24 hours. Account notices are never held back.')]),
        b,
      ]),
      dl.first_suffix_unicode ? el('div', { class: 'sc-warn' }, [
        el('div', { style: 'flex:1;min-width:220px' }, [el('b', null, 'The first text to a new number is 4 SMS instead of 2. '),
          'Its compliance line uses a long dash (—), which switches the whole text to the expensive character set and cuts the document detail. A plain dash (-) keeps the same words.']),
        el('button', { class: 'sc-btn o sm', onClick: async () => { const ok = await askConfirm('Use a plain dash in the first-text line?', { body: 'Same words, "—" becomes "-". Applies to every first text LoadBoot sends, dispatcher texts included.', confirmLabel: 'Change it' }); if (ok) save({ first_suffix_ascii: true }, 'Done — first texts are now 2 SMS.'); } }, 'Fix it'),
      ]) : null,
    ]);
  }

  // ---------------------------------------------------------------- live feed
  function paintFeed() {
    const rows = D.feed || [];
    const F = { all: () => true, sent: (r) => r.status === 'sent', waiting: (r) => ['collecting', 'pending', 'ready', 'sending'].includes(r.status), notsent: (r) => r.status === 'skipped', failed: (r) => r.status === 'failed', test: (r) => r.kind === 'test' };
    const L = { all: 'All', sent: 'Sent', waiting: 'Waiting', notsent: 'Not sent', failed: 'Failed', test: 'Tests' };
    const shown = rows.filter(F[filter] || F.all);
    mount(feedEl, el('div', { class: 'sc-card' }, [
      el('h3', null, [icon('activity', 17), 'Live feed — carrier texts']),
      el('div', { class: 'hint' }, 'Every review or email that could have texted a carrier: what went, what is waiting, and the exact reason when nothing was sent.'),
      el('div', { class: 'sc-tabs', role: 'tablist' }, Object.keys(L).map((k) => el('button', { class: 'sc-tab' + (filter === k ? ' on' : ''), role: 'tab', 'aria-selected': String(filter === k), onClick: () => { filter = k; paintFeed(); } }, [L[k], el('i', null, String(rows.filter(F[k]).length))]))),
      shown.length ? el('div', { class: 'sc-feed' }, shown.map(feedRow)) : el('div', { class: 'sc-empty' }, rows.length ? 'Nothing in this filter.' : 'No document decisions yet. The first approve / reject in CC shows up here within a minute.'),
    ]));
  }
  function feedRow(r) {
    const [lab, tone] = stateOf(r);
    const docs = (r.keys || []).map((k) => DOC[k] || k).join(', ');
    const waiting = r.status === 'collecting' || r.status === 'pending';
    const when = r.sent_at || (waiting ? r.due_at : r.updated_at);
    const whenLabel = r.status === 'sent' ? 'Sent' : waiting ? 'Goes at' : r.status === 'failed' ? 'Failed' : 'Updated';
    return el('div', { class: 'sc-row ' + tone }, [
      el('div', { class: 'sc-when' }, [el('b', null, clock(when)), whenLabel, el('br'), ago(r.created_at)]),
      el('div', { style: 'min-width:0' }, [
        el('div', { class: 'sc-who' }, [
          r.kind === 'test' ? el('span', null, 'Test text') : r.org_id ? el('a', { href: '#/carrier?id=' + r.org_id }, r.carrier || 'Carrier') : el('span', null, r.carrier || 'Carrier'),
          r.kind === 'approved' ? el('span', { class: 'sc-pill g' }, 'Fully approved') : null,
          r.kind === 'email' ? el('a', { class: 'sc-docs', href: '#/email-catalog', title: 'Sent with this email' }, '✉ ' + (r.catalog_key || 'email')) : null,
          docs ? el('span', { class: 'sc-docs' }, docs) : null,
        ]),
        r.body ? el('div', { class: 'sc-bubble' }, r.body) : null,
        r.reason || r.error ? el('div', { class: 'sc-why' + (r.status === 'failed' ? ' r' : '') }, [icon(r.status === 'failed' ? 'alert' : 'clock', 14), r.error || r.reason]) : null,
      ]),
      el('div', { class: 'sc-meta' }, [
        el('span', { class: 'sc-pill ' + tone }, lab),
        r.to ? el('span', null, 'to ' + r.to) : null,
        r.segments ? el('span', { title: 'SMS segments billed' }, r.segments + ' SMS') : null,
      ]),
    ]);
  }

  // A poll never repaints the card someone is typing in.
  function paint() { paintHero(); if (!routeEl.contains(document.activeElement)) paintRoute(); paintFeed(); }

  await load();
  timer = setInterval(() => { if (!document.hidden && host.isConnected) load(); else if (!host.isConnected) clearInterval(timer); }, 20000);
}

export default renderSmsCenter;
