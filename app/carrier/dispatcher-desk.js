// dispatcher-desk.js — carrier portal "Dispatcher" tab (bl_disp_0408, 22 Sep 2026).
// One screen that follows the carrier from "not verified" to "dedicated dispatcher on the line":
//   not_started → in review → approved (countdown to assignment, 3 business days) → assigned
//   (contact locked until LoadBoot compliance releases it) → released (call / WhatsApp / e-mail,
//   call log, loads, reply time). Owner rules: the number shown is the LoadBoot line, never a
//   personal one; no "confirm your dispatcher" step — only Pause and Request a change.
// Backend: public.carrier_dispatcher_desk(), carrier_dispatcher_change_request(),
//   carrier_dispatcher_pause(), dispatcher_thread_list/send/mark_read (all existing + 0408).
import { carrierDispatcherDesk, carrierDispatcherChangeRequest, carrierDispatcherPause,
  dispatcherThreadList, dispatcherThreadSend, dispatcherThreadMarkRead } from '../shared/api.js';
import { el, mount } from '../shared/ui/dom.js';
import { icon } from '../shared/ui/icons.js';

const h = el;
const SLA_FALLBACK = 3;
const when = (v, o) => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : d.toLocaleString('en-US', o || { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const day = (v) => when(v, { weekday: 'short', month: 'short', day: 'numeric' });
const ago = (v) => { if (!v) return ''; const m = Math.round((Date.now() - new Date(v).getTime()) / 60000); if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; const hh = Math.round(m / 60); if (hh < 48) return hh + ' h ago'; return Math.round(hh / 24) + ' d ago'; };
const money = (v) => '$' + Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const mins = (s) => { s = Number(s || 0); if (s < 60) return s + 's'; const m = Math.floor(s / 60); return m + 'm ' + (s % 60) + 's'; };
const initials = (n) => (n || 'LB').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('') || 'LB';
const nav = (tab) => { try { if (location.hash === '#' + tab) { window.dispatchEvent(new HashChangeEvent('hashchange')); } else location.hash = '#' + tab; } catch (_) {} };   // 'tab/target' deep links are parsed by the carrier router (LB_DEEP)
const toast = (m, kind) => { try { (window.__lbUI && window.__lbUI.lbToast) ? window.__lbUI.lbToast(m, kind) : alert(m); } catch (_) {} };

const CSS = `
.dd-wrap{display:grid;gap:14px;max-width:1080px}
.dd-hero{position:relative;overflow:hidden;border-radius:22px;padding:22px 22px 20px;background:linear-gradient(135deg,#132a4d 0%,#0f1f3a 55%,#0d1a31 100%);border:1px solid rgba(255,255,255,.1);box-shadow:0 24px 50px -30px rgba(0,0,0,.8)}
.dd-hero:before{content:"";position:absolute;inset:-40% -20% auto auto;width:420px;height:420px;border-radius:50%;background:radial-gradient(closest-side,rgba(8,131,247,.28),rgba(8,131,247,0));pointer-events:none}
.dd-eyebrow{font-size:.68rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#7fb4ff;margin-bottom:8px}
.dd-h1{font-size:1.45rem;font-weight:900;color:#fff;letter-spacing:-.01em;line-height:1.2;margin:0 0 8px}
.dd-sub{color:#b9c8e2;font-size:.93rem;line-height:1.5;max-width:640px;margin:0}
.dd-pill{display:inline-flex;align-items:center;gap:6px;font-size:.7rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:5px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#dfe9fb}
.dd-pill.ok{background:rgba(52,211,153,.14);border-color:rgba(52,211,153,.4);color:#6ee7b7}
.dd-pill.warn{background:rgba(245,158,11,.14);border-color:rgba(245,158,11,.45);color:#fcd34d}
.dd-pill.bad{background:rgba(239,68,68,.14);border-color:rgba(239,68,68,.45);color:#fca5a5}
.dd-pill.blue{background:rgba(8,131,247,.16);border-color:rgba(8,131,247,.5);color:#8ec5ff}
.dd-steps{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-top:18px}
.dd-step{position:relative;padding:10px 4px 0;font-size:.72rem;color:#8ea2c3;text-align:center;line-height:1.25}
.dd-step:before{content:"";display:block;height:4px;border-radius:4px;background:rgba(255,255,255,.1);margin-bottom:8px}
.dd-step.done:before{background:#34d399}.dd-step.now:before{background:#0883F7;box-shadow:0 0 0 3px rgba(8,131,247,.25)}
.dd-step.done,.dd-step.now{color:#eaf1fb;font-weight:700}
.dd-count{display:flex;align-items:baseline;gap:10px;margin-top:16px;flex-wrap:wrap}
.dd-count b{font-size:2.6rem;font-weight:900;color:#fff;letter-spacing:-.03em;line-height:1}
.dd-count span{color:#b9c8e2;font-size:.9rem}
.dd-person{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.dd-avatar{width:64px;height:64px;border-radius:20px;display:grid;place-items:center;font-weight:900;font-size:1.35rem;color:#fff;background:linear-gradient(135deg,#0883F7,#FC5305);box-shadow:0 10px 24px -10px rgba(8,131,247,.8);flex:none}
.dd-badges{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.dd-actions{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:6px}
.dd-act{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:14px;border-radius:16px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:#eaf1fb;text-decoration:none;transition:transform .12s,background .12s}
.dd-act:hover{background:rgba(255,255,255,.08);transform:translateY(-1px)}
.dd-act .t{font-weight:800;font-size:.92rem;display:flex;align-items:center;gap:6px}
.dd-act .v{font-size:.8rem;color:#b9c8e2;word-break:break-all}
.dd-act.call .t{color:#8ec5ff}.dd-act.wa .t{color:#6ee7b7}.dd-act.mail .t{color:#fcd34d}
.dd-lock{display:flex;gap:14px;align-items:flex-start;padding:16px;border-radius:16px;border:1px dashed rgba(255,255,255,.2);background:rgba(255,255,255,.03)}
.dd-lock .ic{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:rgba(245,158,11,.14);color:#fcd34d;flex:none}
.dd-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.dd-stat{padding:14px;border-radius:16px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03)}
.dd-stat .k{font-size:.7rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#8ea2c3}
.dd-stat .v{font-size:1.35rem;font-weight:900;color:#fff;margin-top:4px;letter-spacing:-.02em}
.dd-stat .s{font-size:.74rem;color:#8ea2c3;margin-top:2px}
.dd-grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
.dd-act.off{opacity:.55;pointer-events:none}
.dd-cols{display:grid;grid-template-columns:1fr 1fr;gap:0 24px}
.dd-block{border-radius:20px;padding:16px 18px;background:linear-gradient(135deg,rgba(252,83,5,.16),rgba(252,83,5,.05) 60%,rgba(255,255,255,.02));border:1px solid rgba(252,83,5,.45)}
.dd-block .hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dd-block .hd b{color:#fff;font-size:1.02rem}
.dd-block .hd span{color:#f8c9b0;font-size:.86rem}
.dd-blist{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:12px}
.dd-bitem{display:flex;gap:12px;align-items:center;padding:12px 14px;border-radius:14px;background:rgba(10,19,34,.55);border:1px solid rgba(252,83,5,.35);color:#eaf1fb;text-decoration:none;transition:transform .12s,border-color .12s}
.dd-bitem:hover{transform:translateY(-1px);border-color:#FC5305}
.dd-bitem .n{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;background:#FC5305;color:#fff;font-weight:900;font-size:.8rem;flex:none}
.dd-bitem .m{flex:1;min-width:0}.dd-bitem .m b{display:block;font-size:.9rem}.dd-bitem .m span{display:block;font-size:.76rem;color:#f8c9b0;margin-top:1px}
.dd-bitem .go{font-weight:800;color:#ffb38a;white-space:nowrap;font-size:.82rem}
.dd-allok{display:flex;gap:12px;align-items:center;padding:14px 16px;border-radius:16px;background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.4);color:#d1fae5;font-size:.9rem}
.dd-sec{font-size:.7rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#7fb4ff;margin:14px 0 4px}
.dd-sec:first-child{margin-top:0}
.dd-thread.empty{height:auto}
.dd-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;color:#8ea2c3;font-size:.86rem;padding:14px 10px 8px}
.dd-chips{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}
.dd-chip{font-size:.78rem;font-weight:700;padding:6px 11px;border-radius:999px;border:1px solid rgba(8,131,247,.45);background:rgba(8,131,247,.12);color:#8ec5ff;cursor:pointer}
.dd-list{display:grid;gap:2px}
.dd-row{display:flex;gap:12px;align-items:center;padding:10px 6px;border-top:1px solid rgba(255,255,255,.07)}
.dd-row:first-child{border-top:0}
.dd-check{width:26px;height:26px;border-radius:9px;display:grid;place-items:center;flex:none;border:1px solid rgba(255,255,255,.14);color:#8ea2c3}
.dd-check.on{background:rgba(52,211,153,.16);border-color:rgba(52,211,153,.5);color:#6ee7b7}
.dd-row .l{flex:1;min-width:0}.dd-row .l b{display:block;color:#eaf1fb;font-size:.9rem}.dd-row .l span{display:block;color:#8ea2c3;font-size:.76rem;margin-top:1px}
.dd-row a.fix{font-size:.78rem;font-weight:800;color:#8ec5ff;text-decoration:none;white-space:nowrap}
.dd-ring{--p:0;width:64px;height:64px;border-radius:50%;background:conic-gradient(#0883F7 calc(var(--p)*1%),rgba(255,255,255,.08) 0);display:grid;place-items:center;flex:none}
.dd-ring i{width:50px;height:50px;border-radius:50%;background:#111c31;display:grid;place-items:center;font-style:normal;font-weight:900;color:#fff;font-size:.9rem}
.dd-faq{border-top:1px solid rgba(255,255,255,.07)}
.dd-faq summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:10px;padding:12px 4px;font-weight:800;color:#eaf1fb;font-size:.92rem}
.dd-faq summary::-webkit-details-marker{display:none}
.dd-faq summary .ic{width:30px;height:30px;border-radius:10px;display:grid;place-items:center;background:rgba(8,131,247,.14);color:#8ec5ff;flex:none}
.dd-faq p{margin:0 0 12px 44px;color:#b9c8e2;font-size:.86rem;line-height:1.55}
.dd-thread{height:300px;overflow:auto;padding:4px 2px;margin:8px 0;display:grid;gap:6px;align-content:start}
.dd-msg{max-width:84%;padding:8px 11px;border-radius:14px;font-size:.88rem;line-height:1.4;white-space:pre-wrap}
.dd-msg.me{margin-left:auto;background:rgba(8,131,247,.2);border:1px solid rgba(8,131,247,.38)}
.dd-msg.them{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1)}
.dd-msg.sys{max-width:100%;text-align:center;border:1px dashed rgba(255,255,255,.18);font-size:.8rem;opacity:.85}
.dd-msg .who{font-size:.64rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;opacity:.65;margin-bottom:2px}
.dd-call{display:flex;gap:10px;align-items:center;padding:9px 4px;border-top:1px solid rgba(255,255,255,.07)}
.dd-call .dir{width:30px;height:30px;border-radius:10px;display:grid;place-items:center;flex:none;background:rgba(255,255,255,.05);color:#8ea2c3}
.dd-call .dir.in{color:#6ee7b7}.dd-call .dir.out{color:#8ec5ff}
.dd-call .m{flex:1;min-width:0}.dd-call .m b{display:block;color:#eaf1fb;font-size:.86rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dd-call .m span{color:#8ea2c3;font-size:.74rem}
.dd-call .d{font-size:.78rem;color:#b9c8e2;white-space:nowrap}
.dd-delay{margin-top:16px;padding:16px 18px;border-radius:18px;background:rgba(10,19,34,.55);border:1px solid rgba(245,158,11,.45);display:grid;grid-template-columns:auto 1fr;gap:14px;align-items:start}
.dd-delay .ic{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;background:rgba(245,158,11,.16);color:#fcd34d}
.dd-delay h3{margin:0 0 4px;font-size:1rem;color:#fff}
.dd-delay p{margin:0;color:#dfe9fb;font-size:.9rem;line-height:1.55}
.dd-delay .why{margin-top:10px;display:grid;gap:6px}
.dd-delay .why div{display:flex;gap:8px;align-items:flex-start;font-size:.84rem;color:#b9c8e2}
.dd-delay .why b{color:#fcd34d;flex:none}
.dd-delay .note{margin-top:10px;padding:10px 12px;border-radius:12px;background:rgba(245,158,11,.08);border:1px dashed rgba(245,158,11,.4);font-size:.86rem;color:#fde68a}
.dd-delay .eta{display:inline-flex;align-items:center;gap:6px;margin-top:10px;font-weight:800;color:#fff;font-size:.9rem}
.dd-cta{display:inline-flex;align-items:center;gap:8px;padding:12px 18px;border-radius:14px;background:#0883F7;color:#fff;font-weight:800;border:0;cursor:pointer;font-size:.92rem;box-shadow:0 12px 26px -12px rgba(8,131,247,.9)}
.dd-cta.ghost{background:rgba(255,255,255,.07);box-shadow:none;border:1px solid rgba(255,255,255,.14)}
.dd-cta.danger{background:rgba(239,68,68,.14);color:#fca5a5;border:1px solid rgba(239,68,68,.4);box-shadow:none}
.dd-btnrow{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
.dd-wrap{container-type:inline-size}
@container (max-width:760px){.dd-delay{grid-template-columns:1fr}.dd-grid2,.dd-cols{grid-template-columns:1fr}.dd-thread{height:260px}.dd-actions{grid-template-columns:1fr}.dd-steps{grid-template-columns:repeat(5,minmax(0,1fr))}.dd-step{font-size:.62rem}.dd-hero{padding:18px 16px}.dd-h1{font-size:1.25rem}.dd-count b{font-size:2.1rem}.dd-stats{grid-template-columns:1fr 1fr}.dd-blist{grid-template-columns:1fr}.dd-btnrow{flex-direction:column;align-items:stretch}.dd-btnrow>div{display:grid!important;grid-template-columns:1fr 1fr;gap:8px}.dd-btnrow .dd-cta{width:100%;justify-content:center}.dd-person{flex-direction:row}.dd-avatar{width:52px;height:52px;border-radius:16px;font-size:1.1rem}.dd-act .v{font-size:.78rem}.dd-row .l b{font-size:.86rem}.dd-faq p{margin-left:0}}
@supports not (container-type:inline-size){@media (max-width:760px){.dd-grid2,.dd-cols{grid-template-columns:1fr}.dd-thread{height:260px}.dd-actions{grid-template-columns:1fr}.dd-steps{grid-template-columns:repeat(5,minmax(0,1fr))}.dd-step{font-size:.62rem}.dd-hero{padding:18px 16px}.dd-h1{font-size:1.25rem}.dd-count b{font-size:2.1rem}.dd-stats{grid-template-columns:1fr 1fr}.dd-blist{grid-template-columns:1fr}.dd-btnrow{flex-direction:column;align-items:stretch}.dd-btnrow>div{display:grid!important;grid-template-columns:1fr 1fr;gap:8px}.dd-btnrow .dd-cta{width:100%;justify-content:center}.dd-person{flex-direction:row}.dd-avatar{width:52px;height:52px;border-radius:16px;font-size:1.1rem}.dd-act .v{font-size:.78rem}.dd-row .l b{font-size:.86rem}.dd-faq p{margin-left:0}}}
`;
function ensureCss() { if (document.getElementById('dd-css')) return; const s = document.createElement('style'); s.id = 'dd-css'; s.textContent = CSS; document.head.appendChild(s); }

const card = (title, sub, body, right) => h('div', { class: 'cp-card' }, [
  h('div', { class: 'cp-cardhead' }, [h('div', null, [h('h3', null, title), sub ? h('span', { class: 'cp-cardhead-sub' }, sub) : null].filter(Boolean)), right || null].filter(Boolean)),
  body,
]);
const pill = (t, k) => h('span', { class: 'dd-pill ' + (k || '') }, t);

// ---------- what a carrier gets from a LoadBoot dispatcher (industry standard, plain words) ----------
const YOU_GET = [
  ['Load sourcing, every day', 'DAT / Truckstop / 123Loadboard, broker e-mail blasts and direct shippers — matched to your truck, lanes and rate floor.'],
  ['Rate negotiation', 'Every load is negotiated against live market rates and your cost per mile. Never below your floor.'],
  ['Broker vetting', 'MC/authority, credit and days-to-pay checked before a rate confirmation is signed. Double-brokering set-ups are refused.'],
  ['Paperwork handled', 'Carrier packet, rate confirmations, BOL flow — LoadBoot approves every RC before your driver moves.'],
  ['Check-calls and tracking', 'Pickup, in-transit and delivery updates to the broker, so you are not the one answering the phone.'],
  ['Detention, TONU, layover, lumper', 'Accessorials are claimed and chased for you — with the proof attached.'],
  ['Weekly plan and home time', 'The last load of the week ends where you live. Availability planned a day ahead.'],
  ['Invoicing support', 'Delivered-load paperwork bundled for your invoice or your factoring company.'],
  ['Compliance awareness', 'HOS-legal planning only. No illegal driving advice, ever.'],
  ['One shared thread', 'You, your dispatcher and LoadBoot in one place — nothing happens that LoadBoot cannot see.'],
];

const HOW = [
  ['dollar', 'Who pays your dispatcher?', 'LoadBoot does. Your only fee is the flat 5% of line haul on loads you deliver — your dispatcher\'s pay comes out of LoadBoot\'s side and is never added to your invoice. No base fee, no per-truck charge, nothing out of your pocket.'],
  ['globe', 'Where do we hire from?', 'Experienced US-freight dispatchers, hired remotely from a global pool and working US hours. Every one must already source and book loads themselves — their own load-board access or a live broker network — before they are even tested.'],
  ['award', 'How are they screened?', 'Government photo ID on file · an 18-question written skills test (75 minutes; at least 70% overall and 60% on compliance; must catch a double-brokering set-up and refuse an illegal-hours plan) · a spoken broker-negotiation drill · a signed Independent Dispatcher Agreement · then a 10-working-day monitored trial before they are confirmed.'],
  ['shield', 'Who supervises them?', 'LoadBoot dispatch. Calls go through a LoadBoot line and messages through the shared thread, so everything is logged and read. Every rate confirmation is approved by LoadBoot before your driver moves. Your dispatcher books under YOUR authority as your agent (FMCSA 88 FR 39368): never touches your money, never re-brokers, never books below your floor.'],
];

// ---------- why a match is taking longer than the promised window (reason set by CC; honest default otherwise) ----------
const DELAY_COPY = {
  authority_new: { title: 'Your authority is new — brokers are the bottleneck, not you',
    body: 'Most brokers will not tender freight to an MC younger than 90–180 days, and a dispatcher cannot book what brokers will not release. We are matching you with a dispatcher who works the brokers that do take new authorities, and that pool is smaller — so the match takes longer.',
    why: [['What we are doing', 'Placing you with a dispatcher who has active new-authority broker relationships and DAT/Truckstop access.'], ['What helps most', 'Keep insurance, W-9 and availability current — a complete packet is what those brokers check first.']] },
  capacity: { title: 'All our dispatchers are at full load right now',
    body: 'Every LoadBoot dispatcher carries a fixed number of trucks so your truck gets real attention, and every seat is taken this week. New dispatchers are in the final stage of screening.',
    why: [['What we are doing', 'Onboarding the next screened dispatchers and freeing a seat for you first.'], ['What helps most', 'Nothing on your side — you are next in line.']] },
  docs_pending: { title: 'One of your documents is still being verified',
    body: 'A dispatcher is assigned only once the packet brokers ask for is approved. One item is still with compliance; the countdown resumes the moment it clears.',
    why: [['What we are doing', 'Compliance is reviewing it now.'], ['What helps most', 'Check the Documents page — if something was sent back, a corrected copy clears it same day.']] },
  working: { title: 'We are working on it',
    body: 'Your match is taking longer than our usual window. Some matches need more time — the right dispatcher for your equipment and lanes is worth a day or two more than the wrong one.',
    why: [['What we are doing', 'LoadBoot dispatch is matching you by hand and checks in daily.'], ['What helps most', 'Keep availability current so the dispatcher can start the day they are assigned.']] },
  other: { title: 'Your match is taking longer than planned',
    body: 'LoadBoot dispatch has a specific reason on file for your account — it is in the note below.',
    why: [['What we are doing', 'Matching you by hand.'], ['What helps most', 'Reply on WhatsApp if anything on your side has changed.']] },
};
function delayCard(sla, program) {
  const dl = sla.delay || {}; const c = DELAY_COPY[dl.reason] || DELAY_COPY.working;
  return h('div', { class: 'dd-delay' }, [
    h('div', { class: 'ic' }, icon('clock', 22)),
    h('div', null, [
      h('h3', null, c.title), h('p', null, c.body),
      h('div', { class: 'why' }, c.why.map((r) => h('div', null, [h('b', null, r[0] + ':'), h('span', null, r[1])]))),
      dl.note ? h('div', { class: 'note' }, ['From LoadBoot dispatch: ', dl.note]) : null,
      dl.eta_days ? h('div', { class: 'eta' }, [icon('cal', 14), ' We expect to match you within ' + dl.eta_days + ' business day' + (dl.eta_days === 1 ? '' : 's')]) : null,
      h('div', { class: 'cp-row-s', style: 'margin-top:8px' }, ['Questions? WhatsApp us or write to ', h('a', { href: 'mailto:' + (program && program.escalation_email || 'dispatch@loadboot.com'), style: 'color:#8ec5ff' }, program && program.escalation_email || 'dispatch@loadboot.com'), ' — a person answers the same day.']),
    ]),
  ]);
}

export async function renderDispatcherDesk(host) {
  ensureCss();
  mount(host, h('div', { class: 'cp-muted' }, 'Loading your dispatcher desk…'));
  let d; try { d = await carrierDispatcherDesk(); } catch (e) { d = { error: (e && e.message) || 'load error' }; }
  if (!d || d.error) { mount(host, card('Dispatcher', null, h('div', { class: 'cp-err' }, d && d.error ? d.error : 'Could not load.'))); return; }
  const ob = d.onboarding || {}; const sla = d.sla || {}; const a = d.assignment; const dp = (a && a.dispatcher) || {};
  const released = !!(a && a.contact_released); const c = d.contact || {}; const perf = d.performance || null; const calls = d.calls || null;
  const stage = ob.stage || 'not_started';
  const slaDays = sla.business_days || SLA_FALLBACK;
  const ready = Array.isArray(d.readiness) ? d.readiness : []; const readyDone = ready.filter((r) => r.done).length; const readyPct = ready.length ? Math.round(100 * readyDone / ready.length) : 0;
  const firstLoad = !!(perf && perf.loads_total > 0);

  // ---------- journey ----------
  const inReview = ['submitted', 'docs_review', 'compliance_check', 'info_needed'].includes(stage);
  const approved = stage === 'approved';
  const steps = [['Verification', stage !== 'not_started', stage === 'not_started' || inReview], ['Approved', approved, false], ['Dispatcher assigned', !!a, approved && !a], ['Direct line released', released, !!a && !released], ['First load booked', firstLoad, released && !firstLoad]];
  const stepper = h('div', { class: 'dd-steps', role: 'list' }, steps.map((s) => h('div', { class: 'dd-step' + (s[1] ? ' done' : s[2] ? ' now' : ''), role: 'listitem' }, s[0])));

  // ---------- hero ----------
  let hero;
  if (a) {
    hero = h('div', { class: 'dd-hero', 'data-tour': 'disp-hero' }, [
      h('div', { style: 'display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap' }, [
        h('div', { class: 'dd-eyebrow' }, 'Your dedicated dispatcher'),
        a.status === 'paused' ? pill('Paused by you', 'warn') : pill('Active', 'ok'),
      ]),
      h('div', { class: 'dd-person' }, [
        h('div', { class: 'dd-avatar', 'aria-hidden': 'true' }, initials(dp.name)),
        h('div', { style: 'flex:1;min-width:200px' }, [
          h('h2', { class: 'dd-h1', style: 'margin-bottom:2px' }, dp.name || 'Your LoadBoot dispatcher'),
          h('p', { class: 'dd-sub' }, ['LoadBoot dispatcher', dp.city || dp.country ? ' · ' + [dp.city, dp.country].filter(Boolean).join(', ') : '', a.assigned_at ? ' · with you since ' + day(a.assigned_at) : ''].join('')),
          h('div', { class: 'dd-badges' }, [
            dp.skills_test_passed ? pill('Skills test passed' + (dp.skills_test_pct ? ' · ' + dp.skills_test_pct + '%' : ''), 'ok') : null,
            dp.id_verified ? pill('ID verified', 'ok') : null,
            pill('LoadBoot-supervised', 'blue'),   // owner call 22 Sep: trial vs permanent is between LoadBoot and the dispatcher — never shown to the carrier
            dp.us_hours ? pill('US hours', '') : null,
            dp.years_exp ? pill(dp.years_exp + ' yrs US freight', '') : null,
            dp.english_level ? pill('English · ' + dp.english_level, '') : null,
          ].filter(Boolean)),
        ]),
      ]),
      stepper,
    ]);
  } else if (approved) {
    const left = sla.business_days_left; const overdue = !!sla.overdue;
    hero = h('div', { class: 'dd-hero', 'data-tour': 'disp-hero' }, [
      h('div', { class: 'dd-eyebrow' }, 'Dedicated dispatcher'),
      h('h2', { class: 'dd-h1' }, overdue ? 'Your match is taking longer than ' + slaDays + ' business days' : 'Assigning your dedicated dispatcher'),
      h('p', { class: 'dd-sub' }, overdue
        ? 'The usual window (' + slaDays + ' business days from approval, ' + day(sla.assign_by) + ') has passed. Here is exactly why, and what happens next.'
        : 'You are verified. A screened LoadBoot dispatcher is assigned to your trucks within ' + slaDays + ' business days of approval — you will get an e-mail and an in-app notice the moment it happens.'),
      overdue ? delayCard(sla, d.program) : h('div', { class: 'dd-count' }, [h('b', null, String(left == null ? slaDays : left)), h('span', null, (left === 1 ? 'business day' : 'business days') + ' left · by ' + day(sla.assign_by))]),
      stepper,
    ]);
  } else if (stage === 'rejected') {
    hero = h('div', { class: 'dd-hero', 'data-tour': 'disp-hero' }, [h('div', { class: 'dd-eyebrow' }, 'Dedicated dispatcher'), h('h2', { class: 'dd-h1' }, 'Verification was not approved'), h('p', { class: 'dd-sub' }, ob.note || 'Contact support and we will tell you exactly what to fix.'), h('div', { class: 'dd-btnrow' }, [h('button', { class: 'dd-cta', onClick: () => nav('support') }, 'Talk to support')]), stepper]);
  } else if (stage === 'info_needed') {
    hero = h('div', { class: 'dd-hero', 'data-tour': 'disp-hero' }, [h('div', { class: 'dd-eyebrow' }, 'Dedicated dispatcher'), h('h2', { class: 'dd-h1' }, 'One thing is needed before we continue'), h('p', { class: 'dd-sub' }, ob.note || 'LoadBoot asked for a document fix — check your Documents page.'), h('div', { class: 'dd-btnrow' }, [h('button', { class: 'dd-cta', onClick: () => nav('documents') }, 'Open Documents')]), stepper]);
  } else if (inReview) {
    hero = h('div', { class: 'dd-hero', 'data-tour': 'disp-hero' }, [h('div', { class: 'dd-eyebrow' }, 'Dedicated dispatcher'), h('h2', { class: 'dd-h1' }, 'Verification in progress'), h('p', { class: 'dd-sub' }, 'LoadBoot is reviewing your documents (usually under 24 hours). The moment you are approved, the ' + slaDays + '-business-day clock starts and your dispatcher is assigned.'), ob.submitted_at ? h('p', { class: 'dd-sub', style: 'margin-top:6px;font-size:.8rem' }, 'Submitted ' + when(ob.submitted_at)) : null, stepper]);
  } else {
    hero = h('div', { class: 'dd-hero', 'data-tour': 'disp-hero' }, [h('div', { class: 'dd-eyebrow' }, 'Dedicated dispatcher'), h('h2', { class: 'dd-h1' }, 'A dedicated dispatcher is waiting for your trucks'), h('p', { class: 'dd-sub' }, 'Finish verification and LoadBoot assigns a screened, supervised dispatcher to you within ' + slaDays + ' business days. LoadBoot pays them — your only fee is the flat 5% on loads you deliver.'), h('div', { class: 'dd-btnrow' }, [h('button', { class: 'dd-cta', onClick: () => nav('onboarding') }, [icon('shield', 16), ' Start verification']), h('button', { class: 'dd-cta ghost', onClick: () => nav('documents') }, 'Upload documents')]), stepper]);
  }

  // ---------- contact: WhatsApp (the LoadBoot line) in EVERY state; dispatcher line + mailbox after release ----------
  const waNum = (d.program && d.program.whatsapp) || c.whatsapp || '';
  const waDigits = String(waNum).replace(/[^\d]/g, '');
  const waTile = waDigits
    ? h('a', { class: 'dd-act wa', href: 'https://wa.me/' + waDigits + '?text=' + encodeURIComponent('Hi LoadBoot dispatch — '), target: '_blank', rel: 'noopener' }, [h('span', { class: 't' }, [icon('chat', 15), ' WhatsApp LoadBoot']), h('span', { class: 'v' }, waNum), h('span', { class: 'v', style: 'font-size:.7rem' }, a ? 'Goes straight to ' + (dp.first_name || 'your dispatcher') + ' · LoadBoot reads it' : 'LoadBoot dispatch desk · answered by a person')])
    : h('div', { class: 'dd-act wa off' }, [h('span', { class: 't' }, [icon('chat', 15), ' WhatsApp LoadBoot']), h('span', { class: 'v' }, 'Number not set yet')]);
  const offTile = (cls, ic, label, note) => h('div', { class: 'dd-act ' + cls + ' off' }, [h('span', { class: 't' }, [icon(ic, 15), ' ' + label]), h('span', { class: 'v' }, note)]);
  const callTile = a && released
    ? (c.phone ? h('a', { class: 'dd-act call', href: 'tel:' + c.phone }, [h('span', { class: 't' }, [icon('phone', 15), ' Call or text ' + (dp.first_name || '')]), h('span', { class: 'v' }, c.phone), h('span', { class: 'v', style: 'font-size:.7rem' }, c.phone_label || 'LoadBoot line')]) : offTile('call', 'phone', 'Call or text', 'Line being provisioned — use WhatsApp or the thread'))
    : offTile('call', 'phone', 'Call or text', a ? 'Unlocks after LoadBoot\'s compliance check' : 'Your dispatcher\'s LoadBoot line appears here once assigned');
  const mailTile = a && released
    ? (c.email ? h('a', { class: 'dd-act mail', href: 'mailto:' + c.email }, [h('span', { class: 't' }, [icon('mail', 15), ' E-mail ' + (dp.first_name || '')]), h('span', { class: 'v' }, c.email), h('span', { class: 'v', style: 'font-size:.7rem' }, 'Company mailbox')]) : offTile('mail', 'mail', 'E-mail', 'Mailbox being set up'))
    : offTile('mail', 'mail', 'E-mail', a ? 'Unlocks after LoadBoot\'s compliance check' : 'Your dispatcher\'s company mailbox appears here once assigned');
  const contactSub = a && released ? 'Company line and mailbox — every call and message is logged with LoadBoot'
    : a ? 'WhatsApp works now · direct line and mailbox unlock after LoadBoot\'s compliance check (usually the first working day)'
    : 'One WhatsApp number for the whole company — write any time, before or after your dispatcher is assigned';
  const contact = card(a ? 'Reach ' + (dp.first_name || 'your dispatcher') : 'Reach LoadBoot dispatch', contactSub, h('div', null, [
    h('div', { class: 'dd-actions' }, [waTile, callTile, mailTile]),
    a && released ? h('div', { class: 'cp-row-s', style: 'margin-top:10px' }, ['Released by LoadBoot compliance ', when(a.contact_released_at), c.escalation_email ? [' · Not happy? Escalate to ', h('a', { href: 'mailto:' + c.escalation_email, style: 'color:#8ec5ff' }, c.escalation_email)] : null]) : null,
  ]));

  // ---------- stats + call log ----------
  let stats = null; let callLog = null;
  if (a && released) {
    stats = h('div', { class: 'dd-stats' }, [
      stat('Loads booked', perf ? perf.loads_total : 0, perf && perf.loads_delivered ? perf.loads_delivered + ' delivered' : 'under your MC'),
      stat('Gross this month', money(perf && perf.gross_month), 'booked, before the 5% fee'),
      stat('Avg rate', perf && perf.avg_rpm ? '$' + Number(perf.avg_rpm).toFixed(2) + '/mi' : '—', 'all loads booked for you'),
      stat('Reply time', perf && perf.reply_minutes_median != null ? Math.round(perf.reply_minutes_median) + ' min' : '—', 'median, last 30 days'),
      stat('Calls (30 d)', calls ? calls.count_30d : 0, calls ? (calls.minutes_30d || 0) + ' min on the line' : ''),
    ]);
    const rows = (calls && calls.recent) || [];
    callLog = card('Call log', 'Calls your dispatcher made and took for your trucks on the LoadBoot line', rows.length ? h('div', null, rows.map((r) => h('div', { class: 'dd-call' }, [
      h('div', { class: 'dd-dir dir ' + (r.direction === 'inbound' ? 'in' : 'out') }, icon(r.direction === 'inbound' ? 'back' : 'arrow', 14)),
      h('div', { class: 'm' }, [h('b', null, (r.who || 'Unknown') + (r.kind ? ' · ' + r.kind : '')), h('span', null, [when(r.at), r.outcome ? ' · ' + r.outcome : r.status ? ' · ' + r.status : ''])]),
      h('div', { class: 'd' }, r.answered ? mins(r.duration_sec) : 'no answer'),
    ]))) : h('div', { class: 'cp-muted' }, 'No calls logged yet. Broker and shipper calls for your trucks will show here, with duration and outcome.'));
  }

  // ---------- blockers: what stops the dispatcher from working today, each with its exact deep link ----------
  const missing = ready.filter((r) => !r.done);
  const hard = missing.filter((r) => r.blocker !== false);
  const soft = missing.filter((r) => r.blocker === false);
  const linkOf = (r) => r.link || r.tab || 'account';
  const bitem = (r, i) => h('a', { class: 'dd-bitem', href: '#' + linkOf(r), onClick: (e) => { e.preventDefault(); nav(linkOf(r)); } }, [
    h('span', { class: 'n' }, String(i + 1)), h('span', { class: 'm' }, [h('b', null, r.label), h('span', null, r.detail || r.why || '')]), h('span', { class: 'go' }, 'Fix now →')]);
  const blockers = stage === 'not_started' || stage === 'rejected' ? null
    : hard.length ? h('div', { class: 'dd-block' }, [
        h('div', { class: 'hd' }, [icon('alert', 18), h('b', null, hard.length === 1 ? '1 thing is stopping your dispatcher from booking' : hard.length + ' things are stopping your dispatcher from booking'), h('span', null, '— each link opens the exact field')]),
        h('div', { class: 'dd-blist' }, hard.map(bitem)),
        soft.length ? h('div', { class: 'cp-row-s', style: 'margin-top:10px;color:#f8c9b0' }, ['Also worth setting: ', soft.map((r, i) => [i ? ' · ' : '', h('a', { href: '#' + linkOf(r), style: 'color:#ffb38a;font-weight:700', onClick: (e) => { e.preventDefault(); nav(linkOf(r)); } }, r.label)])]) : null,
      ])
    : h('div', { class: 'dd-allok' }, [icon('check', 18), h('div', null, [h('b', { style: 'color:#fff' }, 'Nothing is blocking your dispatcher. '), soft.length ? ['Optional: ', soft.map((r, i) => [i ? ' · ' : '', h('a', { href: '#' + linkOf(r), style: 'color:#6ee7b7;font-weight:700', onClick: (e) => { e.preventDefault(); nav(linkOf(r)); } }, r.label)])] : 'Every item on the checklist is done.'])]);

  // ---------- setup card: rules (if assigned) + readiness, one card, rows in two columns ----------
  const row = (on, label, why, fixTab) => h('div', { class: 'dd-row' }, [
    h('div', { class: 'dd-check' + (on ? ' on' : '') }, icon(on ? 'check' : 'dot', 13)),
    h('div', { class: 'l' }, [h('b', null, label), why ? h('span', null, why) : null]),
    on || !fixTab ? null : h('a', { class: 'fix', href: '#' + fixTab, onClick: (e) => { e.preventDefault(); nav(fixTab); } }, 'Fix →'),
  ]);
  let sopRows = [];
  if (a && a.sop && Object.keys(a.sop).length) {
    const s = a.sop;
    if (s.min_rate) sopRows.push(['Rate floor', '$' + s.min_rate + '/mi' + (s.min_rate_note ? ' · ' + s.min_rate_note : '')]);
    if (s.home_time) sopRows.push(['Home time', s.home_time]);
    if (s.truck) sopRows.push(['Trucks covered', s.truck]);
    if (s.scope || s.scope_basis) sopRows.push(['Scope', s.scope || s.scope_basis]);
    sopRows.push(['Before the driver moves', 'RC goes to LoadBoot first' + (s.driver_moves_only_after_approval === false ? '' : ' · driver moves only after approval')]);
  }
  const setup = card(a ? 'Your setup with ' + (dp.first_name || 'your dispatcher') : 'What your dispatcher needs from you',
    readyDone + ' of ' + ready.length + ' ready — every missing item is a load you cannot take', h('div', null, [
      sopRows.length ? h('div', { class: 'dd-sec' }, 'Rules your dispatcher works to · change them in Account → Dispatch') : null,
      sopRows.length ? h('div', { class: 'dd-cols' }, sopRows.map((r) => row(true, r[0], r[1]))) : null,
      sopRows.length ? h('div', { class: 'dd-sec' }, 'What your dispatcher needs from you') : null,
      h('div', { class: 'dd-cols' }, ready.map((r) => row(!!r.done, r.label, r.detail ? r.detail + ' · ' + (r.why || '') : r.why, r.link || r.tab || 'account'))),
    ]), h('div', { class: 'dd-ring', style: '--p:' + readyPct + ';width:52px;height:52px' }, h('i', { style: 'width:40px;height:40px;font-size:.78rem' }, readyPct + '%')));
  const readiness = setup; const sop = null;

  // ---------- thread + actions ----------
  let thread = null;
  if (a) {
    const box = h('div', { class: 'dd-thread', role: 'log', 'aria-live': 'polite' });
    const inp = h('textarea', { class: 'cp-in', rows: 2, placeholder: 'Message ' + (dp.first_name || 'your dispatcher') + ' — LoadBoot sees this too…' });
    const err = h('div', { class: 'cp-err', style: 'display:none' });
    const paint = async () => {
      try {
        const r = await dispatcherThreadList(a.assignment_id, 120); if (r && r.error) throw new Error(r.error);
        const ms = (r && r.messages) || [];
        box.classList.toggle('empty', !ms.length);
        mount(box, ms.length ? ms.map((m) => h('div', { class: 'dd-msg ' + (m.mine ? 'me' : m.role === 'system' ? 'sys' : 'them') }, [
          m.role !== 'system' ? h('div', { class: 'who' }, (m.mine ? 'you' : m.role === 'staff' ? 'LoadBoot' : (m.by || dp.first_name || m.role)) + ' · ' + when(m.at)) : null, m.body])) : h('div', { class: 'dd-empty' }, [h('div', null, [h('b', { style: 'color:#eaf1fb' }, 'No messages yet.'), ' Pickup details, availability and rate questions all live here — LoadBoot reads along.']), h('div', { class: 'dd-chips' }, ['My truck is empty from ', 'What is the rate on this load?', 'Call me before booking', 'Driver is off this weekend'].map((t) => h('button', { class: 'dd-chip', type: 'button', onClick: () => { inp.value = t; inp.focus(); } }, t)))]));
        box.scrollTop = box.scrollHeight; dispatcherThreadMarkRead(a.assignment_id).catch(() => {});
      } catch (e) { mount(box, h('div', { class: 'cp-muted' }, (e && e.message) || 'Could not load messages.')); }
    };
    const send = h('button', { class: 'dd-cta', onClick: async () => { const t = (inp.value || '').trim(); if (!t) return; send.disabled = true; err.style.display = 'none'; try { const r = await dispatcherThreadSend(a.assignment_id, t); if (r && r.error) throw new Error(r.error); inp.value = ''; await paint(); } catch (e) { err.textContent = (e && e.message) || 'Could not send.'; err.style.display = 'block'; } send.disabled = false; } }, [icon('send', 15), ' Send']);
    // Pause / resume + change request (owner rule: no confirm step, only these two)
    const pauseBtn = h('button', { class: 'dd-cta ghost', onClick: async () => {
      const pausing = a.status !== 'paused'; const reason = pausing ? prompt('Pause your dispatcher — tell them why (truck down, home time, …):', '') : null; if (pausing && reason === null) return;
      pauseBtn.disabled = true; try { const r = await carrierDispatcherPause(a.assignment_id, pausing, reason || null); if (r && r.error) throw new Error(r.error); toast(pausing ? 'Dispatcher paused — nothing is booked until you resume.' : 'Dispatcher resumed.'); renderDispatcherDesk(host); } catch (e) { toast((e && e.message) || 'Could not update.', 'error'); pauseBtn.disabled = false; }
    } }, a.status === 'paused' ? [icon('play', 14), ' Resume dispatcher'] : [icon('pause', 14), ' Pause bookings']);
    const chgHost = h('div');
    const chgBtn = h('button', { class: 'dd-cta danger', onClick: () => {
      const ta = h('textarea', { class: 'cp-in', rows: 3, placeholder: 'What went wrong? One line is enough — LoadBoot dispatch reads it today.' }); const e2 = h('div', { class: 'cp-err', style: 'display:none' });
      const go = h('button', { class: 'dd-cta danger', onClick: async () => { go.disabled = true; try { const r = await carrierDispatcherChangeRequest(ta.value); if (r && r.error) throw new Error(r.error); mount(chgHost, h('div', { class: 'cp-row-s', style: 'margin-top:8px;color:#6ee7b7' }, '✓ Sent to LoadBoot dispatch. We reply in the thread, usually the same day.')); } catch (e) { e2.textContent = (e && e.message) || 'Could not send.'; e2.style.display = 'block'; go.disabled = false; } } }, 'Send request');
      mount(chgHost, h('div', { style: 'margin-top:10px;padding:12px;border-radius:14px;border:1px solid rgba(239,68,68,.35);background:rgba(239,68,68,.06)' }, [h('div', { style: 'font-weight:800;color:#fca5a5;margin-bottom:6px' }, 'Ask LoadBoot for a different dispatcher'), ta, e2, h('div', { class: 'dd-btnrow' }, [go, h('button', { class: 'dd-cta ghost', onClick: () => mount(chgHost, []) }, 'Cancel')])]));
    } }, 'Request a change');
    thread = card('Shared thread', 'You · ' + (dp.first_name || 'your dispatcher') + ' · LoadBoot', h('div', { class: 'dd-body' }, [
      box, inp, err,
      h('div', { class: 'dd-btnrow', style: 'justify-content:space-between' }, [send, h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [pauseBtn, chgBtn])]),
      chgHost,
    ]), d.thread && d.thread.unread ? pill(d.thread.unread + ' new', 'blue') : null);
    paint();
  }

  // ---------- what you get + how it works ----------
  const youGet = card('What your dispatcher does for you', 'The standard every LoadBoot dispatcher is held to', h('div', { class: 'dd-list' }, YOU_GET.map((r) => h('div', { class: 'dd-row' }, [h('div', { class: 'dd-check on' }, icon('check', 13)), h('div', { class: 'l' }, [h('b', null, r[0]), h('span', null, r[1])])]))));
  const how = card('How the LoadBoot dispatcher program works', 'Plain answers to the four questions every carrier asks', h('div', null, HOW.map((r, i) => h('details', { class: 'dd-faq', open: window.innerWidth > 560 }, [h('summary', null, [h('span', { class: 'ic' }, icon(r[0], 15)), r[1]]), h('p', null, r[2])]))));

  mount(host, h('div', { class: 'dd-wrap' }, [
    hero,
    blockers,
    contact,
    stats,
    thread,
    setup,
    callLog,
    h('div', { class: 'dd-grid2' }, [youGet, how]),
  ].filter(Boolean)));
}

function stat(k, v, s) { return h('div', { class: 'dd-stat' }, [h('div', { class: 'k' }, k), h('div', { class: 'v' }, String(v == null ? '—' : v)), s ? h('div', { class: 's' }, s) : null].filter(Boolean)); }
