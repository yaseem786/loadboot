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
import { sectionHead, statCard, statusPill, toolbar, openDrawer, money, fmtDate, fmtDateTime, askReason, askConfirm } from '../../shared/ui/components.js';
import { feeInvoiceQueue, feeInvoiceApprove, feeInvoiceReject } from '../../shared/api.js';
import { can } from '../../shared/permissions.js';
import { humanizeError, toast } from '../../shared/errors.js';

const daysOld = (iso) => {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
};

export function renderFeeApprovals(host) {
  const kpiHost = el('div');
  const bodyHost = el('div', { class: 'cc-table-wrap' });
  let rows = [];

  function header() {
    return el('div', null, [
      sectionHead({
        title: 'Fee approvals',
        sub: 'Auto-generated 5% dispatch-fee invoices waiting for your review. Nothing is sent to the carrier until you approve it here.',
      }),
      kpiHost,
      toolbar([
        el('button', {
          class: 'cc-btn cc-btn-ghost',
          onClick: () => load(),
        }, 'Refresh'),
        can('finance.manage') ? el('button', {
          class: 'cc-btn cc-btn-primary',
          onClick: () => approveAll(),
        }, 'Approve all') : null,
      ].filter(Boolean)),
    ]);
  }

  function paintKpis() {
    const total = rows.reduce((s, r) => s + Number(r.fee || 0), 0);
    const stale = rows.filter(r => daysOld(r.delivered_at || r.created_at) >= 3).length;
    mount(kpiHost, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'list', label: 'Awaiting approval', value: String(rows.length), sub: 'drafted on delivery', accent: rows.length ? 'amber' : 'green' }),
      statCard({ icon: 'doc', label: 'Fee value held', value: money(total), sub: 'not yet invoiced', accent: 'blue' }),
      statCard({ icon: 'shield', label: 'Waiting 3+ days', value: String(stale), sub: stale ? 'carrier has not been billed' : 'all fresh', accent: stale ? 'red' : 'green' }),
    ]));
  }

  async function load() {
    mount(bodyHost, showLoading('Loading approval queue…'));
    let res;
    try { res = await feeInvoiceQueue(); }
    catch (e) { mount(bodyHost, showError(humanizeError(e))); return; }
    rows = (res && res.pending) || [];
    paintKpis();
    if (!rows.length) {
      mount(bodyHost, showEmpty('Nothing waiting. Every delivered load has been billed.'));
      return;
    }
    mount(bodyHost, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, [
        el('th', null, 'Invoice'), el('th', null, 'Carrier'), el('th', null, 'Lane'),
        el('th', null, 'Delivered'), el('th', null, 'Gross'), el('th', null, 'Fee (5%)'),
        el('th', null, 'Waiting'), el('th', null, ''),
      ])),
      el('tbody', null, rows.map(r => {
        const age = daysOld(r.delivered_at || r.created_at);
        return el('tr', { class: 'cc-row', onClick: () => openOne(r) }, [
          el('td', null, el('b', null, r.invoice_no || '—')),
          el('td', null, r.carrier || '—'),
          el('td', null, r.lane || '—'),
          el('td', null, fmtDate(r.delivered_at)),
          el('td', null, money(r.gross || 0)),
          el('td', null, el('b', null, money(r.fee || 0))),
          el('td', null, statusPill(age + 'd', age >= 3 ? 'red' : age >= 1 ? 'amber' : 'gray')),
          el('td', null, el('span', { class: 'cc-row-go' }, '›')),
        ]);
      })),
    ]));
  }

  function openOne(r) {
    const manage = can('finance.manage');
    const body = el('div', { class: 'cc-drawer-body' }, [
      el('div', { class: 'cc-kv' }, [
        kv('Carrier', r.carrier || '—'),
        kv('Lane', r.lane || '—'),
        kv('Delivered', fmtDateTime(r.delivered_at)),
        kv('Load gross', money(r.gross || 0)),
        kv('Fee rate', (r.fee_pct || 5) + '%'),
        kv('Fee due', money(r.fee || 0)),
        kv('Terms', 'Net 30 from approval'),
      ]),
      el('p', { class: 'cc-sub' }, 'Approving sends the carrier their invoice email and starts the Net-30 clock today. Check the gross against the rate confirmation before approving — the 5% is calculated from it.'),
      manage ? el('div', { class: 'cc-drawer-actions' }, [
        el('button', { class: 'cc-btn cc-btn-primary', onClick: () => doApprove(r, drawer) }, 'Approve & send'),
        el('button', { class: 'cc-btn cc-btn-danger', onClick: () => doReject(r, drawer) }, 'Reject (void)'),
      ]) : el('div', { class: 'cc-sub' }, 'You have read-only access to finance. finance.manage is required to approve.'),
    ]);
    const drawer = openDrawer('Invoice ' + (r.invoice_no || ''), body, { subtitle: money(r.fee || 0) + ' dispatch fee' });
  }

  function kv(k, v) {
    return el('div', { class: 'cc-kv-row' }, [el('span', { class: 'cc-kv-k' }, k), el('span', { class: 'cc-kv-v' }, v)]);
  }

  async function doApprove(r, drawer) {
    const ok = await askConfirm({
      title: 'Send invoice ' + r.invoice_no + '?',
      body: 'The carrier ' + (r.carrier || '') + ' will be emailed a ' + money(r.fee || 0) + ' invoice, due in 30 days.',
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
    const reason = await askReason({
      title: 'Void invoice ' + r.invoice_no,
      placeholder: 'Why is this invoice wrong? (wrong rate, load cancelled, duplicate…)',
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
    const ok = await askConfirm({
      title: 'Send ' + rows.length + ' invoices?',
      body: money(total) + ' in dispatch fees across ' + rows.length + ' carriers. Each carrier is emailed their own invoice, due in 30 days.',
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
