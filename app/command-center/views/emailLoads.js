// emailLoads.js — Email Load Ingestion review queue: broker blast emails parsed by AI
// land here as drafts. Staff verify the broker (FMCSA + terms e-sign) and approve —
// approval auto-publishes every complete load to the live board with standard terms.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { ccEmailLoads, ccEmailBrokerVerify } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';

export function renderEmailLoads(host) {
  showLoading(host, 'Email loads');
  load();
  async function load() {
    let rows;
    try { rows = await ccEmailLoads(null); } catch (e) { showError(host, humanizeError(e), load); return; }
    if (rows && rows.error) { showError(host, rows.error, load); return; }
    rows = rows || [];
    const pill = (t, tone) => el('span', { class: 'cc-pill cc-pill-' + tone }, t);
    const tone = (s) => s === 'published' ? 'green' : s === 'ready' ? 'blue' : s === 'needs_info' ? 'amber' : s === 'rejected' ? 'red' : 'gray';
    mount(host, el('div', null, [
      el('div', { class: 'cc-page-head' }, [
        el('div', null, [el('h2', null, '📧 Email loads'), el('p', { class: 'cc-sub' }, rows.length + ' parsed from broker emails — approve a broker once and every complete load auto-publishes with LoadBoot standard terms.')]),
        el('button', { class: 'lb-btn lb-btn-ghost', onclick: load }, '↻ Refresh'),
      ]),
      rows.length === 0 ? el('div', { class: 'lb-state' }, 'No email loads yet. When a broker emails loads@ they appear here automatically.') :
      el('table', { class: 'cc-table' }, [
        el('thead', null, el('tr', null, ['When', 'Broker', 'Load', 'Rate', 'Status', 'Missing', 'Actions'].map((h) => el('th', null, h)))),
        el('tbody', null, rows.map((r) => el('tr', null, [
          el('td', null, new Date(r.created_at).toLocaleString()),
          el('td', null, [
            el('b', null, r.company || r.from_email),
            el('div', { class: 'cc-sub' }, 'MC ' + (r.mc || '—') + ' · ' + (r.broker_status || '') + (r.terms ? ' · terms ✓' : ' · terms ✗')),
          ]),
          el('td', null, (r.parsed.origin || '?') + ' → ' + (r.parsed.destination || '?') + ' · ' + (r.parsed.equipment || '?')),
          el('td', null, r.parsed.rate || '—'),
          el('td', null, pill(r.status, tone(r.status))),
          el('td', null, (r.missing || []).join(', ') || '—'),
          el('td', null, [
            r.broker_status !== 'verified' ? el('button', { class: 'lb-btn lb-btn-sm', onclick: async () => {
              try { const x = await ccEmailBrokerVerify(r.broker_id, true); toast('Broker verified — ' + (x.published || 0) + ' load(s) published'); load(); }
              catch (e) { toast(humanizeError(e)); }
            } }, '✓ Verify broker') : null,
            el('button', { class: 'lb-btn lb-btn-ghost lb-btn-sm', onclick: () => {
              const url = location.origin + '/broker-claim.html?t=' + r.claim_token;
              navigator.clipboard && navigator.clipboard.writeText(url);
              toast('Claim link copied — send it to the broker');
            } }, '🔗 Claim link'),
            r.broker_status !== 'blocked' ? el('button', { class: 'lb-btn lb-btn-ghost lb-btn-sm', onclick: async () => {
              if (!confirm('Block this broker? Their loads will never publish.')) return;
              try { await ccEmailBrokerVerify(r.broker_id, false); toast('Blocked'); load(); }
              catch (e) { toast(humanizeError(e)); }
            } }, '✗ Block') : null,
          ]),
        ]))),
      ]),
    ]));
  }
}
