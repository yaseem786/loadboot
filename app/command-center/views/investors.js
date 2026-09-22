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
         ccInvConfirmReceipt, ccInvReverseReceipt, ccInvExpense, ccInvReverseExpense, ccInvPublishMonth, ccInvPay,
         ccInvRejectReceipt, ccInvCloseCommitment, ccInvReopenCommitment, ccInvWindDown, ccInvAnswerFlag,
         ccInvSettingsGet, ccInvSettingsSet, ccInvPublishDoc, ccInvCountersign, invProofUrl, invCurrentDoc } from '../../shared/api.js';
import { buildAgreement, hasPlaceholders, mdToHtml, DEFAULT_EXTRA } from '../../investor/agreement-template.js';
import { VENDOR_NAMES, vendorWhat } from '../../investor/glossary.js';
import { can } from '../../shared/permissions.js';
import { humanizeError, toast } from '../../shared/errors.js';

const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const pkr = (n, cur) => (cur || 'PKR') + ' ' + nf.format(Number(n || 0));
const pct = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';
const pill = (text, tone) => el('span', { class: 'cc-pill cc-pill-' + (tone || 'gray') }, [el('i', { class: 'cc-pill-dot' }), text]);
const field = (k, v) => el('div', { class: 'cc-field' }, [el('span', null, k), el('b', null, v == null || v === '' ? '—' : v)]);
const CATS = ['office', 'rent', 'utilities', 'salary', 'equipment', 'tools', 'legal', 'relocation', 'marketing', 'misc'];
const today = () => new Date().toISOString().slice(0, 10);
const CURRENCIES = ['PKR', 'USD', 'AED', 'GBP', 'EUR', 'SAR'];
// Tools & services LoadBoot pays for — pre-listed in the expense form. Editable in Settings → Vendors.
const DEFAULT_VENDORS = VENDOR_NAMES; // names + plain-language meaning live in app/investor/glossary.js (3 languages)
let SETTINGS = null;
async function settings(force) { if (!SETTINGS || force) { try { SETTINGS = await ccInvSettingsGet(); } catch (_) { SETTINGS = {}; } } return SETTINGS; }
const isStorageRef = (u) => typeof u === 'string' && u.startsWith('storage:');
function proofLink(u, label) {
  if (!u) return '—';
  if (!isStorageRef(u)) return el('a', { href: u, target: '_blank', rel: 'noopener' }, label || 'open');
  return el('a', { href: '#', onClick: async (e) => { e.preventDefault(); e.stopPropagation(); try { const s = await invProofUrl(u); window.open(s, '_blank', 'noopener'); } catch (ex) { toast(humanizeError(ex), 'error'); } } }, label || 'open');
}

const STYLE_ID = 'cc-inv-style';
function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style'); st.id = STYLE_ID;
  st.textContent = [
    '.cc-inv-hero{position:relative;overflow:hidden;border-radius:18px;padding:22px 24px;margin:0 0 18px;color:#fff;background:linear-gradient(135deg,#0B1B33 0%,#10223B 45%,#0E3A6B 100%);box-shadow:0 18px 40px -24px rgba(16,34,59,.6)}',
    '.cc-inv-hero:before{content:"";position:absolute;inset:auto -60px -120px auto;width:320px;height:320px;border-radius:50%;background:radial-gradient(circle,rgba(8,131,247,.45),transparent 65%)}',
    '.cc-inv-hero h2{margin:0;font-size:1.35rem;font-weight:800;letter-spacing:-.01em}',
    '.cc-inv-hero p{margin:4px 0 0;color:rgba(255,255,255,.72);font-size:.86rem;max-width:720px}',
    '.cc-inv-hero .acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}',
    '.cc-inv-hero .lb-btn{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);color:#fff}',
    '.cc-inv-hero .lb-btn-primary{background:#0883F7;border-color:#0883F7}',
    '.cc-inv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px;margin-top:6px}',
    '.cc-inv-card{background:var(--lb-card,#fff);border:1px solid var(--lb-border,#e6edf5);border-radius:16px;padding:18px;cursor:pointer;transition:transform .15s,box-shadow .15s;position:relative}',
    '.cc-inv-card:hover{transform:translateY(-2px);box-shadow:0 14px 30px -18px rgba(16,34,59,.35)}',
    '.cc-inv-card .who{display:flex;align-items:center;gap:12px;margin-bottom:12px}',
    '.cc-inv-card .av{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-weight:800;color:#fff;background:linear-gradient(135deg,#0883F7,#10223B);font-size:.95rem;flex:none}',
    '.cc-inv-card .nm{font-weight:800;color:var(--lb-navy,#10223B)}.cc-inv-card .rel{font-size:.76rem;color:var(--lb-muted,#64748b)}',
    '.cc-inv-card .big{font-size:1.5rem;font-weight:800;letter-spacing:-.01em;color:var(--lb-navy,#10223B);font-variant-numeric:tabular-nums}.cc-inv-card .big small{font-size:.78rem;color:var(--lb-muted,#64748b);font-weight:600;margin-left:6px}',
    '.cc-inv-bar{height:8px;border-radius:999px;background:#eef2f7;overflow:hidden;margin:8px 0 4px}.cc-inv-bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#0883F7,#4FA9FF)}.cc-inv-bar i.g{background:linear-gradient(90deg,#16a34a,#4ade80)}',
    '.cc-inv-mini{display:grid;grid-template-columns:1fr 1fr;gap:8px 14px;margin-top:10px}.cc-inv-mini div{font-size:.8rem;color:var(--lb-muted,#64748b)}.cc-inv-mini b{display:block;color:var(--lb-navy,#10223B);font-size:.92rem;font-variant-numeric:tabular-nums}',
    '.cc-inv-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}',
    '.cc-inv-tabs{display:flex;gap:2px;border-bottom:1px solid var(--lb-border,#e6edf5);margin:14px 0 6px;position:sticky;top:0;background:var(--lb-card,#fff);z-index:2}',
    '.cc-inv-tabs button{border:0;background:none;padding:10px 14px;font:700 .84rem inherit;color:var(--lb-muted,#64748b);border-bottom:2px solid transparent;margin-bottom:-1px;cursor:pointer;display:inline-flex;gap:6px;align-items:center}',
    '.cc-inv-tabs button.on{color:#0883F7;border-bottom-color:#0883F7}.cc-inv-tabs .n{font-size:.68rem;font-weight:800;background:#fff3cd;color:#92400e;border-radius:999px;padding:1px 7px}',
    '.cc-inv-tl{position:relative;padding-left:22px;margin-top:8px}.cc-inv-tl:before{content:"";position:absolute;left:7px;top:4px;bottom:4px;width:2px;background:#e6edf5}',
    '.cc-inv-tl div{position:relative;padding:4px 0 10px;font-size:.84rem}.cc-inv-tl div:before{content:"";position:absolute;left:-19px;top:9px;width:10px;height:10px;border-radius:50%;background:#0883F7;border:2px solid #fff;box-shadow:0 0 0 1px #e6edf5}',
    '.cc-inv-tl small{display:block;color:var(--lb-muted,#64748b);font-size:.74rem}',
    '.cc-inv-doc{background:#fff;color:#10223B;border:1px solid #e6edf5;border-radius:12px;padding:18px;max-height:56vh;overflow:auto;font-family:Georgia,serif;font-size:.9rem;line-height:1.6}',
    '.cc-inv-doc h1{font-size:1.1rem;margin:0 0 8px}.cc-inv-doc h2{font-size:.95rem;margin:14px 0 4px;border-top:1px solid #eef2f7;padding-top:8px}.cc-inv-doc table{border-collapse:collapse;width:100%;font-size:.84rem}.cc-inv-doc td,.cc-inv-doc th{border:1px solid #d4deea;padding:4px 8px;text-align:left}.cc-inv-doc .ph{background:#FEF3C7;color:#92400e;padding:0 4px;border-radius:3px}.cc-inv-doc.rtl{direction:rtl;text-align:right;font-family:"Noto Nastaliq Urdu",serif;line-height:1.9}',
    '.cc-inv-sig{display:flex;gap:10px;align-items:center;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:10px 12px;font-size:.84rem;margin:6px 0}.cc-inv-sig.wait{background:#fffbeb;border-color:#fde68a}',
    '.cc-inv-hash{font-family:monospace;font-size:.7rem;word-break:break-all;color:var(--lb-muted,#64748b)}',
    '.lb-callout{border-radius:12px;padding:12px 14px;font-size:.86rem;border:1px solid}.lb-callout-amber{background:#fffbeb;border-color:#fde68a;color:#78350f}.lb-callout-red{background:#fef2f2;border-color:#fecaca;color:#7f1d1d}.lb-callout-green{background:#ecfdf5;border-color:#a7f3d0;color:#064e3b}',
    '.cc-inv-set{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}',
    '@media (max-width:700px){.cc-inv-set{grid-template-columns:1fr}.cc-inv-grid{grid-template-columns:1fr}}',
  ].join('\n');
  document.head.appendChild(st);
}

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
  const bodyHost = el('div');
  let rows = [];
  const manage = can('finance.manage');

  function header() {
    const actions = [el('button', { class: 'lb-btn lb-btn-sm', onClick: load }, 'Refresh')];
    if (manage) {
      actions.push(el('button', { class: 'lb-btn lb-btn-sm', onClick: () => settingsDrawer(load) }, 'Settings · bank, FX, forecast, vendors'));
      actions.push(el('button', { class: 'lb-btn lb-btn-sm', onClick: () => publishMonthForm(load) }, 'Publish month'));
      actions.push(el('button', { class: 'lb-btn lb-btn-sm', onClick: () => agreementForm(null, rows, load) }, '+ Agreement'));
      actions.push(el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => investorForm(null, load) }, '+ Investor'));
    }
    return el('div', null, [
      el('div', { class: 'cc-inv-hero' }, [
        el('h2', null, 'Investor capital desk'),
        el('p', null, 'Every rupee in, every rupee out, and what each investor is owed — the same ledger they see live in their portal. Nothing counts until both sides confirm it; confirmed rows are never edited, only reversed.'),
        el('div', { class: 'acts' }, actions),
      ]),
      kpiHost,
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
    try { res = await ccInvList(); await settings(); } catch (e) { showError(bodyHost, humanizeError(e), load); return; }
    rows = (res && res.investors) || [];
    paintKpis();
    if (!rows.length) { showEmpty(bodyHost, manage ? 'No investors yet. Add the first one with “+ Investor”, then create their agreement.' : 'No investors recorded.'); return; }
    const initials = (n) => String(n || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    mount(bodyHost, el('div', { class: 'cc-inv-grid' }, rows.flatMap(r => {
      const agrs = r.agreements || [];
      const who = el('div', { class: 'who' }, [el('div', { class: 'av' }, initials(r.investor.name)), el('div', null, [el('div', { class: 'nm' }, r.investor.name), el('div', { class: 'rel' }, [(r.investor.relationship || 'investor'), r.investor.linked ? ' · portal linked' : ' · login not linked'])])]);
      if (!agrs.length) return [el('div', { class: 'cc-inv-card', onClick: () => investorForm(r.investor, load) }, [who,
        el('p', { style: 'opacity:.7;font-size:.86rem;margin:0' }, 'No agreement yet.'),
        manage ? el('div', { class: 'cc-inv-tags' }, el('button', { class: 'lb-btn lb-btn-sm', onClick: (e) => { e.stopPropagation(); agreementForm(null, rows, load, r.investor.id); } }, '+ Agreement')) : null])];
      return agrs.map(a => {
        const p = a.position || {}, cur = a.currency || 'PKR', rec = p.phase === 'recovering';
        const oq = (p.open_questions || []).length;
        return el('div', { class: 'cc-inv-card', onClick: () => openDetail(a.id, load) }, [
          who.cloneNode(true),
          el('div', { style: 'font-size:.76rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;opacity:.6' }, a.title || 'Agreement'),
          el('div', { class: 'big' }, [pkr(p.funded, cur), el('small', null, 'of ' + pkr(p.commitment_cap, cur))]),
          el('div', { class: 'cc-inv-bar' }, el('i', { style: 'width:' + Math.min(100, Number(p.funded_pct || 0)) + '%' })),
          el('div', { style: 'display:flex;justify-content:space-between;font-size:.76rem;opacity:.7' }, [el('span', null, 'Recovery ' + pct(p.recovered_pct)), el('span', null, pct(p.payback_rate_pct) + ' + ' + pct(p.permanent_share_pct) + (p.share_type ? ' · ' + p.share_type.replace('_', ' ') : ' · type TBD'))]),
          el('div', { class: 'cc-inv-bar' }, el('i', { class: 'g', style: 'width:' + Math.min(100, Number(p.recovered_pct || 0)) + '%' })),
          el('div', { class: 'cc-inv-mini' }, [
            el('div', null, ['Fund cash', el('b', { style: Number(p.fund_cash) < 0 ? 'color:#dc2626' : '' }, pkr(p.fund_cash, cur))]),
            el('div', null, ['Spent', el('b', null, pkr(p.spent, cur))]),
            el('div', null, [rec ? 'Still owed' : 'Recovered', el('b', null, pkr(rec ? p.outstanding : p.recovered, cur))]),
            el('div', null, ['Paid out', el('b', null, pkr(p.total_paid_out, cur))]),
          ]),
          el('div', { class: 'cc-inv-tags' }, [
            rec ? pill('Recovering', 'blue') : p.phase === 'wound_down' ? pill('Wound down', 'red') : pill('Permanent share', 'green'),
            a.signed_date ? pill('Signed ' + fmtDate(a.signed_date), 'green') : pill('Not signed', 'amber'),
            Number(r.pending_receipts) ? pill(r.pending_receipts + ' to confirm', 'amber') : null,
            oq ? pill(oq + ' open question' + (oq === 1 ? '' : 's'), 'amber') : null,
          ]),
        ]);
      });
    })));
  }

  ensureStyle();
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
  const lang = sel([['en', 'English'], ['ur_roman', 'Roman Urdu'], ['ur', 'Urdu (اردو)']], inv ? (inv.lang || inv.preferred_lang || 'en') : 'en');
  const linkEmail = inp({ type: 'email', placeholder: 'email they signed up with' });
  const btn = el('button', { class: 'lb-btn lb-btn-primary' }, inv ? 'Save' : 'Add investor');
  const d = openDrawer(inv ? inv.name : 'New investor', el('div', null, [
    f('Name', name), f('Email', email), f('Phone', phone), f('Relationship', rel),
    f('Portal language', lang, 'What their portal opens in. They can switch it themselves.'), f('Notes', notes), btn,
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
  btn.onclick = () => submit(btn, () => ccInvSaveInvestor({ id: inv ? inv.id : null, name: name.value, email: email.value, phone: phone.value, relationship: rel.value, notes: notes.value, preferred_lang: lang.value }), () => { d.close(); onDone(); });
}

function agreementForm(agr, rows, onDone, presetInvestor) {
  const a = agr || {};
  const invSel = agr ? null : sel(rows.map(r => [r.investor.id, r.investor.name]), presetInvestor);
  const title = inp({ value: a.title || '', placeholder: 'e.g. Seed — Sep 2026' });
  const cur = sel(CURRENCIES.concat(a.currency && !CURRENCIES.includes(a.currency) ? [a.currency] : []).map(c => [c, c]), a.currency || 'PKR');
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
  const stopMode = sel([['pro_rata', 'Pro-rate the permanent % to what was paid (8 of 20 → 2%)'], ['keep', 'Keep the full permanent %']], a.early_stop_share_mode || 'pro_rata');
  const carry = sel([['false', 'Month by month — a loss month owes nothing and is not carried'], ['true', 'Carry losses forward — later profit first repays earlier losses']], String(a.loss_carry_forward === true));
  const exitPct = num({ value: a.exit_participation_pct ?? '', max: '100', placeholder: 'e.g. 5' });
  const signed = inp({ type: 'date', value: a.signed_date || '' });
  const doc = inp({ type: 'url', value: a.doc_url || '', placeholder: 'https://… signed PDF' });
  const status = sel([['draft', 'Draft'], ['active', 'Active'], ['recovered', 'Recovered'], ['closed', 'Closed']], a.status || 'active');
  const btn = el('button', { class: 'lb-btn lb-btn-primary' }, agr ? 'Save agreement' : 'Create agreement');
  const d = openDrawer(agr ? 'Edit agreement' : 'New agreement', el('div', null, [
    invSel ? f('Investor', invSel) : null, f('Title', title),
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px' }, [f('Currency', cur, 'Every amount in this agreement is in this currency. The portal shows a USD hint from Settings → FX.'), f('Commitment cap', cap)]),
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px' }, [f('Payback % of profit', payRate, 'reduces the balance'), f('Permanent share %', shareRate, 'theirs forever')]),
    f('Recovery target', basis), f('Fixed target amount', fixed),
    f('What the permanent % IS', shareType, 'Leave undecided and the portal shows it as an open question rather than guessing.'),
    f('Equity vesting (equity only)', vest),
    f('Profit definition', profitDef),
    f('Exit participation % (of sale proceeds)', exitPct, 'Phantom equity: a share of a sale WITHOUT ownership. Blank = none.'), f('If the company is sold (words)', exitT),
    f('If they stop funding partway — the permanent %', stopMode), f('If they stop funding partway (words)', stopT),
    f('Loss months', carry), f('Buyout clause', buyout),
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px' }, [f('Signed on', signed), f('Status', status)]),
    f('Signed document link', doc), btn,
  ]), { subtitle: 'These words are what the investor reads in their portal. Write them as agreed, not as hoped.' });
  btn.onclick = () => submit(btn, () => ccInvSaveAgreement({
    id: a.id || null, investor_id: invSel ? invSel.value : a.investor_id, title: title.value, currency: cur.value.toUpperCase(),
    commitment_cap: cap.value, payback_rate_pct: payRate.value, permanent_share_pct: shareRate.value,
    payback_basis: basis.value, payback_fixed_amount: fixed.value, share_type: shareType.value,
    equity_vesting_mode: vest.value, profit_definition: profitDef.value, exit_treatment: exitT.value,
    early_stop_terms: stopT.value, buyout_terms: buyout.value, signed_date: signed.value, doc_url: doc.value, status: status.value,
    early_stop_share_mode: stopMode.value, loss_carry_forward: carry.value === 'true', exit_participation_pct: exitPct.value,
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
  const vendors = ((SETTINGS && SETTINGS.vendors && SETTINGS.vendors.list) || DEFAULT_VENDORS);
  const vendorSel = sel([['', '— choose —']].concat(vendors.map(v => [v, v])).concat([['__other', 'Other…']]), '');
  const vendorOther = inp({ placeholder: 'Who was paid', style: 'width:100%;display:none;margin-top:6px' });
  vendorSel.onchange = () => { vendorOther.style.display = vendorSel.value === '__other' ? '' : 'none'; if (vendorSel.value === '__other') vendorOther.focus();
    const w = vendorWhat(vendorSel.value, 'en'); mount(whatHint, w ? ('Investor sees: “' + w + '” — in their own language.') : (vendorSel.value === '__other' ? 'No preset meaning — write in Description, in plain words, what it is and why it was needed.' : '')); };
  const whatHint = el('div', { style: 'font-size:.8rem;color:#0762C4;margin-top:4px;min-height:1em' });
  const vendor = { get value() { return vendorSel.value === '__other' ? vendorOther.value : vendorSel.value; } };
  const desc = inp({ placeholder: 'What exactly (plan, month, invoice #)' });
  const receipt = inp({ type: 'url', placeholder: 'https://… receipt photo' });
  const rec = el('input', { type: 'checkbox' });
  const btn = el('button', { class: 'lb-btn lb-btn-primary' }, 'Log expense');
  settings();
  const d = openDrawer('Log an expense', el('div', null, [
    f('Paid from tranche', tranche, 'TAG 1 — which money paid for it'), f('Category', cat, 'TAG 2 — what it was'),
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px' }, [f('Amount', amount), f('Date', date)]),
    f('Vendor / service', el('div', null, [vendorSel, vendorOther, whatHint]), 'Pre-listed tools carry a plain-language meaning the investor reads automatically. Manage the list in Settings.'), f('Description', desc, 'Plain words a non-technical person understands: what was bought and why. No jargon.'), f('Receipt photo link', receipt, 'The investor can open this.'),
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

function windDownForm(agrId, p, cur, onDone) {
  const reason = ta({ placeholder: 'Written reason — the investor reads this', required: true });
  const assets = num({ value: '', placeholder: '0' });
  const ret = num({ value: Math.max(Number(p.fund_cash || 0), 0), required: true });
  const btn = el('button', { class: 'lb-btn lb-btn-primary', style: 'background:#dc2626;border-color:#dc2626' }, 'Wind down this agreement');
  const d = openDrawer('Wind down — loss / shutdown', el('div', null, [
    el('div', { class: 'lb-callout lb-callout-red' }, [el('b', null, 'This ends the agreement. '), 'Unspent fund cash (' + pkr(p.fund_cash, cur) + ') plus any asset sale proceeds go back to the investor as a capital return. Spent money (' + pkr(p.spent, cur) + ') is recorded as lost. Nothing is owed personally by the owner. The investor sees all of it.']),
    f('Reason', reason), f('Asset sale proceeds (equipment sold, etc.)', assets, 'Added to the return'),
    f('Amount to return', ret, 'Defaults to fund cash + asset proceeds. Recorded as a pending capital-return payout — mark it paid when sent.'), btn,
  ]));
  assets.oninput = () => { ret.value = (Math.max(Number(p.fund_cash || 0), 0) + Number(assets.value || 0)).toFixed(2); };
  btn.onclick = async () => { if (!(await askConfirm('Wind down for real?', { body: 'This cannot be undone from the UI.', danger: true, confirmLabel: 'Yes, wind down' }))) return;
    submit(btn, () => ccInvWindDown({ agreement_id: agrId, reason: reason.value, asset_proceeds: assets.value, return_amount: ret.value }), () => { d.close(); onDone(); }); };
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
    try { const r = await invCurrentDoc(agrId); D.doc = r && r.doc; } catch (_) { D.doc = null; }
    const a = D.agreement || {}, p = D.position || {}, cur = a.currency || 'PKR';
    const rec = p.phase === 'recovering';
    const sec = (title, actions, node) => el('div', { style: 'margin-top:22px' }, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px' }, [el('h4', { style: 'margin:0' }, title), el('div', { style: 'display:flex;gap:6px' }, actions || [])]), node]);
    const row = (cells, cls) => el('tr', { class: cls || '' }, cells.map(c => el('td', null, c)));
    const tbl = (heads, trs) => trs.length ? el('table', { class: 'cc-table cc-table-sm' }, [el('thead', null, el('tr', null, heads.map(h => el('th', null, h)))), el('tbody', null, trs)]) : el('p', { style: 'opacity:.6;font-size:.88rem' }, 'Nothing yet.');
    const link = (u, t) => proofLink(u, t);

    const overview = [
      el('div', { class: 'cc-kpi-grid' }, [
        statCard({ icon: 'doc', label: 'Funded', value: pkr(p.funded, cur), sub: 'of ' + pkr(p.commitment_cap, cur) + ' · ' + pct(p.funded_pct), accent: 'blue' }),
        statCard({ icon: 'list', label: 'Fund cash', value: pkr(p.fund_cash, cur), sub: pkr(p.spent, cur) + ' spent', accent: Number(p.fund_cash) < 0 ? 'red' : 'green' }),
        statCard({ icon: 'shield', label: rec ? 'Still owed' : 'Recovered', value: pkr(rec ? p.outstanding : p.recovered, cur), sub: pct(p.recovered_pct) + ' recovered', accent: rec ? 'amber' : 'green' }),
        statCard({ icon: 'users', label: 'Paid out', value: pkr(p.total_paid_out, cur), sub: pkr(p.share_paid, cur) + ' was their share', accent: 'blue' }),
      ]),
      (p.open_questions || []).length ? el('div', { class: 'lb-callout lb-callout-amber', style: 'margin-top:12px' }, [
        el('b', null, 'Open questions in this agreement: '), (p.open_questions || []).join(', '), ' — the investor sees these flagged too.']) : null,

      a.status === 'wound_down' ? el('div', { class: 'lb-callout lb-callout-red', style: 'margin-top:12px' }, [el('b', null, 'Wound down. '), 'Reason: ' + ((a.wind_down || {}).reason || '—') + ' · returned ' + pkr((a.wind_down || {}).return_amount, cur) + ' · lost ' + pkr((a.wind_down || {}).spent_and_lost, cur)]) : null,
      (a.commitment_closed_at && a.status !== 'wound_down') ? el('div', { class: 'lb-callout lb-callout-amber', style: 'margin-top:12px' }, [el('b', null, 'Commitment closed at ' + pkr(a.commitment_cap, cur) + '. '), 'Was ' + pkr(a.original_cap, cur) + ' · permanent share now ' + pct(p.effective_share_pct) + ' · ' + (a.closed_reason || '')]) : null,
      manage && a.status !== 'wound_down' ? el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:12px' }, [
        !a.commitment_closed_at ? el('button', { class: 'lb-btn lb-btn-sm', onClick: async () => { const why = await askReason('Close the commitment at ' + pkr(p.funded, cur) + '?', { placeholder: 'Why is the investor stopping here?' }); if (!why) return; try { await ccInvCloseCommitment(agrId, why); toast('Commitment closed'); reload(); } catch (e) { toast(humanizeError(e), 'error'); } } }, 'Close commitment at funded amount') : null,
        a.commitment_closed_at ? el('button', { class: 'lb-btn lb-btn-sm', onClick: async () => { const v = await askReason('Reopen — new commitment cap (' + cur + ')', { placeholder: String(a.original_cap || a.commitment_cap) }); if (!v) return; try { await ccInvReopenCommitment(agrId, Number(v)); toast('Reopened'); reload(); } catch (e) { toast(humanizeError(e), 'error'); } } }, 'Reopen commitment') : null,
        el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', style: 'color:#dc2626', onClick: () => windDownForm(agrId, p, cur, reload) }, 'Wind down (loss / shutdown)'),
      ]) : null,

      sec('Terms', manage ? [el('button', { class: 'lb-btn lb-btn-sm', onClick: () => agreementForm(a, [], reload) }, 'Edit')] : null,
        el('div', { class: 'cc-fields' }, [
          field('Payback', pct(a.payback_rate_pct) + ' of profit until ' + (a.payback_basis === 'fixed' ? pkr(a.payback_fixed_amount, cur) : 'funded amount') + ' is back'),
          field('Permanent', pct(a.permanent_share_pct) + ' of profit, forever'),
          field('That % is', a.share_type === 'equity' ? 'Equity (' + (a.equity_vesting_mode === 'pro_rata' ? 'vests pro-rata — now ' + pct(p.equity_vested_pct) : 'upfront') + ')' : a.share_type === 'profit_share' ? 'Profit share only' : 'NOT DECIDED'),
          field('Profit =', a.profit_definition), field('If sold', a.exit_treatment), field('If funding stops', a.early_stop_terms), field('Buyout', a.buyout_terms),
          field('On a sale', a.exit_participation_pct != null ? pct(a.exit_participation_pct) + ' of proceeds' : '—'),
          field('Stops partway', a.early_stop_share_mode === 'keep' ? 'permanent % kept' : 'permanent % pro-rated'), field('Loss months', a.loss_carry_forward ? 'carried forward' : 'month by month'),
          field('Signed', a.signed_date ? fmtDate(a.signed_date) : 'not signed'), field('Document', link(a.doc_url, 'open PDF')),
        ])),

    ];
    const ledger = [
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
          r.state === 'rejected' ? pill('Rejected', 'red') : r.confirmed_at ? pill('Confirmed', 'green') : pill('Not yet', 'amber'),
          manage ? el('div', { style: 'display:flex;gap:4px' }, [
            (!r.confirmed_at && r.state !== 'rejected') ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: async () => { if (!(await askConfirm('Confirm ' + pkr(r.amount, cur) + ' received?', { body: 'This makes it count. It cannot be edited afterwards — only reversed.' }))) return; try { await ccInvConfirmReceipt({ receipt_id: r.id }); toast('Confirmed'); reload(); } catch (e) { toast(humanizeError(e), 'error'); } } }, 'Confirm') : null,
            (!r.confirmed_at && r.state !== 'rejected' && r.declared_at) ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: async () => { const why = await askReason('Reject this declared payment', { placeholder: 'e.g. never arrived / wrong amount' }); if (!why) return; try { await ccInvRejectReceipt(r.id, why); toast('Rejected'); reload(); } catch (e) { toast(humanizeError(e), 'error'); } } }, 'Reject') : null,
            (r.confirmed_at && r.state !== 'reversal' && Number(r.amount) > 0) ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: async () => { const why = await askReason('Reverse this receipt', { placeholder: 'Why?' }); if (!why) return; try { await ccInvReverseReceipt(r.id, why); toast('Reversed'); reload(); } catch (e) { toast(humanizeError(e), 'error'); } } }, 'Reverse') : null,
          ]) : ''], (r.state === 'reversal' || r.state === 'rejected') ? 'cc-row-muted' : '')))),

      sec('Expenses', manage ? [el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => expenseForm(agrId, D.receipts || [], cur, reload) }, '+ Log expense')] : null,
        el('div', null, [
          Object.keys(D.by_category || {}).length ? el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px' }, Object.entries(D.by_category).sort((x, y) => y[1] - x[1]).map(([c, v]) => pill(c + ' ' + pkr(v, cur), 'blue'))) : null,
          tbl(['Date', 'Category', 'Vendor / what', 'Amount', 'Receipt', ''], (D.expenses || []).map(x => row([
            fmtDate(x.date), x.category, (x.vendor || '—') + (x.description ? ' · ' + x.description : '') + (x.recurring ? ' · monthly' : ''),
            el('b', { style: x.reversed ? 'color:#16a34a' : '' }, (x.reversed ? '+' : '−') + pkr(x.amount, cur)), link(x.receipt_url, 'view'),
            (manage && !x.reversed) ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: async () => { const why = await askReason('Reverse this expense', { placeholder: 'Why?' }); if (!why) return; try { await ccInvReverseExpense(x.id, why); toast('Reversed'); reload(); } catch (e) { toast(humanizeError(e), 'error'); } } }, 'Reverse') : ''], x.reversed ? 'cc-row-muted' : ''))),
        ])),

      sec('Payouts due', null, tbl(['Month', 'Payback', 'Share', 'Total', ''], (D.payouts_due || []).map(po => row([
        po.kind === 'capital_return' ? el('b', null, 'Capital return') : (po.month ? new Date(po.month).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '—'), pkr(po.payback, cur), pkr(po.share, cur), el('b', null, pkr(po.total, cur)),
        manage ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => payForm(po, cur, reload) }, 'Pay') : ''])))),

      sec('Payout history', null, tbl(['Month', 'Total', 'Paid', 'Investor confirmed'], (D.payouts || []).filter(x => x.status === 'paid').map(x => row([
        x.month ? new Date(x.month).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '—', pkr(x.total, cur), fmtDate(x.paid_date) + ' ', link(x.proof_url, '(proof)'),
        x.confirmed_at ? pill('Yes · ' + fmtDate(x.confirmed_at), 'green') : pill('Waiting', 'amber')])))),
    ];
    const activity = [
      sec('Investor questions', null, tbl(['Raised', 'About', 'Question', 'Status', ''], (D.flags || []).map(fl => row([
        fmtDate(fl.raised_at), fl.kind, el('div', null, [fl.note, fl.answer ? el('div', { style: 'opacity:.7;margin-top:4px' }, '↳ ' + fl.answer) : null]),
        pill(fl.status, fl.status === 'open' ? 'amber' : 'green'),
        (manage && fl.status === 'open') ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: async () => { const ans = await askReason('Answer the investor', { placeholder: 'They read this in their portal' }); if (!ans) return; try { await ccInvAnswerFlag(fl.id, ans, true); toast('Answered'); reload(); } catch (e) { toast(humanizeError(e), 'error'); } } }, 'Answer') : ''])))),

      sec('Activity', null, timeline(D, cur)),
    ];
    const document_ = [sec('Agreement document', null, docSection(D, agrId, manage, reload))];
    const openFlags = (D.flags || []).filter(x => x.status === 'open').length;
    const pendingRc = (D.receipts || []).filter(x => !x.confirmed_at && x.state !== 'rejected' && x.declared_at).length;
    const panes = { overview, ledger, document: document_, activity };
    const paneHost = el('div');
    let tab = sessionStorage.getItem('cc-inv-tab') || 'overview';
    const tabs = el('div', { class: 'cc-inv-tabs' }, [
      ['overview', 'Overview'], ['ledger', 'Ledger', pendingRc], ['document', 'Document', (D.doc && !D.doc.fully_signed) ? 1 : 0], ['activity', 'Questions & activity', openFlags],
    ].map(([id, label, n]) => el('button', { class: id === tab ? 'on' : '', onClick: (e) => { tab = id; sessionStorage.setItem('cc-inv-tab', id); tabs.querySelectorAll('button').forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); mount(paneHost, panes[id]); } }, [label, n ? el('span', { class: 'n' }, String(n)) : null])));
    mount(paneHost, panes[tab] || overview);
    mount(body, [tabs, paneHost]);
    const sub = d.body.parentElement.querySelector('.cc-drawer-head p');
    if (sub) sub.textContent = (a.title || 'Agreement') + ' · ' + (rec ? 'recovering' : 'permanent share phase');
  }
  await paint();
}

export default renderInvestors;

// ─────────────────────────────────────────────────────────── settings (bl_inv_0403)
// Payment instructions the investor sees on every capital request, the FX rate used
// for the portal's USD hint, the owner's forecast (labelled "not yet proven" in the
// portal until real months exist), and the vendor list for the expense form.
function settingsDrawer(onDone) {
  const body = el('div');
  const d = openDrawer('Investor settings', body, { subtitle: 'Shown to every investor in their portal. Save each card separately.' });
  showLoading(body, 'Loading…');
  settings(true).then(S => {
    const pi = S.payment_instructions || {}, fx = S.fx || {}, fc = S.forecast || {}, vend = (S.vendors && S.vendors.list) || DEFAULT_VENDORS;
    const card = (title, hint, rows, onSave) => {
      const btn = el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary' }, 'Save');
      btn.onclick = () => submit(btn, onSave, () => { toast('Saved'); settings(true); onDone && onDone(); });
      return el('div', { class: 'lb-card', style: 'padding:16px;margin-bottom:14px' }, [
        el('h4', { style: 'margin:0 0 2px' }, title), el('p', { style: 'opacity:.65;font-size:.82rem;margin:0 0 12px' }, hint), rows, btn]);
    };
    const bank = inp({ value: pi.bank_name || '', placeholder: 'e.g. Meezan Bank' }), title = inp({ value: pi.account_title || '', placeholder: 'LoadBoot LLC' });
    const acct = inp({ value: pi.account_number || '' }), iban = inp({ value: pi.iban || '', placeholder: 'PK..' }), branch = inp({ value: pi.branch || '' });
    const ep = inp({ value: pi.easypaisa || '', placeholder: '03xx…' }), jc = inp({ value: pi.jazzcash || '', placeholder: '03xx…' }), pnote = ta({ value: pi.note || '', rows: 2, placeholder: 'e.g. Write the request number in the transfer note.' });
    const rate = num({ value: fx.pkr_per_usd || '', placeholder: '280', step: '0.01' }), asOf = inp({ type: 'date', value: fx.as_of || today() });
    const emp = num({ value: fc.expected_monthly_profit || '', placeholder: 'e.g. 150000' }), fpm = inp({ type: 'month', value: fc.first_payout_month ? String(fc.first_payout_month).slice(0, 7) : '' }), fnote = ta({ value: fc.note || '', rows: 2, placeholder: 'What this forecast assumes (office open, 2 dispatchers, 15 active carriers…)' });
    const vlist = ta({ value: vend.join('\n'), rows: 8 });
    const lk = S.links || {}; const lkFb = inp({ type: 'url', value: lk.facebook || '', placeholder: 'https://facebook.com/…' }), lkCap = inp({ type: 'url', value: lk.capterra || '', placeholder: 'https://www.capterra.com/p/…' }), lkIg = inp({ type: 'url', value: lk.instagram || '' }), lkYt = inp({ type: 'url', value: lk.youtube || '' });
    mount(body, [
      card('Where investors send money', 'Appears on every capital request with copy buttons. Leave a field blank to hide it.',
        el('div', { class: 'cc-inv-set' }, [f('Bank', bank), f('Account title', title), f('Account number', acct), f('IBAN', iban), f('Branch', branch), f('Easypaisa', ep), f('JazzCash', jc), f('Note', pnote)]),
        () => ccInvSettingsSet('payment_instructions', { bank_name: bank.value, account_title: title.value, account_number: acct.value, iban: iban.value, branch: branch.value, easypaisa: ep.value, jazzcash: jc.value, note: pnote.value })),
      card('FX rate for the USD hint', 'Display only. Every ledger amount stays in the agreement currency.',
        el('div', { class: 'cc-inv-set' }, [f('PKR per USD', rate), f('As of', asOf)]),
        () => ccInvSettingsSet('fx', { pkr_per_usd: Number(rate.value) || null, as_of: asOf.value })),
      card('Your forecast', 'Until two real months are published, the portal shows this — clearly labelled as LoadBoot\'s estimate, not proven. After that it switches to the trailing 3-month average automatically.',
        el('div', { class: 'cc-inv-set' }, [f('Expected monthly profit', emp), f('First payout expected (month)', fpm), f('Assumptions', fnote)]),
        () => ccInvSettingsSet('forecast', { expected_monthly_profit: Number(emp.value) || null, first_payout_month: fpm.value ? fpm.value + '-01' : null, note: fnote.value })),
      card('Public links', 'Shown to investors as "LoadBoot online". Google Play, website, LinkedIn and Trustpilot are built in; add the rest here. Leave blank to hide.',
        el('div', { class: 'cc-inv-set' }, [f('Facebook page', lkFb), f('Capterra listing', lkCap), f('Instagram', lkIg), f('YouTube', lkYt)]),
        () => ccInvSettingsSet('links', { facebook: lkFb.value.trim() || null, capterra: lkCap.value.trim() || null, instagram: lkIg.value.trim() || null, youtube: lkYt.value.trim() || null })),
      card('Vendors & services', 'One per line. Pre-listed in the expense form; "Other" is always available. Names that match the glossary carry a plain-language meaning in 3 languages.',
        f('List', vlist), () => ccInvSettingsSet('vendors', { list: vlist.value.split('\n').map(x => x.trim()).filter(Boolean) })),
    ]);
  });
  return d;
}

// ─────────────────────────────────────────────────────────── agreement document (e-sign)
function docSection(D, agrId, manage, reload) {
  const a = D.agreement || {}, doc = D.doc || null;
  const inv = D.investor || {};
  const box = el('div');
  const sigs = doc ? (doc.signatures || []) : [];
  const mine = sigs.find(x => x.party === 'investor'), co = sigs.find(x => x.party === 'company');
  const status = doc ? el('div', null, [
    el('div', { class: 'cc-inv-sig' + (mine ? '' : ' wait') }, mine ? ['Investor signed · ' + mine.signer_name + ' · ' + fmtDate(mine.signed_at) + (mine.hash_matches ? '' : ' · HASH MISMATCH')] : ['Awaiting the investor\'s signature (they sign inside the portal)']),
    el('div', { class: 'cc-inv-sig' + (co ? '' : ' wait') }, co ? ['LoadBoot signed · ' + co.signer_name + (co.signer_title ? ', ' + co.signer_title : '') + ' · ' + fmtDate(co.signed_at)] : ['Awaiting LoadBoot\'s countersignature']),
  ]) : null;
  const publishForm = () => {
    const lang = sel([['en', 'English'], ['ur_roman', 'Roman Urdu']], inv.lang === 'ur_roman' ? 'ur_roman' : 'en');
    const x = Object.assign({}, DEFAULT_EXTRA, (D.settings && D.settings.agreement_extra) || {});
    const signer = inp({ value: x.company_signer }), signerT = inp({ value: x.company_signer_title }), state = inp({ value: x.company_state });
    const stDay = num({ value: x.statement_day, step: '1' }), payDays = num({ value: x.payout_days, step: '1' }), flagDays = num({ value: x.flag_answer_days, step: '1' }), reqDays = num({ value: x.request_response_days, step: '1' });
    const law = inp({ value: x.governing_law || '', placeholder: 'e.g. Laws of Pakistan (Islamabad courts)' }), med = inp({ value: x.mediator || '', placeholder: 'Named neutral person for disputes' });
    const salary = inp({ value: x.owner_salary_in_expenses || '', placeholder: 'e.g. Owner draws no salary until recovery' }), tax = inp({ value: x.tax_treatment || '', placeholder: 'e.g. Each party bears its own taxes' });
    const preview = el('div', { class: 'cc-inv-doc' });
    const warn = el('div');
    const build = () => {
      const md = buildAgreement(a, inv, { company_signer: signer.value, company_signer_title: signerT.value, company_state: state.value, statement_day: stDay.value, payout_days: payDays.value, flag_answer_days: flagDays.value, request_response_days: reqDays.value, governing_law: law.value, mediator: med.value, owner_salary_in_expenses: salary.value, tax_treatment: tax.value }, lang.value);
      preview.className = 'cc-inv-doc' + (lang.value === 'ur' ? ' rtl' : ''); preview.innerHTML = mdToHtml(md);
      mount(warn, hasPlaceholders(md) ? el('div', { class: 'lb-callout lb-callout-amber' }, [el('b', null, 'Open points highlighted in yellow. '), 'The investor can read this version but cannot sign it. Fill the term (Edit agreement) and publish again.']) : el('div', { class: 'lb-callout lb-callout-green' }, 'No open points — this version can be signed.'));
      return md;
    };
    [lang, signer, signerT, state, stDay, payDays, flagDays, reqDays, law, med, salary, tax].forEach(i => { i.oninput = build; i.onchange = build; });
    const btn = el('button', { class: 'lb-btn lb-btn-primary' }, doc ? 'Publish as version ' + (doc.version + 1) : 'Publish version 1');
    btn.onclick = async () => {
      const md = build();
      const ok = await askConfirm('Publish this document to the investor?', { body: (doc ? 'Version ' + doc.version + ' becomes superseded; existing signatures stay attached to it and BOTH parties must sign again. ' : '') + 'The text is hashed (SHA-256) and signatures bind to that hash.' });
      if (!ok) return;
      submit(btn, () => ccInvPublishDoc({ agreement_id: agrId, body_md: md, lang: lang.value, title: 'Investment Agreement — ' + (a.title || '') }), () => { toast('Published'); reload(); });
    };
    const form = el('div', null, [
      el('div', { class: 'cc-inv-set' }, [f('Language', lang), f('Company signer', signer), f('Signer title', signerT), f('Company state / registration', state),
        f('Statement day (of month)', stDay), f('Payout within (days)', payDays), f('Answer questions within (days)', flagDays), f('Respond to capital request within (days)', reqDays),
        f('Governing law', law), f('Mediator', med), f('Owner salary rule', salary), f('Tax treatment', tax)]),
      warn, preview, el('div', { style: 'margin-top:10px' }, btn),
    ]);
    build();
    return form;
  };
  const countersign = () => {
    const name = inp({ value: DEFAULT_EXTRA.company_signer }), title = inp({ value: DEFAULT_EXTRA.company_signer_title });
    const btn = el('button', { class: 'lb-btn lb-btn-primary' }, 'Countersign version ' + doc.version);
    btn.onclick = async () => {
      if (!(await askConfirm('Countersign on behalf of LoadBoot LLC?', { body: 'Binds to hash ' + doc.hash.slice(0, 16) + '… This cannot be undone; a new version would need new signatures.' }))) return;
      submit(btn, () => ccInvCountersign({ doc_id: doc.id, signer_name: name.value, signer_title: title.value, hash: doc.hash, consent: true, consent_text: 'Signed on behalf of the Company.', user_agent: navigator.userAgent }), () => { toast('Countersigned'); reload(); });
    };
    return el('div', { class: 'lb-card', style: 'padding:14px;margin-top:10px' }, [el('h4', { style: 'margin:0 0 8px' }, 'Countersign'), el('div', { class: 'cc-inv-set' }, [f('Name', name), f('Title', title)]), btn]);
  };
  const current = doc ? el('div', null, [
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap' }, [
      el('div', null, [el('b', null, doc.title), ' · v' + doc.version + ' · ' + (doc.lang === 'ur_roman' ? 'Roman Urdu' : doc.lang === 'ur' ? 'Urdu' : 'English') + ' · ' + fmtDate(doc.published_at)]),
      doc.fully_signed ? pill('Fully signed', 'green') : pill('Signatures pending', 'amber')]),
    status,
    el('div', { class: 'cc-inv-hash' }, 'SHA-256 ' + doc.hash),
    (() => { const v = el('div', { class: 'cc-inv-doc' + (doc.lang === 'ur' ? ' rtl' : ''), style: 'margin-top:10px' }); v.innerHTML = mdToHtml(doc.body_md); return v; })(),
    (manage && mine && !co) ? countersign() : null,
  ]) : el('p', { style: 'opacity:.7' }, 'No document published yet. The investor currently sees only the terms summary.');
  const toggle = el('button', { class: 'lb-btn lb-btn-sm' }, doc ? 'Draft a new version' : 'Draft version 1');
  const formHost = el('div', { style: 'display:none;margin-top:12px' });
  toggle.onclick = () => { if (formHost.style.display === 'none') { mount(formHost, publishForm()); formHost.style.display = ''; toggle.textContent = 'Hide draft'; } else { formHost.style.display = 'none'; toggle.textContent = doc ? 'Draft a new version' : 'Draft version 1'; } };
  mount(box, [current, manage ? el('div', { style: 'margin-top:12px' }, toggle) : null, formHost]);
  return box;
}

// ─────────────────────────────────────────────────────────── activity timeline
function timeline(D, cur) {
  const ev = [];
  (D.requests || []).forEach(r => ev.push({ t: r.created_at || r.requested_at, s: 'Capital request #' + r.seq + ' · ' + pkr(r.amount, cur) + ' · ' + r.status }));
  (D.receipts || []).forEach(r => { if (r.declared_at) ev.push({ t: r.declared_at, s: 'Investor declared ' + pkr(r.amount, cur) }); if (r.confirmed_at) ev.push({ t: r.confirmed_at, s: 'LoadBoot confirmed ' + pkr(r.amount, cur) + ' received' }); if (r.rejected_at) ev.push({ t: r.rejected_at, s: 'Declared payment rejected' }); });
  (D.expenses || []).forEach(x => ev.push({ t: x.date, s: (x.reversed ? 'Reversed expense ' : 'Expense ') + pkr(x.amount, cur) + ' · ' + x.category + (x.vendor ? ' · ' + x.vendor : '') }));
  (D.payouts || []).forEach(x => { if (x.paid_date) ev.push({ t: x.paid_date, s: 'Paid out ' + pkr(x.total, cur) }); if (x.confirmed_at) ev.push({ t: x.confirmed_at, s: 'Investor confirmed payout received' }); });
  (D.flags || []).forEach(fl => ev.push({ t: fl.raised_at, s: 'Investor asked about ' + fl.kind + (fl.status === 'open' ? ' (open)' : ' (answered)') }));
  if (D.doc) { ev.push({ t: D.doc.published_at, s: 'Agreement document v' + D.doc.version + ' published' }); (D.doc.signatures || []).forEach(sg => ev.push({ t: sg.signed_at, s: (sg.party === 'investor' ? 'Investor' : 'LoadBoot') + ' signed v' + D.doc.version })); }
  ev.sort((x, y) => new Date(y.t) - new Date(x.t));
  if (!ev.length) return el('p', { style: 'opacity:.6' }, 'Nothing yet.');
  return el('div', { class: 'cc-inv-tl' }, ev.slice(0, 40).map(e => el('div', null, [e.s, el('small', null, e.t ? new Date(e.t).toLocaleString('en-GB') : '')])));
}
