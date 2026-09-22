// investors.js — Investor capital desk (bl_inv_0401).
//
// Every rupee an investor puts in is tracked like a VC capital call: commitment,
// requests, confirmed receipts, expenses tagged to a tranche AND a category,
// monthly profit statements, and payouts. The investor sees all of it live in
// their own portal (/app/investor/), so this screen is the only place the
// ledger is written. Two rules the UI enforces: a movement only counts once
// BOTH sides confirmed it, and a confirmed row is never edited — only reversed.
//
// Server: cc_inv_* (finance.manage to write, finance.view to read).
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import { sectionHead, statCard, toolbar, openDrawer, fmtDate, askReason, askConfirm } from '../../shared/ui/components.js';
import { ccInvList, ccInvDetail, ccInvSaveInvestor, ccInvLinkUser, ccInvSaveAgreement, ccInvRequest,
         ccInvConfirmReceipt, ccInvReverseReceipt, ccInvExpense, ccInvReverseExpense, ccInvPublishMonth, ccInvPay } from '../../shared/api.js';
import { can } from '../../shared/permissions.js';
import { humanizeError, toast } from '../../shared/errors.js';

const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const pkr = (n, cur) => (cur || 'PKR') + ' ' + nf.format(Number(n || 0));
const pct = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';
const pill = (text, tone) => el('span', { class: 'cc-pill cc-pill-' + (tone || 'gray') }, [el('i', { class: 'cc-pill-dot' }), text]);
const field = (k, v) => el('div', { class: 'cc-field' }, [el('span', null, k), el('b', null, v == null || v === '' ? '—' : v)]);
const CATS = ['office', 'rent', 'utilities', 'salary', 'equipment', 'tools', 'legal', 'relocation', 'marketing', 'misc'];
const today = () => new Date().toISOString().slice(0, 10);

// small form builder
function f(label, input, hint) {
  return el('label', { class: 'cc-form-row', style: 'display:block;margin-bottom:10px' }, [
    el('span', { style: 'display:block;font-size:.75rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;opacity:.7;margin-bottom:4px' }, label),
    input, hint ? el('small', { style: 'display:block;opacity:.65;margin-top:3px' }, hint) : null]);
}
const inp = (attrs) => el('input', Object.assign({ class: 'lb-input', style: 'width:100%' }, attrs));
const sel = (opts, value) => el('select', { class: 'lb-input', style: 'width:100%' }, opts.map(([v, l]) => el('option', { value: v, selected: v === value }, l)));
const ta = (attrs) => el('textarea', Object.assign({ class: 'lb-input', rows: 3, style: 'width:100%' }, attrs));
const num = (attrs) => inp(Object.assign({ type: 'number', inputmode: 'decimal', step: '0.01', min: '0' }, attrs));

async function submit(btn, fn, onOk) {
  btn.disabled = true;
  try { const r = await fn(); toast('Saved'); if (onOk) onOk(r); }
  catch (e) { toast(humanizeError(e), 'error'); btn.disabled = false; }
}

export function renderInvestors(host) {
  const kpiHost = el('div');
  const bodyHost = el('div', { class: 'cc-table-wrap' });
  let rows = [];
  const manage = can('finance.manage');

  function header() {
    const actions = [el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: load }, 'Refresh')];
    if (manage) {
      actions.push(el('button', { class: 'lb-btn lb-btn-sm', onClick: () => publishMonthForm(load) }, 'Publish month'));
      actions.push(el('button', { class: 'lb-btn lb-btn-sm', onClick: () => agreementForm(null, rows, load) }, '+ Agreement'));
      actions.push(el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => investorForm(null, load) }, '+ Investor'));
    }
    return el('div', null, [
      sectionHead('Investors', 'Capital in, where it went, and what each investor is owed — the same ledger they see live in their portal. Nothing counts until both sides confirm it.'),
      kpiHost, toolbar(actions),
    ]);
  }

  function paintKpis() {
    const agrs = rows.flatMap(r => r.agreements || []);
    const sum = (k) => agrs.reduce((s, a) => s + Number((a.position || {})[k] || 0), 0);
    const pending = rows.reduce((s, r) => s + Number(r.pending_receipts || 0), 0);
    const open = agrs.reduce((s, a) => s + ((a.position || {}).open_questions || []).length, 0);
    mount(kpiHost, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'users', label: 'Investors', value: String(rows.length), sub: agrs.length + ' agreement' + (agrs.length === 1 ? '' : 's'), accent: 'blue' }),
      statCard({ icon: 'doc', label: 'Funded / committed', value: pkr(sum('funded')), sub: 'of ' + pkr(sum('commitment_cap')), accent: 'green' }),
      statCard({ icon: 'list', label: 'Fund cash on hand', value: pkr(sum('fund_cash')), sub: pkr(sum('spent')) + ' spent', accent: sum('fund_cash') < 0 ? 'red' : 'blue' }),
      statCard({ icon: 'shield', label: 'Needs your confirm', value: String(pending), sub: open ? open + ' open agreement question' + (open === 1 ? '' : 's') : 'terms complete', accent: pending || open ? 'amber' : 'green' }),
    ]));
  }

  async function load() {
    showLoading(bodyHost, 'Loading investors…');
    let res;
    try { res = await ccInvList(); } catch (e) { showError(bodyHost, humanizeError(e), load); return; }
    rows = (res && res.investors) || [];
    paintKpis();
    if (!rows.length) { showEmpty(bodyHost, manage ? 'No investors yet. Add the first one with “+ Investor”, then create their agreement.' : 'No investors recorded.'); return; }
    mount(bodyHost, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Investor', 'Agreement', 'Funded', 'Fund cash', 'Recovery', 'Phase', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.flatMap(r => {
        const agrs = r.agreements || [];
        if (!agrs.length) return [el('tr', { class: 'cc-row', onClick: () => investorForm(r.investor, load) }, [
          el('td', null, el('b', null, r.investor.name)),
          el('td', { colspan: 5 }, el('span', { style: 'opacity:.7' }, 'No agreement yet' + (r.investor.linked ? '' : ' · login not linked'))),
          el('td', null, manage ? el('button', { class: 'lb-btn lb-btn-sm', onClick: (e) => { e.stopPropagation(); agreementForm(null, rows, load, r.investor.id); } }, '+ Agreement') : ''),
        ])];
        return agrs.map(a => {
          const p = a.position || {};
          const rec = p.phase === 'recovering';
          return el('tr', { class: 'cc-row', onClick: () => openDetail(a.id, load) }, [
            el('td', null, [el('b', null, r.investor.name), el('div', { style: 'font-size:.78rem;opacity:.65' }, (r.investor.relationship || '') + (r.investor.linked ? '' : ' · login not linked'))]),
            el('td', null, [a.title || 'Agreement', el('div', { style: 'font-size:.78rem;opacity:.65' }, pct(p.payback_rate_pct) + ' + ' + pct(p.permanent_share_pct) + (p.share_type ? ' · ' + p.share_type : ' · type TBD'))]),
            el('td', null, [el('b', null, pkr(p.funded, a.currency)), el('div', { style: 'font-size:.78rem;opacity:.65' }, 'of ' + pkr(p.commitment_cap, a.currency))]),
            el('td', null, el('b', { style: Number(p.fund_cash) < 0 ? 'color:#dc2626' : '' }, pkr(p.fund_cash, a.currency))),
            el('td', null, [pkr(p.recovered, a.currency) + ' / ' + pkr(p.recovery_target, a.currency), el('div', { style: 'font-size:.78rem;opacity:.65' }, pct(p.recovered_pct))]),
            el('td', null, [rec ? pill('Recovering', 'blue') : pill('Permanent share', 'green'), Number(r.pending_receipts) ? el('div', { style: 'margin-top:4px' }, pill(r.pending_receipts + ' to confirm', 'amber')) : null]),
            el('td', null, ((p.open_questions || []).length) ? pill((p.open_questions || []).length + ' open', 'amber') : ''),
          ]);
        });
      })),
    ]));
  }

  mount(host, [header(), bodyHost]);
  load();
}

// ─────────────────────────────────────────────────────────── forms
function investorForm(inv, onDone) {
  const name = inp({ value: inv ? inv.name : '', required: true, placeholder: 'Full name' });
  const email = inp({ type: 'email', value: inv ? (inv.email || '') : '', placeholder: 'Login email (used to link their portal)' });
  const phone = inp({ value: inv ? (inv.phone || '') : '', placeholder: '+92…' });
  const rel = inp({ value: inv ? (inv.relationship || '') : '', placeholder: 'friend / family / angel' });
  const notes = ta({ placeholder: 'Anything staff should know' });
  const linkEmail = inp({ type: 'email', placeholder: 'email they signed up with' });
  const btn = el('button', { class: 'lb-btn lb-btn-primary' }, inv ? 'Save' : 'Add investor');
  const d = openDrawer(inv ? inv.name : 'New investor', el('div', null, [
    f('Name', name), f('Email', email), f('Phone', phone), f('Relationship', rel), f('Notes', notes), btn,
    inv ? el('div', { style: 'margin-top:22px;padding-top:14px;border-top:1px solid rgba(128,128,128,.25)' }, [
      el('b', null, 'Portal login'), el('p', { style: 'font-size:.85rem;opacity:.75;margin:4px 0 10px' },
        inv.linked ? 'Linked — they can sign in at /app/investor/.' : 'Not linked yet. They must sign up (any LoadBoot signup page) with an email, then you link it here.'),
      f('Link login by email', linkEmail),
      el('button', { class: 'lb-btn', onClick: (e) => submit(e.target, () => ccInvLinkUser(inv.id, linkEmail.value), (r) => {
        if (r && r.ok === false) { toast(r.note || 'No account with that email yet', 'error'); e.target.disabled = false; return; }
        d.close(); onDone();
      }) }, 'Link'),
    ]) : null,
  ]), { subtitle: 'Investors see their own agreements only — never carriers, loads or other investors.' });
  btn.onclick = () => submit(btn, () => ccInvSaveInvestor({ id: inv ? inv.id : null, name: name.value, email: email.value, phone: phone.value, relationship: rel.value, notes: notes.value }), () => { d.close(); onDone(); });
}

function agreementForm(agr, rows, onDone, presetInvestor) {
  const a = agr || {};
  const invSel = agr ? null : sel(rows.map(r => [r.investor.id, r.investor.name]), presetInvestor);
  const title = inp({ value: a.title || '', placeholder: 'e.g. Seed — Sep 2026' });
  const cur = inp({ value: a.currency || 'PKR', maxlength: 3 });
  const cap = num({ value: a.commitment_cap || '', required: true, placeholder: '2000000' });
  const payRate = num({ value: a.payback_rate_pct ?? '', max: '100', placeholder: '15' });
  const shareRate = num({ value: a.permanent_share_pct ?? '', max: '100', placeholder: '5' });
  const basis = sel([['actual_funded', 'Whatever they actually paid in'], ['fixed', 'A fixed amount (e.g. 1.5×)']], a.payback_basis || 'actual_funded');
  const fixed = num({ value: a.payback_fixed_amount || '', placeholder: 'only if fixed' });
  const shareType = sel([['', '— not decided yet —'], ['profit_share', 'Profit share (no ownership)'], ['equity', 'Equity (ownership)']], a.share_type || '');
  const vest = sel([['pro_rata', 'Pro-rata with money received'], ['upfront', 'All at once']], a.equity_vesting_mode || 'pro_rata');
  const profitDef = ta({ value: a.profit_definition || '', placeholder: 'Revenue actually collected − rent − utilities − salaries & commission − tools − legal − bank charges …' });
  const exitT = ta({ value: a.exit_treatment || '', placeholder: 'What the investor gets if the company is sold' });
  const stopT = ta({ value: a.early_stop_terms || '', placeholder: 'If they stop funding partway: target = what was paid; the permanent share becomes …' });
  const buyout = ta({ value: a.buyout_terms || '', placeholder: 'Optional buy-back formula after recovery' });
  const signed = inp({ type: 'date', value: a.signed_date || '' });
  const doc = inp({ type: 'url', value: a.doc_url || '', placeholder: 'https://… signed PDF' });
  const status = sel([['draft', 'Draft'], ['active', 'Active'], ['recovered', 'Recovered'], ['closed', 'Closed']], a.status || 'active');
  const btn = el('button', { class: 'lb-btn lb-btn-primary' }, agr ? 'Save agreement' : 'Create agreement');
  const d = openDrawer(agr ? 'Edit agreement' : 'New agreement', el('div', null, [
    invSel ? f('Investor', invSel) : null, f('Title', title),
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px' }, [f('Currency', cur), f('Commitment cap', cap)]),
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px' }, [f('Payback % of profit', payRate, 'reduces the balance'), f('Permanent share %', shareRate, 'theirs forever')]),
    f('Recovery target', basis), f('Fixed target amount', fixed),
    f('What the permanent % IS', shareType, 'Leave undecided and the portal shows it as an open question rather than guessing.'),
    f('Equity vesting (equity only)', vest),
    f('Profit definition', profitDef), f('If the company is sold', exitT), f('If they stop funding partway', stopT), f('Buyout clause', buyout),
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px' }, [f('Signed on', signed), f('Status', status)]),
    f('Signed document link', doc), btn,
  ]), { subtitle: 'These words are what the investor reads in their portal. Write them as agreed, not as hoped.' });
  btn.onclick = () => submit(btn, () => ccInvSaveAgreement({
    id: a.id || null, investor_id: invSel ? invSel.value : a.investor_id, title: title.value, currency: cur.value.toUpperCase(),
    commitment_cap: cap.value, payback_rate_pct: payRate.value, permanent_share_pct: shareRate.value,
    payback_basis: basis.value, payback_fixed_amount: fixed.value, share_type: shareType.value,
    equity_vesting_mode: vest.value, profit_definition: profitDef.value, exit_treatment: exitT.value,
    early_stop_terms: stopT.value, buyout_terms: buyout.value, signed_date: signed.value, doc_url: doc.value, status: status.value,
  }), () => { d.close(); onDone(); });
}

function requestForm(agrId, unfunded, cur, onDone) {
  const amount = num({ required: true, placeholder: 'max ' + pkr(unfunded, cur) });
  const reason = inp({ required: true, placeholder: 'e.g. Office deposit + 2 computers' });
  const cat = sel(CATS.map(c => [c, c]), 'office');
  const by = inp({ type: 'date' });
  const btn = el('button', { class: 'lb-btn lb-btn-primary' }, 'Raise request');
  const d = openDrawer('Raise a capital request', el('div', null, [
    f('Amount', amount, 'Remaining commitment: ' + pkr(unfunded, cur)), f('What for', reason), f('Category', cat), f('Needed by', by), btn,
  ]), { subtitle: 'The investor sees this in their portal immediately and marks it paid from there.' });
  btn.onclick = () => submit(btn, () => ccInvRequest({ agreement_id: agrId, amount: amount.value, reason: reason.value, category: cat.value, needed_by: by.value }), () => { d.close(); onDone(); });
}

function receiptForm(agrId, requests, cur, onDone) {
  const req = sel([['', '— not tied to a request —']].concat(requests.filter(r => r.status !== 'funded' && r.status !== 'cancelled').map(r => [r.id, '#' + r.seq + ' · ' + pkr(r.amount, cur) + ' · ' + r.reason])), '');
  const amount = num({ required: true });
  const date = inp({ type: 'date', value: today() });
  const method = sel([['bank', 'Bank'], ['easypaisa', 'Easypaisa'], ['jazzcash', 'JazzCash'], ['cash', 'Cash'], ['other', 'Other']], 'bank');
  const ref = inp({ placeholder: 'Transaction ID' });
  const proof = inp({ type: 'url', placeholder: 'https://… screenshot' });
  const btn = el('button', { class: 'lb-btn lb-btn-primary' }, 'Record & confirm');
  const d = openDrawer('Record money received', el('div', null, [
    f('Against request', req), f('Amount', amount), f('Date received', date), f('Method', method), f('Reference', ref), f('Proof link', proof), btn,
  ]), { subtitle: 'Use this when the investor handed money over without declaring it in the portal. It is confirmed on your side immediately.' });
  btn.onclick = () => submit(btn, () => ccInvConfirmReceipt({ agreement_id: agrId, request_id: req.value, amount: amount.value, received_date: date.value, method: method.value, reference: ref.value, proof_url: proof.value }), () => { d.close(); onDone(); });
}

function expenseForm(agrId, receipts, cur, onDone) {
  const confirmed = receipts.filter(r => r.state === 'confirmed' && Number(r.amount) > 0);
  const tranche = sel([['', '— general —']].concat(confirmed.map(r => [r.id, fmtDate(r.received_date) + ' · ' + pkr(r.amount, cur)])), confirmed.length ? confirmed[0].id : '');
  const cat = sel(CATS.map(c => [c, c]), 'office');
  const amount = num({ required: true });
  const date = inp({ type: 'date', value: today() });
  const vendor = inp({ placeholder: 'Who was paid' });
  const desc = inp({ placeholder: 'What exactly' });
  const receipt = inp({ type: 'url', placeholder: 'https://… receipt photo' });
  const rec = el('input', { type: 'checkbox' });
  const btn = el('button', { class: 'lb-btn lb-btn-primary' }, 'Log expense');
  const d = openDrawer('Log an expense', el('div', null, [
    f('Paid from tranche', tranche, 'TAG 1 — which money paid for it'), f('Category', cat, 'TAG 2 — what it was'),
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px' }, [f('Amount', amount), f('Date', date)]),
    f('Vendor', vendor), f('Description', desc), f('Receipt photo link', receipt, 'The investor can open this.'),
    el('label', { style: 'display:flex;gap:8px;align-items:center;margin:6px 0 12px' }, [rec, 'Recurring monthly (rent, subscription)']), btn,
  ]), { subtitle: 'Shows in the investor portal the moment you save. Log it within 48 hours of paying.' });
  btn.onclick = () => submit(btn, () => ccInvExpense({ agreement_id: agrId, receipt_id: tranche.value, category: cat.value, amount: amount.value, expense_date: date.value, vendor: vendor.value, description: desc.value, receipt_url: receipt.value, is_recurring: rec.checked }), () => { d.close(); onDone(); });
}

function publishMonthForm(onDone) {
  const m = inp({ type: 'month', value: new Date().toISOString().slice(0, 7) });
  const rev = num({ required: true, placeholder: 'Fees actually COLLECTED this month' });
  const exp = num({ required: true, placeholder: 'All operating expenses' });
  const note = ta({ placeholder: 'Optional note the investors will see' });
  const btn = el('button', { class: 'lb-btn lb-btn-primary' }, 'Publish');
  const d = openDrawer('Publish a monthly profit statement', el('div', null, [
    f('Month', m), f('Revenue collected', rev), f('Expenses', exp), f('Note', note), btn,
    el('p', { style: 'font-size:.85rem;opacity:.75;margin-top:10px' }, 'Profit = revenue − expenses. Every active agreement’s payback % and share % are computed from it and staged as a pending payout. Re-publishing the same month recalculates unpaid payouts only.'),
  ]));
  btn.onclick = () => submit(btn, () => ccInvPublishMonth({ month: m.value + '-01', revenue: rev.value, expenses_total: exp.value, note: note.value }), (r) => { toast('Published — ' + (r.payouts_staged || 0) + ' payout(s) staged'); d.close(); onDone(); });
}

function payForm(po, cur, onDone) {
  const pay = num({ value: po.payback, required: true });
  const share = num({ value: po.share, required: true });
  const date = inp({ type: 'date', value: today() });
  const method = sel([['bank', 'Bank'], ['easypaisa', 'Easypaisa'], ['jazzcash', 'JazzCash'], ['cash', 'Cash']], 'bank');
  const ref = inp({ placeholder: 'Transaction ID' });
  const proof = inp({ type: 'url', placeholder: 'https://… proof' });
  const btn = el('button', { class: 'lb-btn lb-btn-primary' }, 'Mark paid');
  const d = openDrawer('Record payout — ' + (po.month ? new Date(po.month).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : ''), el('div', null, [
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px' }, [f('Payback portion', pay, 'reduces balance'), f('Share portion', share)]),
    f('Paid on', date), f('Method', method), f('Reference', ref), f('Proof link', proof), btn,
  ]), { subtitle: 'The investor then confirms receipt from their portal.' });
  btn.onclick = () => submit(btn, () => ccInvPay({ payout_id: po.id, payback_portion: pay.value, share_portion: share.value, paid_date: date.value, method: method.value, reference: ref.value, proof_url: proof.value }), () => { d.close(); onDone(); });
}

// ─────────────────────────────────────────────────────────── detail drawer
async function openDetail(agrId, onListChange) {
  const body = el('div');
  const d = openDrawer('Agreement', body, { subtitle: 'Loading…' });
  const manage = can('finance.manage');
  const reload = async () => { await paint(); onListChange && onListChange(); };

  async function paint() {
    showLoading(body, 'Loading ledger…');
    let D;
    try { D = await ccInvDetail(agrId); } catch (e) { showError(body, humanizeError(e), paint); return; }
    const a = D.agreement || {}, p = D.position || {}, cur = a.currency || 'PKR';
    const rec = p.phase === 'recovering';
    const sec = (title, actions, node) => el('div', { style: 'margin-top:22px' }, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px' }, [el('h4', { style: 'margin:0' }, title), el('div', { style: 'display:flex;gap:6px' }, actions || [])]), node]);
    const row = (cells, cls) => el('tr', { class: cls || '' }, cells.map(c => el('td', null, c)));
    const tbl = (heads, trs) => trs.length ? el('table', { class: 'cc-table cc-table-sm' }, [el('thead', null, el('tr', null, heads.map(h => el('th', null, h)))), el('tbody', null, trs)]) : el('p', { style: 'opacity:.6;font-size:.88rem' }, 'Nothing yet.');
    const link = (u, t) => u ? el('a', { href: u, target: '_blank', rel: 'noopener' }, t || 'open') : '—';

    mount(body, [
      el('div', { class: 'cc-kpi-grid' }, [
        statCard({ icon: 'doc', label: 'Funded', value: pkr(p.funded, cur), sub: 'of ' + pkr(p.commitment_cap, cur) + ' · ' + pct(p.funded_pct), accent: 'blue' }),
        statCard({ icon: 'list', label: 'Fund cash', value: pkr(p.fund_cash, cur), sub: pkr(p.spent, cur) + ' spent', accent: Number(p.fund_cash) < 0 ? 'red' : 'green' }),
        statCard({ icon: 'shield', label: rec ? 'Still owed' : 'Recovered', value: pkr(rec ? p.outstanding : p.recovered, cur), sub: pct(p.recovered_pct) + ' recovered', accent: rec ? 'amber' : 'green' }),
        statCard({ icon: 'users', label: 'Paid out', value: pkr(p.total_paid_out, cur), sub: pkr(p.share_paid, cur) + ' was their share', accent: 'blue' }),
      ]),
      (p.open_questions || []).length ? el('div', { class: 'lb-callout lb-callout-amber', style: 'margin-top:12px' }, [
        el('b', null, 'Open questions in this agreement: '), (p.open_questions || []).join(', '), ' — the investor sees these flagged too.']) : null,

      sec('Terms', manage ? [el('button', { class: 'lb-btn lb-btn-sm', onClick: () => agreementForm(a, [], reload) }, 'Edit')] : null,
        el('div', { class: 'cc-fields' }, [
          field('Payback', pct(a.payback_rate_pct) + ' of profit until ' + (a.payback_basis === 'fixed' ? pkr(a.payback_fixed_amount, cur) : 'funded amount') + ' is back'),
          field('Permanent', pct(a.permanent_share_pct) + ' of profit, forever'),
          field('That % is', a.share_type === 'equity' ? 'Equity (' + (a.equity_vesting_mode === 'pro_rata' ? 'vests pro-rata — now ' + pct(p.equity_vested_pct) : 'upfront') + ')' : a.share_type === 'profit_share' ? 'Profit share only' : 'NOT DECIDED'),
          field('Profit =', a.profit_definition), field('If sold', a.exit_treatment), field('If funding stops', a.early_stop_terms), field('Buyout', a.buyout_terms),
          field('Signed', a.signed_date ? fmtDate(a.signed_date) : 'not signed'), field('Document', link(a.doc_url, 'open PDF')),
        ])),

      sec('Capital requests', manage ? [el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => requestForm(agrId, p.unfunded, cur, reload) }, '+ Request')] : null,
        tbl(['#', 'Amount', 'For', 'Status', 'Seen'], (D.requests || []).map(r => row([
          r.seq, pkr(r.amount, cur), r.reason + (r.category ? ' · ' + r.category : ''),
          pill({ pending: 'Awaiting investor', declared: 'Declared — confirm below', funded: 'Funded', declined: 'Declined', cancelled: 'Cancelled' }[r.status] || r.status, { pending: 'amber', declared: 'blue', funded: 'green' }[r.status] || 'gray'),
          r.seen_at ? fmtDate(r.seen_at) : '—'])))),

      sec('Money received', manage ? [el('button', { class: 'lb-btn lb-btn-sm', onClick: () => receiptForm(agrId, D.requests || [], cur, reload) }, '+ Record receipt')] : null,
        tbl(['Date', 'Amount', 'Method / ref', 'Investor', 'LoadBoot', ''], (D.receipts || []).map(r => row([
          fmtDate(r.received_date), el('b', { style: Number(r.amount) < 0 ? 'color:#dc2626' : '' }, pkr(r.amount, cur)),
          (r.method || '—') + (r.reference ? ' · ' + r.reference : '') + ' ', link(r.proof_url, '(proof)'),
          r.declared_at ? pill('Declared', 'green') : pill('—', 'gray'),
          r.confirmed_at ? pill('Confirmed', 'green') : pill('Not yet', 'amber'),
          manage ? el('div', { style: 'display:flex;gap:4px' }, [
            !r.confirmed_at ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: async () => { if (!(await askConfirm('Confirm ' + pkr(r.amount, cur) + ' received?', { body: 'This makes it count. It cannot be edited afterwards — only reversed.' }))) return; try { await ccInvConfirmReceipt({ receipt_id: r.id }); toast('Confirmed'); reload(); } catch (e) { toast(humanizeError(e), 'error'); } } }, 'Confirm') : null,
            (r.confirmed_at && r.state !== 'reversal' && Number(r.amount) > 0) ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: async () => { const why = await askReason('Reverse this receipt', { placeholder: 'Why?' }); if (!why) return; try { await ccInvReverseReceipt(r.id, why); toast('Reversed'); reload(); } catch (e) { toast(humanizeError(e), 'error'); } } }, 'Reverse') : null,
          ]) : ''], r.state === 'reversal' ? 'cc-row-muted' : '')))),

      sec('Expenses', manage ? [el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => expenseForm(agrId, D.receipts || [], cur, reload) }, '+ Log expense')] : null,
        el('div', null, [
          Object.keys(D.by_category || {}).length ? el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px' }, Object.entries(D.by_category).sort((x, y) => y[1] - x[1]).map(([c, v]) => pill(c + ' ' + pkr(v, cur), 'blue'))) : null,
          tbl(['Date', 'Category', 'Vendor / what', 'Amount', 'Receipt', ''], (D.expenses || []).map(x => row([
            fmtDate(x.date), x.category, (x.vendor || '—') + (x.description ? ' · ' + x.description : '') + (x.recurring ? ' · monthly' : ''),
            el('b', { style: x.reversed ? 'color:#16a34a' : '' }, (x.reversed ? '+' : '−') + pkr(x.amount, cur)), link(x.receipt_url, 'view'),
            (manage && !x.reversed) ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: async () => { const why = await askReason('Reverse this expense', { placeholder: 'Why?' }); if (!why) return; try { await ccInvReverseExpense(x.id, why); toast('Reversed'); reload(); } catch (e) { toast(humanizeError(e), 'error'); } } }, 'Reverse') : ''], x.reversed ? 'cc-row-muted' : ''))),
        ])),

      sec('Payouts due', null, tbl(['Month', 'Payback', 'Share', 'Total', ''], (D.payouts_due || []).map(po => row([
        po.month ? new Date(po.month).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '—', pkr(po.payback, cur), pkr(po.share, cur), el('b', null, pkr(po.total, cur)),
        manage ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => payForm(po, cur, reload) }, 'Pay') : ''])))),

      sec('Payout history', null, tbl(['Month', 'Total', 'Paid', 'Investor confirmed'], (D.payouts || []).filter(x => x.status === 'paid').map(x => row([
        x.month ? new Date(x.month).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '—', pkr(x.total, cur), fmtDate(x.paid_date) + ' ', link(x.proof_url, '(proof)'),
        x.confirmed_at ? pill('Yes · ' + fmtDate(x.confirmed_at), 'green') : pill('Waiting', 'amber')])))),
    ]);
    const sub = d.body.parentElement.querySelector('.cc-drawer-head p');
    if (sub) sub.textContent = (a.title || 'Agreement') + ' · ' + (rec ? 'recovering' : 'permanent share phase');
  }
  await paint();
}

export default renderInvestors;
