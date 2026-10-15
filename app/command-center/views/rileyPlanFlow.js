// Command Center — "Plan a call" (Riley call plans) — bl_voice_0483 (27 Sep 2026)
//
// One popup, used from Carrier 360, Carrier choices and Riley → Call plans: pick why we are calling, add a note,
// and the Ops Brain writes Riley's briefing (goal, opener, five talking points, confirm, do-not-say, best time,
// language). Nothing dials from here — the plan is read first under Riley → Call plans, where it is booked
// (bl_voice_0485, gated by `tool.schedule_riley_call` in CC → AI Brain → Permissions). Popup = openDrawer (CLAUDE.md §8).

import { el, mount } from '../../shared/ui/dom.js';
import { openDrawer } from '../../shared/ui/components.js';
import { ccRileyPlanCreate, ccRileyPlanCreateTarget, ccRileyNumberCheck } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';

export const PLAN_REASONS = [
  ['welcome',          'Welcome — new carrier: what is missing to get dispatched'],
  ['onboarding_gap',   'Onboarding gap — signed up, did not finish'],
  ['document_missing', 'Document missing or rejected'],
  ['choice_pending',   'Dispatcher choice pending — explain the trial'],
  ['no_reply',         'No reply to our email / message'],
  ['custom',           'Custom — say what to cover in the note'],
];
export const PLAN_REASON_LABEL = Object.assign(Object.fromEntries(PLAN_REASONS.map(([k, l]) => [k, l.split(' — ')[0]])), { follow_up: 'Follow-up call' });
export const PLAN_STATUS = {
  planning: ['Planning…', 'a'], ready: ['Plan ready', 'g'], failed: ['Failed', 'r'],
  scheduled: ['Call booked', 'b'], dialing: ['Riley is calling', 'b'], called: ['Called', 'm'], no_answer: ['No answer', 'a'], cancelled: ['Cancelled', 'm'],
};
// bl_voice_0485 — the next step after a call (brain or rule)
export const NEXT_ACTION = { second_call: 'Second call', email: 'Follow-up email', staff_task: 'Task for a person', none: 'Nothing needed' };
export const planLink = (id) => '#/riley?tab=plans' + (id ? '&id=' + encodeURIComponent(id) : '');

// bl_voice_0555 — a call to someone else: who they are and their zone (Riley calls them Mon–Fri 9:00–17:00 their time)
export const TARGET_ROLES = [['factoring', 'Factoring company'], ['insurance', 'Insurance agent / insurer'], ['broker', 'Broker'], ['shipper', 'Shipper'], ['other', 'Other business']];
export const TARGET_ROLE_LABEL = Object.fromEntries(TARGET_ROLES);
export const US_TZ = [['America/New_York', 'Eastern'], ['America/Chicago', 'Central'], ['America/Denver', 'Mountain'], ['America/Phoenix', 'Arizona'],
  ['America/Los_Angeles', 'Pacific'], ['America/Anchorage', 'Alaska'], ['Pacific/Honolulu', 'Hawaii'], ['America/Puerto_Rico', 'Puerto Rico']];
export const tzLabel = (tz) => (US_TZ.find(([v]) => v === tz) || [null, tz ? tz.replace('_', ' ') : 'unknown'])[1];

/** Open the "Plan a call" popup for one carrier, or (orgId null) a custom call with no carrier.
 *  opts: { reason, note, onDone(plan) } */
export function planCallFlow(orgId, orgName, opts = {}) {
  const custom = !orgId;   // "Custom call" from Riley → Call plans: always someone else, purpose note required
  const reason = el('select', { class: 'cc-input' }, PLAN_REASONS.map(([v, l]) => el('option', { value: v, selected: v === (opts.reason || (custom ? 'custom' : 'welcome')) ? 'selected' : undefined }, l)));
  const note = el('textarea', { class: 'cc-input', rows: '4' });
  if (opts.note) note.value = opts.note;
  const lang = el('select', { class: 'cc-input' }, [['en', 'English'], ['es', 'Spanish']].map(([v, l]) => el('option', { value: v }, l)));

  // target: the carrier | someone else for this carrier
  let who = custom ? 'other' : 'carrier';
  const tName = el('input', { class: 'cc-input', maxlength: '120', placeholder: 'e.g. Maria Lopez' });
  const tOrg = el('input', { class: 'cc-input', maxlength: '160', placeholder: 'e.g. Triumph Factoring' });
  const tRole = el('select', { class: 'cc-input' }, [el('option', { value: '' }, 'Pick their role…'), ...TARGET_ROLES.map(([v, l]) => el('option', { value: v }, l))]);
  const tNum = el('input', { class: 'cc-input', type: 'tel', placeholder: '+1 (555) 555-0123' });
  const tTz = el('select', { class: 'cc-input' }, [el('option', { value: '' }, 'Their time zone…'), ...US_TZ.map(([v, l]) => el('option', { value: v }, l))]);
  const numInfo = el('div', { class: 'cc-sub', style: 'font-size:12px;min-height:16px' }, '');
  let tzTouched = false; tTz.addEventListener('change', () => { tzTouched = true; });
  tNum.addEventListener('blur', async () => {
    const v = tNum.value.trim(); if (!v) { mount(numInfo, ''); return; }
    try {
      const r = await ccRileyNumberCheck(v);
      if (!r || !r.valid) { mount(numInfo, el('span', { style: 'color:#b91c1c' }, (r && r.reason) || 'Not a valid US number.')); return; }
      tNum.value = r.e164;
      if (r.tz && !tzTouched) tTz.value = r.tz;
      const warn = [r.dnc ? 'On the Riley do-not-call list: ' + r.dnc.reason : null, r.sms_stop ? 'This number texted STOP — Riley will not call it.' : null,
        r.is_carrier ? 'This is a LoadBoot carrier’s number — use “The carrier” on their page instead.' : null].filter(Boolean);
      mount(numInfo, warn.length ? el('span', { style: 'color:#b91c1c;font-weight:600' }, warn.join(' · '))
        : el('span', null, r.tz ? 'Time zone from the area code: ' + tzLabel(r.tz) + ' — change it if they are elsewhere.' : 'The area code does not tell the time zone — pick it.'));
    } catch (e) { mount(numInfo, el('span', { style: 'color:#b91c1c' }, humanizeError(e))); }
  });
  const otherBox = el('div', { style: 'display:grid;gap:8px;padding:10px 12px;border:1px solid var(--line,#e2e8f0);border-radius:12px' }, [
    el('div', { class: 'cc-field' }, [el('span', null, 'Their name'), tName]),
    el('div', { class: 'cc-field' }, [el('span', null, 'Organisation'), tOrg]),
    el('div', { class: 'cc-field' }, [el('span', null, 'Role'), tRole]),
    el('div', { class: 'cc-field' }, [el('span', null, 'Phone'), tNum, numInfo]),
    el('div', { class: 'cc-field' }, [el('span', null, 'Time zone'), tTz]),
    el('div', { class: 'cc-sub', style: 'font-size:12px' }, 'Riley opens: “Hi, this is Riley, an AI assistant calling on behalf of LoadBoot … this call is recorded.” She asks only what your note needs — never bank or account numbers, TIN or insurance amounts; “confirm X” becomes a yes / no question. Calls Mon–Fri 9:00–17:00 their time, one per number per day. Business calls only — no sales or marketing.'),
  ]);
  const help = el('p', { class: 'cc-sub', style: 'margin:0 0 6px' });
  const paintWho = () => {
    otherBox.style.display = who === 'other' ? '' : 'none';
    note.placeholder = who === 'other' ? 'Required — what Riley must find out, in your words. e.g. “Confirm the NOA for this carrier is on file. Ask where rate confirmations go.”'
      : 'What Riley must cover or avoid, in your words. Optional — the brain already reads the carrier file.';
    help.textContent = who === 'other'
      ? 'The Ops Brain gets your note plus only what it needs about the carrier (name, MC/DOT, dispatcher, the documents your note names — status only). Nothing is dialled — you read the plan first.'
      : 'The Ops Brain reads this carrier’s file (application, documents, trucks, dispatcher, pending choices, past Riley calls) and writes Riley’s briefing: goal, opener, five talking points, what to confirm, what not to say, best time. Nothing is dialled — you read the plan first.';
  };
  const radio = (v, label) => el('label', { style: 'display:flex;gap:8px;align-items:center;font-weight:600;cursor:pointer' }, [
    el('input', { type: 'radio', name: 'ry-who', checked: who === v ? true : undefined, onChange: () => { who = v; paintWho(); } }), label]);
  const whoField = custom ? null : el('div', { class: 'cc-field' }, [el('span', null, 'Who does Riley call?'),
    el('div', { style: 'display:flex;gap:18px;flex-wrap:wrap' }, [radio('carrier', 'The carrier'), radio('other', 'Someone else for this carrier')])]);
  paintWho();

  const btn = el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev) => {
    const b = ev.currentTarget;
    if (who === 'other') {
      const miss = [!tName.value.trim() && 'their name', !tRole.value && 'their role', !tNum.value.trim() && 'their phone', !note.value.trim() && 'the purpose note'].filter(Boolean);
      if (miss.length) { toast('Add ' + miss.join(', ') + '.', 'error'); return; }
    }
    b.disabled = true; b.textContent = 'Asking the brain…';
    try {
      const r = who === 'other'
        ? await ccRileyPlanCreateTarget(orgId || null, reason.value, note.value.trim(), lang.value,
            { name: tName.value.trim(), org: tOrg.value.trim() || null, role: tRole.value, number: tNum.value.trim(), tz: tTz.value || null })
        : await ccRileyPlanCreate(orgId, reason.value, note.value.trim() || null, lang.value);
      if (r && r.error) throw new Error(r.error);
      dr.close();
      toast(r.reused ? 'A plan for this call is already being written — opening it.' : 'Plan requested. Riley → Call plans shows it in a few seconds.');
      if (typeof opts.onDone === 'function') opts.onDone(r); else location.hash = planLink(r.id);
    } catch (e) { toast(humanizeError(e), 'error'); b.disabled = false; b.textContent = 'Plan the call'; }
  } }, 'Plan the call');
  const dr = openDrawer(custom ? 'Custom call — no carrier' : 'Plan a call — ' + (orgName || 'carrier'), el('div', { class: 'cc-form' }, [
    help, whoField, otherBox,
    el('div', { class: 'cc-field' }, [el('span', null, 'Why this call'), reason]),
    el('div', { class: 'cc-field' }, [el('span', null, custom ? 'Purpose of the call (required)' : 'Note for the brain'), note]),
    el('div', { class: 'cc-field' }, [el('span', null, 'Call language'), lang]),
    el('div', { class: 'cc-sub', style: 'font-size:12px' }, 'Cost: brain ≈ $0.01–0.05 per plan · Retell ≈ $0.13/min, only if the call is booked (≈ $0.52 for a 4-minute call). Carrier calls go only to the number the carrier gave at signup (TCPA); never to a demo account.'),
    el('div', { style: 'display:flex;justify-content:flex-end;gap:8px;margin-top:6px' }, [btn]),
  ].filter(Boolean)), { size: 'sm', subtitle: 'Riley call plan · staff only' });
  return dr;
}

export default planCallFlow;
