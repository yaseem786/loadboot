// carrierRequests.js — CC "Carrier requests" (bl_disp_0457): every carrier-side pause / change-dispatcher request in one
// queue, with the decision buttons. Before this, a carrier's pause or "give me a different dispatcher" only surfaced as a
// bell notification + a line in the assignment thread. Staff-gated by the RPCs (cc_dispatcher_requests /
// cc_dispatcher_request_resolve). Reuses the dl- styles from dialerLive.js so the screen matches Phones. No alert/confirm.
import { el, mount } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { sectionHead, openDrawer } from '../../shared/ui/components.js';
import { ccDispatcherRequests, ccDispatcherRequestResolve } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';

const ET = 'America/New_York';
const et = (v) => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString('en-US', { timeZone: ET, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'; };
const ago = (v) => { const h = Math.max(0, Math.round((Date.now() - new Date(v)) / 36e5)); return h < 1 ? 'just now' : h < 48 ? h + ' h ago' : Math.round(h / 24) + ' d ago'; };

const CSS = `
.cr-card{background:var(--card,#fff);border:1px solid var(--line,#e5e9f2);border-radius:16px;padding:16px;margin-bottom:14px}
.cr-card.open{border-left:4px solid var(--o,#FC5305)}
.cr-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}
.cr-head h3{margin:0;font-size:16px}.cr-sub{color:var(--mut,#64748b);font-size:13px;margin-top:3px}
.cr-pill{display:inline-block;font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px;white-space:nowrap;margin-right:6px}
.cr-pill.pause{background:rgba(245,158,11,.16);color:#b45309}.cr-pill.change{background:rgba(239,68,68,.13);color:#b91c1c}.cr-pill.m{background:rgba(100,116,139,.15);color:#475569}
.cr-reason{margin:10px 0;padding:10px 12px;border-radius:12px;background:rgba(8,131,247,.07);font-size:14px}
.cr-thread{font-size:12.5px;color:var(--mut,#64748b);margin:6px 0 10px;display:grid;gap:3px}
.cr-thread b{color:inherit;font-weight:600}
.cr-actions{display:flex;gap:8px;flex-wrap:wrap}
.cr-btn{border:1px solid var(--line,#d8dee9);background:var(--card,#fff);color:inherit;border-radius:10px;padding:8px 13px;font:inherit;font-weight:600;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
.cr-btn.p{background:var(--b,#0883F7);border-color:var(--b,#0883F7);color:#fff}.cr-btn.d{border-color:rgba(239,68,68,.5);color:#b91c1c}.cr-btn[disabled]{opacity:.5;cursor:not-allowed}
.cr-t{width:100%;border-collapse:collapse;font-size:13.5px}.cr-t th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:var(--mut,#64748b);padding:8px 10px;border-bottom:1px solid var(--line,#e5e9f2)}
.cr-t td{padding:9px 10px;border-bottom:1px solid var(--line,#eef1f6);vertical-align:top}.cr-t tr:last-child td{border-bottom:0}
.cr-form{display:grid;gap:12px}.cr-form label{display:grid;gap:5px;font-size:12.5px;font-weight:600}.cr-form textarea{border:1px solid var(--line,#d8dee9);background:var(--card,#fff);color:inherit;border-radius:10px;padding:8px 11px;font:inherit;min-height:90px}
.cr-form small{font-weight:400;color:var(--mut,#64748b)}
@media (max-width:640px){.cr-card{padding:13px;border-radius:14px}.cr-actions .cr-btn{flex:1;justify-content:center}}
`;

export async function renderCarrierRequests(host) {
  if (!document.getElementById('cr-css')) { const s = document.createElement('style'); s.id = 'cr-css'; s.textContent = CSS; document.head.appendChild(s); }
  const root = el('div', { class: 'cr' });
  const openEl = el('div'), recentEl = el('div');
  mount(host, root);
  root.append(
    sectionHead('Carrier requests', 'Every time a carrier pauses their dispatcher or asks for a different one. Decide here — the carrier and the dispatcher are told.',
      [el('button', { class: 'cr-btn', onClick: () => load() }, [icon('refresh', 16), 'Refresh'])]),
    openEl, recentEl);
  let data = null;

  async function load() {
    try { const r = await ccDispatcherRequests(); if (r && r.error) throw new Error(r.error); data = r; paint(); }
    catch (e) { mount(openEl, el('div', { class: 'cr-card' }, humanizeError(e))); }
  }
  function paint() {
    const open = data.open || [], recent = data.recent || [];
    mount(openEl, open.length ? open.map(card) : el('div', { class: 'cr-card' }, [el('h3', null, 'Nothing waiting'), el('div', { class: 'cr-sub' }, 'No carrier has paused a dispatcher or asked for a change. New requests appear here the moment a carrier sends one.')]));
    mount(recentEl, el('div', { class: 'cr-card' }, [
      el('h3', null, 'Decided recently'),
      recent.length ? el('div', { style: 'overflow:auto' }, el('table', { class: 'cr-t' }, [
        el('thead', null, el('tr', null, ['When', 'Carrier', 'Dispatcher', 'Request', 'Decision', 'Note'].map((x) => el('th', null, x)))),
        el('tbody', null, recent.map((r) => el('tr', null, [
          el('td', null, et(r.resolved_at)), el('td', null, r.carrier || '—'), el('td', null, r.dispatcher || '—'),
          el('td', null, [el('span', { class: 'cr-pill ' + r.kind }, r.kind), r.reason || '']),
          el('td', null, el('span', { class: 'cr-pill m' }, String(r.resolution || '').replace('_', ' '))), el('td', null, r.note || '—'),
        ]))),
      ])) : el('div', { class: 'cr-sub' }, 'No decisions yet.'),
    ]));
  }
  function card(r) {
    const paused = r.assignment_status === 'paused';
    return el('div', { class: 'cr-card open' }, [
      el('div', { class: 'cr-head' }, [
        el('div', null, [
          el('h3', null, [el('span', { class: 'cr-pill ' + r.kind }, r.kind === 'pause' ? 'PAUSED by carrier' : 'CHANGE requested'), (r.carrier || 'Carrier') + ' → ' + (r.dispatcher || 'dispatcher')]),
          el('div', { class: 'cr-sub' }, [et(r.created_at), ' · ', ago(r.created_at), ' · assigned ', et(r.assigned_at), ' · assignment ', el('b', null, r.assignment_status || '—'), r.dispatcher_status ? ' · dispatcher ' + r.dispatcher_status : '']),
        ]),
        el('a', { class: 'cr-btn', href: '#/dispatchers?assignment=' + r.assignment_id }, [icon('user', 16), 'Open dispatcher']),
      ]),
      el('div', { class: 'cr-reason' }, r.reason || '(no reason given)'),
      (r.thread || []).length ? el('div', { class: 'cr-thread' }, r.thread.map((m) => el('div', null, [el('b', null, (m.role || '') + ' · ' + et(m.at) + ': '), m.body]))) : null,
      el('div', { class: 'cr-actions' }, [
        el('button', { class: 'cr-btn p', onClick: () => decide(r, 'keep') }, [icon('check', 16), 'Keep dispatcher']),
        paused ? el('button', { class: 'cr-btn', onClick: () => decide(r, 'resume') }, [icon('play', 16), 'Resume assignment']) : null,
        el('button', { class: 'cr-btn d', onClick: () => decide(r, 'reassign') }, [icon('x', 16), 'Reassign — unassign this dispatcher']),
        el('button', { class: 'cr-btn', onClick: () => decide(r, 'dismiss') }, 'Dismiss'),
      ]),
    ]);
  }
  const COPY = {
    keep: ['Keep ' + '{d}' + ' on ' + '{c}', 'The carrier is told LoadBoot reviewed it and the dispatcher stays. The dispatcher sees the concern. Write what you decided in plain words — it goes to both.', 'e.g. We spoke to the dispatcher — daily updates from tomorrow, 8 AM ET check-in.'],
    resume: ['Resume ' + '{d}' + ' on ' + '{c}', 'Lifts the carrier’s pause. Both sides get a note. Do this only after the carrier agreed.', 'e.g. Carrier confirmed on the phone — resuming today.'],
    reassign: ['Take ' + '{d}' + ' off ' + '{c}', 'Ends this assignment now. The dispatcher gets the branded "assignment ended" e-mail with your reason; the carrier gets "dispatcher changed" (reason not shown) and reopens in Choose your carrier for the next candidate.', 'Reason for the dispatcher — one line.'],
    dismiss: ['Dismiss this request', 'Closes it with no message to anyone. Use when it was sent by mistake or already handled by phone.', 'optional — why'],
  };
  function decide(r, action) {
    const [title, help, ph] = COPY[action].map((s) => s.replace('{d}', r.dispatcher || 'the dispatcher').replace('{c}', r.carrier || 'the carrier'));
    const note = el('textarea', { placeholder: ph });
    const err = el('div', { style: 'color:#b91c1c;font-size:13px' });
    const go = el('button', { class: 'cr-btn ' + (action === 'reassign' ? 'd' : 'p'), onClick: async () => {
      if (action === 'reassign' && !note.value.trim()) { err.textContent = 'Give the dispatcher a reason — one line is enough.'; return; }
      go.disabled = true; err.textContent = '';
      try { const x = await ccDispatcherRequestResolve(r.id, action, note.value); if (x && x.error) throw new Error(x.error); dr.close(); toast(title + ' — done'); await load(); }
      catch (e) { err.textContent = humanizeError(e); go.disabled = false; }
    } }, title);
    const dr = openDrawer(title, el('div', { class: 'cr-form' }, [
      el('div', { class: 'cr-reason' }, [el('b', null, 'They wrote: '), r.reason || '(no reason)']),
      el('label', null, [action === 'dismiss' ? 'Note (internal)' : 'Your note', note, el('small', null, help)]),
      err, go,
    ]), { size: 'sm' });
  }
  await load();
}
