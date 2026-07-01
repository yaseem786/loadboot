// audiences.js — Audience / Segment Builder (Phase 3B). Build and save reusable
// audiences (carriers, leads, staff segments) with a live recipient estimate +
// sample. Resolution to actual recipients happens in the delivery layer (push/email).
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, fmtDateTime } from '../../shared/ui/components.js';
import { audienceEstimate, listAudiences, saveAudience, deleteAudience, consentSummary, AUDIENCE_TYPES } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const LABEL = Object.fromEntries(AUDIENCE_TYPES);

export function renderAudiences(host) {
  const manage = can('content.manage') || can('settings.manage');
  const consent = el('div', { class: 'cc-kpi-grid', style: 'margin-bottom:14px' });
  const builder = el('div', { class: 'lb-card' });
  const list = el('div', { class: 'cc-table-wrap', style: 'margin-top:16px' });
  mount(host, el('div', null, [
    sectionHead('Audiences', 'Build and save reusable segments for campaigns and broadcasts. Counts are live; sending excludes unsubscribed and suppressed contacts.'),
    consent, builder, list,
  ]));
  loadConsent();
  drawBuilder();
  loadList();

  async function loadConsent() {
    let s; try { s = await consentSummary(); } catch (_) { return; }
    if (!s) return;
    mount(consent, [
      statCard({ icon: 'users', label: 'Have preferences', value: String(s.total || 0), sub: 'carriers configured', accent: 'blue' }),
      statCard({ icon: 'check', label: 'Marketing opt-in', value: String(s.marketing_in || 0), sub: 'can receive marketing', accent: 'green' }),
      statCard({ icon: 'bell', label: 'Push opt-in', value: String(s.push_in || 0), sub: 'push allowed', accent: 'violet' }),
      statCard({ icon: 'shield', label: 'Unsubscribed', value: String(s.unsubscribed || 0), sub: 'suppressed from marketing', accent: (s.unsubscribed || 0) > 0 ? 'amber' : 'green' }),
    ]);
  }

  function drawBuilder() {
    const typeSel = el('select', { class: 'cc-input' }, AUDIENCE_TYPES.map(([v, l]) => el('option', { value: v }, l)));
    const nameIn = el('input', { class: 'cc-input', placeholder: 'Save as… e.g. Active carriers — TX' });
    const result = el('div', { class: 'cc-sub', style: 'margin-top:6px' });
    const estimate = el('button', { class: 'lb-btn lb-btn-sm', onClick: async (ev) => {
      ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Estimating…';
      try { const r = await audienceEstimate(typeSel.value); const sample = (r.sample || []).filter(Boolean); result.innerHTML = ''; result.append(el('b', null, String(r.count || 0) + ' recipients'), document.createTextNode(sample.length ? ' — e.g. ' + sample.slice(0, 4).join(', ') : '')); }
      catch (e) { result.textContent = humanizeError(e); }
      ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Estimate';
    } }, 'Estimate');
    const saveBtn = manage ? el('button', { class: 'lb-btn lb-btn-primary lb-btn-sm', onClick: async (ev) => {
      if (!nameIn.value.trim()) { alert('Give the audience a name.'); return; }
      ev.currentTarget.disabled = true; try { await saveAudience({ name: nameIn.value.trim(), type: typeSel.value }); toast('Audience saved', 'success'); nameIn.value = ''; loadList(); } catch (e) { toast(humanizeError(e), 'error'); }
      ev.currentTarget.disabled = false;
    } }, 'Save audience') : null;
    mount(builder, [
      el('div', { class: 'cc-cardhead', style: 'margin-bottom:10px' }, el('h3', { style: 'margin:0' }, 'Build an audience')),
      el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:12px' }, [
        el('label', { class: 'cc-field' }, [el('span', null, 'Segment'), typeSel]),
        el('label', { class: 'cc-field' }, [el('span', null, 'Name'), nameIn]),
      ]),
      el('div', { style: 'display:flex;gap:8px;align-items:center;margin-top:8px' }, [estimate, saveBtn].filter(Boolean)),
      result,
    ]);
  }

  async function loadList() {
    showLoading(list, 'Loading saved audiences…');
    let rows; try { rows = await listAudiences(); } catch (e) { showError(list, humanizeError(e), loadList); return; }
    rows = rows || [];
    if (!rows.length) { mount(list, el('div', { class: 'lb-state' }, 'No saved audiences yet. Build one above.')); return; }
    mount(list, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Audience', 'Segment', 'Saved', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(a => el('tr', { class: 'cc-row' }, [
        el('td', null, el('b', null, a.name)),
        el('td', null, LABEL[a.type] || a.type),
        el('td', null, el('span', { class: 'cc-sub' }, a.created_at ? fmtDateTime(a.created_at) : '—')),
        el('td', null, manage ? el('button', { class: 'lb-btn lb-btn-sm', onClick: async (ev) => { ev.stopPropagation(); if (!confirm('Delete this audience?')) return; try { await deleteAudience(a.id); loadList(); } catch (e) { toast(humanizeError(e), 'error'); } } }, 'Delete') : ''),
      ]))),
    ]));
  }
}

export default renderAudiences;
