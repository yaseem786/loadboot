// workflowBuilder.js — Workflow Builder (Increment 63, v1). Structured multi-step builder: add typed nodes
// (trigger → condition/delay/task/notification/email → end), connect condition true/false branches, validate,
// SIMULATE against a sample event (no side effects), publish, run history. Guardrails live server-side:
// node types are allowlisted — no node can approve accounts, move money or change permissions.
// KNOWN LIMITATION (honest): v1 is a step-list editor, not a drag/drop canvas; the graph model already
// supports a canvas UI later.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, openDrawer, fmtDateTime } from '../../shared/ui/components.js';
import { workflowsList, workflowSave, workflowSetStatus, workflowRun, workflowRuns } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const ST_TONE = { draft: 'gray', published: 'green', paused: 'amber', archived: 'red' };
const NODE_TYPES = [['condition', 'Condition (branch)'], ['delay', 'Delay'], ['task_note', 'Task note'], ['notification', 'Notification'], ['email_template', 'Email (template)']];

export function renderWorkflowBuilder(host) {
  const manage = can('settings.manage') || can('content.manage');
  const kpis = el('div', { class: 'cc-kpi-grid' });
  const body = el('div', { class: 'cc-table-wrap' });
  mount(host, el('div', null, [
    sectionHead('Workflow Builder', 'Multi-step automations with server-validated guardrails: no workflow can approve accounts, release money or change permissions. Simulate first — live email steps go through the consent-enforcing delivery ledger.',
      manage ? el('button', { class: 'lb-btn lb-btn-primary lb-btn-sm', onClick: () => editor(null) }, '+ New workflow') : null),
    kpis, body,
  ]));
  load();

  async function load() {
    showLoading(body, 'Loading workflows…');
    let rows; try { rows = await workflowsList(null); } catch (e) { showError(body, humanizeError(e), load); return; }
    rows = rows || [];
    mount(kpis, [
      statCard({ icon: 'settings', label: 'Workflows', value: String(rows.length), sub: rows.filter(r => r.status === 'published').length + ' published', accent: 'blue' }),
      statCard({ icon: 'check', label: 'Total runs', value: String(rows.reduce((a, r) => a + Number(r.runs || 0), 0)), sub: 'simulations + live', accent: 'green' }),
    ]);
    if (!rows.length) { mount(body, el('div', { class: 'lb-state' }, 'No workflows yet. Build the first one — start with a simulation.')); return; }
    mount(body, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Workflow', 'Trigger', 'Status', 'Version', 'Runs', 'Updated', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(w => el('tr', { class: 'cc-row' }, [
        el('td', null, [el('b', null, w.name), el('div', { class: 'cc-sub' }, w.key)]),
        el('td', null, w.trigger_event || 'manual'),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (ST_TONE[w.status] || 'gray') }, w.status)),
        el('td', null, 'v' + w.version + (w.published_version ? ' (pub v' + w.published_version + ')' : '')),
        el('td', null, String(w.runs || 0)),
        el('td', null, el('span', { class: 'cc-sub' }, fmtDateTime(w.updated_at))),
        el('td', null, el('div', { style: 'display:flex;gap:6px;justify-content:flex-end' }, [
          el('button', { class: 'lb-btn lb-btn-sm', onClick: () => simulate(w) }, 'Simulate'),
          manage ? el('button', { class: 'lb-btn lb-btn-sm', onClick: () => editor(w) }, 'Edit') : null,
          manage && w.status !== 'published' ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: async (ev) => {
            const _btn9 = ev.currentTarget;
            _btn9.disabled = true;
            try { await workflowSetStatus(w.id, 'publish'); toast('Published', 'success'); load(); }
            catch (e) { _btn9.disabled = false; toast(humanizeError(e), 'error'); }
          } }, 'Publish') : null,
          manage && w.status === 'published' ? el('button', { class: 'lb-btn lb-btn-sm', onClick: async () => {
            try { await workflowSetStatus(w.id, 'pause'); toast('Paused', 'success'); load(); } catch (e) { toast(humanizeError(e), 'error'); }
          } }, 'Pause') : null,
          el('button', { class: 'lb-btn lb-btn-sm', onClick: () => history(w) }, 'Runs'),
        ].filter(Boolean))),
      ]))),
    ]));
  }

  // Step-list editor: nodes are kept in order; condition nodes get true/false targets; others chain linearly.
  function editor(w) {
    let nodes = (w && (w.graph || {}).nodes || []).filter(n => n.type !== 'trigger' && n.type !== 'end');
    const keyI = el('input', { class: 'cc-input', placeholder: 'unique key e.g. wf.offer_followup' }); keyI.value = w ? w.key : '';
    if (w) keyI.disabled = true;
    const nameI = el('input', { class: 'cc-input', placeholder: 'Name' }); nameI.value = w ? (w.name || '') : '';
    const trigI = el('input', { class: 'cc-input', placeholder: 'trigger event e.g. offer.created (informational)' }); trigI.value = w ? (w.trigger_event || '') : '';
    const list = el('div');
    const typeSel = el('select', { class: 'cc-input', style: 'max-width:200px' }, NODE_TYPES.map(([v, l]) => el('option', { value: v }, l)));
    const draw = () => mount(list, nodes.length ? nodes.map((n, i) => el('div', { class: 'lb-card', style: 'margin:6px 0;padding:10px' }, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, [
        el('b', null, (i + 1) + '. ' + n.type),
        el('button', { class: 'lb-btn lb-btn-sm', onClick: () => { nodes.splice(i, 1); draw(); } }, '✕'),
      ]),
      cfgRow(n),
    ])) : el('div', { class: 'cc-sub' }, 'No steps yet — add one below. Trigger and End are added automatically.'));
    function cfgRow(n) {
      n.config = n.config || {};
      const inp = (ph, key, val) => { const i = el('input', { class: 'cc-input', placeholder: ph, style: 'margin-top:4px' }); i.value = val || ''; i.oninput = () => { n.config[key] = i.value; }; return i; };
      if (n.type === 'condition') return el('div', null, [
        inp('event field e.g. rate', 'field', n.config.field),
        el('select', { class: 'cc-input', style: 'margin-top:4px', onChange: (e) => { n.config.op = e.target.value; } },
          ['eq', 'neq', 'gt', 'lt', 'contains', 'exists'].map(o => el('option', { value: o, selected: n.config.op === o ? 'selected' : null }, o))),
        inp('value', 'value', n.config.value),
        el('div', { class: 'cc-sub', style: 'margin-top:4px' }, 'TRUE → next step in the list · FALSE → skips to the step after that (or End)'),
      ]);
      if (n.type === 'delay') return inp('minutes', 'minutes', n.config.minutes);
      if (n.type === 'task_note') return inp('task text for staff', 'text', n.config.text);
      if (n.type === 'notification') return inp('notification message', 'message', n.config.message);
      if (n.type === 'email_template') return el('div', null, [
        inp('template key e.g. tx.offer_new', 'template_key', n.config.template_key),
        inp('recipient email (or leave blank to use event.email)', 'to_email', n.config.to_email),
        inp('subject (optional)', 'subject', n.config.subject),
      ]);
      return el('span');
    }
    nodes.forEach(n => { if (n.type === 'condition') { n.config = n.config || {}; n.config.op = n.config.op || 'eq'; } });
    const addBtn = el('button', { class: 'lb-btn lb-btn-sm', onClick: () => { nodes.push({ id: 'n' + (nodes.length + 1) + '_' + typeSel.value, type: typeSel.value, config: typeSel.value === 'condition' ? { op: 'eq' } : {} }); draw(); } }, '+ Add step');
    const saveBtn = el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => {
      // build graph: trigger → steps (condition true→next, false→step-after-next/end) → end
      const g = { nodes: [{ id: 't0', type: 'trigger' }], edges: [] };
      nodes.forEach((n, i) => { n.id = 'n' + (i + 1); g.nodes.push({ id: n.id, type: n.type, config: n.config || {} }); });
      g.nodes.push({ id: 'zend', type: 'end' });
      const idAt = (i) => (i < nodes.length ? 'n' + (i + 1) : 'zend');
      g.edges.push({ from: 't0', to: idAt(0) });
      nodes.forEach((n, i) => {
        if (n.type === 'condition') {
          g.edges.push({ from: n.id, to: idAt(i + 1), when: 'true' });
          g.edges.push({ from: n.id, to: idAt(i + 2), when: 'false' });
        } else g.edges.push({ from: n.id, to: idAt(i + 1) });
      });
      try {
        const r = await workflowSave({ key: keyI.value.trim(), name: nameI.value.trim() || keyI.value.trim(), trigger_event: trigI.value.trim() || null, graph: g });
        if (!r.ok) { alert('Validation: ' + (r.validation_errors || []).join('; ')); return; }
        toast('Saved (draft v bump) — simulate before publishing', 'success');
        document.getElementById('cc-drawer-root')?.remove(); load();
      } catch (e) { alert(humanizeError(e)); }
    } }, 'Save workflow');
    draw();
    openDrawer(w ? 'Edit — ' + w.name : 'New workflow', el('div', null, [
      el('label', { class: 'cc-field' }, [el('span', null, 'Key'), keyI]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Name'), nameI]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Trigger event'), trigI]),
      el('div', { style: 'margin:10px 0 4px' }, el('b', null, 'Steps')), list,
      el('div', { style: 'display:flex;gap:8px;margin-top:8px' }, [typeSel, addBtn]),
      el('div', { class: 'cc-drawer-actions', style: 'margin-top:12px' }, saveBtn),
    ]), { subtitle: 'Guardrailed automation — simulate before publish' });
  }

  function simulate(w) {
    const ta = el('textarea', { class: 'cc-input', rows: '4' });
    ta.value = '{"rate": "2850", "origin": "Dallas, TX", "destination": "Atlanta, GA", "equipment": "Reefer"}'; // sample event — edit freely
    const out = el('div');
    openDrawer('Simulate — ' + w.name, el('div', null, [
      el('p', { class: 'cc-sub' }, 'Runs the published graph against this sample event with ZERO side effects — every step reports what it WOULD do.'),
      el('label', { class: 'cc-field' }, [el('span', null, 'Sample event (JSON)'), ta]),
      el('div', { class: 'cc-drawer-actions', style: 'margin:10px 0' }, el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev) => {
        const _btn9 = ev.currentTarget;
        let evt; try { evt = JSON.parse(ta.value); } catch (_) { alert('Invalid JSON'); return; }
        _btn9.disabled = true;
        try {
          const r = await workflowRun(w.id, evt, 'simulation');
          mount(out, el('div', null, (r.steps || []).map((s, i) => el('div', { style: 'display:flex;gap:8px;padding:4px 0;border-bottom:1px dashed #e2e8f0' }, [
            el('b', { style: 'white-space:nowrap' }, (i + 1) + '. ' + s.type),
            el('span', { class: 'cc-pill cc-pill-' + (s.outcome === 'failed' ? 'red' : 'gray'), style: 'white-space:nowrap' }, s.outcome),
            el('span', { class: 'cc-sub' }, s.detail || ''),
          ]))));
        } catch (e) { mount(out, el('div', { class: 'cc-sub', style: 'color:#dc2626' }, humanizeError(e))); }
        _btn9.disabled = false;
      } }, 'Run simulation')),
      out,
    ]), { subtitle: 'No side effects' });
  }

  async function history(w) {
    const bodyEl = el('div', null, el('div', { class: 'cc-sub' }, 'Loading…'));
    openDrawer('Runs — ' + w.name, bodyEl, { subtitle: 'newest first' });
    let rows; try { rows = await workflowRuns(w.id, 30); } catch (e) { mount(bodyEl, el('div', { class: 'cc-sub' }, humanizeError(e))); return; }
    mount(bodyEl, (rows && rows.length) ? el('div', null, rows.map(r => el('div', { class: 'lb-card', style: 'margin-bottom:8px' }, [
      el('div', { style: 'display:flex;justify-content:space-between' }, [
        el('b', null, r.mode + ' · ' + r.status), el('span', { class: 'cc-sub' }, fmtDateTime(r.created_at))]),
      el('div', { class: 'cc-sub' }, (r.steps || []).map(s => s.type + ':' + s.outcome).join(' → ')),
      r.error ? el('div', { class: 'cc-sub', style: 'color:#dc2626' }, r.error) : null,
    ].filter(Boolean)))) : el('div', { class: 'lb-state' }, 'No runs yet.'));
  }
}

export default renderWorkflowBuilder;
