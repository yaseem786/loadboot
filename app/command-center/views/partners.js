// partners.js — Brokers, broker agents & shippers: the account directory (real logins) + the CRM contact list.
//
// bl_bp_0455: the account table no longer shows a packet fraction ("0/8 verified" meant nothing for an agent or
// a shipper). Every row carries the server-computed onboarding STAGE (same engine as the 360 journey ladder),
// the next action for staff, the trust tier, last sign-in and load volume; the role filter separates brokers,
// agents and shippers; "Needs attention" surfaces blocked accounts and packets awaiting review. A row opens the
// role's own 360 (#/broker · #/broker-agent · #/shipper) through the shared entity-link helper.
import { el, mount } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { showError } from '../../shared/loading.js';
import { sectionHead, statCard, statusPill, searchBox, segmented, card, openDrawer, fmtDateTime, fmtDate, ago } from '../../shared/ui/components.js';
import { downloadCSV, downloadExcel, printTable } from '../../shared/ui/exporters.js';
import { partnersOverview, listPartners, getPartner, upsertPartner, setPartnerStatus, partnersAccounts } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';
import { partnerHref, ROLE_LABEL } from '../../shared/ui/entityLink.js';

const COLS = [
  { key: 'kind', label: 'Type' }, { key: 'name', label: 'Name' }, { key: 'mc', label: 'MC' },
  { key: 'contact_name', label: 'Contact' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }, { key: 'status', label: 'Status' },
];
const ACC_COLS = [
  { key: 'role', label: 'Role' }, { key: 'name', label: 'Account' }, { key: 'email', label: 'Owner email' }, { key: 'stage', label: 'Stage' }, { key: 'tier', label: 'Trust tier' },
  { key: 'next_action', label: 'Next action' }, { key: 'loads', label: 'Loads' }, { key: 'last_sign_in_at', label: 'Last sign-in' }, { key: 'status', label: 'Account status' },
];
const ROLE_TONE = { broker: 'blue', agent: 'violet', shipper: 'green', facility: 'gray' };
const pill = (tone, text, title) => el('span', { class: 'cc-pill cc-pill-' + (tone || 'gray'), style: 'text-transform:none', title: title || null }, text);

export function renderPartners(host) {
  let role = null, search = null, attention = false, rows = [], accs = [];
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Brokers, agents & shippers', 'Every partner login with its onboarding stage and what to do next — click a row for the full 360. CRM contacts (not logins) are below.',
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
    el('button', { class: 'cc-seg-btn', onClick: () => downloadCSV('loadboot-partner-accounts', ACC_COLS, accs) }, 'CSV'),
    el('button', { class: 'cc-seg-btn', onClick: () => downloadExcel('loadboot-partner-accounts', ACC_COLS, accs, 'Partner accounts') }, 'Excel'),
    el('button', { class: 'cc-seg-btn', onClick: () => printTable('Partner accounts', 'LoadBoot', ACC_COLS, accs) }, 'PDF'),
    manage ? el('button', { class: 'lb-btn lb-btn-primary lb-btn-sm', onClick: () => partnerForm(null) }, '+ CRM contact') : '',
  ]));
  const attentionBtn = el('button', { class: 'cc-seg-btn', title: 'Blocked accounts, packets awaiting review, unconfirmed emails', onClick: () => { attention = !attention; attentionBtn.classList.toggle('active', attention); draw(); } }, [icon('alert', 14), ' Needs attention']);
  mount(toolsHost, [
    segmented([{ value: null, label: 'All' }, { value: 'broker', label: 'Brokers' }, { value: 'agent', label: 'Broker agents' }, { value: 'shipper', label: 'Shippers' }], role, (v) => { role = v; draw(); loadCrm(); }),
    el('div', { class: 'cc-seg' }, [attentionBtn]),
    searchBox('Search name, MC, email…', (q) => { search = q || null; draw(); loadCrm(); }),
  ]);

  load();

  async function load() {
    mount(body, el('div', { class: 'lb-state lb-loading' }, 'Loading…'));
    try { accs = (await partnersAccounts()) || []; }
    catch (e) { showError(body, humanizeError(e), load); return; }
    accs.forEach((a) => { a.role = a.role || (a.is_agent ? 'agent' : a.kind); });
    drawKpis();
    draw();
    loadCrm();
  }

  function drawKpis() {
    const by = (r) => accs.filter((a) => a.role === r).length;
    const attn = accs.filter(needsAttention).length;
    const review = accs.reduce((n, a) => n + (Number(a.awaiting) || 0), 0);
    const active7 = accs.filter((a) => a.last_sign_in_at && Date.now() - new Date(a.last_sign_in_at).getTime() < 7 * 864e5).length;
    mount(kpiHost, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'users', label: 'Accounts', value: String(accs.length), sub: by('broker') + ' brokers · ' + by('agent') + ' agents · ' + by('shipper') + ' shippers', accent: 'blue' }),
      statCard({ icon: 'alert', label: 'Need a human', value: String(attn), sub: 'blocked step, hold, or unconfirmed email', accent: attn ? 'red' : 'green', onClick: () => { attention = true; attentionBtn.classList.add('active'); draw(); } }),
      statCard({ icon: 'doc', label: 'Packet items to review', value: String(review), sub: 'submitted, waiting for staff', accent: review ? 'amber' : 'green', onClick: () => { attention = true; attentionBtn.classList.add('active'); draw(); } }),
      statCard({ icon: 'activity', label: 'Signed in this week', value: String(active7), sub: 'of ' + accs.length + ' accounts', accent: 'green' }),
    ]));
    // CRM overview numbers, if the RPC answers, go in the CRM card header (loaded lazily)
  }

  function needsAttention(a) {
    return Number(a.blockers) > 0 || Number(a.awaiting) > 0 || a.email_confirmed === false || a.stage_tone === 'red';
  }

  function draw() {
    const q = (search || '').toLowerCase();
    const list = accs
      .filter((a) => !role || a.role === role)
      .filter((a) => !q || [a.name, a.email, a.mc_number, a.contact, a.stage].some((x) => String(x || '').toLowerCase().includes(q)))
      .filter((a) => !attention || needsAttention(a))
      .sort((a, b) => (needsAttention(b) - needsAttention(a)) || (Number(b.awaiting) - Number(a.awaiting)) || (new Date(b.created_at) - new Date(a.created_at)));
    const table = list.length ? el('div', { class: 'cc-table-wrap' }, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, [el('th', null, 'Account'), el('th', null, 'Stage'), el('th', null, 'Next for staff'), el('th', null, 'Journey'), el('th', null, 'Loads'), el('th', null, 'Last sign-in'), el('th', null, 'Status')])),
      el('tbody', null, list.map((a) => el('tr', { class: 'cc-row-click', style: 'cursor:pointer', onClick: () => { location.hash = partnerHref(a); } }, [
        el('td', null, [
          el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [el('b', null, a.name || '—'), pill(ROLE_TONE[a.role] || 'gray', ROLE_LABEL[a.role] || a.role), a.is_demo ? pill('amber', 'demo') : null]),
          el('div', { class: 'cc-sub' }, [a.email || '—', a.mc_number ? ' · MC ' + a.mc_number : '', a.contact ? ' · ' + a.contact : '', ' · joined ' + fmtDate(a.created_at)]),
          a.role === 'agent' && Array.isArray(a.agent_parents) && a.agent_parents.length ? el('div', { class: 'cc-sub' }, 'agent of ' + a.agent_parents.map((p) => p.name + (p.status === 'confirmed' ? ' ✓' : ' (' + p.status + ')')).join(', ')) : null,
        ]),
        el('td', null, [pill(a.stage_tone || 'gray', a.stage || 'New', 'trust tier: ' + String(a.tier || 'new').replace(/_/g, ' ')), Number(a.awaiting) ? el('div', { class: 'cc-sub', style: 'margin-top:3px' }, a.awaiting + ' item(s) awaiting review') : null]),
        el('td', { style: 'max-width:340px' }, el('div', { class: 'cc-sub', style: 'white-space:normal;line-height:1.45', title: a.next_action || '' }, (a.next_action || '—').length > 140 ? (a.next_action || '').slice(0, 137) + '…' : (a.next_action || '—'))),
        el('td', null, [el('b', null, (a.journey_done || 0) + '/' + (a.journey_total || 0)), el('div', { style: 'height:5px;border-radius:3px;background:var(--lb-border,#e2e8f0);margin-top:4px;width:80px;overflow:hidden' }, el('div', { style: 'height:100%;width:' + Math.round(100 * (a.journey_done || 0) / Math.max(1, a.journey_total || 1)) + '%;background:' + (a.stage_tone === 'red' ? '#dc2626' : a.stage_tone === 'green' ? '#16a34a' : '#0883F7') }))]),
        el('td', null, [el('b', null, String(a.loads_30d || 0)), el('div', { class: 'cc-sub' }, (a.loads || 0) + ' total')]),
        el('td', null, a.last_sign_in_at ? [ago(a.last_sign_in_at), el('div', { class: 'cc-sub' }, fmtDateTime(a.last_sign_in_at))] : (a.email_confirmed === false ? pill('red', 'email unconfirmed') : el('span', { class: 'cc-sub' }, 'never'))),
        el('td', null, [statusPill(a.status), Number(a.unread_notices) ? el('div', { class: 'cc-sub', style: 'margin-top:3px' }, a.unread_notices + ' unread notice(s)') : null]),
      ]))),
    ])) : el('div', { class: 'cc-sub', style: 'padding:8px' }, attention ? 'Nothing needs a human right now.' : 'No partner accounts match.');
    const accCard = card(el('div', null, [
      el('div', { class: 'cc-card-head', style: 'display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center' }, [el('h4', { class: 'cc-card-title' }, 'Partner accounts — real logins'), el('span', { class: 'cc-sub' }, list.length + ' shown · sorted: needs attention first · click a row → 360')]),
      table,
    ]));
    const crmHost = el('div', { id: 'pt-crm' });
    mount(body, el('div', null, [accCard, el('div', { class: 'cc-sub', style: 'margin:14px 0 6px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;font-size:.72rem' }, 'CRM contacts (directory — not logins)'), crmHost]));
    if (crmRows) drawCrm(crmRows);
  }

  let crmRows = null;
  async function loadCrm() {
    const kind = role === 'agent' ? 'broker' : role;
    try { crmRows = await listPartners({ kind, search }); } catch (_) { crmRows = []; }
    rows = crmRows;
    drawCrm(crmRows);
  }
  function drawCrm(list) {
    const crmHost = body.querySelector('#pt-crm'); if (!crmHost) return;
    mount(crmHost, card((list || []).length ? el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, [el('th', null, 'Type'), el('th', null, 'Name'), el('th', null, 'MC'), el('th', null, 'Contact'), el('th', null, 'Email'), el('th', null, 'Status')])),
      el('tbody', null, list.map((p) => el('tr', { class: 'cc-row-click', onClick: () => openPartner(p.id) }, [
        el('td', null, statusPill(p.kind)), el('td', null, el('b', null, p.name)), el('td', null, p.mc || '—'),
        el('td', null, p.contact_name || '—'), el('td', null, p.email || '—'), el('td', null, statusPill(p.status)),
      ]))),
    ]) : el('div', { class: 'cc-sub', style: 'padding:8px' }, 'No CRM contacts match.')));
  }

  async function openPartner(id) {
    let p; try { p = await getPartner(id); } catch (e) { toast(humanizeError(e)); return; }
    const tl = p.timeline || [];
    const actions = el('div', { class: 'cc-drawer-actions' });
    if (manage) {
      actions.appendChild(el('button', { class: 'lb-btn lb-btn-secondary', onClick: () => { document.getElementById('cc-drawer-root')?.remove(); partnerForm(p); } }, 'Edit'));
      const setS = async (s) => { try { await setPartnerStatus(id, s); } catch (e) { toast(humanizeError(e)); return; } document.getElementById('cc-drawer-root')?.remove(); loadCrm(); };
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
    ]), { subtitle: (p.kind === 'broker' ? 'Broker' : 'Shipper') + ' · CRM contact (not a login)' });
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
      el('div', { class: 'cc-drawer-actions', style: 'margin-top:12px' }, [el('button', { class: 'lb-btn lb-btn-primary', onClick: save }, isEdit ? 'Save changes' : 'Add contact')]),
    ]);
    openDrawer(isEdit ? p.name : 'New CRM contact', form, { subtitle: isEdit ? 'Edit contact' : 'A broker or shipper you talk to — not a portal login' });

    async function save() {
      const name = fields.name.value.trim();
      if (!name) { toast('Name is required.'); return; }
      const cl = fields.credit_limit.value === '' ? null : Number(fields.credit_limit.value);
      try { await upsertPartner({ id: p && p.id, kind: kindSel.value, name, mc: fields.mc.value.trim() || null, contactName: fields.contact_name.value.trim() || null, email: fields.email.value.trim() || null, phone: fields.phone.value.trim() || null, billingTerms: fields.billing_terms.value.trim() || null, creditLimit: cl }); }
      catch (e) { toast(humanizeError(e)); return; }
      document.getElementById('cc-drawer-root')?.remove(); loadCrm();
    }
  }
}

function kv(k, v) { return el('div', { class: 'cc-kv' }, [el('span', { class: 'cc-kv-k' }, k), el('span', { class: 'cc-kv-v' }, v == null || v === '' ? '—' : String(v))]); }

export default renderPartners;
