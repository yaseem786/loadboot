// dispatchers.js — CC DISPATCHERS module: the salaried, verified dispatch workforce.
// Pipeline (applied → screening → skills_test → trial → verified → active), carrier
// assignment + per-carrier SOP, and salary (base + per-active-truck + performance bonus).
// Distinct from Referral Partners (agents.js). Staff-gated by the RPCs themselves.
import { el, mount } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { money, fmtDate, fmtDateTime, card, sectionHead, askReason, askConfirm } from '../../shared/ui/components.js';
import { ccDispatchersList, ccDispatcher360, ccDispatcherDecide, ccDispatcherAssign, ccDispatcherSop,
         ccDispatcherUnassign, ccDispatcherSalarySet, ccDispatcherSalaryRun, ccDispatcherSalaryStatus,
         getCarriersDirectory } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { signedDocumentUrl } from '../../shared/storage.js';

const PIPE = ['applied', 'screening', 'skills_test', 'trial', 'verified', 'active', 'suspended', 'rejected'];
const STPILL = {
  applied: ['applied', 'violet'], screening: ['screening', 'amber'], skills_test: ['skills test', 'amber'],
  trial: ['paid trial', 'amber'], verified: ['verified', 'green'], active: ['ACTIVE', 'green'],
  suspended: ['suspended', 'red'], rejected: ['rejected', 'red'], withdrawn: ['withdrawn', 'violet'],
};
function pill(st) { const m = STPILL[st] || [st, 'violet']; return el('span', { class: 'cc-pill cc-pill-' + m[1] }, m[0]); }
const money0 = (n, c) => (c || 'PKR') + ' ' + Number(n || 0).toLocaleString();

export function renderDispatchers(host) {
  const state = { q: '', st: 'all', rows: [], carriers: [] };
  const body = el('div');
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Dispatchers', 'The salaried dispatch workforce — hiring pipeline, strict verification, carrier assignment + SOP, and salary (base + per-truck + performance).'),
    body,
  ]));
  load();

  async function load() {
    mount(body, el('div', { class: 'lb-state lb-loading' }, 'Loading dispatchers…'));
    let rows;
    try { rows = await ccDispatchersList(); } catch (e) { mount(body, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    if (rows && rows.error) { mount(body, el('div', { class: 'lb-state lb-error' }, rows.error)); return; }
    state.rows = Array.isArray(rows) ? rows : [];
    paint();
  }

  function paint() {
    const q = state.q.toLowerCase();
    const list = state.rows.filter((x) => (state.st === 'all' || x.status === state.st)
      && (!q || ((x.name || '') + ' ' + (x.email || '') + ' ' + (x.country || '')).toLowerCase().includes(q)));
    const qIn = el('input', { class: 'lb-input', placeholder: '🔍 name / email / country', value: state.q, style: 'max-width:240px',
      onInput: (e) => { state.q = e.target.value; paint(); } });
    const stSel = el('select', { class: 'lb-input', style: 'max-width:180px', onChange: (e) => { state.st = e.target.value; paint(); } },
      [['all', 'All statuses']].concat(PIPE.map((s) => [s, (STPILL[s] || [s])[0]])).map(([v, l]) => el('option', { value: v, selected: state.st === v ? '' : undefined }, l)));
    mount(body, el('div', null, [
      el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;align-items:center' }, [qIn, stSel,
        el('span', { class: 'cc-sub' }, list.length + ' of ' + state.rows.length + ' dispatchers')]),
      card([el('div', { class: 'cc-doclist' }, list.length ? list.map(row) : [el('div', { class: 'cc-sub' }, 'No dispatchers match.')])]),
    ]));
  }

  function row(x) {
    return el('div', { class: 'cc-row', style: 'display:flex;gap:12px;flex-wrap:wrap;align-items:center;padding:10px 0;border-bottom:1px solid #eef2f7;cursor:pointer', onClick: () => open360(x) }, [
      el('div', { style: 'flex:1;min-width:220px' }, [
        el('div', { style: 'font-weight:700' }, (x.name || '(no name)') + ' · ' + (x.email || '')),
        el('div', { class: 'cc-sub' }, (x.country || '—') + ' · ' + (x.years_exp || 0) + ' yrs exp · applied ' + fmtDate(x.applied_at)),
      ]),
      Number(x.carriers) ? el('span', { class: 'cc-pill cc-pill-green' }, (x.carriers) + ' carrier' + (x.carriers > 1 ? 's' : '') + ' · ' + (x.active_trucks || 0) + ' trucks') : '',
      pill(x.status),
    ]);
  }

  async function open360(x) {
    let d;
    try { d = await ccDispatcher360(x.user_id); } catch (e) { toast(humanizeError(e)); return; }
    if (!d || d.error) { toast((d && d.error) || 'Could not load'); return; }
    const p = d.profile || {};
    const wrap = el('div', { class: 'cc-drawer-body', style: 'max-width:760px' });
    const rerender = async () => { const nx = await ccDispatcher360(x.user_id).catch(() => null); if (nx && !nx.error) { mount(wrap, sections(nx)); } };

    function sections(dd) {
      const pp = dd.profile || {};
      return el('div', null, [
        el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:6px' }, [
          el('h2', { style: 'margin:0' }, pp.full_name || '(no name)'), pill(pp.status),
        ]),
        el('div', { class: 'cc-sub', style: 'margin-bottom:14px' }, (dd.email || '') + ' · ' + (pp.country || '—') + ' · ' + (pp.city || '') + ' · ' + (pp.years_exp || 0) + ' yrs'),
        // ---- application detail ----
        (() => { const s = pp.skills || {}; return card([
          el('div', { style: 'font-weight:700;margin-bottom:6px' }, 'Application & screening'),
          kv('English', pp.english_level),
          kv('Experience', (pp.years_exp || 0) + ' yrs · trucks handled: ' + (s.trucks_handled || '—')),
          kv('Availability', (s.availability_hours || '—') + ' hrs/wk · ' + (s.timezone || '') + (s.us_hours_overlap ? ' · US-hours overlap' : '')),
          kv('Load boards', (pp.load_boards || []).join(', ')),
          kv('Equipment', (s.equipment || []).join(', ')),
          kv('Skills', 'negotiation ' + (s.negotiation || '—') + ' · FMCSA/HOS ' + (s.fmcsa_hos || '—') + ' · geography ' + (s.us_geography || '—')),
          kv('Tools', s.tools), kv('Payout pref', s.payout_pref), kv('LinkedIn', s.linkedin),
          kv('References', (pp.refs || []).join('  |  ')),
          s.note ? kv('Why hire', s.note) : '',
          el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' }, [
            s.cv_doc ? docBtn('📄 CV / résumé' + (s.cv_name ? ' (' + s.cv_name + ')' : ''), s.cv_doc) : el('span', { class: 'cc-sub' }, 'No CV uploaded'),
            s.id_doc ? docBtn('🪪 Government ID', s.id_doc) : '',
          ]),
          pp.review_note ? kv('Last note', pp.review_note) : '',
        ]); })(),
        // ---- pipeline actions ----
        pipeline(pp),
        // ---- assignments ----
        assignSection(dd),
        // ---- salary ----
        salarySection(dd),
      ]);
    }
    function kv(k, v) { return el('div', { style: 'display:flex;gap:8px;padding:3px 0;font-size:.9rem' }, [el('span', { class: 'cc-sub', style: 'min-width:120px' }, k), el('span', null, v == null || v === '' ? '—' : String(v))]); }
    function docBtn(label, path) { return el('button', { class: 'lb-btn lb-btn-ghost', onClick: async () => { try { const u = await signedDocumentUrl(path, 600); window.open(u, '_blank', 'noopener'); } catch (e) { toast(humanizeError(e)); } } }, label); }

    function actBtn(label, action, tone, confirmMsg) {
      return el('button', { class: 'lb-btn ' + (tone || 'lb-btn-ghost'), style: 'margin:4px 6px 0 0', onClick: async () => {
        if (confirmMsg && !(await askConfirm(confirmMsg))) return;
        let note = null;
        if (action === 'reject' || action === 'suspend') { note = await askReason('Reason (optional)'); if (note === false) return; }
        const r = await ccDispatcherDecide(x.user_id, action, note).catch((e) => ({ error: humanizeError(e) }));
        if (r && r.error) { toast(r.error); return; }
        toast('✓ ' + (r.status || 'updated')); rerender();
      } }, label);
    }
    function pipeline(pp) {
      const st = pp.status;
      const btns = [];
      if (st === 'applied') btns.push(actBtn('Start screening →', 'screening', 'lb-btn-primary'));
      if (st === 'screening') btns.push(actBtn('Send skills test →', 'skills_test', 'lb-btn-primary'));
      if (st === 'skills_test') btns.push(actBtn('Move to paid trial →', 'trial', 'lb-btn-primary'));
      if (st === 'trial') btns.push(actBtn('✓ Verify (passed)', 'verify', 'lb-btn-primary'));
      if (st === 'verified') btns.push(el('span', { class: 'cc-sub' }, 'Verified — assign a carrier below to activate.'));
      if (st === 'active' || st === 'verified') btns.push(actBtn('Suspend', 'suspend', 'lb-btn-danger', 'Suspend this dispatcher?'));
      if (st === 'suspended') btns.push(actBtn('Reinstate', 'reinstate', 'lb-btn-primary'));
      if (!['rejected', 'active'].includes(st)) btns.push(actBtn('Reject', 'reject', 'lb-btn-danger', 'Reject this applicant?'));
      return card([el('div', { style: 'font-weight:700;margin-bottom:4px' }, 'Verification pipeline'),
        el('div', { class: 'cc-sub', style: 'margin-bottom:6px' }, 'applied → screening → skills test → paid trial → verified → active (on assignment)'),
        el('div', null, btns)]);
    }

    function assignSection(dd) {
      const active = (dd.assignments || []).filter((a) => a.status !== 'ended');
      const rows = active.length ? active.map((a) => el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid #eef2f7' }, [
        el('div', { style: 'flex:1;min-width:180px' }, [el('b', null, a.carrier || a.carrier_org_id), el('div', { class: 'cc-sub' }, (a.trucks || 0) + ' trucks · ' + a.status + ' · since ' + fmtDate(a.assigned_at))]),
        el('button', { class: 'lb-btn lb-btn-ghost', onClick: () => editSop(a) }, 'SOP'),
        el('button', { class: 'lb-btn lb-btn-danger', onClick: async () => { if (!(await askConfirm('End this assignment? The carrier frees up for reassignment.'))) return; const reason = await askReason('Reason (optional)'); if (reason === false) return; const r = await ccDispatcherUnassign(a.id, reason, false).catch((e) => ({ error: humanizeError(e) })); if (r && r.error) { toast(r.error); return; } toast('✓ ended'); rerender(); } }, 'End'),
      ])) : [el('div', { class: 'cc-sub' }, 'No active carriers assigned.')];
      // assign picker (verified/active only)
      let picker = '';
      if (['verified', 'active'].includes((dd.profile || {}).status)) {
        const sel = el('select', { class: 'lb-input', style: 'max-width:260px' }, [el('option', { value: '' }, 'Choose a carrier…')].concat(
          state.carriers.map((c) => el('option', { value: c.id }, c.name || c.id))));
        const btn = el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => {
          if (!sel.value) { toast('Pick a carrier'); return; }
          const r = await ccDispatcherAssign(x.user_id, sel.value, {}).catch((e) => ({ error: humanizeError(e) }));
          if (r && r.error) { toast(r.error); return; }
          toast('✓ assigned'); rerender();
        } }, 'Assign');
        picker = el('div', { style: 'display:flex;gap:8px;margin-top:8px;flex-wrap:wrap' }, [sel, btn]);
        if (!state.carriers.length) loadCarriers(sel);
      }
      return card([el('div', { style: 'font-weight:700;margin-bottom:4px' }, 'Assigned carriers (one dedicated dispatcher per carrier)'), el('div', null, rows), picker]);
    }
    async function loadCarriers(sel) {
      try { const r = await getCarriersDirectory({}); const arr = Array.isArray(r) ? r : (r && r.rows) || [];
        state.carriers = arr.map((c) => ({ id: c.id || c.org_id || c.carrier_id, name: c.name || c.company || c.legal_name })).filter((c) => c.id);
        if (sel) state.carriers.forEach((c) => sel.appendChild(el('option', { value: c.id }, c.name || c.id)));
      } catch (e) { /* leave empty */ }
    }
    function editSop(a) {
      const s = a.sop || {};
      // Compliance-critical: scope basis prevents "allocation of traffic" (88 FR 39371).
      const scopeType = el('select', { class: 'lb-input', style: 'max-width:220px' },
        [['geography', 'Geography (origin region)'], ['equipment', 'Equipment type'], ['commodity', 'Commodity / hazmat'], ['single', 'Single-carrier (no others)']]
          .map(([v9, l9]) => el('option', { value: v9, selected: (s.scope_type || 'geography') === v9 ? '' : undefined }, l9)));
      const scopeVal = el('input', { class: 'lb-input', value: s.scope_value || '', placeholder: 'e.g. "Origins in TX/OK/LA" or "Reefer only"' });
      const lanes = el('input', { class: 'lb-input', value: s.lanes || '', placeholder: 'Preferred lanes (e.g. TX↔CA)' });
      const minRate = el('input', { class: 'lb-input', value: s.min_rate || '', placeholder: 'Min rate/mile (e.g. 2.20)' });
      const equipment = el('input', { class: 'lb-input', value: s.equipment || '', placeholder: 'Equipment (van/reefer/flatbed)' });
      const homeTime = el('input', { class: 'lb-input', value: s.home_time || '', placeholder: 'Home-time rule' });
      const rules = el('textarea', { class: 'lb-input', style: 'min-height:70px' }, s.rules || '');
      const save = el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => {
        const sop = { scope_type: scopeType.value, scope_value: scopeVal.value, lanes: lanes.value, min_rate: minRate.value, equipment: equipment.value, home_time: homeTime.value, rules: rules.value };
        const r = await ccDispatcherSop(a.id, sop).catch((e) => ({ error: humanizeError(e) }));
        if (r && r.error) { toast(r.error); return; }
        m.remove(); toast('✓ SOP saved'); rerender();
      } }, 'Save SOP');
      const m = el('div', { style: 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:70;display:flex;align-items:center;justify-content:center', onClick: (e) => { if (e.target === m) m.remove(); } }, [
        el('div', { style: 'background:#fff;border-radius:12px;max-width:520px;width:92%;max-height:90vh;overflow:auto;padding:20px', onClick: (e) => e.stopPropagation() }, [
          el('div', { style: 'font-weight:800;margin-bottom:4px' }, 'SOP — ' + (a.carrier || 'carrier')),
          el('div', { class: 'cc-sub', style: 'margin-bottom:10px;line-height:1.5' }, '⚖️ Scope basis keeps this carrier’s loads NON-overlapping with your other carriers — so no load is ever "allocated" between carriers (FMCSA 88 FR 39371). Pick how this carrier’s freight is uniquely scoped.'),
          el('label', { class: 'cc-sub' }, 'Scope basis (required for compliance)'), scopeType, scopeVal,
          el('label', { class: 'cc-sub', style: 'margin-top:8px;display:block' }, 'Lanes'), lanes,
          el('label', { class: 'cc-sub' }, 'Min rate/mile'), minRate,
          el('label', { class: 'cc-sub' }, 'Equipment'), equipment,
          el('label', { class: 'cc-sub' }, 'Home-time'), homeTime,
          el('label', { class: 'cc-sub' }, 'Do’s / don’ts'), rules,
          el('div', { style: 'display:flex;gap:8px;margin-top:12px' }, [save, el('button', { class: 'lb-btn', onClick: () => m.remove() }, 'Cancel')]),
        ]),
      ]);
      document.body.appendChild(m);
    }

    function salarySection(dd) {
      const pp = dd.profile || {};
      const baseIn = el('input', { class: 'lb-input', type: 'number', value: pp.base_salary || 0, style: 'max-width:120px' });
      const perIn = el('input', { class: 'lb-input', type: 'number', value: pp.per_truck || 0, style: 'max-width:120px' });
      const curIn = el('input', { class: 'lb-input', value: pp.currency || 'PKR', style: 'max-width:80px' });
      const setBtn = el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => {
        const r = await ccDispatcherSalarySet(x.user_id, Number(baseIn.value), Number(perIn.value), curIn.value).catch((e) => ({ error: humanizeError(e) }));
        if (r && r.error) { toast(r.error); return; } toast('✓ salary terms saved'); rerender();
      } }, 'Save terms');
      // run month
      const period = el('input', { class: 'lb-input', type: 'month', value: new Date().toISOString().slice(0, 7), style: 'max-width:150px' });
      const bonus = el('input', { class: 'lb-input', type: 'number', value: 0, placeholder: 'bonus', style: 'max-width:110px' });
      const util = el('input', { class: 'lb-input', type: 'number', placeholder: 'util %', style: 'max-width:90px' });
      const ontime = el('input', { class: 'lb-input', type: 'number', placeholder: 'on-time %', style: 'max-width:100px' });
      const runBtn = el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => {
        const kpi = { utilization: Number(util.value) || null, on_time: Number(ontime.value) || null };
        const r = await ccDispatcherSalaryRun(x.user_id, period.value + '-01', Number(bonus.value), kpi, null).catch((e) => ({ error: humanizeError(e) }));
        if (r && r.error) { toast(r.error); return; }
        toast('✓ ' + money0(r.total, r.currency) + ' (' + r.active_trucks + ' trucks)'); rerender();
      } }, 'Run month');
      const ledger = (dd.salary || []).map((s) => el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid #eef2f7' }, [
        el('div', { style: 'flex:1;min-width:180px' }, [el('b', null, money0(s.total, s.currency) + ' · ' + fmtDate(s.period)),
          el('div', { class: 'cc-sub' }, 'base ' + money0(s.base, s.currency) + ' + ' + (s.active_trucks || 0) + '×' + money0(s.per_truck_rate, s.currency) + ' + bonus ' + money0(s.performance_bonus, s.currency))]),
        el('span', { class: 'cc-pill cc-pill-' + (s.status === 'paid' ? 'green' : s.status === 'approved' ? 'amber' : 'violet') }, s.status),
        s.status === 'draft' ? el('button', { class: 'lb-btn lb-btn-ghost', onClick: async () => { const r = await ccDispatcherSalaryStatus(s.id, 'approved').catch(() => null); if (r && r.ok) { toast('✓ approved'); rerender(); } } }, 'Approve') : '',
        s.status === 'approved' ? el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => { const r = await ccDispatcherSalaryStatus(s.id, 'paid').catch(() => null); if (r && r.ok) { toast('✓ paid'); rerender(); } } }, 'Mark paid') : '',
      ]));
      return card([
        el('div', { style: 'font-weight:700;margin-bottom:4px' }, 'Salary (base + per-active-truck + performance)'),
        el('div', { class: 'cc-sub', style: 'margin-bottom:6px' }, 'Total pay must stay below the 5% revenue this dispatcher’s carriers generate.'),
        el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px' }, [el('span', { class: 'cc-sub' }, 'Base'), baseIn, el('span', { class: 'cc-sub' }, '+ per truck'), perIn, curIn, setBtn]),
        el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px' }, [el('span', { class: 'cc-sub' }, 'Run'), period, bonus, util, ontime, runBtn]),
        ledger.length ? el('div', null, ledger) : el('div', { class: 'cc-sub' }, 'No salary runs yet.'),
      ]);
    }

    mount(wrap, sections(d));
    // simple overlay drawer
    const overlay = el('div', { class: 'cc-overlay', style: 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:60;display:flex;justify-content:flex-end', onClick: (e) => { if (e.target === overlay) overlay.remove(); } }, [
      el('div', { style: 'background:#fff;height:100%;width:min(820px,100%);overflow:auto;padding:22px', onClick: (e) => e.stopPropagation() }, [
        el('button', { class: 'lb-btn lb-btn-ghost', style: 'float:right', onClick: () => overlay.remove() }, '✕ Close'), wrap]),
    ]);
    document.body.appendChild(overlay);
  }
}
