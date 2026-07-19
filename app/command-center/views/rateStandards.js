// rateStandards.js — staff editor for marketplace rate standards (detention/layover/
// TONU/lumper/RPM benchmarks etc.). Reads cc_rate_standards, writes cc_set_rate_standard
// (dispatch.manage or settings.manage — server re-checks). Every change is audit-logged
// and versioned; these values drive load posting defaults and market benchmarks.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, card } from '../../shared/ui/components.js';
import { rateStandardsList, setRateStandard } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';

export function renderRateStandards(host) {
  const body = el('div');
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Rate standards', 'Marketplace-wide defaults and benchmarks (detention, layover, TONU, per-mile floors). Versioned + audit-logged; posting wizards and the board read these live.'),
    body,
  ]));
  load();
  async function load() {
    showLoading(body, 'Loading standards…');
    let rows; try { rows = await rateStandardsList(); } catch (e) { showError(body, humanizeError(e), load); return; }
    if (!rows || !rows.length) { mount(body, card(el('div', { class: 'cc-sub' }, 'No standards defined yet.'))); return; }
    mount(body, card(el('div', null, rows.map((r) => {
      const inp = el('input', { class: 'cc-input', style: 'max-width:160px;text-align:right', value: r.value == null ? '' : String(r.value) });
      const save = el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: async (ev) => {
        const b = ev.currentTarget; if (!String(inp.value).trim()) { toast('Value required', 'error'); return; }
        b.disabled = true; b.textContent = 'Saving…';
        try { await setRateStandard(r.key, String(inp.value).trim()); toast('Saved — v' + (Number(r.version || 0) + 1), 'success'); load(); }
        catch (e) { b.disabled = false; b.textContent = 'Save'; toast(humanizeError(e), 'error'); }
      } }, 'Save');
      return el('div', { style: 'display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #eef2f7;flex-wrap:wrap' }, [
        el('div', { style: 'min-width:200px' }, [
          el('b', { style: 'font-size:.9rem' }, r.label || r.key),
          el('div', { class: 'cc-sub' }, r.key + (r.unit ? ' · ' + r.unit : '') + ' · v' + (r.version || 1)),
        ]),
        el('div', { style: 'display:flex;gap:8px;align-items:center;flex:none' }, [inp, save]),
      ]);
    }))));
  }
}

export default renderRateStandards;
