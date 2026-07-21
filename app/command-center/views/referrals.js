// referrals.js — Referral Program overview (WEB-2 part 2). Staff read of the multi-level referral engine
// (cwi_referral_engine): who is referring, how much has accrued/is payable/has been paid, and a top-referrer
// leaderboard. HONESTY: commissions are paid out of LoadBoot's own 5% fee (never an extra charge to a carrier),
// held before becoming payable, and a human records the payout decision here — the money itself always moves
// through the normal payment rail, never automatically from this screen.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, openDrawer } from '../../shared/ui/components.js';
import { referralOverview, referralAccrue, referralMarkPaid, referralPayoutQueue, referralPayoutDecide } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const KIND_LABEL = { carrier: 'Carrier', partner: 'Partner', affiliate: 'Affiliate' };
const money = (n) => '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function renderReferrals(host) {
  const canAccrue = can('finance.manage');
  const canPay = can('finance.approve');
  const kpis = el('div', { class: 'cc-kpi-grid' });
  const payoutCard = el('div', { class: 'lb-card', style: 'margin:10px 0' });
  const body = el('div', { class: 'cc-table-wrap' });

  const accrueBtn = canAccrue ? el('button', { class: 'lb-btn lb-btn-sm', onClick: async (ev) => {
    const _btn9 = ev.currentTarget;
    _btn9.disabled = true;
    try {
      const r = await referralAccrue();
      const added = (r && r.new_commissions) ?? 0;
      const promoted = (r && r.promoted_payable) ?? 0;
      toast('Accrual run complete — ' + added + ' new commission row(s), ' + promoted + ' promoted to payable', 'success');
      load();
    } catch (e) { toast(humanizeError(e), 'error'); }
    if (_btn9) _btn9.disabled = false;
  } }, 'Run accrual') : null;

  mount(host, el('div', null, [
    sectionHead('Referral Program',
      'Multi-level referral commissions are paid entirely out of LoadBoot’s own 5% dispatch fee — the carrier never pays more. Rewards are held before becoming payable; marking paid here records the decision only. Move the money through your normal payment rail.',
      accrueBtn),
    kpis,
    el('div', { class: 'lb-card', style: 'background:#fffbeb;margin:10px 0;font-size:.85rem' },
      el('div', { class: 'cc-sub' }, 'This program is feature-flagged (referral_program) and OFF in production until owner + legal sign-off. Percentages and payout terms are confirmed in writing before anything is owed.')),
    payoutCard,
    body,
  ]));
  load();
  loadPayouts();

  async function loadPayouts() {
    mount(payoutCard, el('div', null, [el('h3', { style: 'margin:0 0 8px' }, 'Payout requests'), el('div', { class: 'cc-sub' }, 'Loading…')]));
    let rows; try { rows = await referralPayoutQueue('open'); } catch (e) { mount(payoutCard, el('div', null, [el('h3', { style: 'margin:0 0 8px' }, 'Payout requests'), el('div', { class: 'cc-sub' }, humanizeError(e))])); return; }
    rows = Array.isArray(rows) ? rows : [];
    const head = el('h3', { style: 'margin:0 0 8px' }, 'Payout requests (' + rows.length + ' open)');
    if (!rows.length) { mount(payoutCard, el('div', null, [head, el('div', { class: 'cc-sub' }, 'No open payout requests. Referrers request payouts from their portal with their bank details; approve then mark paid here — the decision is recorded only, money moves through the normal rail.')])); return; }
    const items = rows.map((p) => {
      const d = p.payout_details || {};
      const act = (label, action, cls) => el('button', { class: 'lb-btn lb-btn-sm ' + (cls || ''), style: 'margin-left:6px', onClick: async (ev) => {
        const _btn9 = ev.currentTarget;
        if (action === 'paid' && !confirm('Record this payout as PAID? This marks the referrer\'s payable commissions paid. Money must be transferred through the normal payment rail — nothing is sent from here.')) return;
        _btn9.disabled = true;
        try { await referralPayoutDecide(p.id, action, null); toast('Payout ' + action + ' recorded', 'success'); loadPayouts(); load(); }
        catch (e) { toast(humanizeError(e), 'error'); _btn9.disabled = false; }
      } }, label);
      const actions = !canPay ? el('span', { class: 'cc-sub' }, 'finance.approve required')
        : p.status === 'requested' ? el('span', null, [act('Approve', 'approve'), act('Reject', 'reject', 'lb-btn-ghost')])
        : el('span', null, [act('Mark paid', 'paid'), act('Reject', 'reject', 'lb-btn-ghost')]);
      return el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--lb-border,#e2e8f0);flex-wrap:wrap' }, [
        el('div', null, [
          el('div', { style: 'font-weight:700' }, money(p.amount) + ' — ' + (p.referrer_name || p.referrer_code) + ' (' + (KIND_LABEL[p.referrer_kind] || p.referrer_kind) + ' · ' + p.referrer_code + ')'),
          el('div', { class: 'cc-sub' }, (d.bank_name || '') + ' · ' + (d.account_title || '') + ' · ' + (d.account_number || '') + ' · requested ' + new Date(p.requested_at).toLocaleString() + ' · status: ' + p.status + ' · payable now: ' + money(p.payable_now)),
        ]),
        actions,
      ]);
    });
    mount(payoutCard, el('div', null, [head].concat(items)));
  }

  async function load() {
    showLoading(body, 'Loading referral overview…');
    let o; try { o = await referralOverview(); } catch (e) { showError(body, humanizeError(e), load); return; }
    o = o || {};
    mount(kpis, [
      statCard({ icon: 'users', label: 'Referrers', value: String(o.referrers || 0), sub: 'active codes', accent: 'blue' }),
      statCard({ icon: 'truck', label: 'Referred orgs', value: String(o.referred_orgs || 0), sub: 'each credited once', accent: 'blue' }),
      statCard({ icon: 'clock', label: 'Accrued (on hold)', value: money(o.accrued), sub: 'not payable yet', accent: 'amber' }),
      statCard({ icon: 'dollar', label: 'Payable', value: money(o.payable), sub: 'cleared hold — ready', accent: 'green' }),
      statCard({ icon: 'check', label: 'Paid', value: money(o.paid), sub: 'recorded payouts', accent: 'gray' }),
    ]);

    const rows = Array.isArray(o.top_referrers) ? o.top_referrers : [];
    if (!rows.length) {
      mount(body, el('div', { class: 'lb-state' }, 'No referrers yet. Codes appear here once carriers or partners join the program.'));
      return;
    }
    mount(body, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Code', 'Type', 'Referrals', 'Earned (payable + paid)', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(r => el('tr', { class: 'cc-row' }, [
        el('td', null, el('b', null, r.code || '—')),
        el('td', null, el('span', { class: 'cc-pill cc-pill-gray' }, KIND_LABEL[r.kind] || r.kind || '—')),
        el('td', null, String(r.referrals || 0)),
        el('td', null, el('b', null, money(r.earned))),
        el('td', null, canPay ? el('button', { class: 'lb-btn lb-btn-sm', onClick: (e) => { e.stopPropagation(); payUI(r); } }, 'Mark payable paid') : null),
      ]))),
    ]));
  }

  function payUI(r) {
    const form = el('div', null, [
      el('div', { class: 'lb-card', style: 'background:#fffbeb;margin-bottom:10px' },
        el('div', { class: 'cc-sub' }, 'This records that PAYABLE commissions for ' + (r.code || 'this referrer') + ' have been paid. Only rows past their hold window are affected — accrued (still-on-hold) rows are never touched. This does not move money; complete the transfer through your normal payment rail.')),
      el('div', { class: 'cc-drawer-actions', style: 'margin-top:10px' }, el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev) => {
        const _btn9 = ev.currentTarget;
        _btn9.disabled = true;
        try {
          const res = await referralMarkPaid(r.code);
          toast('Recorded: ' + (res.rows_paid || 0) + ' commission(s) marked paid (' + money(res.amount) + ')', 'success');
          document.getElementById('cc-drawer-root')?.remove();
          load();
        } catch (e) { toast(humanizeError(e), 'error'); if (_btn9) _btn9.disabled = false; }
      } }, 'Confirm — mark payable paid')),
    ]);
    openDrawer('Mark paid — ' + (r.code || 'referrer'), form, { subtitle: (KIND_LABEL[r.kind] || r.kind || '') + ' · ' + money(r.earned) + ' earned' });
  }
}

export default renderReferrals;
