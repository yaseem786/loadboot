// app.js — LoadBoot Investor Portal (bl_inv_0401).
//
// One private, unlisted, mobile-first page for the people who put money into
// LoadBoot. Everything on it is read straight from the ledger the Command Center
// writes, so the investor never has to ask "where did my money go" — and the
// owner never has to answer on WhatsApp. The investor can do exactly two things:
// declare a payment they have sent, and confirm a payout they have received.
// Both are the investor's half of a two-sided confirmation; nothing here can
// edit the ledger.
//
// Server side: inv_me / inv_my_requests / inv_declare_payment / inv_ledger /
// inv_statements / inv_confirm_payout — all self-scoping, all security definer.
import { getSession, signInWithPassword, signOut, onAuthChange, resetPassword } from '../shared/session.js';
import { el, mount } from '../shared/ui/dom.js';
import { invMe, invMyRequests, invDeclarePayment, invLedger, invStatements, invConfirmPayout } from '../shared/api.js';

const root = document.getElementById('lb-app');
const S = { me: null, agreements: [], agr: null, tab: 'home', ledger: null, requests: null, statements: null, busy: false };

// ---------- formatting (PKR uses lakh/crore grouping) ----------
const nfIN = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const nfIN2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n, cur) => (cur || (S.agr && S.agr.currency) || 'PKR') + ' ' + (Number(n || 0) % 1 ? nfIN2 : nfIN).format(Number(n || 0));
const pct = (n) => (Number(n || 0)).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtMonth = (d) => d ? new Date(d).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : '—';
const CAT = { office: 'Office', rent: 'Rent', salary: 'Salaries', equipment: 'Equipment', tools: 'Tools & subscriptions', legal: 'Legal & professional', relocation: 'Relocation', utilities: 'Utilities', marketing: 'Marketing', misc: 'Other' };
const catName = (c) => CAT[c] || (c ? c.charAt(0).toUpperCase() + c.slice(1) : 'Other');
const CAT_ICON = { office: '🏢', rent: '🏢', salary: '👤', equipment: '💻', tools: '🧰', legal: '⚖️', relocation: '🚚', utilities: '⚡', marketing: '📣', misc: '•' };
const pill = (text, tone) => el('span', { class: 'iv-pill ' + (tone || '') }, [el('i'), text]);
const err = (e) => (e && (e.message || String(e))) || 'Something went wrong';

// ---------- sheet (bottom drawer) ----------
function openSheet(title, body) {
  const bg = el('div', { class: 'iv-sheet-bg', onClick: (ev) => { if (ev.target === bg) close(); } });
  const sheet = el('div', { class: 'iv-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
    el('button', { class: 'close', 'aria-label': 'Close', onClick: () => close() }, '×'),
    el('h3', null, title), body,
  ]);
  bg.appendChild(sheet); document.body.appendChild(bg);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  function close() { document.removeEventListener('keydown', onKey); bg.remove(); }
  return close;
}
function field(label, input, hint) {
  return el('div', { class: 'iv-field' }, [el('label', { for: input.id }, label), input, hint ? el('span', { class: 'hint' }, hint) : null]);
}
const inp = (id, attrs) => el('input', Object.assign({ id, name: id }, attrs || {}));

// ---------- login ----------
function renderLogin(msg) {
  const email = inp('iv-email', { type: 'email', autocomplete: 'username', placeholder: 'you@example.com', required: true });
  const pass = inp('iv-pass', { type: 'password', autocomplete: 'current-password', placeholder: '••••••••', required: true });
  const note = el('div');
  if (msg) mount(note, el('div', { class: 'iv-err' }, msg));
  const btn = el('button', { class: 'iv-btn primary block', type: 'submit' }, 'Sign in');
  const form = el('form', { onSubmit: async (e) => {
    e.preventDefault(); btn.disabled = true; mount(note, '');
    try { await signInWithPassword(email.value.trim(), pass.value); await boot(); }
    catch (ex) { mount(note, el('div', { class: 'iv-err' }, err(ex))); btn.disabled = false; }
  } }, [
    note, field('Email', email), field('Password', pass), btn,
    el('div', { class: 'iv-actions', style: 'justify-content:center' }, [
      el('button', { class: 'iv-btn sm', type: 'button', onClick: async () => {
        if (!email.value.trim()) { mount(note, el('div', { class: 'iv-err' }, 'Enter your email first.')); return; }
        try { await resetPassword(email.value.trim()); mount(note, el('div', { class: 'iv-ok' }, 'Reset link sent — check your email.')); }
        catch (ex) { mount(note, el('div', { class: 'iv-err' }, err(ex))); }
      } }, 'Forgot password'),
    ]),
  ]);
  mount(root, el('div', { class: 'iv-login' }, el('div', { class: 'box' }, [
    el('div', { class: 'brand' }, [el('img', { src: '/logo-text-dark.png', alt: 'LoadBoot' }), el('div', null, 'Investor Portal')]),
    el('div', { class: 'iv-card' }, form),
    el('p', { class: 'iv-muted', style: 'text-align:center' }, 'Private access. If you were given a login by LoadBoot, use that email.'),
  ])));
  root.removeAttribute('aria-busy');
}

function renderNotLinked() {
  mount(root, el('div', { class: 'iv-login' }, el('div', { class: 'box' }, [
    el('div', { class: 'brand' }, [el('img', { src: '/logo-text-dark.png', alt: 'LoadBoot' }), el('div', null, 'Investor Portal')]),
    el('div', { class: 'iv-card' }, [
      el('h3', { style: 'margin:0 0 6px' }, 'This account is not linked to an investment yet'),
      el('p', { class: 'iv-muted' }, 'Aap ka login abhi kisi investment se juda nahi. LoadBoot ko batayein ke aap ne is email se sign in kiya hai — wo ise link kar denge.'),
      el('button', { class: 'iv-btn block', onClick: async () => { await signOut(); renderLogin(); } }, 'Sign out'),
    ]),
  ])));
  root.removeAttribute('aria-busy');
}

// ---------- shell + tabs ----------
const ICON = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z"/></svg>',
  requests: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  ledger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>',
  payments: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  statements: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></svg>',
};
const TABS = [['home', 'Home'], ['requests', 'Requests'], ['ledger', 'Kharcha'], ['payments', 'Payments'], ['statements', 'Statements']];
function svg(html) { const s = el('span'); s.innerHTML = html; return s.firstChild; }

function renderShell() {
  const pendingReq = (S.requests || []).filter(r => r.status === 'pending').length;
  const pane = el('div');
  mount(root, el('div', { class: 'iv-shell' }, [
    el('div', { class: 'iv-top' }, [
      el('img', { src: '/logo-text-dark.png', alt: 'LoadBoot' }),
      el('div', { class: 'iv-who' }, [el('b', null, S.me.name), el('span', null, 'Investor')]),
    ]),
    pane,
    el('nav', { class: 'iv-tabs', 'aria-label': 'Sections' }, TABS.map(([id, label]) =>
      el('button', { class: 'iv-tab' + (S.tab === id ? ' on' : ''), 'aria-current': S.tab === id ? 'page' : null, onClick: () => { S.tab = id; renderShell(); } }, [
        svg(ICON[id]), label, (id === 'requests' && pendingReq) ? el('i', { class: 'dot', 'aria-label': pendingReq + ' pending' }) : null,
      ]))),
  ]));
  root.removeAttribute('aria-busy');
  ({ home: renderHome, requests: renderRequests, ledger: renderLedger, payments: renderPayments, statements: renderStatements })[S.tab](pane);
}

function agrPicker() {
  if (S.agreements.length < 2) return null;
  const sel = el('select', { id: 'iv-agr', onChange: (e) => { S.agr = S.agreements.find(a => a.id === e.target.value); S.ledger = S.requests = S.statements = null; refresh(); } },
    S.agreements.map(a => el('option', { value: a.id, selected: a.id === S.agr.id }, a.title || ('Agreement ' + fmtDate(a.signed_date)))));
  return el('div', { class: 'iv-field' }, [el('label', { for: 'iv-agr' }, 'Agreement'), sel]);
}

// ---------- HOME ----------
const OPEN_LABEL = { share_type: '5% ka matlab — equity ya profit share?', profit_definition: 'Munafay ka formula', exit_treatment: 'Company bikne par kya hoga', early_stop_terms: 'Beech mein rukne par kya hoga', signed_document: 'Dastakhat shuda agreement' };
function kv(k, v, cls) { return el('div', null, [el('div', { class: 'k' }, k), el('div', { class: 'v ' + (cls || '') }, v)]); }

function renderHome(host) {
  const p = S.agr.position || {};
  const recovering = p.phase === 'recovering';
  const open = p.open_questions || [];
  mount(host, [
    agrPicker(),
    el('h1', { class: 'iv-h1' }, 'Aap ka investment'),
    el('p', { class: 'iv-sub' }, 'Live — jo yahan hai wohi ledger mein hai.'),
    el('div', { class: 'iv-card hero' }, [
      el('p', { class: 'iv-eyebrow' }, 'Diya hua · Funded'),
      el('div', { class: 'iv-big' }, [money(p.funded), el('small', null, 'of ' + money(p.commitment_cap))]),
      el('div', { class: 'iv-prog' }, [
        el('div', { class: 'row' }, [el('span', null, 'Commitment used'), el('b', null, pct(p.funded_pct))]),
        el('div', { class: 'bar' }, el('i', { style: 'width:' + Math.min(100, Number(p.funded_pct || 0)) + '%' })),
      ]),
      el('div', { class: 'iv-kv' }, [
        kv('Baqi commitment', money(p.unfunded)),
        kv('Fund mein bacha', money(p.fund_cash), Number(p.fund_cash) < 0 ? 'warn' : 'ok'),
        kv('Kharch hua', money(p.spent)),
        kv('Kul mila (aap ko)', money(p.total_paid_out)),
      ]),
    ]),
    el('div', { class: 'iv-card' }, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:10px' }, [
        el('p', { class: 'iv-eyebrow', style: 'margin:0' }, 'Wapsi · Recovery'),
        recovering ? pill('Recovering', 'blue') : pill('Recovered — permanent share', 'ok'),
      ]),
      el('div', { class: 'iv-prog' }, [
        el('div', { class: 'row' }, [el('span', null, money(p.recovered) + ' of ' + money(p.recovery_target)), el('b', null, pct(p.recovered_pct))]),
        el('div', { class: 'bar' }, el('i', { class: recovering ? '' : 'done', style: 'width:' + Math.min(100, Number(p.recovered_pct || 0)) + '%' })),
      ]),
      el('div', { class: 'iv-kv' }, [
        kv('Baqi wapsi', money(p.outstanding)),
        kv('Har mahine', recovering ? (pct(p.payback_rate_pct) + ' + ' + pct(p.permanent_share_pct)) : pct(p.permanent_share_pct)),
        kv('Apna hissa mila', money(p.share_paid)),
        kv(p.share_type === 'equity' ? 'Equity vested' : 'Share type',
           p.share_type === 'equity' ? pct(p.equity_vested_pct) : (p.share_type === 'profit_share' ? 'Profit share' : '— tay nahi')),
      ]),
      el('p', { class: 'iv-muted', style: 'margin:10px 0 0' }, recovering
        ? 'Jab tak aap ka paisa wapis na ho: munafay ka ' + pct(p.payback_rate_pct) + ' wapsi mein + ' + pct(p.permanent_share_pct) + ' aap ka hissa. Wapsi sirf munafay se — munafa nahi to us mahine adayegi nahi.'
        : 'Aap ka paisa poora wapis ho chuka. Ab munafay ka ' + pct(p.permanent_share_pct) + ' hamesha aap ka.'),
    ]),
    open.length ? el('div', { class: 'iv-open' }, [
      el('b', null, 'Abhi tay hona baqi hai'),
      el('ul', null, open.map(q => el('li', null, OPEN_LABEL[q] || q))),
    ]) : null,
    el('button', { class: 'iv-row', onClick: () => showAgreement() }, [
      el('div', { class: 'ic' }, '§'),
      el('div', null, [el('div', { class: 't' }, 'Agreement'), el('div', { class: 's' }, S.agr.signed_date ? 'Signed ' + fmtDate(S.agr.signed_date) : 'Draft — not yet signed')]),
      el('div', { class: 'amt' }, '›'),
    ]),
    el('div', { class: 'iv-actions', style: 'justify-content:center;margin-top:20px' }, [
      el('button', { class: 'iv-btn sm', onClick: async () => { await signOut(); renderLogin(); } }, 'Sign out'),
    ]),
  ]);
}

function showAgreement() {
  const a = S.agr, p = a.position || {};
  const row = (k, v) => [el('span', null, k), el('b', null, v || '— tay nahi')];
  openSheet('Agreement', el('div', null, [
    el('div', { class: 'iv-dl' }, [].concat(
      row('Commitment', money(p.commitment_cap)),
      row('Paisa kab', 'Zarurat par, qist qist (capital request)'),
      row('Wapsi target', Number(p.recovery_target) === Number(p.funded) ? 'Jitna asal mein diya' : money(p.recovery_target)),
      row('Wapsi ke dauran', pct(p.payback_rate_pct) + ' wapsi + ' + pct(p.permanent_share_pct) + ' hissa, munafay ka'),
      row('Wapsi ke baad', pct(p.permanent_share_pct) + ' hamesha'),
      row('Share ka matlab', p.share_type === 'equity' ? 'Equity (malkiyat)' : p.share_type === 'profit_share' ? 'Profit share (malkiyat nahi)' : null),
      row('Munafa =', a.profit_definition),
      row('Bikne par', a.exit_treatment),
      row('Ruk jaye to', a.early_stop_terms),
      row('Buyout', a.buyout_terms),
      row('Signed', a.signed_date ? fmtDate(a.signed_date) : null),
    )),
    a.doc_url ? el('a', { class: 'iv-btn block', href: a.doc_url, target: '_blank', rel: 'noopener' }, 'Open signed document') : null,
    el('p', { class: 'iv-muted' }, 'Ye shartein LoadBoot ne Command Center mein darj ki hain. Kuch ghalat lage to LoadBoot ko batayein — portal ka record hi asal record hai.'),
  ]));
}

// ---------- REQUESTS ----------
async function renderRequests(host) {
  mount(host, el('div', { class: 'iv-empty' }, 'Loading…'));
  try { S.requests = (await invMyRequests(S.agr.id)).requests || []; }
  catch (e) { mount(host, el('div', { class: 'iv-err' }, err(e))); return; }
  const pending = S.requests.filter(r => r.status === 'pending' || r.status === 'declared');
  const past = S.requests.filter(r => !pending.includes(r));
  const LABEL = { pending: 'Awaiting you', declared: 'Awaiting LoadBoot confirm', funded: 'Funded', declined: 'Declined', cancelled: 'Cancelled' };
  const rowFor = (r) => {
    const tone = r.status === 'funded' ? 'ok' : r.status === 'declared' ? 'wait' : r.status === 'pending' ? 'due' : '';
    return el('button', { class: 'iv-row', onClick: () => openRequest(r) }, [
      el('div', { class: 'ic' }, '#' + r.seq),
      el('div', null, [el('div', { class: 't' }, r.reason), el('div', { class: 's' }, [catName(r.category) + ' · ' + fmtDate(r.requested_at) + ' · ', pill(LABEL[r.status] || r.status, tone)])]),
      el('div', { class: 'amt' }, money(r.amount)),
    ]);
  };
  mount(host, [
    agrPicker(),
    el('h1', { class: 'iv-h1' }, 'Capital requests'),
    el('p', { class: 'iv-sub' }, 'LoadBoot ko jab paisa chahiye, request yahan aati hai. Bhej kar "Paid" mark karein — LoadBoot confirm karega.'),
    pending.length ? el('div', { class: 'iv-list' }, pending.map(rowFor)) : el('div', { class: 'iv-card' }, el('div', { class: 'iv-empty' }, 'Abhi koi request nahi. Sab shant hai.')),
    past.length ? el('div', { class: 'iv-sect' }, el('h2', null, 'Earlier')) : null,
    past.length ? el('div', { class: 'iv-list' }, past.map(rowFor)) : null,
  ]);
}

function openRequest(r) {
  let close;
  const body = el('div', null, [
    el('div', { class: 'iv-dl' }, [
      el('span', null, 'Amount'), el('b', null, money(r.amount)),
      el('span', null, 'For'), el('b', null, r.reason),
      el('span', null, 'Category'), el('b', null, catName(r.category)),
      el('span', null, 'Needed by'), el('b', null, fmtDate(r.needed_by)),
      el('span', null, 'Raised'), el('b', null, fmtDate(r.requested_at)),
      el('span', null, 'Funded so far'), el('b', null, money(r.funded)),
    ]),
    r.status === 'pending' ? el('button', { class: 'iv-btn primary block', onClick: () => { close(); declareForm(r); } }, 'Maine bhej diya — Mark as paid') : null,
    r.status === 'declared' ? el('div', { class: 'iv-ok' }, 'Aap ne bhej diya hai. LoadBoot ki confirm ka intezaar — confirm hote hi ye aap ki position mein aa jayega.') : null,
  ]);
  close = openSheet('Request #' + r.seq, body);
}

function declareForm(r) {
  let close;
  const amount = inp('iv-amt', { type: 'number', inputmode: 'decimal', min: '1', step: '0.01', value: r ? r.amount : '', required: true });
  const date = inp('iv-date', { type: 'date', value: new Date().toISOString().slice(0, 10), required: true });
  const method = el('select', { id: 'iv-method', name: 'iv-method' }, ['bank', 'easypaisa', 'jazzcash', 'cash', 'other'].map(m => el('option', { value: m }, m.charAt(0).toUpperCase() + m.slice(1))));
  const ref = inp('iv-ref', { type: 'text', placeholder: 'Transaction ID / last 4 digits' });
  const proof = inp('iv-proof', { type: 'url', placeholder: 'https://… (screenshot link, optional)' });
  const note = el('textarea', { id: 'iv-note', name: 'iv-note', rows: 2, placeholder: 'Optional' });
  const msg = el('div'); const btn = el('button', { class: 'iv-btn primary block', type: 'submit' }, 'Record my payment');
  const form = el('form', { onSubmit: async (e) => {
    e.preventDefault(); btn.disabled = true; mount(msg, '');
    try {
      const res = await invDeclarePayment({ agreement_id: S.agr.id, request_id: r ? r.id : null, amount: amount.value, received_date: date.value, method: method.value, reference: ref.value, proof_url: proof.value, note: note.value });
      mount(msg, el('div', { class: 'iv-ok' }, res.note || 'Recorded.')); btn.textContent = 'Done'; S.requests = S.ledger = null;
      setTimeout(() => { close(); refresh(); }, 900);
    } catch (ex) { mount(msg, el('div', { class: 'iv-err' }, err(ex))); btn.disabled = false; }
  } }, [
    msg,
    r ? el('p', { class: 'iv-muted' }, 'Request #' + r.seq + ' · ' + r.reason) : el('p', { class: 'iv-muted' }, 'Bina request ke paisa bheja? Yahan record karein.'),
    field('Amount', amount), field('Date sent', date), field('Method', method), field('Reference', ref),
    field('Proof link', proof, 'Screenshot kisi drive/link par ho to yahan daal dein.'), field('Note', note), btn,
    el('p', { class: 'iv-muted' }, 'Ye aap ki taraf se tasdeeq hai. LoadBoot apni taraf se confirm karega — dono ke baad ye pakka record ban jata hai.'),
  ]);
  close = openSheet(r ? 'Paid — request #' + r.seq : 'Record a payment', form);
}

// ---------- LEDGER (kharcha) ----------
async function renderLedger(host) {
  mount(host, el('div', { class: 'iv-empty' }, 'Loading…'));
  if (!S.ledger) { try { S.ledger = await invLedger(S.agr.id); } catch (e) { mount(host, el('div', { class: 'iv-err' }, err(e))); return; } }
  const L = S.ledger, p = L.position || {};
  const cats = Object.entries(L.by_category || {}).sort((a, b) => b[1] - a[1]);
  const max = cats.length ? Math.max(...cats.map(c => Number(c[1]))) : 1;
  const exp = L.expenses || [];
  const expSheet = (x) => openSheet(catName(x.category), el('div', null, [
    el('div', { class: 'iv-dl' }, [
      el('span', null, 'Amount'), el('b', null, money(x.amount)),
      el('span', null, 'Date'), el('b', null, fmtDate(x.date)),
      el('span', null, 'Vendor'), el('b', null, x.vendor || '—'),
      el('span', null, 'Details'), el('b', null, x.description || '—'),
      el('span', null, 'Paid from'), el('b', null, x.tranche ? 'Tranche of ' + fmtDate(x.tranche) : '—'),
      el('span', null, 'Recurring'), el('b', null, x.recurring ? 'Yes — monthly' : 'No'),
    ]),
    x.receipt_url ? el('a', { class: 'iv-btn block', href: x.receipt_url, target: '_blank', rel: 'noopener' }, 'View receipt') : el('p', { class: 'iv-muted' }, 'No receipt attached.'),
  ]));
  mount(host, [
    agrPicker(),
    el('h1', { class: 'iv-h1' }, 'Paisa kahan laga'),
    el('p', { class: 'iv-sub' }, 'Har kharcha, jis din hua — receipt ke sath.'),
    el('div', { class: 'iv-card hero' }, [
      el('p', { class: 'iv-eyebrow' }, 'Fund mein bacha hua'),
      el('div', { class: 'iv-big' }, money(p.fund_cash)),
      el('p', { class: 'iv-muted', style: 'margin:6px 0 0' }, money(p.funded) + ' aaya − ' + money(p.spent) + ' kharch hua'),
      cats.length ? el('div', { class: 'iv-cats' }, cats.map(([c, v]) => el('div', { class: 'iv-cat' }, [
        el('span', null, catName(c)), el('div', { class: 'bar' }, el('i', { style: 'width:' + Math.round(100 * Number(v) / max) + '%' })), el('b', null, money(v)),
      ]))) : null,
    ]),
    exp.length ? el('div', { class: 'iv-list' }, exp.map(x => el('button', { class: 'iv-row', onClick: () => expSheet(x) }, [
      el('div', { class: 'ic out' }, CAT_ICON[x.category] || '•'),
      el('div', null, [el('div', { class: 't' }, x.reversed ? 'Reversal · ' + catName(x.category) : (x.vendor || catName(x.category))), el('div', { class: 's' }, fmtDate(x.date) + (x.description ? ' · ' + x.description : ''))]),
      el('div', { class: 'amt ' + (x.reversed ? 'pos' : 'neg') }, [(x.reversed ? '+' : '−') + money(x.amount), x.receipt_url ? el('small', null, 'receipt ✓') : null]),
    ]))) : el('div', { class: 'iv-card' }, el('div', { class: 'iv-empty' }, 'Abhi koi kharcha darj nahi.')),
  ]);
}

// ---------- PAYMENTS (meri adayegiyan) ----------
async function renderPayments(host) {
  mount(host, el('div', { class: 'iv-empty' }, 'Loading…'));
  if (!S.ledger) { try { S.ledger = await invLedger(S.agr.id); } catch (e) { mount(host, el('div', { class: 'iv-err' }, err(e))); return; } }
  const rc = S.ledger.receipts || [];
  const sheet = (r) => openSheet('Payment', el('div', { class: 'iv-dl' }, [
    el('span', null, 'Amount'), el('b', null, money(r.amount)),
    el('span', null, 'Date'), el('b', null, fmtDate(r.received_date)),
    el('span', null, 'Method'), el('b', null, r.method || '—'),
    el('span', null, 'Reference'), el('b', null, r.reference || '—'),
    el('span', null, 'You declared'), el('b', null, r.declared_at ? fmtDate(r.declared_at) : '—'),
    el('span', null, 'LoadBoot confirmed'), el('b', null, r.confirmed_at ? fmtDate(r.confirmed_at) : 'Not yet'),
    el('span', null, 'Note'), el('b', null, r.note || '—'),
    el('span', null, 'Proof'), r.proof_url ? el('a', { href: r.proof_url, target: '_blank', rel: 'noopener' }, 'Open') : el('b', null, '—'),
  ]));
  mount(host, [
    agrPicker(),
    el('h1', { class: 'iv-h1' }, 'Meri adayegiyan'),
    el('p', { class: 'iv-sub' }, 'Har paisa jo aap ne diya — tareekh, tareeqa, saboot.'),
    el('button', { class: 'iv-btn block', onClick: () => declareForm(null) }, '+ Record a payment'),
    el('div', { style: 'height:12px' }),
    rc.length ? el('div', { class: 'iv-list' }, rc.map(r => {
      const neg = Number(r.amount) < 0;
      const tone = r.state === 'confirmed' ? 'ok' : r.state === 'reversal' ? 'due' : 'wait';
      const label = r.state === 'confirmed' ? 'Confirmed' : r.state === 'reversal' ? 'Reversal' : 'Awaiting confirm';
      return el('button', { class: 'iv-row', onClick: () => sheet(r) }, [
        el('div', { class: 'ic ' + (neg ? 'out' : 'in') }, neg ? '↩' : '↑'),
        el('div', null, [el('div', { class: 't' }, fmtDate(r.received_date) + (r.method ? ' · ' + r.method : '')), el('div', { class: 's' }, [r.reference ? r.reference + ' · ' : '', pill(label, tone)])]),
        el('div', { class: 'amt ' + (neg ? 'neg' : 'pos') }, money(r.amount)),
      ]);
    })) : el('div', { class: 'iv-card' }, el('div', { class: 'iv-empty' }, 'Abhi koi adayegi darj nahi.')),
  ]);
}

// ---------- STATEMENTS ----------
async function renderStatements(host) {
  mount(host, el('div', { class: 'iv-empty' }, 'Loading…'));
  if (!S.statements) { try { S.statements = (await invStatements(S.agr.id)).statements || []; } catch (e) { mount(host, el('div', { class: 'iv-err' }, err(e))); return; } }
  const st = S.statements;
  const payouts = (S.ledger && S.ledger.payouts) || [];
  const payoutId = (s) => { const m = payouts.find(x => x.month === s.month); return m ? m.id : null; };
  const sheet = (s) => {
    const po = s.payout;
    openSheet(fmtMonth(s.month), el('div', null, [
      el('div', { class: 'iv-dl' }, [
        el('span', null, 'Revenue'), el('b', null, money(s.revenue)),
        el('span', null, 'Expenses'), el('b', null, money(s.expenses)),
        el('span', null, 'Profit'), el('b', { style: 'color:var(--iv-green)' }, money(s.profit)),
        el('span', null, 'Wapsi'), el('b', null, po ? money(po.payback) : '—'),
        el('span', null, 'Hissa'), el('b', null, po ? money(po.share) : '—'),
        el('span', null, 'Total to you'), el('b', null, po ? money(po.total) : '—'),
        el('span', null, 'Paid on'), el('b', null, po && po.paid_date ? fmtDate(po.paid_date) : 'Not yet'),
        el('span', null, 'Note'), el('b', null, s.note || '—'),
      ]),
      (po && po.status === 'paid' && !po.confirmed_at) ? el('button', { class: 'iv-btn primary block', onClick: async (ev) => {
        ev.target.disabled = true;
        try {
          if (!S.ledger) S.ledger = await invLedger(S.agr.id);
          const id = payoutId(s) || ((S.ledger.payouts || []).find(x => x.month === s.month) || {}).id;
          await invConfirmPayout(id); S.statements = S.ledger = null; refresh();
        } catch (ex) { alert(err(ex)); ev.target.disabled = false; }
      } }, 'Haan, mujhe mil gaya — Confirm') : null,
    ]));
  };
  mount(host, [
    agrPicker(),
    el('h1', { class: 'iv-h1' }, 'Mahana hisaab'),
    el('p', { class: 'iv-sub' }, 'Har mahine ka munafa aur us mein aap ka hissa.'),
    st.length ? el('div', { class: 'iv-list' }, st.map(s => {
      const po = s.payout;
      const tone = !po ? '' : po.status === 'paid' ? (po.confirmed_at ? 'ok' : 'wait') : 'blue';
      const label = !po ? 'No share' : po.status === 'paid' ? (po.confirmed_at ? 'Received ✓' : 'Paid — confirm?') : 'Due';
      return el('button', { class: 'iv-row', onClick: () => sheet(s) }, [
        el('div', { class: 'ic' }, new Date(s.month).toLocaleDateString('en-GB', { month: 'short' })),
        el('div', null, [el('div', { class: 't' }, fmtMonth(s.month)), el('div', { class: 's' }, ['Profit ' + money(s.profit) + ' · ', pill(label, tone)])]),
        el('div', { class: 'amt pos' }, po ? money(po.total) : '—'),
      ]);
    })) : el('div', { class: 'iv-card' }, el('div', { class: 'iv-empty' }, 'Pehla mahana hisaab abhi publish nahi hua.')),
  ]);
}

// ---------- boot ----------
async function refresh() {
  try {
    const me = await invMe();
    if (!me || me.ok === false) { renderNotLinked(); return; }
    S.me = me.investor; S.agreements = me.agreements || [];
    if (!S.agreements.length) { renderNotLinked(); return; }
    S.agr = S.agreements.find(a => S.agr && a.id === S.agr.id) || S.agreements[0];
    if (!S.requests) { try { S.requests = (await invMyRequests(S.agr.id)).requests || []; } catch (_) { S.requests = []; } }
    renderShell();
  } catch (e) { renderLogin(err(e)); }
}
async function boot() {
  const s = await getSession();
  if (!s) { renderLogin(); return; }
  await refresh();
}
onAuthChange((ev) => { if (ev === 'SIGNED_OUT') renderLogin(); });
boot();
