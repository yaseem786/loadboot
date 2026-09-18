// feeApprovals.js — the owner's review desk for auto-generated dispatch-fee invoices.
//
// When the `fee_invoice_approval_queue` feature flag is ON, auto_invoice_on_delivery() stops
// issuing straight to the carrier and parks the invoice at status 'draft'. Nothing reaches the
// carrier until someone approves it here. Approving flips it to 'sent', re-dates it Net-30 from
// the approval day, and (when `stripe_fee_billing_enabled` is on) queues the Stripe invoice so
// the carrier's email carries a hosted ACH/card pay link.
//
// Server side: cc_fee_invoice_queue / cc_fee_invoice_approve / cc_fee_invoice_reject
// (migration bl_stripe_0346). All three are finance.view/finance.manage gated + audited.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import { sectionHead, statCard, toolbar, openDrawer, money, fmtDate, fmtDateTime, askReason, askConfirm } from '../../shared/ui/components.js';
import { feeInvoiceQueue, feeInvoiceApprove, feeInvoiceReject } from '../../shared/api.js';
import { can } from '../../shared/permissions.js';
import { humanizeError, toast } from '../../shared/errors.js';

const daysOld = (iso) => iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : 0;
const pill = (text, tone) => el('span', { class: 'cc-pill cc-pill-' + tone }, [el('i', { class: 'cc-pill-dot' }), text]);
const field = (k, v) => el('div', { class: 'cc-field' }, [el('span', null, k), el('b', null, v || '—')]);

export function renderFeeApprovals(host) {
  const kpiHost = el('div');
  const bodyHost = el('div', { class: 'cc-table-wrap' });
  let rows = [];

  function header() {
    const actions = [el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => load() }, 'Refresh')];
    if (can('finance.manage')) actions.push(el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => approveAll() }, 'Approve all'));
    return el('div', null, [
      sectionHead('Fee approvals', 'Auto-generated 5% dispatch-fee invoices waiting for your review. Nothing is sent to the carrier until you approve it here.'),
      kpiHost,
      toolbar(actions),
    ]);
  }

  function paintKpis() {
    const total = rows.reduce((s, r) => s + Number(r.fee || 0), 0);
    const stale = rows.filter(r => daysOld(r.delivered_at || r.created_at) >= 3).length;
    mount(kpiHost, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'list', label: 'Awaiting approval', value: String(rows.length), sub: 'drafted on delivery', accent: rows.length ? 'amber' : 'green' }),
      statCard({ icon: 'doc', label: 'Fee value held', value: money(total, 2), sub: 'not yet invoiced', accent: 'blue' }),
      statCard({ icon: 'shield', label: 'Waiting 3+ days', value: String(stale), sub: stale ? 'carrier not yet billed' : 'all fresh', accent: stale ? 'red' : 'green' }),
    ]));
  }

  async function load() {
    showLoading(bodyHost, 'Loading approval queue…');
    let res;
    try { res = await feeInvoiceQueue(); }
    catch (e) { showError(bodyHost, humanizeError(e), load); return; }
    rows = (res && res.pending) || [];
    paintKpis();
    if (!rows.length) { showEmpty(bodyHost, 'Nothing waiting. Every delivered load has been billed.'); return; }
    mount(bodyHost, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Invoice', 'Carrier', 'Lane', 'Delivered', 'Gross', 'Fee (5%)', 'Waiting', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(r => {
        const age = daysOld(r.delivered_at || r.created_at);
        return el('tr', { class: 'cc-row', onClick: () => openOne(r) }, [
          el('td', null, el('b', null, r.invoice_no || '—')),
          el('td', null, r.carrier || '—'),
          el('td', null, r.lane || '—'),
          el('td', null, r.delivered_at ? fmtDate(r.delivered_at) : '—'),
          el('td', null, money(r.gross || 0)),
          el('td', null, el('b', null, money(r.fee || 0, 2))),
          el('td', null, pill(age + 'd', age >= 3 ? 'red' : age >= 1 ? 'amber' : 'gray')),
          el('td', null, el('span', { class: 'cc-row-go' }, '›')),
        ]);
      })),
    ]));
  }

  function openOne(r) {
    const manage = can('finance.manage');
    const body = el('div', null, [
      el('div', { class: 'cc-grid-2' }, [
        field('Carrier', r.carrier), field('Lane', r.lane),
        field('Delivered', r.delivered_at ? fmtDateTime(r.delivered_at) : '—'), field('Load gross', money(r.gross || 0)),
        field('Fee rate', (r.fee_pct || 5) + '%'), field('Fee due', money(r.fee || 0, 2)),
        field('Terms', 'Net 30 from approval'),
      ]),
      el('p', { class: 'cc-sub', style: 'margin-top:12px' }, 'Approving emails the carrier their invoice and starts the Net-30 clock today. Check the gross against the rate confirmation first — the 5% is calculated from it.'),
      manage
        ? el('div', { class: 'cc-status-row', style: 'margin-top:12px;display:flex;gap:8px;flex-wrap:wrap' }, [
            el('button', { class: 'lb-btn lb-btn-primary', onClick: () => doApprove(r, drawer) }, 'Approve & send'),
            el('button', { class: 'lb-btn lb-btn-secondary', onClick: () => doReject(r, drawer) }, 'Reject (void)'),
          ])
        : el('div', { class: 'cc-sub', style: 'margin-top:12px' }, 'Read-only: finance.manage is required to approve.'),
    ]);
    const drawer = openDrawer('Invoice ' + (r.invoice_no || ''), body, { subtitle: money(r.fee || 0, 2) + ' dispatch fee' });
  }

  async function doApprove(r, drawer) {
    const ok = await askConfirm('Send invoice ' + r.invoice_no + '?', {
      body: (r.carrier || 'The carrier') + ' will be emailed a ' + money(r.fee || 0, 2) + ' invoice, due in 30 days.',
      confirmLabel: 'Approve & send',
    });
    if (!ok) return;
    try {
      await feeInvoiceApprove(r.id);
      toast('Invoice ' + r.invoice_no + ' sent', 'success');
      if (drawer) drawer.close();
      load();
    } catch (e) { toast(humanizeError(e), 'error'); }
  }

  async function doReject(r, drawer) {
    const reason = await askReason('Void invoice ' + r.invoice_no, {
      placeholder: 'Why is this invoice wrong? (wrong rate, load cancelled, duplicate…)',
      submitLabel: 'Void invoice',
    });
    if (!reason) return;
    try {
      await feeInvoiceReject(r.id, reason);
      toast('Invoice voided — the carrier was never billed', 'success');
      if (drawer) drawer.close();
      load();
    } catch (e) { toast(humanizeError(e), 'error'); }
  }

  async function approveAll() {
    if (!rows.length) return;
    const total = rows.reduce((s, r) => s + Number(r.fee || 0), 0);
    const ok = await askConfirm('Send ' + rows.length + ' invoices?', {
      body: money(total, 2) + ' in dispatch fees across ' + rows.length + ' invoices. Each carrier is emailed their own invoice, due in 30 days.',
      confirmLabel: 'Approve all',
    });
    if (!ok) return;
    let sent = 0; const failed = [];
    for (const r of rows.slice()) {
      try { await feeInvoiceApprove(r.id); sent++; }
      catch (e) { failed.push((r.invoice_no || r.id) + ': ' + humanizeError(e)); }
    }
    toast(sent + ' sent' + (failed.length ? ' · ' + failed.length + ' failed' : ''), failed.length ? 'error' : 'success');
    if (failed.length) console.warn('[feeApprovals] failed:', failed);
    load();
  }

  mount(host, el('div', { class: 'cc-view' }, [header(), bodyHost]));
  load();
}

export default renderFeeApprovals;
