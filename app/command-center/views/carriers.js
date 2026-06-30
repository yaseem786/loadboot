// carriers.js — Carrier directory + detail drawer.
// Reads: cc_list_carriers / cc_get_carrier. Mutations: cc_set_carrier_status
// (carriers.approve, scope-checked + audited server-side). Permission-denied is
// surfaced cleanly; the server is always the authority.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import { sectionHead, toolbar, searchBox, segmented, statusPill, openDrawer, fmtDate, card } from '../../shared/ui/components.js';
import { getCarriersDirectory, getCarrierDetail, setCarrierStatus } from '../../shared/api.js';
import { can } from '../../shared/permissions.js';
import { humanizeError, toast } from '../../shared/errors.js';

const STATUSES = [
  { value: '', label: 'All' }, { value: 'pending', label: 'Pending' },
  { value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' },
];

export function renderCarriers(host) {
  let state = { search: '', status: '' };
  const listHost = el('div', { class: 'cc-table-wrap' });

  function header() {
    return el('div', null, [
      sectionHead('Carriers', 'Onboard, verify and manage your carrier network.'),
      toolbar([
        searchBox('Search company, email or MC…', (v) => { state.search = v; load(); }),
        segmented(STATUSES, state.status, (v) => { state.status = v; load(); }),
      ]),
    ]);
  }

  async function load() {
    showLoading(listHost, 'Loading carriers…');
    let rows;
    try { rows = await getCarriersDirectory({ search: state.search || null, status: state.status || null, limit: 200 }); }
    catch (e) { showError(listHost, humanizeError(e), load); return; }
    if (!rows || !rows.length) { showEmpty(listHost, 'No carriers match these filters.'); return; }

    const table = el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, [
        el('th', null, 'Company'), el('th', null, 'Contact'), el('th', null, 'MC / DOT'),
        el('th', null, 'Home base'), el('th', null, 'Docs'), el('th', null, 'Status'), el('th', null, ''),
      ])),
      el('tbody', null, rows.map(c => el('tr', { class: 'cc-row', onClick: () => openCarrier(c.id) }, [
        el('td', null, [el('b', null, c.company || '—'), el('div', { class: 'cc-sub' }, c.email || '')]),
        el('td', null, c.contact_name || '—'),
        el('td', null, [c.mc || '—', el('div', { class: 'cc-sub' }, c.dot || '')]),
        el('td', null, c.home_base || '—'),
        el('td', null, Number(c.doc_pending) > 0 ? el('span', { class: 'cc-chip-warn' }, c.doc_pending + ' pending') : '—'),
        el('td', null, statusPill(c.status)),
        el('td', null, el('span', { class: 'cc-row-go' }, '›')),
      ]))),
    ]);
    mount(listHost, table);
  }

  async function openCarrier(id) {
    const { body } = openDrawer('Carrier', el('div', { class: 'lb-state lb-loading' }, 'Loading…'), { subtitle: 'Profile, documents & actions' });
    let c;
    try { c = await getCarrierDetail(id); }
    catch (e) { mount(body, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }

    const field = (label, val) => el('div', { class: 'cc-field' }, [el('span', null, label), el('b', null, val || '—')]);
    const docs = (c.documents || []);
    const docList = docs.length ? el('div', { class: 'cc-doclist' }, docs.map(d => el('div', { class: 'cc-doc-item' }, [
      el('div', null, [el('b', null, d.file_name || d.type || 'document'), el('div', { class: 'cc-sub' }, (d.type || '') + ' · ' + fmtDate(d.created_at))]),
      statusPill(d.status),
    ]))) : el('div', { class: 'cc-sub' }, 'No documents uploaded.');

    const actionRow = el('div', { class: 'cc-drawer-actions' });
    function actBtn(label, status, kind) {
      return el('button', { class: 'lb-btn lb-btn-' + kind, disabled: c.status === status,
        onClick: async (ev) => {
          const btn = ev.currentTarget; btn.disabled = true; btn.textContent = 'Saving…';
          try {
            const r = await setCarrierStatus(id, status);
            toast('Carrier set to ' + r, 'success');
            openCarrier(id); load();
          } catch (e) { toast(humanizeError(e), 'error'); btn.disabled = false; btn.textContent = label; }
        } }, label);
    }
    if (can('carriers.approve')) {
      actionRow.appendChild(actBtn('Approve', 'active', 'primary'));
      actionRow.appendChild(actBtn('Pause', 'paused', 'secondary'));
      actionRow.appendChild(actBtn('Send back', 'pending', 'ghost'));
    } else {
      actionRow.appendChild(el('p', { class: 'cc-sub' }, 'You have view-only access to carriers.'));
    }

    mount(body, el('div', null, [
      el('div', { class: 'cc-drawer-title' }, [el('h3', null, c.company || 'Carrier'), statusPill(c.status)]),
      el('a', { class: 'cc-360-link', href: '#/carrier?id=' + id, onClick: () => { document.getElementById('cc-drawer-root')?.remove(); } }, 'View full 360° record →'),
      card([
        field('Contact', c.contact_name), field('Email', c.email), field('Phone', c.phone),
        field('MC', c.mc), field('DOT', c.dot), field('Home base', c.home_base),
        field('Equipment', (c.equipment_types || []).join(', ')), field('Trucks', c.truck_count),
        field('Submitted', fmtDate(c.submitted_at)),
      ], 'cc-fields'),
      el('h4', { class: 'cc-card-title', style: 'margin-top:18px' }, 'Documents'),
      docList,
      actionRow,
    ]));
  }

  mount(host, el('div', { class: 'cc-view' }, [header(), listHost]));
  load();
}

export default renderCarriers;
