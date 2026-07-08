// carriers.js — Carrier directory + detail drawer.
// Reads: cc_list_carriers / cc_get_carrier. Mutations: cc_set_carrier_status
// (carriers.approve, scope-checked + audited server-side). Permission-denied is
// surfaced cleanly; the server is always the authority.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import { sectionHead, toolbar, searchBox, segmented, statusPill, openDrawer, fmtDate, card } from '../../shared/ui/components.js';
import { getCarriersDirectory, getCarrierDetail, setCarrierStatus , pauseCarrier } from '../../shared/api.js';
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
        el('td', null, Number(c.doc_pending) > 0
          ? el('span', { class: 'cc-chip-warn' }, c.doc_pending + ' pending' + (Number(c.doc_approved) > 0 ? ' \u00b7 ' + c.doc_approved + ' ok' : ''))
          : Number(c.doc_approved) > 0
            ? el('span', { style: 'background:#e7f9ee;color:#12a150;font-weight:800;font-size:.74rem;padding:4px 10px;border-radius:99px' }, 'All verified \u2713 (' + c.doc_approved + ')')
            : '—'),
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
      const already = (c.status === status);
      if (already && status === 'active') label = '\u2713 Active';
      return el('button', { class: 'lb-btn lb-btn-' + kind, disabled: already, title: already ? 'Carrier is already in this state' : '',
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
      const isPaused = (c.status === 'paused');
      const pauseBtn = el('button', { class: 'lb-btn lb-btn-secondary', onClick: () => {
        if (isPaused) {
          const dr9 = openDrawer('\u25b6 Reinstate carrier', [
            el('div', { style: 'background:#e7f9ee;border:1px solid #bbf7d0;border-radius:12px;padding:12px 14px;font-size:.86rem;color:#166534;margin-bottom:14px' },
              'Booking aur sari services foran bahal \u2014 carrier ko in-app notification + email jayegi (\u201cWelcome back \u2713\u201d).'),
            el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev2) => { const _b_ = ev2.currentTarget;
              _b_.disabled = true;
              try { await pauseCarrier(id, 'resume', 'all', null); dr9.close(); toast('Carrier reinstated \u2014 notified + emailed', 'success'); openCarrier(id); load(); }
              catch (e) { toast(humanizeError(e), 'error'); _b_.disabled = false; }
            } }, '\u25b6 Reinstate now'),
          ]);
          return;
        }
        const REASONS9 = ['Insurance lapsed / COI expired', 'FMCSA authority issue (inactive / OOS)', 'Safety concern under investigation', 'Payment / settlement dispute', 'Suspected fraud or GPS spoofing', 'Excessive claims — under review', 'Carrier requested a hold', 'Other (describe below)'];
        const rs9 = el('select', { class: 'cc-input' }, REASONS9.map(x => el('option', { value: x }, x)));
        const msg9 = el('textarea', { class: 'cc-input', rows: '3', placeholder: 'Custom message \u2014 carrier ko in-app + email mein yehi lafz jayenge. Saaf likhein: kya theek karna hai.' });
        let scope9 = 'booking';
        const scopeEl = el('div', null, [['booking', '\u23f8 Booking only \u2014 loads band, portal/documents/claims chalte rahenge (recommended)'], ['all', '\u26d4 All services \u2014 poora account freeze']].map(([v2, l2]) =>
          el('label', { style: 'display:flex;gap:8px;align-items:flex-start;padding:5px 0;font-size:.85rem;cursor:pointer' }, [
            el('input', { type: 'radio', name: 'pscope', value: v2, checked: v2 === 'booking' ? 'checked' : undefined, onChange: () => { scope9 = v2; } }), el('span', null, l2)])));
        const dr9 = openDrawer('\u23f8 Pause carrier \u2014 ' + (c.company || ''), [
          el('label', { class: 'cc-sub', style: 'font-weight:700' }, 'Reason'), rs9,
          el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:10px;display:block' }, 'Message to carrier'), msg9,
          el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:10px;display:block' }, 'Scope'), scopeEl,
          el('div', { style: 'background:#eef6ff;border:1px solid #bfdbfe;border-radius:12px;padding:12px 14px;font-size:.83rem;color:#1e40af;margin-top:12px;line-height:1.6' },
            [el('div', { style: 'font-weight:800;margin-bottom:3px' }, 'What happens:'), 'Booking blocks instantly (server-level) \u00b7 carrier gets an \u26d4 urgent notification + branded email with your reason \u00b7 audit-log entry.',
             el('div', { style: 'font-weight:800;margin:8px 0 3px' }, 'How it reinstates:'), 'Once the issue is fixed, press \u25b6 Reinstate right here \u2014 everything restores + \u201cWelcome back \u2713\u201d notification.']),
          el('div', { style: 'display:flex;gap:8px;margin-top:14px' }, [
            el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev2) => { const _b_ = ev2.currentTarget;
              const why9 = rs9.value + (msg9.value.trim() ? ' \u2014 ' + msg9.value.trim() : '');
              _b_.disabled = true;
              try { await pauseCarrier(id, 'pause', scope9, why9); dr9.close(); toast('Paused (' + scope9 + ') \u2014 carrier notified + emailed', 'success'); openCarrier(id); load(); }
              catch (e) { toast(humanizeError(e), 'error'); _b_.disabled = false; }
            } }, '\u23f8 Pause carrier'),
            el('button', { class: 'lb-btn lb-btn-ghost', onClick: () => dr9.close() }, 'Cancel'),
          ]),
        ]);
      } }, isPaused ? '\u25b6 Reinstate' : '\u23f8 Pause\u2026');
      actionRow.appendChild(pauseBtn);
      actionRow.appendChild(actBtn('Send back', 'pending', 'ghost'));
    } else {
      actionRow.appendChild(el('p', { class: 'cc-sub' }, 'You have view-only access to carriers.'));
    }

    const pausedBanner = (c.status === 'paused') ? el('div', { style: 'background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:12px 14px;margin:10px 0' }, [
      el('div', { style: 'font-weight:800;color:#b91c1c;font-size:.9rem' }, '\u23f8 Account paused' + (c.pause_info && c.pause_info.scope === 'booking' ? ' \u2014 booking only' : ' \u2014 all services')),
      el('div', { style: 'color:#7f1d1d;font-size:.85rem;margin-top:4px' }, (c.pause_info && c.pause_info.reason) ? c.pause_info.reason : 'No reason recorded.'),
      el('div', { class: 'cc-sub', style: 'margin-top:4px' }, (c.pause_info && c.pause_info.at) ? 'Paused ' + fmtDate(c.pause_info.at) + ' \u00b7 carrier was notified + emailed' : ''),
    ]) : null;
    mount(body, el('div', null, [
      el('div', { class: 'cc-drawer-title' }, [el('h3', null, c.company || 'Carrier'), statusPill(c.status)]),
      pausedBanner,
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
    ].filter(Boolean)));
  }

  mount(host, el('div', { class: 'cc-view' }, [header(), listHost]));
  load();
}

export default renderCarriers;
