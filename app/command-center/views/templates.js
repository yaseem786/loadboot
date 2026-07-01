// templates.js — Template Studio (Phase 3A). One shared template system for marketing
// and transactional messages across email / portal / push / SMS. Variables are an
// allowlist enforced server-side (unknown {{vars}} fail the save). Draft → published →
// archived lifecycle. Builds on app_private.comm_templates (no second system).
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, openDrawer, fmtDateTime } from '../../shared/ui/components.js';
import { studioListTemplates, studioSaveTemplate, studioSetTemplateStatus, TEMPLATE_VARIABLES } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const ST_TONE = { draft: 'gray', published: 'green', archived: 'amber' };
const CHANNELS = ['email', 'portal', 'push', 'sms', 'banner'];

export function renderTemplates(host) {
  const manage = can('content.manage') || can('settings.manage');
  const kpis = el('div', { class: 'cc-kpi-grid' });
  const body = el('div', { class: 'cc-table-wrap' });
  mount(host, el('div', null, [
    sectionHead('Template Studio', 'Marketing + transactional message templates with a strict variable allowlist. One template, many channels.',
      manage ? el('div', { class: 'cc-head-actions' }, el('button', { class: 'lb-btn lb-btn-primary lb-btn-sm', onClick: () => editor(null) }, '+ New template')) : null),
    kpis, body,
  ]));
  load();

  async function load() {
    showLoading(body, 'Loading templates…');
    let rows; try { rows = await studioListTemplates(); } catch (e) { showError(body, humanizeError(e), load); return; }
    rows = rows || [];
    mount(kpis, [
      statCard({ icon: 'doc', label: 'Templates', value: String(rows.length), sub: rows.filter(r => r.category === 'marketing').length + ' marketing', accent: 'blue' }),
      statCard({ icon: 'check', label: 'Published', value: String(rows.filter(r => r.status === 'published').length), sub: 'live', accent: 'green' }),
      statCard({ icon: 'list', label: 'Drafts', value: String(rows.filter(r => r.status === 'draft').length), sub: 'in progress', accent: 'amber' }),
    ]);
    if (!rows.length) { mount(body, el('div', { class: 'lb-state' }, 'No templates yet. Create your first one.')); return; }
    mount(body, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Template', 'Category', 'Channels', 'Status', 'Updated', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(t => el('tr', { class: 'cc-row', onClick: () => editor(t) }, [
        el('td', null, [el('b', null, t.name || t.key), el('div', { class: 'cc-sub' }, t.key)]),
        el('td', null, t.category || '—'),
        el('td', null, (t.channels || [t.channel]).filter(Boolean).join(', ')),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (ST_TONE[t.status] || 'gray') }, t.status || 'draft')),
        el('td', null, el('span', { class: 'cc-sub' }, t.updated_at ? fmtDateTime(t.updated_at) : '—')),
        el('td', null, el('span', { class: 'cc-row-go' }, '›')),
      ]))),
    ]));
  }

  function editor(t) {
    const f = {
      key: t ? t.key : '', name: t ? t.name : '', category: t ? (t.category || 'transactional') : 'transactional',
      channels: t ? (t.channels || ['email']) : ['email'], subject: t ? (t.subject || '') : '',
      preview: t ? (t.preview_text || '') : '', bodyHtml: t ? (t.body || '') : '', bodyText: t ? (t.body_text || '') : '',
      status: t ? (t.status || 'draft') : 'draft',
    };
    const inp = (label, key, ph) => { const i = el('input', { class: 'cc-input', placeholder: ph || '', value: f[key] }); i.disabled = !manage || (key === 'key' && !!t); i.oninput = () => { f[key] = i.value; }; return el('label', { class: 'cc-field' }, [el('span', null, label), i]); };
    const catSel = el('select', { class: 'cc-input', disabled: !manage }, [['transactional', 'Transactional'], ['marketing', 'Marketing']].map(([v, l]) => el('option', { value: v, selected: f.category === v ? 'selected' : null }, l)));
    catSel.onchange = () => { f.category = catSel.value; };
    const chWrap = el('div', { style: 'display:flex;flex-wrap:wrap;gap:7px' }, CHANNELS.map(c => { const on = f.channels.includes(c); const b = el('button', { class: 'cc-chip-btn' + (on ? ' on' : ''), onClick: () => { if (!manage) return; const s = new Set(f.channels); if (s.has(c)) s.delete(c); else s.add(c); f.channels = [...s]; b.classList.toggle('on'); } }, c); return b; }));
    const subj = el('input', { class: 'cc-input', placeholder: 'Subject — e.g. Your load {{load_reference}} is confirmed', value: f.subject }); subj.disabled = !manage; subj.oninput = () => { f.subject = subj.value; };
    const prev = el('input', { class: 'cc-input', placeholder: 'Preview text', value: f.preview }); prev.disabled = !manage; prev.oninput = () => { f.preview = prev.value; };
    const bodyH = el('textarea', { class: 'cc-input', rows: '8', placeholder: 'HTML body — use {{variables}} from the allowlist' }, f.bodyHtml); bodyH.disabled = !manage; bodyH.oninput = () => { f.bodyHtml = bodyH.value; };
    const bodyT = el('textarea', { class: 'cc-input', rows: '4', placeholder: 'Plain-text fallback' }, f.bodyText); bodyT.disabled = !manage; bodyT.oninput = () => { f.bodyText = bodyT.value; };
    const statSel = el('select', { class: 'cc-input', disabled: !manage }, [['draft', 'Draft'], ['published', 'Published'], ['archived', 'Archived']].map(([v, l]) => el('option', { value: v, selected: f.status === v ? 'selected' : null }, l)));
    statSel.onchange = () => { f.status = statSel.value; };
    const vars = el('div', { class: 'cc-sub', style: 'margin-top:6px;line-height:1.7' }, ['Allowed variables: ', ...TEMPLATE_VARIABLES.map(v => el('code', { style: 'background:#eef2f8;padding:1px 6px;border-radius:6px;margin:0 3px;cursor:pointer', onClick: () => { bodyH.value += '{{' + v + '}}'; f.bodyHtml = bodyH.value; } }, '{{' + v + '}}'))]);
    const form = el('div', null, [
      inp('Key (unique id)', 'key', 'invoice_ready'), inp('Name', 'name', 'Invoice ready'),
      el('label', { class: 'cc-field' }, [el('span', null, 'Category'), catSel]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Channels'), chWrap]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Subject'), subj]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Preview text'), prev]),
      el('label', { class: 'cc-field' }, [el('span', null, 'HTML body'), bodyH]),
      vars,
      el('label', { class: 'cc-field' }, [el('span', null, 'Plain-text fallback'), bodyT]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Status'), statSel]),
      manage ? el('div', { class: 'cc-drawer-actions', style: 'margin-top:12px' }, [el('button', { class: 'lb-btn lb-btn-primary', onClick: save }, 'Save template')]) : el('p', { class: 'cc-sub' }, 'You have read-only access to templates.'),
    ]);
    openDrawer(t ? 'Edit template' : 'New template', form, { subtitle: 'Unknown {{variables}} are rejected on save' });

    async function save() {
      if (!f.key.trim() || !f.name.trim()) { alert('Key and name are required.'); return; }
      try { await studioSaveTemplate(f); toast('Template saved', 'success'); document.getElementById('cc-drawer-root')?.remove(); load(); }
      catch (e) { alert(humanizeError(e)); }
    }
  }
}

export default renderTemplates;
