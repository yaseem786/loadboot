// Command Center — "Plan a call" (Riley call plans) — bl_voice_0483 (27 Sep 2026)
//
// One popup, used from Carrier 360, Carrier choices and Riley → Call plans: pick why we are calling, add a note,
// and the Ops Brain writes Riley's briefing (goal, opener, five talking points, confirm, do-not-say, best time,
// language). Nothing dials from here — the plan is read first under Riley → Call plans, where it is booked
// (bl_voice_0485, gated by `tool.schedule_riley_call` in CC → AI Brain → Permissions). Popup = openDrawer (CLAUDE.md §8).

import { el } from '../../shared/ui/dom.js';
import { openDrawer } from '../../shared/ui/components.js';
import { ccRileyPlanCreate } from '../../shared/api.js';
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

/** Open the "Plan a call" popup for one carrier. opts: { reason, note, onDone(plan) } */
export function planCallFlow(orgId, orgName, opts = {}) {
  if (!orgId) { toast('No carrier selected.', 'error'); return; }
  const reason = el('select', { class: 'cc-input' }, PLAN_REASONS.map(([v, l]) => el('option', { value: v, selected: v === (opts.reason || 'welcome') ? 'selected' : undefined }, l)));
  const note = el('textarea', { class: 'cc-input', rows: '4', placeholder: 'What Riley must cover or avoid, in your words. Optional — the brain already reads the carrier file.' });
  if (opts.note) note.value = opts.note;
  const lang = el('select', { class: 'cc-input' }, [['en', 'English'], ['es', 'Spanish']].map(([v, l]) => el('option', { value: v }, l)));
  const btn = el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev) => {
    const b = ev.currentTarget; b.disabled = true; b.textContent = 'Asking the brain…';
    try {
      const r = await ccRileyPlanCreate(orgId, reason.value, note.value.trim() || null, lang.value);
      if (r && r.error) throw new Error(r.error);
      dr.close();
      toast(r.reused ? 'A plan for this carrier is already being written — opening it.' : 'Plan requested. Riley → Call plans shows it in a few seconds.');
      if (typeof opts.onDone === 'function') opts.onDone(r); else location.hash = planLink(r.id);
    } catch (e) { toast(humanizeError(e), 'error'); b.disabled = false; b.textContent = 'Plan the call'; }
  } }, 'Plan the call');
  const dr = openDrawer('Plan a call — ' + (orgName || 'carrier'), el('div', { class: 'cc-form' }, [
    el('p', { class: 'cc-sub', style: 'margin:0 0 6px' }, 'The Ops Brain reads this carrier’s file (application, documents, trucks, dispatcher, pending choices, past Riley calls) and writes Riley’s briefing: goal, opener, five talking points, what to confirm, what not to say, best time. Nothing is dialled — you read the plan first.'),
    el('div', { class: 'cc-field' }, [el('span', null, 'Why this call'), reason]),
    el('div', { class: 'cc-field' }, [el('span', null, 'Note for the brain'), note]),
    el('div', { class: 'cc-field' }, [el('span', null, 'Call language'), lang]),
    el('div', { class: 'cc-sub', style: 'font-size:12px' }, 'Cost line: brain ≈ $0.01–0.05 per plan · Retell ≈ $0.13/min only if the call is later placed. Calls go only to the number the carrier gave at signup (TCPA); never to a demo account.'),
    el('div', { style: 'display:flex;justify-content:flex-end;gap:8px;margin-top:6px' }, [btn]),
  ]), { size: 'sm', subtitle: 'Riley call plan · staff only' });
  return dr;
}

export default planCallFlow;
