// carrierChoices.js — CC → Dispatchers & agents → "Carrier choices" (bl_disp_0481, 27 Sep 2026).
//
// A passed candidate picks a carrier from the Fleet Book in their portal (bl_disp_0442). Until now the owner could
// only accept/decline on that one candidate's Dispatcher 360 page (Carriers tab) — one profile at a time. This is the
// queue: EVERY pending choice across all candidates on one screen, Accept / Decline right on the card, and a
// "Decided recently" list underneath. The Accept (trial terms → SOP → assign in one step) and Decline flows are the
// very same functions the 360 uses (choiceAcceptFlow / choiceDeclineFlow / sopDrawer exported from dispatcher-360.js),
// so a decision made here behaves exactly like one made on the profile. Staff-gated by the RPCs
// (cc_dispatcher_choices / cc_dispatcher_choice_decide). #/carrier-choices?id=<choice> highlights that card
// (the Action Center queue and the bell land there). No alert/confirm — drawers only.
import { el, mount } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { sectionHead } from '../../shared/ui/components.js';
import { ccDispatcherChoices } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';
import { choiceAcceptFlow, choiceDeclineFlow, CHOICE_MK } from './dispatcher-360.js';
import { planCallFlow } from './rileyPlanFlow.js';   // bl_voice_0483 — Riley call plan for the chosen carrier

const ET = 'America/New_York';
const et = (v) => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString('en-US', { timeZone: ET, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'; };
const ago = (v) => { if (!v) return '—'; const h = Math.max(0, (Date.now() - new Date(v)) / 36e5); return h < 1 ? 'just now' : h < 48 ? Math.round(h) + ' h ago' : Math.round(h / 24) + ' d ago'; };
const dShort = (v) => { if (!v) return '—'; const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v)); const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(v); return isNaN(d) ? String(v) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
const STL = { applied: 'Applied', screening: 'Screening', skills_test: 'Skills test', trial: 'Trial', verified: 'Verified', active: 'Active', suspended: 'Suspended', rejected: 'Rejected', withdrawn: 'Withdrawn' };
const DEC = { accepted: ['Accepted', 'green'], declined: ['Declined', 'red'], withdrawn: ['Withdrawn by candidate', 'm'] };

const CSS = `
.chq-card{background:var(--card,#fff);border:1px solid var(--line,#e5e9f2);border-radius:16px;padding:16px;margin-bottom:14px;transition:box-shadow .2s}
.chq-card.open{border-left:4px solid var(--o,#FC5305)}.chq-card.hit{box-shadow:0 0 0 3px rgba(8,131,247,.35)}
.chq-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}
.chq-head h3{margin:0;font-size:16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.chq-sub{color:var(--mut,#64748b);font-size:13px;margin-top:3px}
.chq-pill{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:800;padding:2px 9px;border-radius:999px;white-space:nowrap;line-height:1.6}
.chq-pill.green{background:rgba(22,163,74,.12);color:#15803d}.chq-pill.amber{background:rgba(217,119,6,.12);color:#b45309}.chq-pill.blue{background:rgba(8,131,247,.11);color:#0466c8}
.chq-pill.red{background:rgba(220,38,38,.1);color:#b91c1c}.chq-pill.violet{background:rgba(124,58,237,.11);color:#6d28d9}.chq-pill.m{background:rgba(100,116,139,.15);color:#475569}
.chq-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}
.chq-col{border:1px solid var(--line,#eef1f6);border-radius:12px;padding:10px 12px;font-size:13px;line-height:1.7}
.chq-col b.t{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:var(--mut,#64748b);margin-bottom:3px}
.chq-col a{color:var(--b,#0883F7);font-weight:600;text-decoration:none}.chq-col a:hover{text-decoration:underline}
.chq-note{margin:10px 0;padding:8px 10px;border-left:3px solid #FC5305;background:rgba(252,83,5,.06);font-size:13px;line-height:1.5;border-radius:0 10px 10px 0}
.chq-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.chq-btn{border:1px solid var(--line,#d8dee9);background:var(--card,#fff);color:inherit;border-radius:10px;padding:8px 13px;font:inherit;font-weight:600;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;text-decoration:none}
.chq-btn.p{background:var(--b,#0883F7);border-color:var(--b,#0883F7);color:#fff}.chq-btn.d{border-color:rgba(239,68,68,.5);color:#b91c1c}.chq-btn[disabled]{opacity:.5;cursor:not-allowed}
.chq-t{width:100%;border-collapse:collapse;font-size:13.5px}.chq-t th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:var(--mut,#64748b);padding:8px 10px;border-bottom:1px solid var(--line,#e5e9f2)}
.chq-t td{padding:9px 10px;border-bottom:1px solid var(--line,#eef1f6);vertical-align:top}.chq-t tr:last-child td{border-bottom:0}.chq-t a{color:inherit}
.chq-why{font-size:12.5px;color:var(--mut,#64748b);line-height:1.6;margin-top:6px}
@media (max-width:760px){.chq-grid{grid-template-columns:1fr}.chq-card{padding:13px;border-radius:14px}.chq-actions .chq-btn{flex:1;justify-content:center}}
`;

export async function renderCarrierChoices(host, query) {
  if (!document.getElementById('chq-css')) { const s = document.createElement('style'); s.id = 'chq-css'; s.textContent = CSS; document.head.appendChild(s); }
  const focusId = query && query.get && query.get('id');
  const root = el('div', { class: 'chq' });
  const openEl = el('div'), recentEl = el('div');
  mount(host, root);
  root.append(
    sectionHead('Carrier choices', 'A candidate who passed the skills test picked a carrier from the Fleet Book. Accept = trial terms + SOP + assignment in one step; Decline = the carrier stays open and the candidate chooses again. Both are told.',
      [el('button', { class: 'chq-btn', onClick: () => load() }, [icon('refresh', 16), 'Refresh'])]),
    openEl, recentEl);
  let rows = [];

  async function load() {
    try { const r = await ccDispatcherChoices('all'); if (r && r.error) throw new Error(r.error); rows = Array.isArray(r) ? r : []; paint(); }
    catch (e) { mount(openEl, el('div', { class: 'chq-card' }, humanizeError(e))); }
  }
  function paint() {
    const pend = rows.filter((c) => c.status === 'pending').sort((a, b) => new Date(a.created_at) - new Date(b.created_at));   // oldest first — clear the queue in order
    const recent = rows.filter((c) => c.status !== 'pending').sort((a, b) => new Date(b.decided_at || b.created_at) - new Date(a.decided_at || a.created_at)).slice(0, 40);
    mount(openEl, pend.length ? el('div', null, [
      el('div', { class: 'chq-sub', style: 'margin:0 0 10px' }, pend.length + ' waiting · oldest first · a carrier chosen by several candidates shows a warning — accept one, the others are told automatically'),
      ...pend.map(card),
    ]) : el('div', { class: 'chq-card' }, [el('h3', null, 'Nothing waiting'), el('div', { class: 'chq-sub' }, 'No candidate has a carrier choice pending. New choices appear here the moment a candidate picks one in their portal — and on the Action Center home.')]));
    mount(recentEl, el('div', { class: 'chq-card' }, [
      el('h3', null, 'Decided recently'),
      recent.length ? el('div', { style: 'overflow:auto' }, el('table', { class: 'chq-t' }, [
        el('thead', null, el('tr', null, ['When', 'Candidate', 'Carrier', 'Match', 'Decision', 'Note', ''].map((x) => el('th', null, x)))),
        el('tbody', null, recent.map((c) => { const dp = c.dispatcher || {}, cr = c.carrier || {}; const dm = DEC[c.status] || [c.status, 'm']; const mk = CHOICE_MK[c.match_kind] || [String(c.match_kind || '').toUpperCase(), 'violet']; return el('tr', null, [
          el('td', null, et(c.decided_at || c.created_at)),
          el('td', null, el('a', { href: link360(c) }, dp.name || '—')),
          el('td', null, el('a', { href: '#/carrier?id=' + (c.carrier_org_id || '') }, cr.name || '—')),
          el('td', null, el('span', { class: 'chq-pill ' + mk[1] }, mk[0])),
          el('td', null, el('span', { class: 'chq-pill ' + dm[1] }, dm[0])),
          el('td', null, c.decision_note || '—'),
          el('td', null, c.assignment_id ? el('a', { href: link360(c), title: 'Assignment ' + c.assignment_id }, 'assignment ›') : ''),
        ]); })),
      ])) : el('div', { class: 'chq-sub' }, 'No decisions yet.'),
    ]));
    if (focusId) { const hit = root.querySelector('[data-choice="' + focusId + '"]'); if (hit) { hit.classList.add('hit'); hit.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }
  }
  const link360 = (c) => '#/dispatcher?id=' + encodeURIComponent(c.dispatcher_user_id || '') + '&tab=carriers';
  const pill = (t, tone, ic) => el('span', { class: 'chq-pill ' + (tone || 'm') }, [ic ? icon(ic, 12) : '', t]);
  function card(c) {
    const dp = c.dispatcher || {}, cr = c.carrier || {};
    const mk = CHOICE_MK[c.match_kind] || [String(c.match_kind || '').toUpperCase(), 'violet'];
    const gone = cr.still_available === false;
    const onTerms = ['trial', 'verified', 'active'].includes(dp.status);
    const hasTerms = dp.commission_pct != null && Number(dp.commission_pct) > 0;
    const termsLine = onTerms
      ? 'On ' + (STL[dp.status] || dp.status).toLowerCase() + (hasTerms ? ' · ' + Number(dp.commission_pct) + '% of gross' : '') + (dp.trial_start ? ' · trial ' + dShort(dp.trial_start) + ' → ' + dShort(dp.trial_end) : '') + ' — Accept goes straight to the SOP'
      : (hasTerms ? Number(dp.commission_pct) + '% already on file' : 'No commission set yet') + ' — Accept asks for the trial terms first (step 1), then the SOP (step 2)';
    const equipD = (dp.equipment || []).join(' / ') || 'nothing listed';
    const equipC = (cr.equipment || []).join(' / ') || 'equipment not on file';
    // pp = what choiceAcceptFlow reads from a Dispatcher 360 profile — the queue row carries the same fields
    const pp = { status: dp.status, commission_pct: dp.commission_pct, trial_start: dp.trial_start, trial_end: dp.trial_end, full_name: dp.name };
    return el('div', { class: 'chq-card open', 'data-choice': c.id }, [
      el('div', { class: 'chq-head' }, [
        el('div', null, [
          el('h3', null, [(dp.name || 'Candidate') + ' → ' + (cr.name || 'carrier'), pill(mk[0], mk[1]), gone ? pill('Carrier no longer available — decline', 'red', 'alert') : '', Number(cr.competing) > 0 ? pill('Also chosen by ' + cr.competing + ' other' + (Number(cr.competing) === 1 ? '' : 's'), 'amber', 'users') : '']),
          el('div', { class: 'chq-sub' }, ['Chosen ', et(c.created_at), ' · ', ago(c.created_at), ' · choice ', el('code', { style: 'font-size:11px' }, String(c.id || '').slice(0, 8))]),
        ]),
        el('div', { class: 'chq-actions' }, [
          el('a', { class: 'chq-btn', href: link360(c) }, [icon('user', 16), 'Open Dispatcher 360']),
          el('a', { class: 'chq-btn', href: '#/carrier?id=' + (c.carrier_org_id || '') }, [icon('truck', 16), 'Open carrier']),
          el('button', { class: 'chq-btn', title: 'Ask the Ops Brain for Riley’s briefing before calling this carrier about the trial (nothing dials)', onClick: () => planCallFlow(c.carrier_org_id, cr.name, { reason: 'choice_pending', note: 'Candidate ' + (dp.name || '') + ' picked this carrier (' + (mk[0] || '') + ' match). Explain the trial and confirm they want to proceed.' }) }, [icon('phone', 16), 'Plan a Riley call']),   // bl_voice_0483
        ]),
      ]),
      el('div', { class: 'chq-grid' }, [
        el('div', { class: 'chq-col' }, [el('b', { class: 't' }, 'Candidate'),
          el('div', null, [el('a', { href: link360(c) }, dp.name || '—'), ' · ', pill(STL[dp.status] || dp.status || '—', onTerms ? 'blue' : 'amber')]),
          el('div', null, 'Knows ' + equipD + (dp.years_exp != null ? ' · ' + dp.years_exp + ' yr US dispatch' : '')),
          el('div', null, (dp.score ? 'Skills test ' + dp.score : 'Skills test score not on file') + (dp.load_boards ? ' · boards: ' + (Array.isArray(dp.load_boards) ? dp.load_boards.join(', ') : dp.load_boards) : '')),
          el('div', null, [dp.city || dp.country ? [dp.city, dp.country].filter(Boolean).join(', ') : '—', dp.hours ? ' · ' + dp.hours : '', dp.timezone ? ' (' + dp.timezone + ')' : '']),
        ]),
        el('div', { class: 'chq-col' }, [el('b', { class: 't' }, 'Carrier'),
          el('div', null, [el('a', { href: '#/carrier?id=' + (c.carrier_org_id || '') }, cr.name || '—'), cr.mc ? ' · MC ' + cr.mc : '', cr.dot ? ' · DOT ' + cr.dot : '']),
          el('div', null, 'Runs ' + equipC + ' · ' + (cr.trucks || 0) + ' truck' + (Number(cr.trucks) === 1 ? '' : 's')),
          el('div', null, (cr.home_base ? cr.home_base : 'Home base not on file') + (cr.min_rpm != null ? ' · floor $' + Number(cr.min_rpm).toFixed(2) + '/mi' : ' · no floor rate set')),
          el('div', null, gone ? el('b', { style: 'color:#b91c1c' }, 'Taken by another dispatcher since — decline this one') : 'Still open · stays open to other candidates until you accept one'),
        ]),
      ]),
      c.note ? el('div', { class: 'chq-note' }, ['Candidate wrote: “', c.note, '”']) : '',
      el('div', { class: 'chq-why' }, termsLine),
      el('div', { class: 'chq-actions', style: 'margin-top:12px' }, [
        el('button', Object.assign({ class: 'chq-btn p', onClick: () => choiceAcceptFlow(c, pp, c.dispatcher_user_id, load) }, gone ? { disabled: '' } : {}), [icon('handshake', 16), onTerms ? 'Accept — assign this carrier' : 'Accept — start trial + assign']),
        el('button', { class: 'chq-btn d', onClick: () => choiceDeclineFlow(c, dp.name, load) }, [icon('x', 16), 'Decline — candidate chooses again']),
      ]),
    ]);
  }
  await load();
}

export default renderCarrierChoices;
