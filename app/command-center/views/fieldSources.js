// fieldSources.js — bl_disp_0459: who set each carrier field (Carrier 360 + dispatcher 360 → Carriers tab).
// Reads public.cc_carrier_field_sources(p_org). Carrier-entered values are the default and are not listed one by one;
// every value added by a dispatcher or by staff is listed with name + date, plus how many core fields are still open.
import { ccCarrierFieldSources, ccFieldSuggestions, ccFieldSuggestionDecide } from '../../shared/api.js';   // bl_fill_0534 — suggestions on locked fields
import { el, mount } from '../../shared/ui/dom.js';

const day = (d) => { try { return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch (_) { return ''; } };
const PILL = 'display:inline-flex;align-items:center;gap:4px;font-size:.68rem;font-weight:800;padding:1px 8px;border-radius:99px;border:1px solid currentColor;white-space:nowrap';
const COL = { carrier: '#1d4ed8', dispatcher: '#15803d', staff: '#b45309', system: '#b45309' };
export const sourcePill = (role, who, at) => el('span', { style: PILL + ';color:' + (COL[role] || '#475569'), title: role === 'carrier' ? 'Entered by the carrier' : 'Added by ' + (who || role) + (at ? ' on ' + day(at) : '') },
  role === 'carrier' ? 'Carrier' : role === 'dispatcher' ? 'Dispatcher · ' + (who || '?') + (at ? ' · ' + day(at) : '') : 'LoadBoot' + (who ? ' · ' + who : ''));

// Returns an element that loads itself. `compact` = one line + expandable list (dispatcher 360 card).
export function fieldSourcesPanel(orgId, compact) {
  const host = el('div', { class: 'cc-sub', style: 'margin-top:8px;font-size:12.3px;line-height:1.55' }, 'Loading field provenance…');
  (async () => {
    try {
      const r = await ccCarrierFieldSources(orgId);
      if (!r || r.error) throw new Error((r && r.error) || 'no data');
      const rows = r.rows || []; const by = r.by_role || {};
      const added = rows.filter((x) => x.role !== 'carrier');
      const head = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center' }, [
        el('b', { style: 'color:#0f172a' }, 'Profile provenance'),
        el('span', { style: PILL + ';color:#1d4ed8' }, (by.carrier || 0) + ' by carrier'),
        el('span', { style: PILL + ';color:#15803d' }, (by.dispatcher || 0) + ' by dispatcher'),
        (by.staff || by.system) ? el('span', { style: PILL + ';color:#b45309' }, ((by.staff || 0) + (by.system || 0)) + ' by LoadBoot') : null,
        el('span', { style: PILL + ';color:' + (r.open_core ? '#b45309' : '#15803d') }, r.open_core ? r.open_core + ' core fields still open' : 'core profile complete'),
      ]);
      const list = added.length ? el('div', { style: 'margin-top:6px;display:grid;gap:3px' }, added.map((x) => el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:baseline;padding:4px 0;border-top:1px solid #eef2f7' }, [
        el('span', { style: 'font-weight:700;color:#0f172a' }, x.label + (x.unit_no ? ' · unit ' + x.unit_no : '')),
        el('span', { style: 'color:#334155' }, x.value == null ? '—' : String(x.value)),
        sourcePill(x.role, x.by_name, x.at),
      ]))) : el('div', { style: 'margin-top:4px' }, 'No dispatcher- or staff-added values yet — everything on file came from the carrier.');
      mount(host, compact && added.length > 3 ? [head, el('details', null, [el('summary', { style: 'cursor:pointer;margin-top:4px' }, added.length + ' values added by a dispatcher / LoadBoot'), list])] : [head, list]);
      // bl_fill_0534 — suggested changes to locked fields (dispatcher by hand, or extracted from a call). Staff may decide them here;
      // accept writes through the normal path and is stamped 'staff · accepted suggestion #id'.
      try {
        const sr = await ccFieldSuggestions(orgId); const srows = (sr && sr.rows) || [];
        if (srows.length) {
          const box = el('div', { style: 'margin-top:8px' }); host.appendChild(box);
          const paintS = () => {
            const pend = srows.filter((x) => x.status === 'pending').length;
            mount(box, [el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, [el('b', { style: 'color:#0f172a' }, 'Field suggestions'), el('span', { style: PILL + ';color:' + (pend ? '#6d28d9' : '#64748b') }, pend ? pend + ' waiting on the carrier' : 'none pending')]),
              el('div', { style: 'margin-top:4px;display:grid;gap:3px' }, srows.map((x) => {
                const decide = async (ok, b) => { b.disabled = true; try { const r2 = await ccFieldSuggestionDecide(x.id, ok, null); if (!r2 || r2.error) throw new Error((r2 && (r2.message || r2.error)) || 'failed'); Object.assign(x, r2.suggestion || { status: ok ? 'accepted' : 'rejected' }); paintS(); } catch (e) { b.disabled = false; alert(e.message || e); } };
                const btn = (t, ok) => el('button', { class: 'cc-btn-sm' + (ok ? ' cc-btn-green' : ''), style: 'padding:2px 8px;font-size:11.5px' + (ok ? '' : ';background:transparent;border:1px solid #cbd5e1;color:#475569'), onClick: (ev) => decide(ok, ev.currentTarget) }, t);
                return el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:4px 0;border-top:1px solid #eef2f7' }, [
                  el('span', { style: 'font-weight:700;color:#0f172a' }, (x.label || x.field) + (x.unit_no ? ' · unit ' + x.unit_no : '')),
                  el('span', { style: 'color:#334155' }, x.old_text + ' → ' + x.new_text),
                  el('span', { style: 'color:#64748b;font-size:11.5px' }, (x.source === 'call_ai' ? 'from a call · ' : '') + (x.suggested_by_name || '?') + ' · ' + day(x.created_at) + (x.reason ? ' · “' + x.reason + '”' : '')),
                  x.status === 'pending' ? el('span', { style: 'display:inline-flex;gap:4px' }, [btn('Accept', true), btn('Reject', false)])
                    : el('span', { style: PILL + ';color:' + (x.status === 'accepted' ? '#15803d' : '#64748b') }, x.status + (x.decided_by_name ? ' · ' + x.decided_by_name : '')),
                ]); }))]);
          };
          paintS();
        }
      } catch (_) {}
    } catch (e) {
      mount(host, 'Field provenance unavailable: ' + (e.message || e));
    }
  })();
  return host;
}
