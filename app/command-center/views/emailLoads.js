// emailLoads.js — Email Load Ingestion review center (premium v2).
// Stats strip → status filter → detail table → click-through drawer with EVERY parsed field,
// broker dossier, terms record and the ORIGINAL raw email. Verify/Block/Claim-link inline.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { statCard, segmented, fmtDateTime, openDrawer } from '../../shared/ui/components.js';
import { ccEmailLoads, ccEmailBrokerVerify } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';

export function renderEmailLoads(host) {
  let filter = 'all';
  showLoading(host, 'Email loads');
  load();

  async function load() {
    let rows;
    try { rows = await ccEmailLoads(null); } catch (e) { showError(host, humanizeError(e), load); return; }
    if (rows && rows.error) { showError(host, rows.error, load); return; }
    rows = rows || [];
    const by = (s) => rows.filter((r) => r.status === s).length;
    const shown = filter === 'all' ? rows : rows.filter((r) => r.status === filter);

    const pill = (t, tone) => el('span', { class: 'cc-pill cc-pill-' + tone }, t);
    const tone = (s) => s === 'published' ? 'green' : s === 'ready' ? 'blue' : s === 'needs_info' ? 'amber' : s === 'rejected' ? 'red' : 'gray';
    const label = (s) => s === 'needs_info' ? 'Needs info' : s.charAt(0).toUpperCase() + s.slice(1);

    const verify = async (r) => {
      try { const x = await ccEmailBrokerVerify(r.broker_id, true); toast('Broker verified — ' + (x.published || 0) + ' load(s) published'); load(); }
      catch (e) { toast(humanizeError(e)); }
    };
    const block = async (r) => {
      if (!confirm('Block ' + (r.company || r.domain) + '? Their loads will never publish.')) return;
      try { await ccEmailBrokerVerify(r.broker_id, false); toast('Blocked'); load(); } catch (e) { toast(humanizeError(e)); }
    };
    const claimLink = (r) => {
      const url = location.origin + '/broker-claim.html?t=' + r.claim_token;
      if (navigator.clipboard) navigator.clipboard.writeText(url);
      toast('Claim link copied — send it to the broker');
    };

    const kv = (k, v, strong) => el('div', { style: 'display:flex;justify-content:space-between;gap:14px;padding:7px 0;border-bottom:1px solid #eef2f7;font-size:13.5px' }, [
      el('span', { style: 'color:#64748b' }, k), el(strong ? 'b' : 'span', { style: 'text-align:right' }, v == null || v === '' ? '—' : String(v)),
    ]);

    const openRow = (r) => {
      const p = r.parsed || {};
      const body = el('div', null, [
        el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px' }, [
          pill(label(r.status), tone(r.status)),
          pill(r.broker_status === 'verified' ? '✓ Broker verified' : r.broker_status === 'blocked' ? '✗ Blocked' : '⏳ Broker pending', r.broker_status === 'verified' ? 'green' : r.broker_status === 'blocked' ? 'red' : 'amber'),
          pill(r.terms ? '✓ Terms e-signed' : 'Terms not signed', r.terms ? 'green' : 'amber'),
        ]),
        el('h4', { style: 'margin:6px 0' }, '📦 Load — every field the broker gave'),
        kv('Origin', p.origin, true), kv('Destination', p.destination, true), kv('Equipment', p.equipment),
        kv('Rate', p.rate, true), kv('Pickup date', p.pickup_date), kv('Delivery date', p.delivery_date),
        kv('Weight', p.weight), kv('Commodity', p.commodity), kv('Miles', p.miles), kv('Notes', p.notes),
        (r.missing || []).length ? el('div', { style: 'background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 12px;color:#713f12;font-size:13px;margin:10px 0' },
          '⚠️ Missing before it can publish: ' + r.missing.join(', ') + ' — the broker got an automatic reply asking for exactly this.') : null,
        el('h4', { style: 'margin:16px 0 6px' }, '🏢 Broker dossier'),
        kv('Company', r.company, true), kv('MC number', r.mc), kv('Phone', r.phone), kv('Email', r.from_email),
        kv('Domain', r.domain), kv('Contact (claimed)', r.contact_name), kv('Contact email', r.contact_email),
        kv('Terms signed', r.terms_at ? fmtDateTime(r.terms_at) + ' — "' + (r.terms_signature || '') + '"' : 'not yet'),
        el('h4', { style: 'margin:16px 0 6px' }, '✉️ Original email (exactly as received)'),
        el('div', { class: 'cc-sub', style: 'margin-bottom:4px' }, 'Subject: ' + (r.subject || '—') + ' · ' + fmtDateTime(r.created_at)),
        el('pre', { style: 'white-space:pre-wrap;background:#f8fafc;border:1px solid #e6edf5;border-radius:10px;padding:12px;font-size:12.5px;line-height:1.6;max-height:260px;overflow:auto' }, r.raw_body || '—'),
        el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:14px' }, [
          r.broker_status !== 'verified' ? el('button', { class: 'lb-btn', onclick: () => verify(r) }, '✓ Verify broker & publish') : null,
          el('button', { class: 'lb-btn lb-btn-ghost', onclick: () => claimLink(r) }, '🔗 Copy claim link'),
          r.broker_status !== 'blocked' ? el('button', { class: 'lb-btn lb-btn-ghost', onclick: () => block(r) }, '✗ Block broker') : null,
        ]),
      ]);
      openDrawer((p.origin || '?') + ' → ' + (p.destination || '?'), body, { subtitle: (r.company || r.domain) + ' · via loads@' });
    };

    mount(host, el('div', null, [
      el('div', { class: 'cc-page-head' }, [
        el('div', null, [el('h2', null, '📧 Email loads'), el('p', { class: 'cc-sub' }, 'Broker blast emails, parsed by AI. Verify a broker once — every complete load publishes automatically with LoadBoot standard terms. Click any row for full detail + the original email.')]),
        el('button', { class: 'lb-btn lb-btn-ghost', onclick: load }, '↻ Refresh'),
      ]),
      el('div', { class: 'cc-stats', style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:10px 0 14px' }, [
        statCard({ label: 'Total parsed', value: String(rows.length) }), statCard({ label: 'Published', value: String(by('published')), accent: 'green' }),
        statCard({ label: 'Ready', value: String(by('ready')) }), statCard({ label: 'Needs info', value: String(by('needs_info')), accent: 'amber' }), statCard({ label: 'New (draft)', value: String(by('draft')) }),
      ]),
      segmented([
        { value: 'all', label: 'All' }, { value: 'draft', label: 'New' }, { value: 'needs_info', label: 'Needs info' },
        { value: 'ready', label: 'Ready' }, { value: 'published', label: 'Published' },
      ], filter, (v) => { filter = v; load(); }),
      shown.length === 0 ? el('div', { class: 'lb-state', style: 'margin-top:12px' }, 'Nothing here. When a broker emails loads@ their loads appear automatically.') :
      el('table', { class: 'cc-table', style: 'margin-top:12px' }, [
        el('thead', null, el('tr', null, ['When', 'Broker', 'Load', 'Rate', 'Status', 'Missing', ''].map((h) => el('th', null, h)))),
        el('tbody', null, shown.map((r) => el('tr', { class: 'cc-row-click', onclick: () => openRow(r) }, [
          el('td', null, fmtDateTime(r.created_at)),
          el('td', null, [el('b', null, r.company || r.from_email), el('div', { class: 'cc-sub' }, 'MC ' + (r.mc || '—') + ' · ' + r.broker_status + (r.terms ? ' · terms ✓' : ''))]),
          el('td', null, (r.parsed.origin || '?') + ' → ' + (r.parsed.destination || '?') + ' · ' + (r.parsed.equipment || '?')),
          el('td', null, r.parsed.rate || '—'),
          el('td', null, pill(label(r.status), tone(r.status))),
          el('td', null, (r.missing || []).join(', ') || '—'),
          el('td', null, el('span', { class: 'cc-sub' }, 'Open →')),
        ]))),
      ]),
    ]));
  }
}
