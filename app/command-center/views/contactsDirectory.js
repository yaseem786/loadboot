// contactsDirectory.js — one directory of every account holder (carrier / broker / shipper /
// facility) with a verified badge and drill-down. Reads cc_contacts_directory (carriers.view
// or partners.view). Identity is staff-only here; the marketplace-facing views stay anonymized.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import { sectionHead, statCard, segmented, searchBox, toolbar } from '../../shared/ui/components.js';
import { contactsDirectory } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';

const KINDS = [{ value: '', label: 'All' }, { value: 'carrier', label: 'Carriers' }, { value: 'broker', label: 'Brokers' }, { value: 'shipper', label: 'Shippers' }];

export function renderContactsDirectory(host) {
  let kind = '', search = '';
  const kpis = el('div');
  const listHost = el('div', { class: 'cc-table-wrap' });

  async function load() {
    showLoading(listHost, 'Loading directory...');
    let rows; try { rows = await contactsDirectory({ kind: kind || null, search: search || null, limit: 300 }); }
    catch (e) { showError(listHost, humanizeError(e), load); return; }
    rows = Array.isArray(rows) ? rows : [];
    const verified = rows.filter(r => r.verified).length;
    mount(kpis, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'users', label: 'Accounts', value: String(rows.length), sub: 'in directory', accent: 'blue' }),
      statCard({ icon: 'check', label: 'Verified', value: String(verified), sub: 'onboarding complete', accent: verified ? 'green' : 'amber' }),
      statCard({ icon: 'alert', label: 'Unverified', value: String(rows.length - verified), sub: 'in progress', accent: (rows.length - verified) ? 'amber' : 'green' }),
    ]));
    if (!rows.length) { showEmpty(listHost, 'No accounts match.'); return; }
    const link = (r) => (r.kind === 'carrier') ? ('#/carrier?id=' + r.org) : '#/partners';
    mount(listHost, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Name', 'Type', 'Contact', 'MC / DOT', 'Status', ''].map(t => el('th', null, t)))),
      el('tbody', null, rows.map(r => el('tr', { class: 'cc-row', onClick: () => { location.hash = link(r); } }, [
        el('td', null, [el('b', null, r.name || '—'), r.verified ? el('span', { class: 'cc-pill cc-pill-green', style: 'margin-left:8px' }, '✓ Verified') : el('span', { class: 'cc-pill cc-pill-amber', style: 'margin-left:8px' }, 'Unverified')]),
        el('td', null, el('span', { style: 'text-transform:capitalize' }, r.kind || '—')),
        el('td', null, el('div', null, [el('div', null, r.contact || '—'), el('div', { class: 'cc-sub' }, [r.email, r.phone].filter(Boolean).join(' · '))])),
        el('td', null, (r.mc ? 'MC ' + r.mc : '') + (r.dot ? (r.mc ? ' · ' : '') + 'DOT ' + r.dot : '') || '—'),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (r.status === 'active' ? 'green' : 'gray') }, r.status || '—')),
        el('td', null, el('span', { class: 'cc-row-go' }, '›')),
      ]))),
    ]));
  }

  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Contacts directory', 'Every registered account holder — carrier, broker, shipper, facility — with a verified badge and one-click drill-down into the full record.'),
    toolbar([segmented(KINDS, kind, (v) => { kind = v; load(); }), searchBox('Search name, MC, DOT, email, phone...', (v) => { search = v; load(); })]),
    kpis, listHost,
  ]));
  load();
}

export default renderContactsDirectory;
