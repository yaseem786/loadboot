// carrierReminders.js — Carrier reminders (manual push + what the nightly job would do).
//
// One decision tree decides what each carrier is owed, server-side, in
// app_private.reminder_for_carrier(). This screen shows you that decision for
// every active carrier, lets you dry-run it, and lets you push it by hand on a
// day the nightly job has not run or you want it out early.
//
// The rules, in the order they are checked (hardest blocker first):
//   1. no truck              -> truck_continue (draft open) or truck_add
//   2. trucks but none usable-> truck_continue          (no VIN / no payload)
//   3. usable truck, no driver -> driver_add
//   4. fleet ready           -> avail_confirm (post went stale)
//                             / avail_continue (form abandoned)
//                             / avail_start (never posted)
//   Confirmed in the last 24h -> nothing owed.
//
// Because the truck branches are checked before the driver branch, a carrier who
// added a DRIVER first and still has no truck is never sent the driver email.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, openDrawer, askConfirm, fmtDateTime, ago } from '../../shared/ui/components.js';
import { reminderTargets, reminderSend, studioListTemplates } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const KEYS = ['truck_add', 'truck_continue', 'driver_add', 'avail_start', 'avail_continue', 'avail_confirm'];

const META = {
  truck_add:      { label: 'Add first truck',      tone: 'amber', why: 'Signed up, no truck on file. Nothing for a dispatcher to sell.' },
  truck_continue: { label: 'Finish the truck',     tone: 'amber', why: 'Started the Add Truck form, or the truck has no VIN / no payload, so it cannot be posted.' },
  driver_add:     { label: 'Add a driver',         tone: 'blue',  why: 'Usable truck on file but nobody assigned to it. Only ever sent when a truck already exists.' },
  avail_start:    { label: 'First availability',   tone: 'blue',  why: 'Truck and driver ready, never posted once.' },
  avail_continue: { label: 'Finish the post',      tone: 'blue',  why: 'Opened the availability form and left before it went live.' },
  avail_confirm:  { label: 'Confirm availability', tone: 'green', why: 'Posted before, the post passed its 24-hour mark.' },
};

const CADENCE = 'Availability reminders go at most once a day (20h gap). Onboarding nudges stop after 4 sends, 3 days apart. Opt-outs and the suppression list are always honoured.';

export function renderCarrierReminders(host) {
  const manage = can('comm.manage') || can('comm.send') || can('content.manage') || can('settings.manage');
  let rows = [], filter = 'all', templates = [];

  const kpis = el('div', { class: 'cc-kpi-grid' });
  const bar  = el('div', { class: 'cc-toolbar' });
  const body = el('div', { class: 'cc-table-wrap' });

  mount(host, el('div', null, [
    sectionHead('Carrier reminders',
      'What each active carrier is owed right now, decided server-side. Dry-run it, then push it by hand — or leave it to the nightly job.',
      manage ? el('div', { class: 'cc-head-actions' }, [
        el('button', { class: 'lb-btn lb-btn-sm', onClick: () => runSend(true) }, 'Dry run'),
        el('button', { class: 'lb-btn lb-btn-primary lb-btn-sm', onClick: () => runSend(false) }, 'Send now'),
      ]) : null),
    el('div', { class: 'lb-note', style: 'margin:0 0 14px;font-size:13px;line-height:1.6;color:#475569;background:#f6f9fd;border:1px solid #e3edfa;border-radius:12px;padding:12px 14px' }, [
      el('b', null, 'How the target is chosen: '),
      'no truck → finish/add truck · truck not usable → finish truck · truck but no driver → add driver · fleet ready → post or confirm availability. ',
      el('b', null, 'A carrier who added a driver first and still has no truck gets the truck email, never the driver email.'),
      el('div', { style: 'margin-top:6px' }, CADENCE),
    ]),
    kpis, bar, body,
  ]));
  load();

  async function load() {
    showLoading(body, 'Working out who is owed what…');
    try {
      const [t, tpl] = await Promise.all([reminderTargets(), studioListTemplates().catch(() => [])]);
      rows = Array.isArray(t) ? t : (t ? JSON.parse(JSON.stringify(t)) : []);
      templates = (tpl || []).filter(x => String(x.key || '').startsWith('carrier.reminder.'));
    } catch (e) { showError(body, humanizeError(e), load); return; }
    paintKpis(); paintBar(); paintTable();
  }

  const sendable = (r) => r.due && r.opted_in && !r.suppressed;

  function paintKpis() {
    const due = rows.filter(sendable).length;
    const held = rows.length - due;
    const optOut = rows.filter(r => !r.opted_in || r.suppressed).length;
    mount(kpis, [
      statCard({ icon: 'bell',  label: 'Carriers owed something', value: String(rows.length), sub: 'by the decision tree', accent: 'blue' }),
      statCard({ icon: 'check', label: 'Sendable right now',      value: String(due),         sub: 'cadence clear, opted in', accent: 'green' }),
      statCard({ icon: 'trend', label: 'Held back',               value: String(held),        sub: optOut + ' opted out or suppressed', accent: 'amber' }),
    ]);
  }

  function paintBar() {
    const counts = {}; rows.forEach(r => { counts[r.reminder] = (counts[r.reminder] || 0) + 1; });
    const chip = (id, label, n) => el('button', {
      class: 'cc-chip-btn' + (filter === id ? ' on' : ''),
      onClick: () => { filter = id; paintBar(); paintTable(); },
    }, label + (n != null ? ' · ' + n : ''));
    mount(bar, [
      chip('all', 'All', rows.length),
      ...KEYS.filter(k => counts[k]).map(k => chip(k, META[k].label, counts[k])),
      el('span', { style: 'flex:1' }),
      el('button', { class: 'lb-btn lb-btn-sm', onClick: () => previewEmails() }, 'Preview the emails'),
    ]);
  }

  function paintTable() {
    const list = filter === 'all' ? rows : rows.filter(r => r.reminder === filter);
    if (!list.length) { mount(body, el('div', { class: 'lb-state' }, 'Nobody is owed a reminder here. That is the good outcome.')); return; }
    mount(body, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Carrier', 'Reminder', 'Why', 'Last sent', 'Sent before', 'Status'].map(h => el('th', null, h)))),
      el('tbody', null, list.map(r => {
        const m = META[r.reminder] || { label: r.reminder, tone: 'gray', why: '' };
        return el('tr', { class: 'cc-row' }, [
          el('td', null, [el('b', null, r.company || '—'), el('div', { class: 'cc-sub' }, r.email || '')]),
          el('td', null, el('span', { class: 'cc-pill cc-pill-' + m.tone }, m.label)),
          el('td', null, el('span', { class: 'cc-sub' }, m.why)),
          el('td', null, el('span', { class: 'cc-sub' }, r.last_sent ? ago(r.last_sent) : 'never')),
          el('td', null, String(r.sent_before || 0)),
          el('td', null, statusCell(r)),
        ]);
      })),
    ]));
  }

  function statusCell(r) {
    if (r.suppressed) return el('span', { class: 'cc-pill cc-pill-gray', title: 'On the suppression list — bounced or complained' }, 'suppressed');
    if (!r.opted_in)  return el('span', { class: 'cc-pill cc-pill-gray', title: 'Opted out of marketing email' }, 'opted out');
    if (!r.due)       return el('span', { class: 'cc-pill cc-pill-amber', title: 'Cadence: ' + CADENCE }, 'not due yet');
    return el('span', { class: 'cc-pill cc-pill-green' }, 'sendable');
  }

  async function runSend(dry) {
    const keys = filter === 'all' ? null : [filter];
    const n = rows.filter(r => sendable(r) && (!keys || r.reminder === filter)).length;
    if (!dry) {
      if (!n) { toast('Nothing is sendable right now — everything is either not due, opted out or suppressed.', 'info'); return; }
      const ok = await askConfirm('Send ' + n + ' carrier reminder' + (n === 1 ? '' : 's') + ' now?', {
        body: 'This queues real email to ' + n + ' carrier' + (n === 1 ? '' : 's') + (keys ? ' in “' + META[filter].label + '”' : ' across every reminder type')
            + '. Opt-outs, the suppression list and the cadence rules are applied server-side, and each carrier can only be queued once per day for the same reminder.',
        confirmLabel: 'Yes, send now', subtitle: 'Recorded in the audit log under your name',
      });
      if (!ok) return;
    }
    let res;
    try { res = await reminderSend(keys, dry, false); }
    catch (e) { toast(humanizeError(e), 'error'); return; }
    showResult(res, dry);
    if (!dry) load();
  }

  function showResult(res, dry) {
    const list = (res && res.rows) || [];
    const drawer = openDrawer(dry ? 'Dry run — nothing was sent' : 'Reminders queued',
      el('div', null, [
        el('p', { style: 'margin:0 0 12px;line-height:1.6' },
          dry ? (list.length + ' carrier(s) would receive an email. Skipped ' + (res.skipped || 0) + ' (not due, opted out, suppressed, or already queued today).')
              : ((res.queued || 0) + ' queued for delivery. Skipped ' + (res.skipped || 0) + '.')),
        list.length ? el('table', { class: 'cc-table' }, [
          el('thead', null, el('tr', null, ['Carrier', 'Email', 'Reminder'].map(h => el('th', null, h)))),
          el('tbody', null, list.map(x => el('tr', null, [
            el('td', null, x.company || '—'), el('td', null, el('span', { class: 'cc-sub' }, x.email)),
            el('td', null, (META[x.reminder] || {}).label || x.reminder),
          ]))),
        ]) : el('div', { class: 'lb-state' }, 'Nobody matched.'),
      ]),
      { subtitle: dry ? 'Preview only' : 'Handed to the delivery engine' });
    return drawer;
  }

  function previewEmails() {
    if (!templates.length) {
      openDrawer('Reminder emails', el('div', { class: 'lb-state' },
        'The six reminder templates are not registered in this environment yet, so cc_reminder_send would skip every carrier. Apply migration bl_rem_0331_carrier_reminder_templates.'), { subtitle: 'Nothing to preview' });
      return;
    }
    const wrap = el('div');
    const tabs = el('div', { class: 'cc-toolbar', style: 'margin-bottom:10px' });
    const pane = el('div');
    const show = (t) => {
      mount(tabs, templates.map(x => el('button', {
        class: 'cc-chip-btn' + (x.key === t.key ? ' on' : ''), onClick: () => show(x),
      }, (META[x.key.replace('carrier.reminder.', '')] || {}).label || x.key)));
      mount(pane, [
        el('div', { class: 'cc-sub', style: 'margin-bottom:4px' }, 'Subject'),
        el('div', { style: 'font-weight:700;margin-bottom:10px' }, t.subject || '—'),
        el('div', { class: 'cc-sub', style: 'margin-bottom:4px' }, 'Preview text'),
        el('div', { style: 'margin-bottom:14px' }, t.preview_text || '—'),
        (() => {
          const box = el('div', { style: 'border:1px solid #e2e8f0;border-radius:12px;padding:18px;background:#fff;color:#0f172a;max-width:640px' });
          box.innerHTML = t.body || '';                     // staff-authored template, same source Template Studio renders
          return box;
        })(),
      ]);
    };
    mount(wrap, [tabs, pane]);
    show(templates[0]);
    openDrawer('Reminder emails', wrap, { subtitle: 'Exactly what a carrier receives, inside the LoadBoot email shell' });
  }
}
