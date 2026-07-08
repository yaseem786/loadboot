// partners.js — Control Tower Wave C: Brokers & Shippers.
// Brokers and shippers as first-class records with contact, MC, billing terms and credit
// limit. List + filter + search, create/edit in a drawer, status hold/active, and a
// per-partner audit timeline. Reads/writes via cc_*partner* RPCs (partners.view/manage).
import { el, mount } from '../../shared/ui/dom.js';
import { showError } from '../../shared/loading.js';
import { sectionHead, statCard, statusPill, searchBox, segmented, card, openDrawer, fmtDateTime } from '../../shared/ui/components.js';
import { downloadCSV, downloadExcel, printTable } from '../../shared/ui/exporters.js';
import { partnersOverview, listPartners, getPartner, upsertPartner, setPartnerStatus, partnersAccounts } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const COLS = [
  { key: 'kind', label: 'Type' }, { key: 'name', label: 'Name' }, { key: 'mc', label: 'MC' },
  { key: 'contact_name', label: 'Contact' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }, { key: 'status', label: 'Status' },
];

export function renderPartners(host) {
  let kind = null, search = null, rows = [];
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Brokers & Shippers', 'Your broker and shipper customers — contacts, billing terms and credit, with full history.',
      el('div', { class: 'cc-head-actions', id: 'pt-actions' })),
    el('div', { id: 'pt-kpis' }),
    el('div', { class: 'cc-toolbar', id: 'pt-tools' }),
    el('div', { id: 'pt-body' }, el('div', { class: 'lb-state lb-loading' }, 'Loading…')),
  ]));
  const kpiHost = host.querySelector('#pt-kpis');
  const actionHost = host.querySelector('#pt-actions');
  const toolsHost = host.querySelector('#pt-tools');
  const body = host.querySelector('#pt-body');
  const manage = can('partners.manage');

  mount(actionHost, el('div', { class: 'cc-seg' }, [
    el('button', { class: 'cc-seg-btn', onClick: () => downloadCSV('loadboot-partners', COLS, rows) }, 'CSV'),
    el('button', { class: 'cc-seg-btn', onClick: () => downloadExcel('loadboot-partners', COLS, rows, 'Partners') }, 'Excel'),
    el('button', { class: 'cc-seg-btn', onClick: () => printTable('Brokers & Shippers', 'LoadBoot', COLS, rows) }, 'PDF'),
    manage ? el('button', { class: 'lb-btn lb-btn-primary lb-btn-sm', onClick: () => partnerForm(null) }, '+ Partner') : '',
  ]));
  mount(toolsHost, [
    segmented([{ value: null, label: 'All' }, { value: 'broker', label: 'Brokers' }, { value: 'shipper', label: 'Shippers' }], kind, (v) => { kind = v; load(); }),
    searchBox('Search name, MC, email…', (q) => { search = q || null; load(); }),
  ]);

  loadKpis();
  load();

  async function loadKpis() {
    let ov; try { ov = await partnersOverview(); } catch (_) { return; }
    const n = (k) => Number((ov && ov[k]) || 0);
    mount(kpiHost, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'users', label: 'Brokers', value: String(n('brokers')), sub: 'broker accounts', accent: 'blue' }),
      statCard({ icon: 'truck', label: 'Shippers', value: String(n('shippers')), sub: 'shipper accounts', accent: 'violet' }),
      statCard({ icon: 'check', label: 'Active', value: String(n('active')), sub: 'in good standing', accent: 'green' }),
      statCard({ icon: 'shield', label: 'On hold', value: String(n('hold')), sub: 'credit / compliance hold', accent: 'amber' }),
    ]));
  }

  async function load() {
    mount(body, el('div', { class: 'lb-state lb-loading' }, 'Loading…'));
    try { rows = await listPartners({ kind, search }); }
    catch (e) { showError(body, humanizeError(e), load); return; }
    if (!rows.length) { mount(body, card(el('div', { class: 'cc-sub', style: 'padding:8px' }, 'No partners yet. Add a broker or shipper to get started.'))); return; }
    // ---- REAL partner accounts (logins) — carrier-tab parity: click opens Broker 360 ----
    let accs = []; try { accs = await partnersAccounts() || []; } catch (_) { accs = []; }
    const q9 = (search || '').toLowerCase();
    const accsF = accs.filter((a) => !q9 || String(a.name || '').toLowerCase().includes(q9) || String(a.email || '').toLowerCase().includes(q9))
                      .filter((a) => !kind || a.kind === kind);
    const accCard = card(el('div', null, [
      el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, 'Partner accounts — real logins'), el('span', { class: 'cc-sub' }, 'click a row \u2192 Broker 360 (packet review, FMCSA, loads, claims)')]),
      accsF.length ? el('table', { class: 'cc-table' }, [
        el('thead', null, el('tr', null, [el('th', null, 'Type'), el('th', null, 'Name'), el('th', null, 'Email'), el('th', null, 'Contact'), el('th', null, 'Packet'), el('th', null, 'Loads'), el('th', null, 'Status')])),
        el('tbody', null, accsF.map((a) => el('tr', { class: 'cc-row-click', style: 'cursor:pointer', onClick: () => { location.hash = '#/broker?id=' + a.id; } }, [
          el('td', null, statusPill(a.kind)),
          el('td', null, el('b', null, a.name || '\u2014')),
          el('td', null, a.email || '\u2014'),
          el('td', null, a.contact || '\u2014'),
          el('td', null, (() => {
            const ok = Number(a.packet_done) >= Number(a.packet_total);
            const aw = Number(a.awaiting) || 0;
            return el('span', { class: 'cc-pill', style: aw ? 'background:#fef3c7;color:#b45309' : ok ? 'background:#e7f9ee;color:#12a150' : 'background:#fee2e2;color:#b91c1c' },
              aw ? aw + ' awaiting \u00b7 ' + a.packet_done + '/' + a.packet_total : (ok ? 'Complete \u2713 (' + a.packet_total + ')' : a.packet_done + '/' + a.packet_total + ' verified'));
          })()),
          el('td', null, String(a.loads || 0)),
          el('td', null, statusPill(a.status)),
        ]))),
      ]) : el('div', { class: 'cc-sub', style: 'padding:8px' }, 'No partner accounts yet.'),
    ]));
    const crmHead = el('div', { class: 'cc-sub', style: 'margin:14px 0 6px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;font-size:.72rem' }, 'CRM contacts (directory \u2014 not logins)');
    mount(body, el('div', null, [accCard, crmHead, card(el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, [el('th', null, 'Type'), el('th', null, 'Name'), el('th', null, 'MC'), el('th', null, 'Contact'), el('th', null, 'Email'), el('th', null, 'Status')])),
      el('tbody', null, rows.map(p => el('tr', { class: 'cc-row-click', onClick: () => openPartner(p.id) }, [
        el('td', null, statusPill(p.kind)), el('td', null, el('b', null, p.name)), el('td', null, p.mc || '—'),
        el('td', null, p.contact_name || '—'), el('td', null, p.email || '—'), el('td', null, statusPill(p.status)),
      ]))),
    ]))]));
  }

  async function openPartner(id) {
    let p; try { p = await getPartner(id); } catch (e) { alert(humanizeError(e)); return; }
    const tl = p.timeline || [];
    const actions = el('div', { class: 'cc-drawer-actions' });
    if (manage) {
      actions.appendChild(el('button', { class: 'lb-btn lb-btn-secondary', onClick: () => { document.getElementById('cc-drawer-root')?.remove(); partnerForm(p); } }, 'Edit'));
      const setS = async (s) => { try { await setPartnerStatus(id, s); } catch (e) { alert(humanizeError(e)); return; } document.getElementById('cc-drawer-root')?.remove(); loadKpis(); load(); };
      if (p.status !== 'hold') actions.appendChild(el('button', { class: 'lb-btn lb-btn-secondary', onClick: () => setS('hold') }, 'Put on hold'));
      if (p.status !== 'active') actions.appendChild(el('button', { class: 'lb-btn lb-btn-secondary', onClick: () => setS('active') }, 'Reactivate'));
    }
    openDrawer(p.name, el('div', null, [
      kv('Type', p.kind), kv('Status', p.status), kv('MC', p.mc), kv('Contact', p.contact_name),
      kv('Email', p.email), kv('Phone', p.phone), kv('Billing terms', p.billing_terms),
      kv('Credit limit', p.credit_limit != null ? '$' + Number(p.credit_limit).toLocaleString() : '—'),
      p.notes ? el('div', { class: 'cc-kv', style: 'align-items:flex-start' }, [el('span', { class: 'cc-kv-k' }, 'Notes'), el('span', { class: 'cc-kv-v', style: 'white-space:pre-wrap' }, p.notes)]) : '',
      actions.childNodes.length ? el('div', { style: 'margin-top:12px' }, actions) : '',
      el('h4', { class: 'cc-card-title', style: 'margin-top:16px' }, 'Timeline'),
      tl.length ? el('div', { class: 'cc-timeline' }, tl.map(e => el('div', { class: 'cc-tl-row' }, [el('span', { class: 'cc-tl-dot' }), el('div', null, [el('b', null, e.action), el('div', { class: 'cc-sub' }, (e.summary || '') + ' · ' + fmtDateTime(e.at))])]))) : el('div', { class: 'cc-sub' }, 'No activity yet.'),
    ]), { subtitle: p.kind === 'broker' ? 'Broker' : 'Shipper' });
  }

  function partnerForm(p) {
    const isEdit = !!p;
    const fields = {};
    const input = (key, label, val) => { const i = el('input', { class: 'cc-input', value: val ?? '' }); fields[key] = i; return el('label', { class: 'cc-field' }, [el('span', null, label), i]); };
    const kindSel = el('select', { class: 'cc-input' }, [el('option', { value: 'broker', selected: (p && p.kind) === 'broker' ? true : null }, 'Broker'), el('option', { value: 'shipper', selected: (p && p.kind) === 'shipper' ? true : null }, 'Shipper')]);
    const form = el('div', null, [
      el('label', { class: 'cc-field' }, [el('span', null, 'Type'), kindSel]),
      input('name', 'Name', p && p.name), input('mc', 'MC number', p && p.mc),
      input('contact_name', 'Contact name', p && p.contact_name), input('email', 'Email', p && p.email),
      input('phone', 'Phone', p && p.phone), input('billing_terms', 'Billing terms (e.g. Net 30)', p && p.billing_terms),
      input('credit_limit', 'Credit limit', p && p.credit_limit),
      el('div', { class: 'cc-drawer-actions', style: 'margin-top:12px' }, [el('button', { class: 'lb-btn lb-btn-primary', onClick: save }, isEdit ? 'Save changes' : 'Add partner')]),
    ]);
    openDrawer(isEdit ? p.name : 'New partner', form, { subtitle: isEdit ? 'Edit partner' : 'Add a broker or shipper' });

    async function save() {
      const name = fields.name.value.trim();
      if (!name) { alert('Name is required.'); return; }
      const cl = fields.credit_limit.value === '' ? null : Number(fields.credit_limit.value);
      try { await upsertPartner({ id: p && p.id, kind: kindSel.value, name, mc: fields.mc.value.trim() || null, contactName: fields.contact_name.value.trim() || null, email: fields.email.value.trim() || null, phone: fields.phone.value.trim() || null, billingTerms: fields.billing_terms.value.trim() || null, creditLimit: cl }); }
      catch (e) { alert(humanizeError(e)); return; }
      document.getElementById('cc-drawer-root')?.remove(); loadKpis(); load();
    }
  }
}

function kv(k, v) { return el('div', { class: 'cc-kv' }, [el('span', { class: 'cc-kv-k' }, k), el('span', { class: 'cc-kv-v' }, v == null || v === '' ? '—' : String(v))]); }

export default renderPartners;
