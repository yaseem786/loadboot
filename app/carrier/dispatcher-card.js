// dispatcher-card.js — carrier DASHBOARD: compact "Meet your dispatcher" card (bl_disp_0409, 23 Sep 2026).
// Replaces the 2026-08-29 full card (thread, SOP, availability, confirm step). All of that now lives in the
// Dispatcher tab (dispatcher-desk.js); the owner asked the dashboard to show only WHO the dispatcher is and
// WHAT STATE things are in. Reads the same RPC as the tab, so the contact-release rule holds here too:
// nothing personal is shown, the dispatcher's line/mailbox appear only after CC releases them.
import { carrierDispatcherDesk } from '../shared/api.js';
import { el, mount } from '../shared/ui/dom.js';
import { icon } from '../shared/ui/icons.js';

const h = el;
const day = (v) => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); };
const initials = (n) => (n || 'LB').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('') || 'LB';
const go = (tab) => { try { location.hash = '#' + tab; } catch (_) {} };

const CSS = `
.dc-card{position:relative;overflow:hidden;border-radius:20px;padding:16px 18px;background:linear-gradient(135deg,#132a4d 0%,#0f1f3a 60%,#0d1a31 100%);border:1px solid rgba(255,255,255,.1);box-shadow:0 18px 40px -28px rgba(0,0,0,.8);margin-bottom:12px;container-type:inline-size}
.dc-card:before{content:"";position:absolute;inset:-60% -10% auto auto;width:320px;height:320px;border-radius:50%;background:radial-gradient(closest-side,rgba(8,131,247,.25),rgba(8,131,247,0));pointer-events:none}
.dc-eyebrow{font-size:.66rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#7fb4ff;margin-bottom:8px}
.dc-row{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.dc-avatar{width:50px;height:50px;border-radius:16px;display:grid;place-items:center;font-weight:900;font-size:1.05rem;color:#fff;background:linear-gradient(135deg,#0883F7,#FC5305);box-shadow:0 10px 22px -10px rgba(8,131,247,.8);flex:none}
.dc-avatar.wait{background:rgba(255,255,255,.08);border:1px dashed rgba(255,255,255,.3);box-shadow:none;color:#8ea2c3}
.dc-main{flex:1;min-width:180px}
.dc-name{font-size:1.08rem;font-weight:900;color:#fff;letter-spacing:-.01em;line-height:1.2}
.dc-sub{color:#b9c8e2;font-size:.84rem;margin-top:2px}
.dc-pill{display:inline-flex;align-items:center;gap:5px;font-size:.66rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:4px 9px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#dfe9fb;white-space:nowrap}
.dc-pill.ok{background:rgba(52,211,153,.14);border-color:rgba(52,211,153,.4);color:#6ee7b7}
.dc-pill.warn{background:rgba(245,158,11,.14);border-color:rgba(245,158,11,.45);color:#fcd34d}
.dc-pill.blue{background:rgba(8,131,247,.16);border-color:rgba(8,131,247,.5);color:#8ec5ff}
.dc-pill.bad{background:rgba(239,68,68,.14);border-color:rgba(239,68,68,.45);color:#fca5a5}
.dc-next{display:flex;gap:10px;align-items:center;margin-top:12px;padding:10px 12px;border-radius:12px;background:rgba(10,19,34,.5);border:1px solid rgba(255,255,255,.08);font-size:.84rem;color:#dfe9fb}
.dc-next.hot{border-color:rgba(252,83,5,.45);background:rgba(252,83,5,.08)}
.dc-next .ic{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;flex:none;background:rgba(255,255,255,.06);color:#8ea2c3}
.dc-next.hot .ic{background:#FC5305;color:#fff}
.dc-next b{color:#fff}
.dc-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.dc-btn{display:inline-flex;align-items:center;gap:7px;padding:9px 14px;border-radius:12px;font-weight:800;font-size:.84rem;border:0;cursor:pointer;text-decoration:none;color:#fff;background:#0883F7;box-shadow:0 10px 22px -12px rgba(8,131,247,.9)}
.dc-btn.ghost{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);box-shadow:none}
.dc-btn.wa{background:rgba(52,211,153,.14);border:1px solid rgba(52,211,153,.4);color:#6ee7b7;box-shadow:none}
@container (max-width:520px){.dc-acts .dc-btn{flex:1 1 auto;justify-content:center}.dc-name{font-size:1rem}}
`;
function ensureCss() { if (document.getElementById('dc-css')) return; const s = document.createElement('style'); s.id = 'dc-css'; s.textContent = CSS; document.head.appendChild(s); }
const pill = (t, k) => h('span', { class: 'dc-pill ' + (k || '') }, t);

export async function mountDispatcherCard(host) {
  let d; try { d = await carrierDispatcherDesk(); } catch (_) { d = null; }
  if (!d || d.error) { host.remove(); return; }
  ensureCss();
  const stage = (d.onboarding && d.onboarding.stage) || 'not_started';
  if (stage === 'not_started' || stage === 'rejected') { host.remove(); return; }   // the onboarding hero already owns these states
  const a = d.assignment; const dp = (a && a.dispatcher) || {}; const sla = d.sla || {};
  const released = !!(a && a.contact_released);
  const ready = Array.isArray(d.readiness) ? d.readiness : [];
  const hard = ready.filter((r) => !r.done && r.blocker !== false);
  const wa = d.program && d.program.whatsapp ? String(d.program.whatsapp).replace(/[^\d]/g, '') : '';
  const unread = (d.thread && d.thread.unread) || 0;

  // headline + status pill per state
  let name, sub, status, avatar;
  if (a) {
    name = dp.name || 'Your LoadBoot dispatcher';
    sub = 'Your dedicated LoadBoot dispatcher' + (a.assigned_at ? ' · since ' + day(a.assigned_at) : '') + (released ? '' : ' · direct line after compliance check') + ' · reaches you only from the LoadBoot line and your LoadBoot group — anything else, report it in the Dispatcher tab';
    status = a.status === 'paused' ? pill('Paused by you', 'warn') : pill('Active', 'ok');
    avatar = h('div', { class: 'dc-avatar' }, initials(dp.name));
  } else if (stage === 'approved') {
    name = sla.overdue ? 'Matching your dispatcher' : 'Dispatcher on the way';
    sub = sla.overdue ? 'LoadBoot dispatch is matching you by hand — we answer the same day' : (sla.business_days_left == null ? sla.business_days : sla.business_days_left) + ' business day' + (sla.business_days_left === 1 ? '' : 's') + ' left · by ' + day(sla.assign_by);
    status = pill(sla.overdue ? 'Matching' : 'Assigning', 'blue');
    avatar = h('div', { class: 'dc-avatar wait' }, icon('clock', 20));
  } else if (stage === 'info_needed') {
    name = 'One thing needed'; sub = 'LoadBoot asked for a document fix before your dispatcher is assigned'; status = pill('Action needed', 'bad'); avatar = h('div', { class: 'dc-avatar wait' }, icon('alert', 20));
  } else {
    name = 'Verification in review'; sub = 'Usually under 24 hours · your dispatcher is assigned within ' + (sla.business_days || 3) + ' business days of approval'; status = pill('In review', 'warn'); avatar = h('div', { class: 'dc-avatar wait' }, icon('shield', 20));
  }

  // the ONE next thing
  let next;
  if (hard.length) next = h('div', { class: 'dc-next hot' }, [h('span', { class: 'ic' }, icon('alert', 14)), h('div', null, [h('b', null, hard.length === 1 ? '1 thing is stopping your dispatcher: ' : hard.length + ' things are stopping your dispatcher: '), hard[0].label + (hard[0].detail ? ' — ' + hard[0].detail : ''), hard.length > 1 ? ' +' + (hard.length - 1) + ' more' : ''])]);
  else if (a && unread) next = h('div', { class: 'dc-next' }, [h('span', { class: 'ic' }, icon('chat', 14)), h('div', null, [h('b', null, unread + ' new message' + (unread > 1 ? 's' : '')), ' from ' + (dp.first_name || 'your dispatcher')])]);
  else if (a) next = h('div', { class: 'dc-next' }, [h('span', { class: 'ic' }, icon('check', 14)), h('div', null, [h('b', null, 'All set. '), 'Keep availability current — ' + (dp.first_name || 'your dispatcher') + ' plans from it every morning.'])]);
  else next = null;

  mount(host, h('div', { class: 'dc-card' }, [
    h('div', { class: 'dc-eyebrow' }, a ? 'Meet your dispatcher' : 'Your dedicated dispatcher'),
    h('div', { class: 'dc-row' }, [avatar, h('div', { class: 'dc-main' }, [h('div', { class: 'dc-name' }, name), h('div', { class: 'dc-sub' }, sub)]), status]),
    next,
    h('div', { class: 'dc-acts' }, [
      h('button', { class: 'dc-btn', type: 'button', onClick: () => go('dispatcher') }, [icon('handshake', 15), a ? ' Open Dispatcher tab' : ' See what happens next']),
      a ? h('button', { class: 'dc-btn ghost', type: 'button', onClick: () => go('dispatcher') }, [icon('chat', 15), ' Message ' + (dp.first_name || 'dispatcher')]) : null,
      wa ? h('a', { class: 'dc-btn wa', href: 'https://wa.me/' + wa, target: '_blank', rel: 'noopener' }, [icon('chat', 15), ' WhatsApp']) : null,
    ].filter(Boolean)),
  ]));
}
