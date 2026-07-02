// dispatch.js — Dispatch Board. Loads grouped into lifecycle columns; advance/retreat
// a load with secured cc_set_load_status (loads.assign, scope-checked + audited). If the
// server rejects, the UI reverts. Responsive: columns on desktop, stacked list on mobile.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statusPill, money, openDrawer } from '../../shared/ui/components.js';
import { getLoadsList, getLoadDetail, setLoadStatus } from '../../shared/api.js';
import { can } from '../../shared/permissions.js';
import { humanizeError, toast } from '../../shared/errors.js';

const COLUMNS = [
  { key: 'available', label: 'Available' },
  { key: 'booked', label: 'Booked' },
  { key: 'in_transit', label: 'In transit' },
  { key: 'delivered', label: 'Delivered' },
];
const NEXT = { available: 'booked', booked: 'in_transit', in_transit: 'delivered' };
const PREV = { booked: 'available', in_transit: 'booked', delivered: 'in_transit' };

export function renderDispatch(host) {
  const boardHost = el('div');

  async function load() {
    showLoading(boardHost, 'Loading dispatch board…');
    let rows;
    try { rows = await getLoadsList({ limit: 400 }); }
    catch (e) { showError(boardHost, humanizeError(e), load); return; }
    rows = rows || [];
    const byStatus = {}; COLUMNS.forEach(c => byStatus[c.key] = []);
    rows.forEach(l => { if (byStatus[l.status]) byStatus[l.status].push(l); });

    const mayMove = can('loads.assign');

    function move(load, dir) {
      const target = dir === 'next' ? NEXT[load.status] : PREV[load.status];
      if (!target) return;
      setLoadStatus(load.id, target)
        .then(() => { toast('Moved to ' + target.replace(/_/g, ' '), 'success'); load2(); })
        .catch((e) => { toast(humanizeError(e), 'error'); load2(); }); // reload reverts optimistic UI
    }
    const load2 = load;

    async function openLoadDrawer(l) {
      const hostD = el('div', { class: 'cc-sub' }, 'Loading\u2026');
      const dr = openDrawer((l.origin || '?') + ' \u2192 ' + (l.destination || '?'), hostD, { subtitle: 'Load detail' });
      let d; try { d = await getLoadDetail(l.id); } catch (e) { mount(dr.body, el('div', { class: 'cc-sub' }, humanizeError(e))); return; }
      d = d || l;
      const kv = (k, v) => el('div', { class: 'cc-kv' }, [el('span', { class: 'cc-kv-k' }, k), el('span', { class: 'cc-kv-v' }, v == null || v === '' ? '\u2014' : String(v))]);
      const fm = d.field_meta || {}; const acc = fm.accessorials || {};
      const rpm = (d.rate && d.miles) ? '$' + (Number(d.rate) / Number(d.miles)).toFixed(2) + '/mi' : '\u2014';
      mount(dr.body, el('div', null, [
        el('div', { style: 'display:flex;align-items:center;gap:12px;margin-bottom:12px' }, [statusPill(d.status), el('b', { style: 'font-size:1.35rem' }, d.rate != null ? money(d.rate) : '\u2014'), el('span', { class: 'cc-sub' }, rpm)]),
        kv('Lane', (d.origin || '?') + ' \u2192 ' + (d.destination || '?')),
        kv('Equipment', d.equipment), kv('Commodity', d.commodity), kv('Weight', d.weight), kv('Miles', d.miles),
        el('div', { style: 'font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:700;margin:12px 0 4px' }, 'Schedule'),
        kv('Pickup', d.pickup_date), kv('Pickup window', fm.pickup_window), kv('Delivery', d.delivery_date), kv('Delivery window', fm.delivery_window),
        kv('Appointment', fm.appointment_required ? 'Required' : (acc.fcfs ? 'FCFS' : '\u2014')),
        el('div', { style: 'font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:700;margin:12px 0 4px' }, 'Accessorial rate card'),
        kv('Detention', acc.detention_per_hr ? '$' + acc.detention_per_hr + '/hr after ' + (acc.detention_free_hours || '?') + 'h free' : '\u2014'),
        kv('Layover', acc.layover_per_day ? '$' + acc.layover_per_day + '/day' : '\u2014'), kv('TONU', acc.tonu ? '$' + acc.tonu : '\u2014'), kv('Lumper', acc.lumper_policy),
        el('div', { style: 'font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:700;margin:12px 0 4px' }, 'Assignment & notes'),
        kv('Carrier', d.assigned_company || 'Unassigned'), kv('Broker', d.broker), kv('Reference', d.source_reference), kv('Special instructions', d.requirements || d.notes),
      ]));
    }
    function cardNode(l) {
      const controls = mayMove ? el('div', { class: 'cc-card-ctl' }, [
        PREV[l.status] ? el('button', { class: 'cc-mini', title: 'Back', onClick: (e) => { e.stopPropagation(); move(l, 'prev'); } }, '‹') : '',
        NEXT[l.status] ? el('button', { class: 'cc-mini', title: 'Advance', onClick: (e) => { e.stopPropagation(); move(l, 'next'); } }, '›') : '',
      ]) : '';
      return el('div', { class: 'cc-dcard cc-row-click', onClick: () => openLoadDrawer(l) }, [
        el('div', { class: 'cc-dcard-lane' }, (l.origin || '?') + ' → ' + (l.destination || '?')),
        el('div', { class: 'cc-dcard-meta' }, [
          el('span', null, l.equipment || '—'),
          el('span', null, l.rate != null ? money(l.rate) : '—'),
        ]),
        el('div', { class: 'cc-dcard-foot' }, [
          el('span', { class: 'cc-sub' }, l.assigned_company || 'Unassigned'),
          controls,
        ]),
      ]);
    }

    const board = el('div', { class: 'cc-board' }, COLUMNS.map(c => el('div', { class: 'cc-col' }, [
      el('div', { class: 'cc-col-head' }, [el('span', null, c.label), el('b', { class: 'cc-col-count' }, String(byStatus[c.key].length))]),
      el('div', { class: 'cc-col-body' }, byStatus[c.key].length
        ? byStatus[c.key].map(cardNode)
        : el('div', { class: 'cc-col-empty' }, 'No loads')),
    ])));

    mount(boardHost, board);
  }

  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Dispatch board', can('loads.assign') ? 'Advance loads through their lifecycle — changes are validated server-side.' : 'Live view of every load by status.'),
    boardHost,
  ]));
  load();
}

export default renderDispatch;
