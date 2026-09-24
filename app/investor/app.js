// app.js — LoadBoot Investor Portal v2 (bl_inv_0401 + 0402).
//
// One private, unlisted, mobile-first page for the people who put money into
// LoadBoot. Everything here is read from the ledger the Command Center writes.
// The investor can do four things and nothing else: declare a payment they sent,
// confirm a payout they received, raise a question on any entry, and pick their
// language. Every one of those is a record, not an edit — the ledger itself is
// never touched from here.
//
// v2: three languages (en / Roman Urdu / Urdu RTL), two-factor sign-in gate and
// enrollment, skeleton loading, SVG icons, questions ("flags") on entries, CSV
// export, and honest screens for the situations that happen: commitment closed
// early, agreement wound down, month with no profit, rejected payment.
import { getSession, signInWithPassword, signUp, signOut, onAuthChange, resetPassword,
         mfaVerify, mfaListFactors, mfaEnrollTotp, mfaEnrollPhone, mfaChallenge, mfaVerifyChallenge, mfaRequiredAny } from '../shared/session.js';
import { el, mount } from '../shared/ui/dom.js';
import { invMe, invClaimByEmail, invSelfOnboard, invPublishSelfDoc, invMyRequests, invDeclarePayment, invLedger, invStatements, invConfirmPayout,
         invSetLang, invFlag, invMyFlags, invSettings, invCurrentDoc, invSignDoc, invGrowth, invProjection,
         invUploadProof, invProofUrl, invProposeAmendment, invWithdrawAmendment, invMyAmendments, invAckExpense,
         invNotifications, invMarkRead, invUpdates, invAudit } from '../shared/api.js';
import { mdToHtml, buildFromParams, buildAgreement, DEFAULT_EXTRA } from './agreement-template.js';
import { t, setLang, getLang, LANGS } from './i18n.js';
import { vendorWhat, catWhat, termWhat, impactWhat, TERMS, CATEGORIES, VENDORS } from './glossary.js';
const TAGLINE = 'The Operating System for Trucking';
// SMS second factor is OFF until an SMS provider is wired into Supabase Auth (Telnyx via the
// "Send SMS" auth hook is possible). Authenticator app is the default and needs nothing.
const SMS_2FA_ENABLED = false;
// Public places LoadBoot lives. Facebook / Capterra come from CC → Settings → Links (not invented).
const PUBLIC_LINKS = { site: 'https://loadboot.com', play: 'https://play.google.com/store/apps/details?id=com.loadboot.app', linkedin: 'https://www.linkedin.com/company/135138228/', trustpilot: 'https://www.trustpilot.com/review/loadboot.com' };

const root = document.getElementById('lb-app');
const S = { me: null, agreements: [], agr: null, tab: 'home', ledger: null, requests: null, statements: null, flags: null, settings: null, growth: null, proj: null, doc: null };

// ---------- formatting (PKR uses lakh/crore grouping) ----------
const nfIN = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const nfIN2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n, cur) => (cur || (S.agr && S.agr.currency) || 'PKR') + ' ' + (Number(n || 0) % 1 ? nfIN2 : nfIN).format(Number(n || 0));
function usdLine(n) {
  const fx = S.settings && S.settings.fx; if (!fx || !Number(fx.pkr_per_usd) || (S.agr && S.agr.currency !== 'PKR')) return null;
  return el('span', { class: 'iv-usd' }, '≈ USD ' + Number(Number(n || 0) / Number(fx.pkr_per_usd)).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' · ' + t('usd_hint', fx.pkr_per_usd, fx.as_of || ''));
}
async function proofLink(ref, label) {
  if (!ref) return null;
  const a = el('a', { class: 'iv-btn block', href: '#', target: '_blank', rel: 'noopener' }, label);
  a.onclick = async (e) => { e.preventDefault(); try { const u = await invProofUrl(ref); window.open(u, '_blank', 'noopener'); } catch (ex) { alert(err(ex)); } };
  return a;
}
const pct = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : t('none');
const fmtMonth = (d) => d ? new Date(d).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : t('none');
const CAT = { office: 'Office', rent: 'Rent', salary: 'Salaries', equipment: 'Equipment', tools: 'Tools & subscriptions', legal: 'Legal & professional', relocation: 'Relocation', utilities: 'Utilities', marketing: 'Marketing', misc: 'Other' };
const catName = (c) => CAT[c] || (c ? c.charAt(0).toUpperCase() + c.slice(1) : 'Other');
const pill = (text, tone) => el('span', { class: 'iv-pill ' + (tone || '') }, [el('i'), text]);
const err = (e) => (e && (e.message || String(e))) || t('err_generic');

// ---------- icons (inline SVG, stroke = currentColor) ----------
const P = {
  plan: 'M4 4h16v16H4zM8 9h8M8 13h6M8 17h4',
  agreement: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 15l2 2 4-4',
  home: 'M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z',
  requests: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  ledger: 'M2 7h20v12H2zM2 11h20M6 15h4',
  payments: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  statements: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8',
  doc: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  office: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6', rent: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6',
  salary: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  equipment: 'M2 4h20v12H2zM8 20h8M12 16v4', tools: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-7 7a2.1 2.1 0 0 1-3-3l7-7a6 6 0 0 1 7.9-7.9z',
  legal: 'M12 3v18M5 7l7-4 7 4M3 12l2-5 2 5a2 2 0 0 1-4 0zM17 12l2-5 2 5a2 2 0 0 1-4 0z',
  relocation: 'M1 3h15v13H1zM16 8h4l3 3v5h-7zM5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  utilities: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z', marketing: 'M3 11l18-5v12L3 13v-2zM11.6 16.8a3 3 0 1 1-5.8-1.6',
  misc: 'M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0M19 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0M5 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
  arrowUp: 'M12 19V5M5 12l7-7 7 7', arrowBack: 'M9 14l-4-4 4-4M5 10h11a4 4 0 0 1 0 8h-1',
  x: 'M18 6L6 18M6 6l12 12', shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', check: 'M20 6L9 17l-5-5',
  flag: 'M4 22V4a2 2 0 0 1 2-2h12l-3 5 3 5H6', alert: 'M12 9v4M12 17h.01M10.3 3.9l-8.5 14.7A2 2 0 0 0 3.5 21.5h17a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3', inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13l3.5 7v7H2v-7z',
};
function icon(name, cls) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', cls || 'iv-ic'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', P[name] || P.misc); s.appendChild(p);
  return s;
}
const catIcon = (c) => icon(P[c] ? c : 'misc');

// ---------- sheet (bottom drawer) ----------
function openSheet(title, body) {
  const bg = el('div', { class: 'iv-sheet-bg', onClick: (ev) => { if (ev.target === bg) close(); } });
  const sheet = el('div', { class: 'iv-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
    el('button', { class: 'close', 'aria-label': t('close'), onClick: () => close() }, '×'),
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
const trFrom = (r) => { const x = (r && r.transfer) || {}; return [x.sender_name, x.sender_bank, x.sender_account, x.country].filter(Boolean).join(' · ') || null; };
const trInto = (r) => ((r && r.transfer) || {}).received_into || null;
const dl = (pairs) => el('div', { class: 'iv-dl' }, pairs.flatMap(([k, v]) => [el('span', null, k), (v && v.nodeType) ? v : el('b', null, v == null || v === '' ? t('none') : v)]));
const empty = (msg, ic) => el('div', { class: 'iv-card' }, el('div', { class: 'iv-empty' }, [icon(ic || 'inbox', ''), msg]));
function skeleton() {
  const line = (w) => el('div', { class: 'iv-sk', style: 'width:' + w + '%;height:14px' });
  return el('div', null, [
    el('div', { class: 'iv-sk', style: 'height:28px;width:55%;margin:12px 0 8px' }), line(80),
    el('div', { class: 'iv-card hero iv-sk-card', style: 'margin-top:16px' }, [line(30), el('div', { class: 'iv-sk', style: 'height:38px;width:70%' }), line(100), line(60)]),
    el('div', { class: 'iv-card iv-sk-card' }, [line(40), line(100), line(90), line(70)]),
  ]);
}
function langSwitch() {
  return el('select', { class: 'iv-select', id: 'iv-lang', 'aria-label': t('sel_lang'), title: t('sel_lang'), onChange: async (e) => {
    const code = e.target.value; setLang(code); try { localStorage.setItem('lb-inv-lang', code); } catch (_) {}
    if (S.me) { try { await invSetLang(code); } catch (_) {} renderShell(); } else renderLogin();
  } }, LANGS.map(([code, label]) => el('option', { value: code, selected: code === getLang() }, label)));
}

// ---------- login + 2FA ----------
function loginFrame(inner) {
  mount(root, el('div', { class: 'iv-login' }, el('div', { class: 'box' }, [
    el('div', { class: 'brand' }, [el('img', { src: '/logo-full-dark.png', alt: 'LoadBoot' }), el('div', { class: 'iv-tagline' }, TAGLINE), el('div', null, 'Investor Portal')]),
    el('div', { style: 'display:flex;justify-content:center;margin-bottom:14px' }, langSwitch()),
    el('div', { class: 'iv-card' }, inner),
    el('p', { class: 'iv-muted', style: 'text-align:center;display:flex;gap:6px;justify-content:center;align-items:center' }, [icon('shield'), t('lg_secure')]),
  ])));
  root.removeAttribute('aria-busy');
}
function renderLogin(msg) {
  const email = inp('iv-email', { type: 'email', autocomplete: 'username', placeholder: 'you@example.com', required: true });
  const pass = inp('iv-pass', { type: 'password', autocomplete: 'current-password', placeholder: '••••••••', required: true });
  const note = el('div'); if (msg) mount(note, el('div', { class: 'iv-err' }, msg));
  const btn = el('button', { class: 'iv-btn primary block', type: 'submit' }, t('lg_sign_in'));
  loginFrame(el('form', { onSubmit: async (e) => {
    e.preventDefault(); btn.disabled = true; mount(note, '');
    try { await signInWithPassword(email.value.trim(), pass.value); await boot(); }
    catch (ex) { mount(note, el('div', { class: 'iv-err' }, err(ex))); btn.disabled = false; }
  } }, [
    note, field(t('lg_email'), email), field(t('lg_password'), pass), btn,
    el('div', { class: 'iv-actions', style: 'justify-content:center' }, [
      el('button', { class: 'iv-btn sm', type: 'button', onClick: async () => {
        if (!email.value.trim()) { mount(note, el('div', { class: 'iv-err' }, t('lg_enter_email'))); return; }
        try { await resetPassword(email.value.trim()); mount(note, el('div', { class: 'iv-ok' }, t('lg_reset_sent'))); }
        catch (ex) { mount(note, el('div', { class: 'iv-err' }, err(ex))); }
      } }, t('lg_forgot')),
    ]),
    el('p', { class: 'iv-muted', style: 'margin:12px 0 0;text-align:center' }, t('lg_private')),
    el('div', { class: 'iv-switch' }, [t('su_have_no'), ' ', el('a', { href: '#signup', onClick: (e) => { e.preventDefault(); renderSignup(); } }, t('su_create'))]),
  ]));
}
// ---------- investor's own sign-up page (0409): role='investor' → no carrier org, auto-linked to the CC record by e-mail ----------
function renderSignup(msg) {
  const name = inp('iv-su-name', { type: 'text', autocomplete: 'name', placeholder: 'Hamza Ali', required: true });
  const email = inp('iv-su-email', { type: 'email', autocomplete: 'username', placeholder: 'you@example.com', required: true });
  const pass = inp('iv-su-pass', { type: 'password', autocomplete: 'new-password', placeholder: '••••••••', required: true, minlength: 8 });
  const pass2 = inp('iv-su-pass2', { type: 'password', autocomplete: 'new-password', placeholder: '••••••••', required: true });
  const note = el('div'); if (msg) mount(note, el('div', { class: 'iv-err' }, msg));
  const btn = el('button', { class: 'iv-btn primary block', type: 'submit' }, t('su_btn'));
  loginFrame(el('form', { onSubmit: async (e) => {
    e.preventDefault(); mount(note, '');
    if (pass.value.length < 8) { mount(note, el('div', { class: 'iv-err' }, t('su_short'))); return; }
    if (pass.value !== pass2.value) { mount(note, el('div', { class: 'iv-err' }, t('su_mismatch'))); return; }
    btn.disabled = true;
    try {
      S.signupName = name.value.trim();
      const { data, error } = await signUp(email.value.trim(), pass.value, { name: name.value.trim(), role: 'investor', redirectTo: location.origin + '/app/investor/' });
      if (error) throw error;
      if (data && data.session) { await boot(); return; }
      // Supabase answers an already-registered e-mail with a user that has NO identities (and sends nothing)
      if (data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        mount(note, el('div', { class: 'iv-warn' }, [t('su_exists'), ' ', el('a', { href: '#', onClick: (ev) => { ev.preventDefault(); renderLogin(); } }, t('lg_sign_in'))])); btn.disabled = false; return;
      }
      mount(note, el('div', { class: 'iv-ok' }, t('su_check_mail')));
    } catch (ex) { mount(note, el('div', { class: 'iv-err' }, err(ex))); btn.disabled = false; }
  } }, [
    el('div', { class: 'iv-su-head' }, [el('b', null, t('su_title')), el('p', { class: 'iv-muted', style: 'margin:4px 0 0' }, t('su_sub'))]),
    note, field(t('su_name'), name), field(t('lg_email'), email), field(t('lg_password'), pass), field(t('su_pass2'), pass2), btn,
    el('div', { class: 'iv-switch' }, [t('su_have'), ' ', el('a', { href: '#', onClick: (e) => { e.preventDefault(); renderLogin(); } }, t('lg_sign_in'))]),
  ]));
}
function renderMfaGate(factor) {
  const factorId = factor.id; let challengeId = null;
  const code = inp('iv-otp', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, pattern: '[0-9]{6}', required: true, placeholder: '000000', style: 'letter-spacing:.3em;font-size:1.3rem;text-align:center' });
  const note = el('div'); const btn = el('button', { class: 'iv-btn primary block', type: 'submit' }, t('sec_verify'));
  loginFrame(el('form', { onSubmit: async (e) => {
    e.preventDefault(); btn.disabled = true; mount(note, '');
    try { if (factor.type === 'phone') await mfaVerifyChallenge(factorId, challengeId, code.value); else await mfaVerify(factorId, code.value); await refresh(); }
    catch (ex) { mount(note, el('div', { class: 'iv-err' }, err(ex))); btn.disabled = false; }
  } }, [
    el('h3', { style: 'margin:0 0 4px' }, t('sec_gate_t')), el('p', { class: 'iv-muted' }, factor.type === 'phone' ? t('sec_phone_s') : t('sec_gate_s')),
    note, field(t('sec_code'), code), btn,
    el('div', { class: 'iv-actions', style: 'justify-content:center' }, el('button', { class: 'iv-btn sm', type: 'button', onClick: async () => { await signOut(); renderLogin(); } }, t('sign_out'))),
  ]));
  setTimeout(() => code.focus(), 50);
  if (factor.type === 'phone') mfaChallenge(factorId).then(c => { challengeId = c.id; }).catch(ex => mount(note, el('div', { class: 'iv-err' }, err(ex))));
}
function renderNotLinked() {
  loginFrame(el('div', null, [
    el('h3', { style: 'margin:0 0 6px' }, t('nl_title')),
    el('p', { class: 'iv-muted' }, t('nl_body')),
    el('button', { class: 'iv-btn block', onClick: async () => { await signOut(); renderLogin(); } }, t('sign_out')),
  ]));
}

// ---------- shell + tabs ----------
// SIMPLE mode (Yaseen, 23 Sep): the portal's one job is a provable record — what came in, where it went,
// why, with proof. Everything else (plan, projections, growth, links) stays in the code but off the screen.
const SIMPLE = true;
const TABS = SIMPLE ? ['home', 'ledger', 'payments', 'agreement'] : ['home', 'plan', 'requests', 'ledger', 'payments', 'statements'];
function renderShell() {
  const pendingReq = (S.requests || []).filter(r => r.status === 'pending').length;
  const initials = (S.me.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const pane = el('div');
  mount(root, el('div', { class: 'iv-shell' }, [
    el('div', { class: 'iv-top' }, [
      el('div', { class: 'iv-brand' }, [el('img', { src: '/logo-full-dark.png', alt: 'LoadBoot' }), el('div', { class: 'iv-tagline' }, TAGLINE)]),
      el('div', { class: 'iv-topright' }, [langSwitch(), bellBtn(), el('button', { class: 'iv-avatar', style: 'border:0;cursor:pointer', title: S.me.name, 'aria-label': t('sec_title'), onClick: () => showSecurity() }, initials)]),
    ]),
    pane,
    el('nav', { class: 'iv-tabs', 'aria-label': 'Sections' }, TABS.map(id =>
      el('button', { class: 'iv-tab' + (S.tab === id ? ' on' : ''), 'aria-current': S.tab === id ? 'page' : null, onClick: () => { S.tab = id; renderShell(); } }, [
        icon(id, ''), (SIMPLE && id === 'home') ? t('nav_record') : t('nav_' + id), ((id === 'requests' || (SIMPLE && id === 'home')) && pendingReq) ? el('i', { class: 'dot', 'aria-label': pendingReq + ' pending' }) : null,
      ]))),
  ]));
  root.removeAttribute('aria-busy');
  ({ home: SIMPLE ? renderRecord : renderHome, plan: renderPlan, requests: renderRequests, ledger: renderLedger, payments: renderPayments, statements: renderStatements, agreement: renderAgreementTab })[S.tab](pane);
}
function agrPicker() {
  if (S.agreements.length < 2) return null;
  const sel = el('select', { id: 'iv-agr', onChange: (e) => { S.agr = S.agreements.find(a => a.id === e.target.value); S.ledger = S.requests = S.statements = S.flags = null; refresh(); } },
    S.agreements.map(a => el('option', { value: a.id, selected: a.id === S.agr.id }, a.title || (t('h_agreement') + ' ' + fmtDate(a.signed_date)))));
  return el('div', { class: 'iv-field' }, [el('label', { for: 'iv-agr' }, t('h_agreement')), sel]);
}
function stateBanner(p) {
  const a = S.agr, w = a.wind_down || {};
  if (p.phase === 'wound_down') return el('div', { class: 'iv-banner wound' }, [icon('alert'), el('span', null, t('h_note_wound', fmtDate(w.at), money(w.return_amount), money(w.spent_and_lost), w.reason || t('none')))]);
  if (p.commitment_closed) return el('div', { class: 'iv-banner stop' }, [icon('alert'), el('span', null, t('h_note_stopped', money(p.commitment_cap), pct(p.effective_share_pct), p.closed_reason || t('none')))]);
  if (p.phase === 'permanent_share' && Number(p.recovered) > 0) return el('div', { class: 'iv-banner done' }, [icon('check'), el('span', null, t('h_note_recovered', pct(p.effective_share_pct)))]);
  return null;
}
const kv = (k, v, cls, term) => el('div', term ? { class: 'has-q', title: termShort(term) || null, onClick: () => showTerm(term) } : null, [el('div', { class: 'k' }, term ? [k, ' ', qBtn(term)] : k), el('div', { class: 'v ' + (cls || '') }, v)]);
const qBtn = (term, cat) => el('button', { class: 'iv-q', type: 'button', 'aria-label': t('gl_what'), 'data-tip': cat ? null : (termShort(term) || null), onClick: (e) => { e.stopPropagation(); e.preventDefault(); cat ? openSheet(t('gl_what'), el('p', { class: 'iv-gl-p' }, catWhat(cat, getLang()))) : showTerm(term); } }, '?');
const DONUT = ['#0883F7', '#2ED18A', '#F5B942', '#FC5305', '#A78BFA', '#38BDF8', '#F472B6', '#94A3B8', '#FB923C', '#4ADE80'];
function donut(cats, total) {
  let acc = 0; const stops = cats.map(([c, v], i) => { const a = acc; acc += 100 * Number(v) / Math.max(1, Number(total)); return DONUT[i % DONUT.length] + ' ' + a.toFixed(1) + '% ' + acc.toFixed(1) + '%'; });
  return el('div', { class: 'iv-donut', style: 'background:conic-gradient(' + stops.join(',') + (acc < 100 ? ',rgba(255,255,255,.06) ' + acc.toFixed(1) + '% 100%' : '') + ')' }, el('div', null, [el('b', null, money(total)), el('span', null, t('h_spent'))]));
}
// ---------- premium "what is this?" explainer (v5.4) ----------
// Every "?" opens this: plain meaning + "aap ke case mein" with the REAL numbers + a small visual.
const L3 = (en, ur_roman, ur) => { const l = getLang(); return l === 'ur_roman' ? ur_roman : l === 'ur' ? ur : en; };
const TERM_TITLE = {
  commitment: () => L3('Commitment', 'Commitment (wada)', 'کمٹمنٹ'),
  funded: () => L3('Given so far', 'Ab tak diya', 'اب تک دیا'),
  fund_cash: () => L3('Still with LoadBoot', 'Abhi LoadBoot ke paas', 'ابھی لوڈ بوٹ کے پاس'),
  spent: () => L3('Spent', 'Kharch hua', 'خرچ ہوا'),
  to_give: () => L3('Still to give', 'Abhi dena baqi', 'ابھی دینا باقی'),
  share: () => L3('Each month: your %', 'Har mahine: aap ka hissa', 'ہر مہینے: آپ کا حصہ'),
  recovery: () => L3('Recovery of your money', 'Aap ke paise ki wapsi', 'آپ کے پیسے کی واپسی'),
  outstanding: () => L3('Still to recover', 'Baqi wapsi', 'باقی واپسی'),
  share_type: () => L3('Share type', 'Hisse ki qisam', 'حصے کی قسم'),
  payout: () => L3('Payout', 'Payout (adayegi)', 'پے آؤٹ'),
  profit: () => L3('Profit', 'Munafa', 'منافع'),
  statement: () => L3('Monthly statement', 'Mahine ka hisaab', 'ماہانہ حساب'),
  request: () => L3('Capital request', 'Paise ki darkhwast', 'پیسے کی درخواست'),
  no_profit: () => L3('No-profit month', 'Jis mahine munafa na ho', 'بغیر منافع کا مہینہ'),
};
const TERM_SHORT = { // one-line hover tooltip
  commitment: () => L3('Max you agreed to put in', 'Zyada se zyada jitna dene ka wada', 'زیادہ سے زیادہ جتنا دینے کا وعدہ'),
  funded: () => L3('Received and confirmed by LoadBoot', 'Jo mila aur LoadBoot ne confirm kiya', 'جو ملا اور تصدیق ہوئی'),
  fund_cash: () => L3('Your money not yet spent', 'Aap ka paisa jo abhi kharch nahi hua', 'آپ کا پیسہ جو ابھی خرچ نہیں ہوا'),
  spent: () => L3('Used from your money — each has a receipt', 'Aap ke paise se istemal hua — har ek ki raseed hai', 'آپ کے پیسے سے استعمال ہوا'),
  to_give: () => L3('Commitment minus given', 'Commitment mein se jo abhi nahi diya', 'کمٹمنٹ میں سے جو ابھی نہیں دیا'),
  share: () => L3('Your % of each month\'s profit', 'Har mahine ke munafay mein aap ka %', 'ہر مہینے کے منافع میں آپ کا %'),
  recovery: () => L3('Profit share paid back until your money returns', 'Munafay se aap ka paisa wapas hone tak', 'منافع سے آپ کا پیسہ واپس ہونے تک'),
  outstanding: () => L3('How much of your money is still to come back', 'Aap ka kitna paisa abhi wapas aana baqi hai', 'کتنا پیسہ ابھی واپس آنا باقی ہے'),
  share_type: () => L3('Profit share (not ownership) or equity', 'Munafay mein hissa (malkiyat nahi) ya equity', 'منافع میں حصہ یا ایکویٹی'),
  payout: () => L3('Money LoadBoot paid you', 'Jo paisa LoadBoot ne aap ko diya', 'جو پیسہ لوڈ بوٹ نے آپ کو دیا'),
  profit: () => L3('Collected minus expenses in a month', 'Mahine ki aamdani minus kharcha', 'مہینے کی آمدنی منفی خرچہ'),
  statement: () => L3('Monthly profit sheet your payout comes from', 'Mahine ka hisaab jis se payout nikalta hai', 'ماہانہ حساب جس سے پے آؤٹ بنتا ہے'),
  request: () => L3('LoadBoot asks for an amount for a purpose', 'LoadBoot ek raqam ek kaam ke liye maangta hai', 'ایک رقم ایک مقصد کے لیے'),
  no_profit: () => L3('Nothing owed that month', 'Us mahine kuch nahi banta', 'اس مہینے کچھ واجب نہیں'),
};
const termShort = (k) => TERM_SHORT[k] ? TERM_SHORT[k]() : '';
const exRow = (label, val, cls) => el('div', { class: 'iv-ex-row' }, [el('span', null, label), el('b', { class: cls || '' }, val)]);
const exBar = (parts) => el('div', { class: 'iv-ex-bar' }, parts.filter(x => x.w > 0).map(x => el('div', { class: 'seg ' + x.cls, style: 'width:' + x.w + '%' }, x.w >= 12 ? x.label : '')));
const chip = (txt, cls) => el('span', { class: 'iv-chip ' + (cls || '') }, txt);
const exSec = (title, kids) => el('div', { class: 'iv-ex-sec' }, [el('div', { class: 'iv-ex-h' }, title), ...kids]);
function explainBody(term) {
  const p = S.pos || {}, lang = getLang();
  const cap = Number(p.commitment_cap || 0), funded = Number(p.funded || 0), spent = Number(p.spent || 0), fund = Number(p.fund_cash || 0);
  const toGive = Math.max(0, cap - funded), rate = Number(p.payback_rate_pct || 0), share = Number(p.effective_share_pct || 0);
  const target = Number(p.recovery_target || funded), rec = Number(p.recovered || 0), out = Number(p.outstanding || 0);
  const recovering = p.phase === 'recovering' || out > 0;
  const pc = (n, d) => d ? Math.max(0, Math.min(100, 100 * n / d)) : 0;
  const yours = L3('In your case', 'Aap ke case mein', 'آپ کے کیس میں'), ex = L3('Example', 'Misal', 'مثال');
  const base = term === 'to_give' ? 'commitment' : term === 'outstanding' ? 'recovery' : term === 'share_type' ? 'share' : term;
  const out_ = [el('p', { class: 'iv-ex-mean' }, termWhat(base, lang))];
  if (['commitment', 'funded', 'fund_cash', 'spent', 'to_give'].includes(term)) {
    const note = term === 'commitment' ? L3('You are never obliged to pay the remaining amount — each request can be declined, and you can change or stop the commitment from the Agreement tab.', 'Baqi raqam dena aap par lazim nahi — har darkhwast par mana kar sakte hain, aur Agreement tab se commitment barha, ghata ya rok sakte hain.', 'باقی رقم دینا لازم نہیں — ہر درخواست پر منع کر سکتے ہیں، اور ایگریمنٹ ٹیب سے کمٹمنٹ بدل یا روک سکتے ہیں۔')
      : term === 'funded' ? L3('Only money you declared AND LoadBoot confirmed counts. Each confirmed tranche has a downloadable confirmation.', 'Sirf wo paisa ginta hai jo aap ne declare kiya AUR LoadBoot ne confirm kiya. Har confirmed qist ki tasdeeq download ho sakti hai.', 'صرف وہ پیسہ گنتا ہے جو آپ نے بتایا اور لوڈ بوٹ نے تصدیق کی۔')
      : term === 'spent' ? L3('Every expense shows which tranche it came from, why, where — with a receipt.', 'Har kharcha batata hai kis qist se, kyun, kahan — raseed ke saath.', 'ہر خرچہ بتاتا ہے کس قسط سے، کیوں، کہاں — رسید کے ساتھ۔')
      : term === 'fund_cash' ? L3('Given minus spent. If LoadBoot winds down, unspent cash is returned to you.', 'Diya hua minus kharch hua. Agar LoadBoot band ho to jo kharch nahi hua wo aap ko wapas milta hai.', 'دیا ہوا منفی خرچ ہوا۔ اگر لوڈ بوٹ بند ہو تو بچا ہوا پیسہ واپس ملتا ہے۔')
      : L3('Commitment minus given. Sent only when LoadBoot requests and you agree.', 'Commitment minus diya hua. Sirf tab jata hai jab LoadBoot maange aur aap haan karein.', 'کمٹمنٹ منفی دیا ہوا۔ صرف تب جب لوڈ بوٹ مانگے اور آپ ہاں کریں۔');
    out_.push(exSec(yours, [
      exRow(t('rc_commit'), money(cap)), exRow(t('rec_given'), money(funded), 'ok'), exRow(t('rc_togive'), money(toGive)),
      exRow(t('rec_spent'), money(spent), 'warn'), exRow(t('rec_left'), money(fund), 'ok'),
      exBar([{ cls: 'spent', w: pc(spent, cap), label: t('rc_seg_spent') }, { cls: 'fund', w: pc(fund, cap), label: t('rc_seg_fund') }, { cls: 'left', w: pc(toGive, cap), label: t('rc_seg_left') }]),
      el('p', { class: 'iv-ex-note' }, note),
    ]));
  }
  if (['share', 'recovery', 'outstanding', 'payout', 'profit', 'statement', 'no_profit'].includes(term)) {
    const total = recovering ? rate + share : share, sample = 100000, a = Math.round(sample * rate / 100), b = Math.round(sample * share / 100);
    out_.push(exSec(yours, [
      el('div', { class: 'iv-chips' }, [recovering ? chip(pct(rate) + ' ' + L3('recovery', 'wapsi', 'واپسی'), 'blue') : null, chip(pct(share) + ' ' + L3('permanent share', 'pakka hissa', 'مستقل حصہ'), 'orange'), chip(pct(100 - total) + ' LoadBoot', 'dim')]),
      exBar([{ cls: 'fund', w: recovering ? rate : 0, label: pct(rate) }, { cls: 'spent', w: share, label: pct(share) }, { cls: 'dim', w: 100 - total, label: 'LoadBoot' }]),
      el('p', { class: 'iv-ex-note' }, recovering
        ? L3('Right now: ' + pct(rate) + ' of each month\'s profit comes back to you until ' + money(target) + ' is fully returned, PLUS ' + pct(share) + ' is your permanent share — ' + pct(total) + ' in total. After recovery: only the ' + pct(share) + ', for as long as LoadBoot earns profit.',
             'Abhi: har mahine ke munafay ka ' + pct(rate) + ' aap ki wapsi mein jata hai jab tak ' + money(target) + ' poora wapas na ho, AUR ' + pct(share) + ' aap ka pakka hissa — kul ' + pct(total) + '. Wapsi poori hone ke baad sirf ' + pct(share) + ', jab tak LoadBoot munafa kamaye.',
             'ابھی: ہر مہینے کے منافع کا ' + pct(rate) + ' آپ کی واپسی میں جاتا ہے جب تک ' + money(target) + ' پورا واپس نہ ہو، اور ' + pct(share) + ' آپ کا مستقل حصہ — کل ' + pct(total) + '۔ واپسی کے بعد صرف ' + pct(share) + '۔')
        : L3('Your money is recovered. From now on ' + pct(share) + ' of each month\'s profit is yours, for as long as LoadBoot earns profit.', 'Aap ka paisa wapas ho chuka. Ab se har mahine ke munafay ka ' + pct(share) + ' aap ka hai, jab tak LoadBoot munafa kamaye.', 'آپ کا پیسہ واپس ہو چکا۔ اب سے ہر مہینے کے منافع کا ' + pct(share) + ' آپ کا ہے۔')),
    ]));
    out_.push(exSec(ex + ' · ' + L3('if one month\'s profit were', 'agar kisi mahine munafa ho', 'اگر کسی مہینے منافع ہو') + ' ' + money(sample), [
      recovering ? exRow(pct(rate) + ' ' + L3('recovery', 'wapsi', 'واپسی'), money(a), 'ok') : null,
      exRow(pct(share) + ' ' + L3('permanent share', 'pakka hissa', 'مستقل حصہ'), money(b), 'ok'),
      exRow(L3('You receive', 'Aap ko milta hai', 'آپ کو ملتا ہے'), money(recovering ? a + b : b), 'ok big'),
      exRow(L3('Stays with LoadBoot', 'LoadBoot ke paas rehta hai', 'لوڈ بوٹ کے پاس رہتا ہے'), money(sample - (recovering ? a + b : b))),
      el('p', { class: 'iv-ex-note' }, L3('Illustration only — real payouts come from the published monthly statement. A month with no profit owes nothing.', 'Sirf samajhne ke liye — asli payout har mahine ke published hisaab se nikalta hai. Jis mahine munafa na ho, kuch nahi banta.', 'صرف سمجھنے کے لیے — اصل پے آؤٹ ماہانہ حساب سے بنتا ہے۔ بغیر منافع کے مہینے میں کچھ واجب نہیں۔')),
    ]));
    if (term === 'recovery' || term === 'outstanding') out_.push(exSec(L3('Recovery progress', 'Wapsi kahan tak pohnchi', 'واپسی کہاں تک پہنچی'), [
      exRow(t('h_recovery'), money(rec) + ' / ' + money(target), 'ok'), exRow(t('h_outstanding'), money(out), out ? 'warn' : 'ok'),
      exBar([{ cls: 'fund', w: pc(rec, target), label: pct(Math.round(pc(rec, target))) }, { cls: 'dim', w: 100 - pc(rec, target), label: '' }]),
      el('p', { class: 'iv-ex-note' }, L3('The target is what you actually gave (' + money(target) + '), not the commitment. It grows only when a new tranche is confirmed.', 'Target wo hai jo aap ne sach mein diya (' + money(target) + '), commitment nahi. Nayi qist confirm ho to hi barhta hai.', 'ہدف وہ ہے جو آپ نے اصل میں دیا (' + money(target) + ')، کمٹمنٹ نہیں۔')),
    ]));
  }
  if (term === 'share_type') {
    const cur = p.share_type === 'equity' ? 'equity' : p.share_type === 'profit_share' ? 'profit' : 'open';
    const card = (title, body, on) => el('div', { class: 'iv-ex-opt' + (on ? ' on' : '') }, [el('div', { class: 'iv-ex-opt-h' }, [title, on ? chip(L3('yours', 'aap ka', 'آپ کا'), 'orange') : null]), el('p', null, body)]);
    out_.push(exSec(L3('Two kinds', 'Do qismein', 'دو قسمیں'), [
      card('Profit share', L3('A % of profit every month. No ownership, no voting, no company paperwork in your name — and if the company is ever sold, an agreed % of the sale (if written in the agreement).', 'Har mahine munafay ka %. Company mein malkiyat nahi, vote nahi, aap ke naam par kagzi kaam nahi — aur agar company kabhi bike to bikri ka tay-shuda % (agar agreement mein likha ho).', 'ہر مہینے منافع کا %۔ ملکیت نہیں، ووٹ نہیں — اور اگر کمپنی بکے تو طے شدہ % (اگر ایگریمنٹ میں ہو)۔'), cur === 'profit'),
      card('Equity', L3('A % ownership of the company itself. Comes with ownership rights and obligations, and is filed in the company\'s records.', 'Company ki khud malkiyat ka %. Is ke saath malik ke haqooq aur zimmedariyan aati hain, aur ye company ke record mein darj hota hai.', 'کمپنی کی ملکیت کا %۔ حقوق اور ذمہ داریاں ساتھ آتی ہیں۔'), cur === 'equity'),
      cur === 'open' ? el('p', { class: 'iv-ex-note warn' }, L3('Not decided yet — it will show here once written into the agreement.', 'Abhi tay nahi — agreement mein likhte hi yahan nazar aayega.', 'ابھی طے نہیں — ایگریمنٹ میں لکھتے ہی یہاں نظر آئے گا۔')) : null,
    ]));
  }
  if (term === 'request') out_.push(exSec(yours, [exRow(t('rc_togive'), money(toGive)), el('p', { class: 'iv-ex-note' }, L3('Each request names an amount and a purpose. Pay it, or decline — declining does not break the agreement.', 'Har darkhwast mein raqam aur maqsad likha hota hai. Dein, ya mana kar dein — mana karne se agreement nahi tootta.', 'ہر درخواست میں رقم اور مقصد لکھا ہوتا ہے۔ دیں یا منع کریں۔'))]));
  out_.push(el('button', { class: 'iv-btn sm', style: 'margin-top:14px', onClick: () => showGlossary() }, t('gl_row')));
  return el('div', { class: 'iv-explain' }, out_);
}
// 0410: build version 1 of the agreement from the standard offer (English governing text) and publish it.
async function publishSelfDoc(ob) {
  const o = ob.offer || {};
  const agreement = { id: ob.agreement_id, title: o.title || 'Investment agreement', currency: o.currency || 'PKR', commitment_cap: Number(o.commitment_cap || 0),
    payback_rate_pct: Number(o.payback_rate_pct || 0), permanent_share_pct: Number(o.permanent_share_pct || 0), payback_basis: 'actual_funded',
    share_type: o.share_type || 'profit_share', exit_participation_pct: o.exit_participation_pct != null && o.exit_participation_pct !== '' ? Number(o.exit_participation_pct) : null,
    early_stop_share_mode: o.early_stop_share_mode || 'pro_rata', loss_carry_forward: !!o.loss_carry_forward, profit_definition: o.profit_definition || '',
    exit_treatment: o.exit_treatment || '', early_stop_terms: o.early_stop_terms || '', buyout_terms: o.buyout_terms || '', status: 'active',
    position: { funded: 0, commitment_cap: Number(o.commitment_cap || 0) } };
  const investor = { name: S.signupName || '' };
  const extra = Object.assign({}, DEFAULT_EXTRA, o.extra || {}, { company_signer: o.company_signer || DEFAULT_EXTRA.company_signer, company_signer_title: o.company_signer_title || DEFAULT_EXTRA.company_signer_title });
  const md = buildAgreement(agreement, investor, extra, 'en');
  await invPublishSelfDoc({ agreement_id: ob.agreement_id, body_md: md, title: 'Investment Agreement — ' + agreement.title, params: { agreement, investor, extra } });
}
function showTerm(term) { openSheet(TERM_TITLE[term] ? TERM_TITLE[term]() : t('gl_what'), explainBody(term)); }
function showGlossary() {
  const lang = getLang(); const item = (title, text) => el('div', { class: 'iv-gl' }, [el('b', null, title), el('span', null, text)]);
  openSheet(t('gl_title'), el('div', null, [
    el('p', { class: 'iv-muted' }, t('gl_sub')),
    el('div', { class: 'iv-sect' }, el('h2', null, t('h_title'))), Object.keys(TERMS).map(k => item(termWhat(k, lang).split(' — ')[0], termWhat(k, lang).split(' — ').slice(1).join(' — '))),
    el('div', { class: 'iv-sect' }, el('h2', null, t('l_title'))), Object.keys(CATEGORIES).map(k => item(catName(k), catWhat(k, lang).split(' — ').slice(1).join(' — '))),
    el('div', { class: 'iv-sect' }, el('h2', null, 'Tools')), VENDORS.map(([n, w]) => item(n, w[lang] || w.en)),
  ]));
}
// SVG ring gauge — pct 0..100
function ring(pct, cls, label) {
  const r = 26, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, Number(pct || 0)));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 64 64'); svg.setAttribute('class', 'iv-ring ' + (cls || ''));
  svg.innerHTML = '<circle cx="32" cy="32" r="' + r + '" class="bg"/><circle cx="32" cy="32" r="' + r + '" class="fg" stroke-dasharray="' + c + '" stroke-dashoffset="' + (c * (1 - v / 100)) + '" transform="rotate(-90 32 32)"/><text x="32" y="36" text-anchor="middle">' + Math.round(v) + '%</text>';
  return el('div', { class: 'iv-ringwrap' }, [svg, label ? el('span', null, label) : null]);
}
// SVG sparkline from [{month,n}]
function spark(series) {
  const pts = (series || []).map(x => Number(x.n || 0)); if (pts.length < 2) return null;
  const max = Math.max(1, ...pts), w = 80, h = 24;
  const d = pts.map((n, i) => (i ? 'L' : 'M') + (i * (w / (pts.length - 1))).toFixed(1) + ' ' + (h - 2 - (n / max) * (h - 4)).toFixed(1)).join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h); svg.setAttribute('class', 'iv-spark');
  svg.innerHTML = '<path d="' + d + '"/>'; return svg;
}
function trend(series) {
  const p = (series || []).map(x => Number(x.n || 0)); if (p.length < 2) return null;
  const a = p[p.length - 1], b = p[p.length - 2]; const cls = a > b ? 'up' : a < b ? 'down' : 'flat';
  return el('span', { class: 'iv-trend ' + cls }, (a > b ? '▲ ' : a < b ? '▼ ' : '● ') + t('trend_' + cls));
}

// ---------- HOME ----------
function journey(p) {
  const steps = [['j_commit', true], ['j_funded', Number(p.funded) > 0], ['j_spent', Number(p.spent) > 0], ['j_profit', Number(p.share_paid) > 0 || Number(p.recovered) > 0], ['j_recover', p.phase === 'recovering' && Number(p.recovered) > 0], ['j_share', p.phase === 'recovered' || p.phase === 'permanent']];
  let cur = 0; steps.forEach((st, i) => { if (st[1]) cur = i; });
  return el('div', { class: 'iv-card' }, [
    el('p', { class: 'iv-eyebrow' }, t('journey')),
    el('div', { class: 'iv-journey' }, steps.map(([k, done], i) => el('div', { class: (done ? 'done' : '') + (i === cur ? ' now' : '') }, [el('i'), el('span', null, t(k)), i === cur ? el('small', null, t('j_now')) : null]))),
  ]);
}
function linksCard() {
  const L = Object.assign({}, PUBLIC_LINKS, (S.settings && S.settings.links) || {});
  const row = (k, key, ic) => L[k] ? el('a', { class: 'iv-link', href: L[k], target: '_blank', rel: 'noopener' }, [el('span', { class: 'ic' }, ic), t(key), el('span', { class: 'go' }, '↗')]) : null;
  return el('div', { class: 'iv-card' }, [
    el('p', { class: 'iv-eyebrow' }, t('links_title')), el('p', { class: 'iv-muted', style: 'margin:0 0 10px' }, t('links_sub')),
    el('div', { class: 'iv-links' }, [row('play', 'lk_play', '▶'), row('site', 'lk_site', '⌂'), row('linkedin', 'lk_linkedin', 'in'), row('trustpilot', 'lk_trustpilot', '★'), row('facebook', 'lk_facebook', 'f'), row('capterra', 'lk_capterra', 'C'), row('instagram', 'lk_instagram', 'ig'), row('youtube', 'lk_youtube', '▶')]),
  ]);
}
function renderHome(host) {
  const p = S.agr.position || {};
  const recovering = p.phase === 'recovering';
  const open = p.open_questions || [];
  const shareTypeVal = p.share_type === 'equity' ? pct(p.equity_vested_pct) : p.share_type === 'profit_share' ? t('h_profit_share') : t('h_undecided');
  const navRow = (ic, title, sub, fn, id) => el('button', { class: 'iv-row', onClick: fn }, [el('div', { class: 'ic' }, icon(ic)), el('div', null, [el('div', { class: 't' }, title), el('div', { class: 's', id: id || null }, sub)]), el('div', { class: 'amt' }, '›')]);
  const left = el('div', { class: 'iv-col' }, [
    stateBanner(p),
    el('div', { class: 'iv-card hero' }, [
      el('div', { class: 'iv-hero-grid' }, [
        el('div', null, [
          el('p', { class: 'iv-eyebrow' }, [t('h_funded'), ' ', qBtn('funded')]),
          el('div', { class: 'iv-big' }, [money(p.funded), el('small', null, t('of') + ' ' + money(p.commitment_cap))]), usdLine(p.funded),
        ]),
        ring(p.funded_pct, '', t('h_commit_used')),
      ]),
      el('div', { class: 'iv-kv' }, [
        kv(t('h_unfunded'), money(p.unfunded), '', 'commitment'),
        kv(t('h_fund_cash'), money(p.fund_cash), Number(p.fund_cash) < 0 ? 'warn' : 'ok', 'fund_cash'),
        kv(t('h_spent'), money(p.spent), '', 'spent'),
        kv(t('h_total_paid'), money(p.total_paid_out), '', 'payout'),
      ]),
    ]),
    el('div', { class: 'iv-card' }, [
      el('div', { class: 'iv-hero-grid' }, [
        el('div', null, [
          el('div', { class: 'iv-sec-row' }, [el('p', { class: 'iv-eyebrow', style: 'margin:0' }, [t('h_recovery'), ' ', qBtn('recovery')]),
            p.phase === 'wound_down' ? pill(t('h_wound'), 'due') : p.commitment_closed && recovering ? pill(t('h_stopped'), 'wait') : recovering ? pill(t('h_recovering'), 'blue') : pill(t('h_recovered'), 'ok')]),
          el('div', { class: 'iv-big sm' }, [money(p.recovered), el('small', null, t('of') + ' ' + money(p.recovery_target))]),
        ]),
        ring(p.recovered_pct, recovering ? '' : 'done', t('h_recovery')),
      ]),
      el('div', { class: 'iv-kv' }, [
        kv(t('h_outstanding'), money(p.outstanding), '', 'recovery'),
        kv(t('h_monthly'), recovering ? (pct(p.payback_rate_pct) + ' + ' + pct(p.effective_share_pct)) : pct(p.effective_share_pct), '', 'share'),
        kv(t('h_share_paid'), money(p.share_paid), '', 'share'),
        kv(p.share_type === 'equity' ? t('h_equity_vested') : t('h_share_type'), shareTypeVal, '', 'share'),
      ]),
      p.exit_participation_pct != null ? el('p', { class: 'iv-muted', style: 'margin:10px 0 0' }, t('h_exit') + ': ' + t('h_exit_val', pct(p.exit_participation_pct))) : null,
      recovering ? el('p', { class: 'iv-muted', style: 'margin:10px 0 0' }, t('h_note_recovering', pct(p.payback_rate_pct), pct(p.effective_share_pct))) : null,
    ]),
    journey(p), updatesCard(), planCard(p), amendCard(p),
    open.length ? el('div', { class: 'iv-open' }, [el('b', null, t('h_open')), el('ul', null, open.map(q => el('li', null, t('oq_' + q, pct(p.permanent_share_pct)))))]) : null,
    projectionCard(),
  ]);
  const right = el('div', { class: 'iv-col' }, [
    growthCard(), revenueCard(), trafficCard(), linksCard(),
    navRow('doc', t('h_agreement'), S.agr.signed_date ? t('h_signed', fmtDate(S.agr.signed_date)) : t('h_draft'), () => showAgreement()),
    el('div', { style: 'height:8px' }),
    navRow('shield', t('sec_title'), '…', () => showSecurity(), 'iv-sec-sub'),
    el('div', { style: 'height:8px' }),
    navRow('inbox', t('gl_title'), t('gl_row'), () => showGlossary()),
    el('div', { style: 'height:8px' }),
    navRow('doc', t('log_title'), t('log_sub'), () => showAudit()),
    el('div', { class: 'iv-actions', style: 'justify-content:center;margin-top:20px' }, el('button', { class: 'iv-btn sm', onClick: async () => { await signOut(); renderLogin(); } }, t('sign_out'))),
  ]);
  mount(host, [agrPicker(), el('h1', { class: 'iv-h1' }, t('h_title')), el('p', { class: 'iv-sub' }, t('h_sub')), el('div', { class: 'iv-home' }, [left, right])]);
  mfaListFactors().then(f => { const on = (f.all || []).concat(f.totp || [], f.phone || []).some(x => x.status === 'verified'); const s = document.getElementById('iv-sec-sub'); if (s) s.textContent = on ? t('sec_on') : t('sec_off'); }).catch(() => {});
}

function showAgreement() { return agreementV3(); }
function showTermsSummary() {
  const a = S.agr, p = a.position || {};
  const row = (k, v) => [k, v || t('h_undecided')];
  openSheet(t('h_agreement'), el('div', null, [
    dl([
      row(t('a_commitment'), money(p.original_cap || p.commitment_cap)),
      row(t('a_when'), t('a_when_v')),
      row(t('a_target'), Number(p.recovery_target) === Number(p.funded) || !Number(p.recovery_target) ? t('a_target_actual') : money(p.recovery_target)),
      row(t('a_during'), t('a_during_v', pct(p.payback_rate_pct), pct(p.permanent_share_pct))),
      row(t('a_after'), t('a_after_v', pct(p.permanent_share_pct))),
      row(t('a_type'), p.share_type === 'equity' ? t('a_type_equity') : p.share_type === 'profit_share' ? t('a_type_profit') : null),
      row(t('a_profit'), a.profit_definition),
      row(t('a_sale'), a.exit_participation_pct != null ? t('h_exit_val', pct(a.exit_participation_pct)) + (a.exit_treatment ? ' — ' + a.exit_treatment : '') : a.exit_treatment),
      row(t('a_stop'), (a.early_stop_share_mode === 'keep' ? t('a_stop_keep') : t('a_stop_pro')) + (a.early_stop_terms ? ' — ' + a.early_stop_terms : '')),
      row(t('a_carry'), a.loss_carry_forward ? t('a_carry_on') : t('a_carry_off')),
      row(t('a_buyout'), a.buyout_terms),
      row(t('a_signed'), a.signed_date ? fmtDate(a.signed_date) : null),
    ]),
    a.doc_url ? el('a', { class: 'iv-btn block', href: a.doc_url, target: '_blank', rel: 'noopener' }, t('a_open_doc')) : null,
    el('p', { class: 'iv-muted' }, t('a_note')),
    flagButton('agreement', a.id),
  ]));
}

// ---------- security (2FA enrollment) — see securityV3 below ----------
async function showSecurity() { return securityV3(); }

// ---------- flags (question an entry) ----------
function flagButton(kind, refId) {
  return el('button', { class: 'iv-flag-btn', type: 'button', onClick: () => {
    const note = el('textarea', { id: 'iv-flag-note', name: 'iv-flag-note', rows: 3, placeholder: t('f_ph'), required: true });
    const msg = el('div'); const btn = el('button', { class: 'iv-btn primary block', type: 'submit' }, t('f_send'));
    const close = openSheet(t('f_title'), el('form', { onSubmit: async (e) => { e.preventDefault(); btn.disabled = true;
      try { await invFlag({ agreement_id: S.agr.id, kind, ref_id: refId, note: note.value }); mount(msg, el('div', { class: 'iv-ok' }, t('f_ok'))); S.flags = null; setTimeout(close, 900); }
      catch (ex) { mount(msg, el('div', { class: 'iv-err' }, err(ex))); btn.disabled = false; } } }, [msg, field(t('note'), note), btn]));
  } }, [icon('flag'), t('f_ask')]);
}
async function flagsSection() {
  if (!S.flags) { try { S.flags = (await invMyFlags(S.agr.id)).flags || []; } catch (_) { S.flags = []; } }
  if (!S.flags.length) return null;
  return el('div', null, [
    el('div', { class: 'iv-sect' }, el('h2', null, t('f_mine'))),
    el('div', { class: 'iv-list' }, S.flags.map(f => el('div', { class: 'iv-row', style: 'cursor:default' }, [
      el('div', { class: 'ic' }, icon('flag')),
      el('div', null, [el('div', { class: 't' }, f.note), el('div', { class: 's' }, [fmtDate(f.raised_at) + ' · ', pill(f.status === 'open' ? t('f_open') : f.status === 'answered' ? t('f_answered') : t('f_resolved'), f.status === 'open' ? 'wait' : 'ok'), f.answer ? el('div', { style: 'margin-top:6px;color:var(--iv-ink)' }, '↳ ' + f.answer) : null])]),
      el('div'),
    ]))),
  ]);
}

// ---------- REQUESTS ----------
async function renderRequests(host) {
  mount(host, skeleton());
  try { S.requests = (await invMyRequests(S.agr.id)).requests || []; }
  catch (e) { mount(host, el('div', { class: 'iv-err' }, err(e))); return; }
  const pending = S.requests.filter(r => r.status === 'pending' || r.status === 'declared');
  const past = S.requests.filter(r => !pending.includes(r));
  const LABEL = { pending: t('r_awaiting_you'), declared: t('r_awaiting_lb'), funded: t('r_funded'), declined: t('r_declined'), cancelled: t('r_cancelled') };
  const rowFor = (r) => el('button', { class: 'iv-row', onClick: () => openRequest(r) }, [
    el('div', { class: 'ic' }, '#' + r.seq),
    el('div', null, [el('div', { class: 't' }, r.reason), el('div', { class: 's' }, [catName(r.category) + ' · ' + fmtDate(r.requested_at) + ' · ', pill(LABEL[r.status] || r.status, r.status === 'funded' ? 'ok' : r.status === 'declared' ? 'wait' : r.status === 'pending' ? 'due' : '')])]),
    el('div', { class: 'amt' }, money(r.amount)),
  ]);
  mount(host, [
    agrPicker(), el('h1', { class: 'iv-h1' }, t('r_title')), el('p', { class: 'iv-sub' }, t('r_sub')),
    pending.length ? el('div', { class: 'iv-list' }, pending.map(rowFor)) : empty(t('r_empty')),
    past.length ? el('div', { class: 'iv-sect' }, el('h2', null, t('r_earlier'))) : null,
    past.length ? el('div', { class: 'iv-list' }, past.map(rowFor)) : null,
  ]);
}
function openRequest(r) {
  let close;
  close = openSheet(t('r_request') + ' #' + r.seq, el('div', null, [
    dl([[t('amount'), money(r.amount)], [t('r_for'), r.reason], [t('r_category'), catName(r.category)], [t('r_needed_by'), fmtDate(r.needed_by)], [t('r_raised'), fmtDate(r.requested_at)], [t('r_funded_so_far'), money(r.funded)]]),
    (r.attachments || []).length ? el('div', { class: 'iv-att' }, [el('div', { class: 'iv-att-h' }, t('r_attachments')), el('p', { class: 'iv-muted', style: 'margin:0 0 8px' }, t('r_attach_hint')),
      ...(r.attachments || []).map(a => { const b = el('a', { class: 'iv-att-row', href: '#' }, [icon('doc'), el('span', null, [el('b', null, a.name || 'file'), a.note ? el('i', null, a.note) : null])]); b.onclick = async (e) => { e.preventDefault(); try { window.open(await invProofUrl(a.ref), '_blank', 'noopener'); } catch (ex) { alert(err(ex)); } }; return b; })]) : null,
    r.status === 'pending' ? payTo() : null,
    r.status === 'pending' ? el('button', { class: 'iv-btn primary block', onClick: () => { close(); declareForm(r); } }, t('r_mark_paid')) : null,
    r.status === 'declared' ? el('div', { class: 'iv-ok' }, t('r_declared')) : null,
    flagButton('other', r.id),
  ]));
}
function declareForm(r) {
  let close;
  const amount = inp('iv-amt', { type: 'number', inputmode: 'decimal', min: '1', step: '0.01', value: r ? r.amount : '', required: true });
  const date = inp('iv-date', { type: 'date', value: new Date().toISOString().slice(0, 10), required: true });
  const method = el('select', { id: 'iv-method', name: 'iv-method' }, ['bank', 'easypaisa', 'jazzcash', 'cash', 'other'].map(m => el('option', { value: m }, m.charAt(0).toUpperCase() + m.slice(1))));
  const ref = inp('iv-ref', { type: 'text', placeholder: 'TXN-…' });
  const proof = inp('iv-proof', { type: 'url', placeholder: 'https://…' });
  const file = el('input', { type: 'file', id: 'iv-file', accept: 'image/jpeg,image/png,image/webp,application/pdf' });
  const drop = el('label', { class: 'iv-drop', for: 'iv-file' }, [file, el('span', null, t('up_drop'))]);
  file.onchange = () => { const f = file.files && file.files[0]; drop.classList.toggle('has', !!f); drop.lastChild.textContent = f ? t('up_has', f.name) : t('up_drop'); };
  const note = el('textarea', { id: 'iv-note', name: 'iv-note', rows: 2 });
  const msg = el('div'); const btn = el('button', { class: 'iv-btn primary block', type: 'submit' }, t('d_btn'));
  close = openSheet(r ? t('d_title', r.seq) : t('d_title_free'), el('form', { onSubmit: async (e) => {
    e.preventDefault(); btn.disabled = true; mount(msg, '');
    try {
      let proofRef = proof.value;
      const f = file.files && file.files[0];
      if (f) { if (f.size > 10 * 1024 * 1024) throw new Error('File is larger than 10 MB'); btn.textContent = '…'; proofRef = await invUploadProof(S.agr.id, f); }
      await invDeclarePayment({ agreement_id: S.agr.id, request_id: r ? r.id : null, amount: amount.value, received_date: date.value, method: method.value, reference: ref.value, proof_url: proofRef, note: note.value });
      mount(msg, el('div', { class: 'iv-ok' }, t('d_ok'))); btn.textContent = t('done'); S.requests = S.ledger = null;
      setTimeout(() => { close(); refresh(); }, 900);
    } catch (ex) { mount(msg, el('div', { class: 'iv-err' }, err(ex))); btn.disabled = false; }
  } }, [
    msg, el('p', { class: 'iv-muted' }, r ? ('#' + r.seq + ' · ' + r.reason) : t('d_free')),
    r ? null : payTo(),
    field(t('amount'), amount), field(t('d_sent'), date), field(t('method'), method), field(t('reference'), ref),
    el('div', { class: 'iv-field' }, [el('label', null, t('proof')), drop, el('span', { class: 'hint' }, t('up_hint'))]),
    field(t('up_or'), proof, t('d_proof_hint')), field(t('note'), note), btn,
    el('p', { class: 'iv-muted' }, t('d_two')),
  ]));
}

// ---------- LEDGER (spending) ----------
function exportCsv() {
  const L = S.ledger || {}; const rows = [['type', 'date', 'category', 'vendor_or_method', 'description_or_reference', 'amount', 'state', 'proof']];
  (L.receipts || []).forEach(r => rows.push(['money_in', r.received_date, '', r.method || '', r.reference || '', r.amount, r.state, r.proof_url || '']));
  (L.expenses || []).forEach(x => rows.push(['expense', x.date, x.category, x.vendor || '', x.description || '', x.reversed ? -x.amount : x.amount, x.reversed ? 'reversal' : 'spent', x.receipt_url || '']));
  (L.payouts || []).forEach(p => rows.push([p.kind === 'capital_return' ? 'capital_return' : 'payout', p.paid_date || '', p.month || '', p.method || '', p.reference || '', p.total, p.status, p.proof_url || '']));
  const csv = rows.map(r => r.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,﻿' + encodeURIComponent(csv);
  a.download = 'loadboot-investor-ledger-' + new Date().toISOString().slice(0, 10) + '.csv'; document.body.appendChild(a); a.click(); a.remove();
}
async function renderLedger(host) {
  mount(host, skeleton());
  if (!S.ledger) { try { S.ledger = await invLedger(S.agr.id); } catch (e) { mount(host, el('div', { class: 'iv-err' }, err(e))); return; } }
  const L = S.ledger, p = L.position || {};
  const cats = Object.entries(L.by_category || {}).sort((a, b) => b[1] - a[1]);
  const max = cats.length ? Math.max(...cats.map(c => Number(c[1]))) : 1;
  const exp = L.expenses || [];
  const expSheet = (x) => openSheet(catName(x.category), el('div', null, [
    el('p', { class: 'iv-gl-p' }, vendorWhat(x.vendor, getLang()) || catWhat(x.category, getLang())),
    dl([[t('amount'), money(x.amount)], [t('date'), fmtDate(x.date)], [t('l_vendor'), x.vendor], [t('l_details'), x.description],
        [t('l_paid_from'), x.tranche ? t('l_tranche', fmtDate(x.tranche)) : null], [t('l_recurring'), x.recurring ? t('l_yes') : t('l_no')]]),
    x.receipt_url ? el('a', { class: 'iv-btn block', href: '#', onClick: async (e) => { e.preventDefault(); try { window.open(await invProofUrl(x.receipt_url), '_blank', 'noopener'); } catch (ex) { alert(err(ex)); } } }, t('view') + ' ' + t('receipt')) : el('p', { class: 'iv-muted' }, t('l_no_receipt')),
    el('button', { class: 'iv-btn block', onClick: () => expenseReceipt(x) }, [icon('download'), t('dl_receipt')]),
    x.reversed ? null : x.acknowledged_at ? el('div', { class: 'iv-ok' }, t('ack_done', fmtDate(x.acknowledged_at))) : el('div', null, [
      el('button', { class: 'iv-btn primary block', onClick: async (e) => { e.target.disabled = true; try { await invAckExpense(x.id); x.acknowledged_at = new Date().toISOString(); S.ledger = null; renderShell(); } catch (ex) { alert(err(ex)); e.target.disabled = false; } } }, t('ack_btn')),
      el('p', { class: 'iv-muted', style: 'font-size:.75rem' }, t('ack_hint'))]),
    flagButton('expense', x.id),
  ]));
  mount(host, [
    agrPicker(), el('h1', { class: 'iv-h1' }, t('l_title')), el('p', { class: 'iv-sub' }, t('l_sub')),
    el('div', { class: 'iv-card hero' }, [
      el('p', { class: 'iv-eyebrow' }, t('l_remaining')), el('div', { class: 'iv-big' }, money(p.fund_cash)),
      el('p', { class: 'iv-muted', style: 'margin:6px 0 0' }, t('l_came_spent', money(p.funded), money(p.spent))),
    ]),
    cats.length ? el('div', { class: 'iv-card' }, [
      el('p', { class: 'iv-eyebrow' }, t('spend_mix')),
      el('div', { class: 'iv-donut-wrap' }, [donut(cats, Number(p.spent)), el('div', { class: 'iv-cats' }, cats.map(([c, v], i) => el('div', { class: 'iv-cat' }, [el('span', null, [el('i', { class: 'dot', style: 'background:' + DONUT[i % DONUT.length] }), catName(c), ' ', qBtn(null, c)]), el('div', { class: 'bar' }, el('i', { style: 'width:' + Math.round(100 * Number(v) / max) + '%;background:' + DONUT[i % DONUT.length] })), el('b', null, money(v))])))]),
    ]) : null,
    exp.length ? el('div', { class: 'iv-list' }, exp.map(x => el('button', { class: 'iv-row', onClick: () => expSheet(x) }, [
      el('div', { class: 'ic ' + (x.reversed ? 'in' : 'out') }, x.reversed ? icon('arrowBack') : catIcon(x.category)),
      el('div', null, [el('div', { class: 't' }, x.reversed ? t('l_reversal') + ' · ' + catName(x.category) : vendorLinks(x.vendor || catName(x.category))), el('div', { class: 's' }, fmtDate(x.date) + (x.description ? ' · ' + x.description : '')), el('div', { class: 's what' }, vendorWhat(x.vendor, getLang()) || catWhat(x.category, getLang()))]),
      el('div', { class: 'amt ' + (x.reversed ? 'pos' : 'neg') }, [(x.reversed ? '+' : '−') + money(x.amount), (!x.reversed && !x.acknowledged_at) ? el('small', { class: 'iv-new' }, t('ack_new')) : x.receipt_url ? el('small', null, t('receipt') + ' ✓') : null]),
    ]))) : empty(t('l_empty')),
    el('div', { class: 'iv-actions', style: 'justify-content:center;flex-wrap:wrap' }, [el('button', { class: 'iv-btn sm', onClick: exportCsv }, [icon('download'), t('l_export')]), el('button', { class: 'iv-btn sm', onClick: () => expenseReport(L) }, [icon('download'), t('dl_all_expenses')])]),
    await flagsSection(),
  ]);
}

// ---------- PAYMENTS (mine) ----------
async function renderPayments(host) {
  mount(host, skeleton());
  if (!S.ledger) { try { S.ledger = await invLedger(S.agr.id); } catch (e) { mount(host, el('div', { class: 'iv-err' }, err(e))); return; } }
  const rc = S.ledger.receipts || [];
  const returned = (S.ledger.payouts || []).filter(x => x.kind === 'capital_return');
  const sheet = (r) => openSheet(t('nav_payments'), el('div', null, [
    dl([[t('amount'), money(r.amount)], [t('date'), fmtDate(r.received_date)], [t('method'), r.method], [t('reference'), r.reference], [t('tr_from'), trFrom(r)], [t('tr_into'), trInto(r)],
        [t('p_you_declared'), r.declared_at ? fmtDate(r.declared_at) : null], [t('p_lb_confirmed'), r.confirmed_at ? fmtDate(r.confirmed_at) : t('not_yet')],
        r.rejected_reason ? [t('p_rejected_why'), r.rejected_reason] : [t('note'), r.note],
        [t('proof'), r.proof_url ? el('a', { href: '#', onClick: async (e) => { e.preventDefault(); try { window.open(await invProofUrl(r.proof_url), '_blank', 'noopener'); } catch (ex) { alert(err(ex)); } } }, t('view')) : null]]),
    r.confirmed_at ? el('button', { class: 'iv-btn block', onClick: () => paymentConfirmation(r) }, [icon('download'), t('dl_confirm')]) : null,
    flagButton('receipt', r.id),
  ]));
  mount(host, [
    agrPicker(), el('h1', { class: 'iv-h1' }, t('p_title')), el('p', { class: 'iv-sub' }, t('p_sub')),
    S.agr.status === 'wound_down' || (S.agr.position || {}).commitment_closed ? null : el('button', { class: 'iv-btn block', onClick: () => declareForm(null) }, '+ ' + t('p_record')),
    el('div', { style: 'height:12px' }),
    rc.length ? el('div', { class: 'iv-list' }, rc.map(r => {
      const neg = Number(r.amount) < 0;
      const tone = r.state === 'confirmed' ? 'ok' : r.state === 'rejected' ? 'due' : r.state === 'reversal' ? 'due' : 'wait';
      const label = { confirmed: t('p_confirmed'), rejected: t('p_rejected'), reversal: t('p_reversal') }[r.state] || t('p_awaiting');
      return el('button', { class: 'iv-row', onClick: () => sheet(r) }, [
        el('div', { class: 'ic ' + (neg || r.state === 'rejected' ? 'out' : 'in') }, icon(neg ? 'arrowBack' : 'arrowUp')),
        el('div', null, [el('div', { class: 't' }, fmtDate(r.received_date) + (r.method ? ' · ' + r.method : '')), el('div', { class: 's' }, [r.reference ? r.reference + ' · ' : '', pill(label, tone)])]),
        el('div', { class: 'amt ' + (neg ? 'neg' : 'pos'), style: r.state === 'rejected' ? 'text-decoration:line-through;opacity:.6' : '' }, money(r.amount)),
      ]);
    })) : empty(t('p_empty')),
    returned.length ? el('div', { class: 'iv-sect' }, el('h2', null, t('p_returned'))) : null,
    returned.length ? el('div', { class: 'iv-list' }, returned.map(x => el('div', { class: 'iv-row', style: 'cursor:default' }, [
      el('div', { class: 'ic in' }, icon('arrowBack')),
      el('div', null, [el('div', { class: 't' }, t('p_returned')), el('div', { class: 's' }, [x.paid_date ? fmtDate(x.paid_date) + ' · ' : '', pill(x.status === 'paid' ? t('p_confirmed') : t('s_due'), x.status === 'paid' ? 'ok' : 'wait')])]),
      el('div', { class: 'amt pos' }, money(x.total)),
    ]))) : null,
  ]);
}

// ---------- STATEMENTS ----------
async function renderStatements(host) {
  mount(host, skeleton());
  if (!S.statements) { try { S.statements = (await invStatements(S.agr.id)).statements || []; } catch (e) { mount(host, el('div', { class: 'iv-err' }, err(e))); return; } }
  const st = S.statements;
  const sheet = (s) => {
    const po = s.payout; const zero = po && Number(po.total) === 0;
    openSheet(fmtMonth(s.month), el('div', null, [
      dl([[t('revenue'), money(s.revenue)], [t('expenses'), money(s.expenses)], [t('profit'), el('b', { style: 'color:' + (Number(s.profit) < 0 ? 'var(--iv-orange)' : 'var(--iv-green)') }, money(s.profit))],
          [t('s_payback'), po ? money(po.payback) : null], [t('s_share'), po ? money(po.share) : null], [t('s_to_you'), po ? money(po.total) : null],
          [t('s_paid_on'), po && po.paid_date && !zero ? fmtDate(po.paid_date) : (zero ? t('s_nothing') : t('not_yet'))], [t('note'), s.note]]),
      (S.agr.loss_carry_forward && Number(s.profit) > 0 && po && Number(po.total) === 0) ? el('p', { class: 'iv-muted' }, t('s_basis_note')) : null,
      el('button', { class: 'iv-btn block', onClick: () => statementDoc(s) }, [icon('download'), t('dl_statement')]),
      (po && po.status === 'paid' && !po.confirmed_at && !zero) ? el('button', { class: 'iv-btn primary block', onClick: async (ev) => {
        ev.target.disabled = true; try { await invConfirmPayout(po.id); S.statements = S.ledger = null; refresh(); } catch (ex) { alert(err(ex)); ev.target.disabled = false; }
      } }, t('s_confirm')) : null,
      flagButton('statement', po ? po.id : null),
    ]));
  };
  mount(host, [
    agrPicker(), el('h1', { class: 'iv-h1' }, t('s_title')), el('p', { class: 'iv-sub' }, t('s_sub')),
    st.length ? el('div', { class: 'iv-list' }, st.map(s => {
      const po = s.payout; const zero = po && Number(po.total) === 0;
      const tone = !po ? '' : zero ? '' : po.status === 'paid' ? (po.confirmed_at ? 'ok' : 'wait') : 'blue';
      const label = !po ? t('s_no_share') : zero ? t('s_nothing') : po.status === 'paid' ? (po.confirmed_at ? t('s_received') + ' ✓' : t('s_paid_confirm')) : t('s_due');
      return el('button', { class: 'iv-row', onClick: () => sheet(s) }, [
        el('div', { class: 'ic' }, new Date(s.month).toLocaleDateString('en-GB', { month: 'short' })),
        el('div', null, [el('div', { class: 't' }, fmtMonth(s.month)), el('div', { class: 's' }, [t('profit') + ' ' + money(s.profit) + ' · ', pill(label, tone)])]),
        el('div', { class: 'amt ' + (Number(s.profit) < 0 ? 'neg' : 'pos') }, po ? money(po.total) : t('none')),
      ]);
    })) : empty(t('s_empty'), 'statements'),
  ]);
}

// ---------- boot ----------
async function refresh() {
  try {
    const gate = await mfaRequiredAny(); if (gate) { renderMfaGate(gate); return; }
    // 0410: link by e-mail, or create investor + agreement on the standard offer, then publish v1 (pre-signed by LoadBoot)
    let ob = null; try { ob = await invSelfOnboard({ name: S.signupName || '', lang: getLang() }); } catch (_) { try { await invClaimByEmail(); } catch (__) {} }
    if (ob && ob.ok && ob.needs_doc && ob.agreement_id) { try { await publishSelfDoc(ob); } catch (ex) { console.warn('self doc', ex); } }
    const me = await invMe();
    if (!me || me.ok === false) { renderNotLinked(); return; }
    S.me = me.investor; S.agreements = me.agreements || [];
    try { localStorage.setItem('lb_last_portal', '/app/investor/'); } catch (_) {}
    if (!S.agreements.length) { renderNotLinked(); return; }
    let saved = null; try { saved = localStorage.getItem('lb-inv-lang'); } catch (_) {}
    setLang(saved || S.me.lang || 'en');
    S.agr = S.agreements.find(a => S.agr && a.id === S.agr.id) || S.agreements[0];
    if (!S.agr.signed_date && !S.autoDoc) { S.autoDoc = true; S.tab = SIMPLE ? 'agreement' : S.tab; setTimeout(() => showAgreement(), 400); }
    if (!S.requests) { try { S.requests = (await invMyRequests(S.agr.id)).requests || []; } catch (_) { S.requests = []; } }
    if (!S.settings) { try { S.settings = await invSettings(); } catch (_) { S.settings = {}; } }
    renderShell();
  } catch (e) { renderLogin(err(e)); }
}
async function boot() {
  let saved = null; try { saved = localStorage.getItem('lb-inv-lang'); } catch (_) {}
  setLang(saved || 'en');
  const s = await getSession();
  if (!s) { if (location.hash === '#signup') renderSignup(); else renderLogin(); return; }
  await refresh();
}
onAuthChange((ev) => { if (ev === 'SIGNED_OUT') renderLogin(); });
boot();

// ============================================================================
// v3 — payment instructions, projection, growth, security (app + SMS), e-sign
// ============================================================================
function copyBtn(text) {
  const b = el('button', { class: 'copy', type: 'button' }, t('pay_copy'));
  b.onclick = async () => { try { await navigator.clipboard.writeText(String(text)); b.textContent = t('pay_copied'); setTimeout(() => { b.textContent = t('pay_copy'); }, 1500); } catch (_) {} };
  return b;
}
const PAY_KEYS = [['bank_name', 'Bank'], ['account_title', 'Title'], ['account_number', 'Account #'], ['iban', 'IBAN'], ['branch', 'Branch'], ['easypaisa', 'Easypaisa'], ['jazzcash', 'JazzCash']];
function payTo() {
  const pi = S.settings && S.settings.payment_instructions;
  const has = pi && Object.values(pi).some(v => v && String(v).trim());
  if (!has) return el('div', { class: 'iv-pay' }, el('p', { class: 'iv-muted', style: 'margin:0' }, t('pay_none')));
  const pairs = [];
  PAY_KEYS.forEach(([k, label]) => { if (pi[k]) pairs.push([label, el('b', null, [String(pi[k]), copyBtn(pi[k])])]); });
  Object.keys(pi).forEach(k => { if (!PAY_KEYS.some(([kk]) => kk === k) && k !== 'note' && pi[k]) pairs.push([k, el('b', null, [String(pi[k]), copyBtn(pi[k])])]); });
  return el('div', { class: 'iv-pay' }, [
    el('p', { class: 'iv-eyebrow', style: 'margin:0' }, t('pay_to')), dl(pairs),
    pi.note ? el('p', { class: 'iv-muted', style: 'margin:8px 0 0' }, pi.note) : null,
  ]);
}

function projectionCard() {
  const box = el('div', { class: 'iv-card' }, [el('p', { class: 'iv-eyebrow' }, t('proj')), el('div', { class: 'iv-sk', style: 'height:14px;width:60%' })]);
  const p = S.agr.position || {};
  const paint = (pr) => {
    const f = pr.forecast || {};
    const monthsTo = pr.months_to_recovery;
    const firstMonth = f.first_payout_month ? fmtMonth(f.first_payout_month) : null;
    const rows = [];
    if (pr.source === 'actual') {
      rows.push(kv(t('proj_avg'), money(pr.avg_monthly_profit)), kv(t('proj_pay'), money(pr.est_monthly_payback)), kv(t('proj_share'), money(pr.est_monthly_share)));
      if (monthsTo != null && p.phase === 'recovering') rows.push(kv(t('proj_months'), String(monthsTo)));
    } else if (f.expected_monthly_profit) {
      rows.push(kv(t('proj_avg'), money(f.expected_monthly_profit)), kv(t('proj_pay'), money(pr.est_monthly_payback)));
      if (monthsTo != null && p.phase === 'recovering') rows.push(kv(t('proj_months'), String(monthsTo)));
    }
    if (firstMonth) rows.push(kv(t('proj_first'), firstMonth, 'ok'));
    mount(box, [
      el('p', { class: 'iv-eyebrow' }, t('proj')),
      rows.length ? el('p', { class: 'iv-muted', style: 'margin:0 0 8px' }, pr.source === 'actual' ? t('proj_actual', pr.months_used) : t('proj_owner')) : null,
      rows.length ? el('div', { class: 'iv-kv' }, rows) : el('p', { class: 'iv-muted', style: 'margin:0' }, t('proj_none')),
      f.note ? el('p', { class: 'iv-muted', style: 'margin:8px 0 0' }, f.note) : null,
      rows.length ? el('p', { class: 'iv-muted', style: 'margin:8px 0 0;font-size:.75rem' }, t('proj_note')) : null,
    ]);
  };
  const load = S.proj && S.proj.agr === S.agr.id ? Promise.resolve(S.proj.data) : invProjection(S.agr.id).then(d => { S.proj = { agr: S.agr.id, data: d }; return d; });
  load.then(paint).catch(ex => mount(box, [el('p', { class: 'iv-eyebrow' }, t('proj')), el('p', { class: 'iv-muted' }, err(ex))]));
  return box;
}


// ---------- security: authenticator app (guided) or phone SMS ----------
async function securityV3() {
  let f = { totp: [], phone: [] }; try { f = await mfaListFactors(); } catch (_) {}
  const all = (f.all || []).concat(f.totp || [], f.phone || []);
  const on = all.filter(x => x.status === 'verified');
  const body = el('div');
  const close = openSheet(t('sec_title'), body);
  const done = () => { mount(body, [el('div', { class: 'iv-ok' }, t('sec_done')), el('button', { class: 'iv-btn primary block', onClick: () => { close(); renderShell(); } }, t('done'))]); };
  const codeField = () => inp('iv-otp2', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, pattern: '[0-9]{6}', required: true, placeholder: '000000', style: 'letter-spacing:.3em;font-size:1.3rem;text-align:center' });

  const chooser = () => SMS_2FA_ENABLED ? chooserFull() : appFlow();
  const chooserFull = () => mount(body, [
    el('p', { class: 'iv-muted' }, t('sec_why')),
    on.length ? el('div', { class: 'iv-ok' }, t('sec_on') + ' · ' + on.map(x => (x.factor_type || x.type) === 'phone' ? t('sec_phone') : t('sec_app')).join(', ')) : el('div', { class: 'iv-warn' }, t('sec_off')),
    el('p', { class: 'iv-eyebrow', style: 'margin:14px 0 0' }, t('sec_choose')),
    el('div', { class: 'iv-choice' }, [
      el('button', { type: 'button', onClick: appFlow }, [icon('shield'), t('sec_app'), el('small', null, t('sec_app_s'))]),
      el('button', { type: 'button', onClick: phoneFlow }, [icon('shield'), t('sec_phone'), el('small', null, t('sec_phone_s'))]),
    ]),
    el('p', { class: 'iv-muted', style: 'font-size:.78rem' }, t('sec_recover')),
    el('div', { class: 'iv-actions' }, el('button', { class: 'iv-btn sm', onClick: () => close() }, t('sec_skip'))),
  ]);

  async function appFlow() {
    mount(body, skeleton());
    let en; try { en = await mfaEnrollTotp(); } catch (ex) { mount(body, [el('div', { class: 'iv-err' }, err(ex)), el('button', { class: 'iv-btn sm', onClick: chooser }, '‹')]); return; }
    const code = codeField(); const msg = el('div'); const btn = el('button', { class: 'iv-btn primary block', type: 'submit' }, t('sec_verify'));
    const guide = el('div', { class: 'iv-guide' }, ['sec_g1', 'sec_g2', 'sec_g3', 'sec_g4', 'sec_g5'].map(k => { const d = el('div'); d.innerHTML = '<span>' + t(k) + '</span>'; return d; }));
    const qr = el('div', { class: 'iv-qr' }, el('img', { src: en.totp.qr_code, alt: 'QR', width: 200, height: 200 }));
    const secret = el('div', { class: 'iv-pay' }, [el('span', { class: 'iv-muted', style: 'font-size:.75rem' }, 'Secret (manual entry)'), el('b', { style: 'display:block;word-break:break-all;font-family:monospace;font-size:.85rem' }, [en.totp.secret, copyBtn(en.totp.secret)])]);
    mount(body, el('form', { onSubmit: async (e) => { e.preventDefault(); btn.disabled = true; mount(msg, '');
      try { await mfaVerify(en.id, code.value); done(); } catch (ex) { mount(msg, el('div', { class: 'iv-err' }, err(ex))); btn.disabled = false; } } }, [
      SMS_2FA_ENABLED ? null : el('div', null, [el('p', { class: 'iv-muted' }, t('sec_why')), on.length ? el('div', { class: 'iv-ok' }, t('sec_on')) : el('div', { class: 'iv-warn' }, t('sec_off'))]),
      guide, el('div', { style: 'text-align:center' }, qr), secret, msg, field(t('sec_code'), code), btn,
      el('div', { class: 'iv-actions' }, el('button', { class: 'iv-btn sm', type: 'button', onClick: SMS_2FA_ENABLED ? chooser : () => close() }, SMS_2FA_ENABLED ? '‹ ' + t('sec_choose') : t('sec_skip'))),
    ]));
    setTimeout(() => code.focus(), 50);
  }

  async function phoneFlow() {
    const phone = inp('iv-phone', { type: 'tel', inputmode: 'tel', placeholder: '+92 3xx xxxxxxx', required: true, autocomplete: 'tel' });
    const msg = el('div'); const btn = el('button', { class: 'iv-btn primary block', type: 'submit' }, t('sec_send'));
    mount(body, el('form', { onSubmit: async (e) => { e.preventDefault(); btn.disabled = true; mount(msg, '');
      try {
        const en = await mfaEnrollPhone(phone.value.replace(/[\s-]/g, ''));
        const ch = await mfaChallenge(en.id);
        const code = codeField(); const msg2 = el('div'); const btn2 = el('button', { class: 'iv-btn primary block', type: 'submit' }, t('sec_verify'));
        mount(body, el('form', { onSubmit: async (e2) => { e2.preventDefault(); btn2.disabled = true; mount(msg2, '');
          try { await mfaVerifyChallenge(en.id, ch.id, code.value); done(); } catch (ex) { mount(msg2, el('div', { class: 'iv-err' }, err(ex))); btn2.disabled = false; } } }, [
          el('div', { class: 'iv-ok' }, t('sec_sent', phone.value)), msg2, field(t('sec_code'), code), btn2,
          el('div', { class: 'iv-actions' }, el('button', { class: 'iv-btn sm', type: 'button', onClick: chooser }, '‹ ' + t('sec_choose'))),
        ]));
        setTimeout(() => code.focus(), 50);
      } catch (ex) { mount(msg, el('div', { class: 'iv-err' }, err(ex))); btn.disabled = false; } } }, [
      el('p', { class: 'iv-muted' }, t('sec_phone_s')), msg, field(t('sec_phone_no'), phone), btn,
      el('div', { class: 'iv-actions' }, el('button', { class: 'iv-btn sm', type: 'button', onClick: chooser }, '‹ ' + t('sec_choose'))),
    ]));
    setTimeout(() => phone.focus(), 50);
  }
  chooser();
}

// ---------- agreement: published document + in-portal e-signature ----------
function sigPad() {
  const c = el('canvas', { class: 'iv-sigpad', width: 640, height: 220 });
  const ctx = c.getContext('2d'); let drawing = false, drew = false, last = null;
  ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#10223B';
  const pos = (e) => { const r = c.getBoundingClientRect(); const p = e.touches ? e.touches[0] : e; return { x: (p.clientX - r.left) * c.width / r.width, y: (p.clientY - r.top) * c.height / r.height }; };
  const start = (e) => { drawing = true; last = pos(e); e.preventDefault(); };
  const move = (e) => { if (!drawing) return; const p = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; drew = true; e.preventDefault(); };
  const end = () => { drawing = false; };
  c.addEventListener('pointerdown', start); c.addEventListener('pointermove', move); window.addEventListener('pointerup', end);
  const clr = el('button', { class: 'clr', type: 'button', onClick: () => { ctx.clearRect(0, 0, c.width, c.height); drew = false; } }, t('doc_clear'));
  return { node: el('div', { class: 'iv-sigwrap' }, [c, clr]), hasInk: () => drew, png: () => c.toDataURL('image/png') };
}
async function agreementV3() {
  const a = S.agr;
  let res; try { res = await invCurrentDoc(a.id); } catch (ex) { alert(err(ex)); return; }
  const doc = res && res.doc;
  if (!doc) { showTermsSummary(); return; }
  const lang = doc.lang || 'en';
  const mine = (doc.signatures || []).find(s => s.party === 'investor');
  const co = (doc.signatures || []).find(s => s.party === 'company');
  const ph = /class="ph"/.test(doc.body_md) || /\[[A-Z][A-Za-z ]+\]/.test(doc.body_md);
  const viewLang = getLang();
  const translated = (viewLang !== lang && doc.params) ? buildFromParams(doc.params, viewLang) : null;
  const shownLang = translated ? viewLang : lang;
  const view = el('div', { class: 'iv-doc' + (shownLang === 'ur' ? ' rtl' : '') });
  view.innerHTML = mdToHtml(translated || doc.body_md);
  const stale = !!doc.stale;
  const sigStatus = el('div', null, [
    mine ? el('div', { class: 'iv-signed' }, [icon('check', ''), el('div', null, [el('b', null, t('doc_signed_you')), ' · ', mine.signer_name, ' · ', fmtDate(mine.signed_at)])]) : null,
    co ? el('div', { class: 'iv-signed' }, [icon('check', ''), el('div', null, [el('b', null, t('doc_signed_co')), ' · ', co.signer_name + (co.signer_title ? ', ' + co.signer_title : ''), ' · ', fmtDate(co.signed_at)])]) : null,
    doc.fully_signed ? el('div', { class: 'iv-ok' }, t('doc_done')) : mine && !co ? el('div', { class: 'iv-warn' }, t('doc_await_co')) : !mine ? el('div', { class: 'iv-warn' }, t('doc_await_you')) : null,
  ]);
  const body = el('div');
  const close = openSheet(t('doc_title'), body);
  const signBlock = () => {
    if (mine) return null;
    if (stale) return null;
    if (ph) return el('div', { class: 'iv-warn' }, t('doc_ph'));
    const name = inp('iv-sig-name', { type: 'text', required: true, autocomplete: 'name', placeholder: S.me && S.me.name ? S.me.name : '' });
    const pad = sigPad();
    const consent = el('input', { type: 'checkbox', id: 'iv-consent', required: true });
    const msg = el('div'); const btn = el('button', { class: 'iv-btn primary block', type: 'submit', disabled: true }, t('doc_read'));
    const gate = el('div', null);
    let reached = false;
    view.addEventListener('scroll', () => { if (!reached && view.scrollTop + view.clientHeight >= view.scrollHeight - 24) { reached = true; btn.disabled = false; btn.textContent = t('doc_sign'); } });
    setTimeout(() => { if (view.scrollHeight <= view.clientHeight + 8) { reached = true; btn.disabled = false; btn.textContent = t('doc_sign'); } }, 100);
    return el('form', { onSubmit: async (e) => {
      e.preventDefault(); if (!reached) return; btn.disabled = true; mount(msg, '');
      try {
        await invSignDoc({ doc_id: doc.id, signer_name: name.value, hash: doc.hash, consent: true, consent_text: t('doc_consent'), signature_png: pad.hasInk() ? pad.png() : null, user_agent: navigator.userAgent });
        S.doc = null; close(); await refresh(); setTimeout(() => showAgreement(), 300);
      } catch (ex) { mount(msg, el('div', { class: 'iv-err' }, err(ex))); btn.disabled = false; }
    } }, [
      el('div', { class: 'iv-sect' }, el('h2', null, t('doc_sign'))), msg, gate,
      field(t('doc_name'), name),
      el('div', { class: 'iv-field' }, [el('label', null, t('doc_draw')), pad.node]),
      el('label', { class: 'iv-check', for: 'iv-consent' }, [consent, el('span', null, t('doc_consent'))]),
      btn,
    ]);
  };
  const langSel = el('select', { class: 'iv-select', 'aria-label': t('sel_lang'), onChange: async (e) => { const code = e.target.value; setLang(code); try { localStorage.setItem('lb-inv-lang', code); } catch (_) {} try { await invSetLang(code); } catch (_) {} close(); setTimeout(() => showAgreement(), 50); } }, LANGS.map(([code, label]) => el('option', { value: code, selected: code === getLang() }, label)));
  mount(body, [
    el('div', { class: 'iv-doc-top' }, [el('span', { class: 'iv-muted' }, t('doc_read_in')), langSel]),
    (!mine && co) ? el('div', { class: 'iv-doc-intro' }, [icon('doc'), el('div', null, [el('b', null, t('doc_intro_t')), el('p', null, t('doc_intro_b', co.signer_name))])]) : null,
    el('p', { class: 'iv-muted', style: 'margin:0 0 8px' }, [el('b', null, doc.title), ' · ', t('doc_v', doc.version), ' · ', fmtDate(doc.published_at)]),
    stale ? el('div', { class: 'iv-warn' }, t('doc_stale', fmtDate(res.terms_changed_at))) : null,
    translated ? el('div', { class: 'iv-gl-p' }, t('doc_translated', doc.version, t('doc_lang_' + lang))) : null,
    sigStatus, view,
    el('p', { class: 'iv-muted', style: 'margin:8px 0 0;font-size:.72rem' }, t('doc_hash')), el('div', { class: 'iv-hash' }, doc.hash),
    signBlock(),
    el('div', { class: 'iv-actions', style: 'margin-top:12px' }, [
      el('button', { class: 'iv-btn sm', type: 'button', onClick: () => { const w = window.open('', '_blank'); if (!w) return; w.document.write('<!doctype html><title>' + doc.title + '</title><style>body{font-family:Georgia,serif;max-width:760px;margin:30px auto;padding:0 20px;line-height:1.6}' + (shownLang === 'ur' ? 'body{direction:rtl;font-family:"Noto Nastaliq Urdu",serif}' : '') + '.ph{background:#FEF3C7}</style>' + mdToHtml(translated || doc.body_md) + '<hr><p style="font-family:monospace;font-size:11px">SHA-256 ' + doc.hash + '</p>' + (doc.signatures || []).map(s => '<p>' + (s.party === 'investor' ? 'Investor' : 'Company') + ': ' + s.signer_name + ' — ' + new Date(s.signed_at).toLocaleString() + '</p>').join('')); w.document.close(); } }, t('doc_download')),
      el('button', { class: 'iv-btn sm', type: 'button', onClick: () => { close(); showTermsSummary(); } }, t('h_agreement')),
    ]),
    flagButton('agreement', a.id),
  ]);
}

// ---------- investor-initiated changes (bl_inv_0405): change commitment / stop / resume ----------
function amendCard(p) {
  const a = S.agr; const box = el('div', { class: 'iv-card' }, [el('p', { class: 'iv-eyebrow' }, t('am_title')), el('div', { class: 'iv-sk', style: 'height:14px;width:60%' })]);
  if (a.status === 'wound_down' || a.status === 'closed') return null;
  const paint = (list) => {
    const pending = list.find(m => m.status === 'proposed');
    const closed = !!a.commitment_closed_at || p.commitment_closed;
    const kindLabel = (m) => t('am_kind_' + m.kind);
    const hist = list.filter(m => m.status !== 'proposed').slice(0, 5);
    mount(box, [
      el('p', { class: 'iv-eyebrow' }, t('am_title')), el('p', { class: 'iv-muted', style: 'margin:0 0 10px' }, t('am_sub')),
      pending ? el('div', { class: 'iv-warn' }, [el('b', null, kindLabel(pending) + ' → ' + money(pending.new_value.commitment_cap)), el('div', null, t('am_pending')),
        el('button', { class: 'iv-btn sm', style: 'margin-top:8px', onClick: async () => { try { await invWithdrawAmendment(pending.id); S.amend = null; renderShell(); } catch (ex) { alert(err(ex)); } } }, t('am_withdraw'))]) :
      el('div', { class: 'iv-choice' }, [
        el('button', { type: 'button', onClick: () => amendSheet('commitment_change', p) }, [icon('doc'), t('am_change'), el('small', null, money(p.commitment_cap))]),
        closed ? el('button', { type: 'button', onClick: () => amendSheet('resume_funding', p) }, [icon('arrowBack'), t('am_resume')])
               : el('button', { type: 'button', onClick: () => amendSheet('stop_funding', p) }, [icon('x'), t('am_stop'), el('small', null, money(p.funded))]),
      ]),
      hist.length ? el('div', null, [el('div', { class: 'iv-sect' }, el('h2', null, t('am_history'))), el('div', { class: 'iv-list' }, hist.map(m => el('div', { class: 'iv-row', style: 'cursor:default' }, [
        el('div', { class: 'ic' }, icon('doc')), el('div', null, [el('div', { class: 't' }, kindLabel(m) + ' → ' + money(m.new_value.commitment_cap)), el('div', { class: 's' }, fmtDate(m.decided_at || m.created_at) + (m.decision_note ? ' · ' + m.decision_note : ''))]),
        el('div', { class: 'amt' }, pill(t('am_' + m.status), m.status === 'accepted' ? 'ok' : m.status === 'declined' ? 'due' : 'wait'))])))]) : null,
    ]);
  };
  (S.amend && S.amend.agr === a.id ? Promise.resolve(S.amend.list) : invMyAmendments(a.id).then(r => { S.amend = { agr: a.id, list: r.amendments || [] }; return S.amend.list; }))
    .then(paint).catch(ex => mount(box, [el('p', { class: 'iv-eyebrow' }, t('am_title')), el('p', { class: 'iv-muted' }, err(ex))]));
  return box;
}
function amendSheet(kind, p) {
  const a = S.agr; const proRata = a.early_stop_share_mode !== 'keep';
  const cap = inp('iv-newcap', { type: 'number', inputmode: 'decimal', min: String(Number(p.funded || 0)), step: '1', value: kind === 'stop_funding' ? p.funded : '', required: kind !== 'stop_funding', disabled: kind === 'stop_funding' });
  const reason = el('textarea', { id: 'iv-am-reason', name: 'iv-am-reason', rows: 2 });
  const prev = el('div', { class: 'iv-pay' }); const msg = el('div'); const btn = el('button', { class: 'iv-btn primary block', type: 'submit' }, t('am_send'));
  const paint = () => {
    const nc = kind === 'stop_funding' ? Number(p.funded) : Number(cap.value || 0);
    const orig = Number(p.original_cap || p.commitment_cap); const funded = Number(p.funded || 0);
    const stops = nc > 0 && nc === funded;
    const share = stops && proRata ? Number(p.permanent_share_pct) * funded / orig : Number(p.permanent_share_pct);
    mount(prev, [el('p', { class: 'iv-eyebrow', style: 'margin:0' }, t('am_preview')), dl([
      [t('am_p_cap'), nc > 0 ? money(nc) : '—'],
      [t('am_p_target'), money(stops ? funded : (p.recovery_target && Number(p.recovery_target) > funded ? p.recovery_target : nc || funded))],
      [t('am_p_share'), pct(share)],
    ]), el('p', { class: 'iv-muted', style: 'margin:8px 0 0;font-size:.78rem' }, t('am_p_note'))]);
  };
  cap.oninput = paint; paint();
  const close = openSheet(t('am_kind_' + kind), el('form', { onSubmit: async (e) => { e.preventDefault(); btn.disabled = true; mount(msg, '');
    try { await invProposeAmendment({ agreement_id: a.id, kind, new_cap: kind === 'stop_funding' ? null : cap.value, reason: reason.value }); S.amend = null; mount(msg, el('div', { class: 'iv-ok' }, t('am_pending'))); setTimeout(() => { close(); renderShell(); }, 900); }
    catch (ex) { mount(msg, el('div', { class: 'iv-err' }, err(ex))); btn.disabled = false; } } }, [
    msg, kind === 'stop_funding' ? el('p', { class: 'iv-muted' }, termWhat('recovery', getLang())) : field(t('am_new_cap'), cap, money(p.funded) + ' ≤ … '), prev, field(t('am_reason'), reason), btn,
  ]));
}

// ============================================================================
// v4 — notifications, founder updates, plan, revenue model, traffic, growth v2,
//      branded printable documents, audit trail, glossary links in expense rows
// ============================================================================
function bellBtn() {
  const b = el('button', { class: 'iv-bell', type: 'button', 'aria-label': t('nt_title'), onClick: () => showNotifications() }, [icon('inbox', ''), el('i', { class: 'n', id: 'iv-bell-n', style: 'display:none' })]);
  invNotifications(50).then(r => { S.notif = r; const n = document.getElementById('iv-bell-n'); if (n && r.unread > 0) { n.textContent = r.unread > 99 ? '99+' : String(r.unread); n.style.display = ''; } }).catch(() => {});
  return b;
}
function showNotifications() {
  const body = el('div'); openSheet(t('nt_title'), body); mount(body, skeleton());
  invNotifications(50).then(r => {
    S.notif = r; const items = r.items || [];
    mount(body, [
      items.length ? el('div', { class: 'iv-actions', style: 'justify-content:flex-end' }, el('button', { class: 'iv-btn sm', onClick: async () => { await invMarkRead(null); const n = document.getElementById('iv-bell-n'); if (n) n.style.display = 'none'; body.querySelectorAll('.iv-new').forEach(x => x.remove()); } }, t('nt_read_all'))) : null,
      items.length ? el('div', { class: 'iv-list' }, items.map(n => el('div', { class: 'iv-row', style: 'cursor:default' }, [
        el('div', { class: 'ic' }, icon({ request: 'requests', expense: 'ledger', receipt: 'payments', payout: 'payments', statement: 'statements', document: 'doc', amendment: 'doc', flag: 'flag', update: 'inbox' }[n.kind] || 'inbox')),
        el('div', null, [el('div', { class: 't' }, [n.title, !n.read_at ? el('small', { class: 'iv-new', style: 'margin-left:6px' }, t('nt_new')) : null]), el('div', { class: 's' }, n.body || ''), el('div', { class: 's', style: 'opacity:.6' }, new Date(n.created_at).toLocaleString('en-GB'))]),
      ]))) : empty(t('nt_none')),
    ]);
  }).catch(ex => mount(body, el('div', { class: 'iv-err' }, err(ex))));
}
function updatesCard() {
  const box = el('div', { class: 'iv-card' }, [el('p', { class: 'iv-eyebrow' }, t('upd_title')), el('div', { class: 'iv-sk', style: 'height:14px;width:60%' })]);
  const kindPill = (k) => pill(t('upd_' + k), k === 'milestone' ? 'ok' : k === 'daily' ? 'blue' : 'wait');
  const item = (u) => el('div', { class: 'iv-upd' }, [el('div', { class: 'h' }, [kindPill(u.kind), el('span', null, new Date(u.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }))]), el('b', null, u.title), el('p', null, u.body)]);
  invUpdates(S.agr.id, 30).then(r => {
    const list = r.updates || [];
    mount(box, [el('p', { class: 'iv-eyebrow' }, t('upd_title')), el('p', { class: 'iv-muted', style: 'margin:0 0 10px' }, t('upd_sub')),
      list.length ? list.slice(0, 3).map(item) : el('p', { class: 'iv-muted', style: 'margin:0' }, t('upd_none')),
      list.length > 3 ? el('button', { class: 'iv-btn sm', style: 'margin-top:8px', onClick: () => openSheet(t('upd_all'), el('div', null, list.map(item))) }, t('upd_all')) : null]);
  }).catch(ex => mount(box, [el('p', { class: 'iv-eyebrow' }, t('upd_title')), el('p', { class: 'iv-muted' }, err(ex))]));
  return box;
}
function planCard(p) {
  const plan = S.settings && S.settings.plan; const items = (plan && plan.items) || [];
  const bp = S.settings && S.settings.business_plan;
  if (!plan || (!items.length && !plan.summary)) return el('div', { class: 'iv-card' }, [el('p', { class: 'iv-eyebrow' }, t('plan_title')), el('p', { class: 'iv-muted', style: 'margin:0 0 10px' }, bp ? t('bp_sub') : t('plan_none')), bp ? el('button', { class: 'iv-btn primary block', onClick: () => { S.tab = 'plan'; renderShell(); } }, t('bp_title') + ' ›') : null]);
  const total = items.reduce((a, i) => a + Number(i.amount || 0), 0);
  return el('div', { class: 'iv-card' }, [
    el('p', { class: 'iv-eyebrow' }, t('plan_title')), el('p', { class: 'iv-muted', style: 'margin:0 0 10px' }, plan.summary || t('plan_sub')),
    total ? el('div', { class: 'iv-prog' }, [el('div', { class: 'row' }, [el('span', null, t('plan_total') + ' ' + money(total)), el('b', null, money(p.spent) + ' ' + t('plan_vs'))]), el('div', { class: 'bar' }, el('i', { style: 'width:' + Math.min(100, Math.round(100 * Number(p.spent || 0) / total)) + '%' }))]) : null,
    el('div', { class: 'iv-plan' }, items.map(i => el('div', { class: 'iv-plan-item' }, [
      el('div', { class: 'h' }, [el('b', null, i.title), el('span', { class: 'amt' }, money(i.amount))]),
      i.when ? el('div', { class: 'r' }, [el('span', null, t('plan_item_when')), i.when]) : null,
      i.why ? el('div', { class: 'r' }, [el('span', null, t('plan_item_why')), i.why]) : null,
      i.growth ? el('div', { class: 'r g' }, [el('span', null, t('plan_item_growth')), i.growth]) : null,
    ]))),
  ]);
}
function revenueCard() {
  const rm = S.settings && S.settings.revenue_model;
  return el('div', { class: 'iv-card' }, [el('p', { class: 'iv-eyebrow' }, t('rev_title')),
    rm && rm.text ? el('p', { class: 'iv-gl-p', style: 'white-space:pre-line' }, rm.text) : el('p', { class: 'iv-muted', style: 'margin:0' }, t('rev_none')),
    el('p', { class: 'iv-muted', style: 'margin:8px 0 0;font-size:.78rem' }, termWhat('dispatcher', getLang()) + ' ' + termWhat('load', getLang()))]);
}
function trafficCard() {
  const tr = S.settings && S.settings.traffic; if (!tr || (!tr.gsc_clicks && !tr.ga_users && !tr.gsc_impressions)) return null;
  return el('div', { class: 'iv-card' }, [el('p', { class: 'iv-eyebrow' }, [t('tr_title'), ' ', impactBtn('traffic')]), el('p', { class: 'iv-muted', style: 'margin:0' }, t('tr_sub', tr.as_of ? fmtDate(tr.as_of) : '—')),
    el('div', { class: 'iv-growth' }, [tr.gsc_clicks != null ? tileN(tr.gsc_clicks, t('tr_clicks')) : null, tr.gsc_impressions != null ? tileN(tr.gsc_impressions, t('tr_impr')) : null, tr.ga_users != null ? tileN(tr.ga_users, t('tr_users')) : null]),
    tr.note ? el('p', { class: 'iv-muted', style: 'margin:8px 0 0' }, tr.note) : null]);
}
const tileN = (n, l) => el('div', null, [el('div', { class: 'n' }, String(Number(n || 0).toLocaleString('en-US'))), el('div', { class: 'l' }, l)]);
function impactBtn(k) { return el('button', { class: 'iv-q', type: 'button', 'aria-label': t('g_impact'), onClick: (e) => { e.stopPropagation(); openSheet(t('g_impact'), el('p', { class: 'iv-gl-p' }, impactWhat(k, getLang()))); } }, '±'); }
// override the v3 growth card with the v2 data shape (daily / monthly / verified split)
function growthCard() {
  const box = el('div', { class: 'iv-card' }, [el('p', { class: 'iv-eyebrow' }, t('growth')), el('div', { class: 'iv-sk', style: 'height:14px;width:70%' })]);
  const tile = (n, l, imp, term) => el('div', null, [el('div', { class: 'n' }, String(Number(n || 0).toLocaleString('en-US'))), el('div', { class: 'l' }, [l, ' ', term ? qBtn(term) : null, imp ? impactBtn(imp) : null])]);
  const bars = (series, label, key, fmt) => {
    if (!series || !series.length) return null;
    const max = Math.max(1, ...series.map(s => Number(s.n || 0)));
    return el('div', { class: 'iv-bars-wrap' }, [el('p', { class: 'iv-muted', style: 'margin:12px 0 0;font-size:.78rem' }, label),
      el('div', { class: 'iv-bars' }, series.map((s, i) => el('div', { style: 'height:' + Math.max(4, Math.round(100 * Number(s.n || 0) / max)) + '%', title: (fmt ? fmt(s.n) : s.n) + ' · ' + s[key] }, (series.length <= 8 || i % 5 === 0) ? el('span', null, key === 'month' ? new Date(s.month).toLocaleDateString('en-GB', { month: 'short' }) : new Date(s.day).getDate()) : null)))]);
  };
  const paint = (g) => {
    let mode = 'daily';
    const chart = el('div');
    const paintChart = () => mount(chart, mode === 'daily'
      ? [bars(g.carriers_by_day, t('g_d_carriers'), 'day'), bars(g.trips_by_day, t('g_d_trips'), 'day'), bars(g.fees_by_day, t('g_d_fees'), 'day', (n) => 'USD ' + n)]
      : [bars(g.carriers_by_month, t('g_new_carriers'), 'month'), bars(g.trips_by_month, t('g_delivered'), 'month')]);
    const seg = el('div', { class: 'iv-seg' }, [['daily', t('g_daily')], ['monthly', t('g_monthly')]].map(([m, l]) => el('button', { class: m === mode ? 'on' : '', type: 'button', onClick: (e) => { mode = m; seg.querySelectorAll('button').forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); paintChart(); } }, l)));
    paintChart();
    mount(box, [
      el('p', { class: 'iv-eyebrow' }, t('growth')), el('p', { class: 'iv-muted', style: 'margin:0' }, t('growth_sub')),
      el('div', { class: 'iv-sect' }, el('h2', null, t('g_carriers'))),
      el('div', { class: 'iv-growth' }, [tile(g.carriers_total, t('g_carriers'), null, 'carrier'), tile(g.carriers_verified, t('g_verified'), 'carriers_verified'), tile(g.carriers_in_review, t('g_review')), tile(g.carriers_unverified, t('g_unverified'), 'carriers_unverified'), tile(g.carriers_assigned, t('g_assigned'), 'carriers_assigned'), tile(g.trucks_active, t('g_trucks'))]),
      el('div', { class: 'iv-sect' }, el('h2', null, t('g_brokers'))),
      el('div', { class: 'iv-growth' }, [tile(g.brokers_total, t('g_brokers'), null, 'broker'), tile(g.brokers_active, t('g_b_active'), 'brokers_active'), tile(g.brokers_pending, t('g_b_pending')), tile(g.brokers_identity_verified, t('g_b_identity')), tile(g.dispatchers_active, t('g_dispatchers'), 'dispatchers_active', 'dispatcher'), tile(g.loads_booked, t('g_loads'), null, 'load')]),
      el('div', { class: 'iv-sect' }, el('h2', null, t('g_delivered'))),
      el('div', { class: 'iv-growth' }, [tile(g.trips_delivered, t('g_delivered'), 'trips_delivered'), tile(g.trips_delivered_30d, t('g_del30')), tile(g.trips_in_transit, 'In transit')]),
      el('div', { class: 'iv-kv', style: 'margin-top:10px' }, [kv(t('g_fees'), money(g.fees_collected_total, 'USD'), '', null), kv(t('g_fees30'), money(g.fees_collected_30d, 'USD')), kv(t('g_gross30'), money(g.gross_moved_30d, 'USD')), kv('Fees not yet paid', money(g.fees_outstanding, 'USD'))]),
      el('div', { style: 'display:flex;gap:6px;margin-top:6px' }, [impactBtn('fees_collected'), el('span', { class: 'iv-muted', style: 'font-size:.78rem' }, t('g_impact'))]),
      seg, chart,
      el('p', { class: 'iv-muted', style: 'margin:10px 0 0;font-size:.72rem' }, t('g_as_of') + ' ' + new Date(g.as_of).toLocaleString('en-GB')),
    ]);
  };
  (S.growth ? Promise.resolve(S.growth) : invGrowth().then(g => { S.growth = g; return g; })).then(paint)
    .catch(ex => mount(box, [el('p', { class: 'iv-eyebrow' }, t('growth')), el('p', { class: 'iv-muted' }, err(ex))]));
  return box;
}

// ---------- branded printable documents (receipt / confirmation / statement / reports) ----------
// Opens a print-ready page (the browser's "Save as PDF" makes the file). Real logo + tagline, record id, hash of the rows.
function brandDoc(title, subtitle, rows, table, footerNote, extraHtml) {
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rtl = getLang() === 'ur';
  const w = window.open('', '_blank'); if (!w) { alert('Popup blocked'); return; }
  const rowsHtml = (rows || []).map(([k, v]) => '<tr><th>' + esc(k) + '</th><td>' + esc(v) + '</td></tr>').join('');
  const one = (tb) => (tb.title ? '<h2 style="font-size:15px;margin:22px 0 6px;color:#0883F7;text-transform:uppercase;letter-spacing:.08em">' + esc(tb.title) + '</h2>' : '') + '<table class="grid"><thead><tr>' + tb.head.map(h => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + tb.rows.map(r => '<tr>' + r.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  const tableHtml = Array.isArray(table) ? table.map(one).join('') : table ? one(table) : '';
  w.document.write('<!doctype html><html' + (rtl ? ' dir="rtl"' : '') + '><head><meta charset="utf-8"><title>' + esc(title) + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800&family=Noto+Nastaliq+Urdu&display=swap" rel="stylesheet">' +
    '<style>body{font-family:Manrope,Arial,sans-serif;color:#10223B;margin:0;background:#fff}' + (rtl ? 'body{font-family:"Noto Nastaliq Urdu",Manrope,serif;line-height:1.9}' : '') +
    '.page{max-width:800px;margin:0 auto;padding:36px 40px}.head{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #FC5305;padding-bottom:16px;margin-bottom:22px}' +
    '.head img{height:34px}.tag{font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#0883F7;margin-top:6px}.meta{text-align:' + (rtl ? 'left' : 'right') + ';font-size:12px;color:#64748B}' +
    'h1{font-size:22px;margin:0 0 4px}.sub{color:#64748B;margin:0 0 18px}table{border-collapse:collapse;width:100%;margin:10px 0 18px}th,td{padding:9px 10px;border-bottom:1px solid #E6EDF5;text-align:' + (rtl ? 'right' : 'left') + ';font-size:13.5px;vertical-align:top}' +
    'th{width:34%;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#64748B;font-weight:700}.grid th{width:auto;background:#F5F8FC}.grid td:last-child,.grid th:last-child{text-align:' + (rtl ? 'left' : 'right') + ';font-variant-numeric:tabular-nums}' +
    '.foot{margin-top:26px;padding-top:14px;border-top:1px solid #E6EDF5;font-size:11px;color:#94A3B8;line-height:1.6}.stamp{display:inline-block;border:2px solid #2ED18A;color:#0B7551;font-weight:800;padding:4px 10px;border-radius:8px;font-size:12px;letter-spacing:.06em}' +
    '@media print{.page{padding:0}button{display:none}}</style></head><body><div class="page">' +
    '<div class="head"><div><img src="https://loadboot.com/logo-full.png" alt="LoadBoot"><div class="tag">' + TAGLINE + '</div></div><div class="meta">LoadBoot LLC<br>Investor Portal · loadboot.com/app/investor<br>' + esc(new Date().toLocaleString('en-GB')) + '</div></div>' +
    '<h1>' + esc(title) + '</h1><p class="sub">' + esc(subtitle || '') + '</p>' + (rowsHtml ? '<table>' + rowsHtml + '</table>' : '') + tableHtml +
    (extraHtml || '') + '<div class="foot">' + esc(footerNote || '') + '<br>Investor: ' + esc(S.me.name) + ' · Agreement: ' + esc(S.agr.title || '') + ' · ' + esc(S.agr.id) + '<br>This document is generated from the portal record, which is the record both parties rely on. Every entry can be questioned in the portal.</div>' +
    '<p style="margin-top:20px"><button onclick="window.print()" style="background:#0883F7;color:#fff;border:0;border-radius:10px;padding:10px 18px;font:700 14px Manrope,Arial">Print / Save as PDF</button></p></div></body></html>');
  w.document.close();
}
async function expenseReceipt(x) {
  const L = S.ledger || {}; const tr = (L.receipts || []).find(r => r.received_date === x.tranche && r.state === 'confirmed');
  let img = '';
  if (x.receipt_url) { try { const u = await invProofUrl(x.receipt_url, 900); if (!/\.pdf(\?|$)/i.test(x.receipt_url)) img = '<h2 style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#64748B;margin:18px 0 6px">' + t('rcpt_img') + '</h2><img src="' + u + '" style="max-width:100%;max-height:520px;border:1px solid #E6EDF5;border-radius:10px">'; else img = '<p style="font-size:12px;color:#64748B">' + t('rcpt_img') + ': PDF (' + t('view') + ' in portal)</p>'; } catch (_) {} }
  brandDoc(t('receipt') + ' — ' + (x.vendor || catName(x.category)), money(x.amount) + ' · ' + fmtDate(x.date) + (x.reversed ? ' · REVERSAL' : ''),
    [[t('rcpt_no'), x.id.slice(0, 8).toUpperCase()], [t('amount'), money(x.amount)], [t('rcpt_when'), fmtDate(x.date)],
     [t('rcpt_where'), (x.vendor || '—') + ' · ' + catName(x.category)],
     [t('rcpt_why'), (x.description ? x.description + ' — ' : '') + (vendorWhat(x.vendor, getLang()) || catWhat(x.category, getLang()))],
     [t('rcpt_which'), tr ? (t('rec_in') + ' ' + money(tr.amount) + ' · ' + fmtDate(tr.received_date) + ' · ' + t('p_lb_confirmed') + ' ' + fmtDate(tr.confirmed_at)) : (x.tranche ? t('l_tranche', fmtDate(x.tranche)) : '—')],
     [t('l_recurring'), x.recurring ? t('l_yes') : t('l_no')], [t('rcpt_by'), 'Command Center · ' + fmtDate(x.date)], [t('rcpt_ack'), x.acknowledged_at ? fmtDate(x.acknowledged_at) : '—'], [t('proof'), x.receipt_url ? '✓' : t('l_no_receipt')]],
    null, '', img);
}
function paymentConfirmation(r) {
  brandDoc(t('dl_confirm'), t('p_lb_confirmed') + ' ' + fmtDate(r.confirmed_at),
    [[t('amount'), money(r.amount)], [t('date'), fmtDate(r.received_date)], [t('method'), r.method || '—'], [t('reference'), r.reference || '—'], [t('tr_from'), trFrom(r) || '—'], [t('tr_into'), trInto(r) || '—'], [t('p_you_declared'), r.declared_at ? fmtDate(r.declared_at) : '—'], [t('p_lb_confirmed'), fmtDate(r.confirmed_at)], ['Record id', r.id]],
    null, 'CONFIRMED BY BOTH PARTIES — counts toward the funded amount.');
}
function statementDoc(s) {
  const po = s.payout || {};
  brandDoc(t('nav_statements') + ' — ' + fmtMonth(s.month), t('profit') + ': ' + money(s.profit),
    [[t('revenue'), money(s.revenue)], [t('expenses'), money(s.expenses)], [t('profit'), money(s.profit)], [t('s_payback'), money(po.payback)], [t('s_share'), money(po.share)], [t('s_to_you'), money(po.total)], [t('s_paid_on'), po.paid_date ? fmtDate(po.paid_date) : '—'], [t('note'), s.note || '—']], null, '');
}
function expenseReport(L) {
  const p = L.position || {};
  brandDoc(t('dl_all_expenses'), money(p.spent) + ' ' + t('h_spent').toLowerCase() + ' · ' + money(p.fund_cash) + ' ' + t('h_fund_cash').toLowerCase(),
    [[t('h_funded'), money(p.funded)], [t('h_spent'), money(p.spent)], [t('h_fund_cash'), money(p.fund_cash)]],
    { head: [t('date'), t('l_vendor'), t('l_details'), 'Category', t('amount')], rows: (L.expenses || []).map(x => [fmtDate(x.date), x.vendor || '—', (x.description || '') + (x.reversed ? ' (' + t('l_reversal') + ')' : ''), catName(x.category), (x.reversed ? '+' : '−') + money(x.amount)]) }, '');
}
// vendor names → glossary links ("Netlify + Resend" becomes two links)
function vendorLinks(text) {
  const parts = String(text || '').split(/(\s*[+,/&]\s*)/);
  return el('span', null, parts.map(pt => {
    const w = vendorWhat(pt.trim(), getLang());
    return w ? el('a', { href: '#', class: 'iv-term', onClick: (e) => { e.preventDefault(); e.stopPropagation(); openSheet(pt.trim(), el('p', { class: 'iv-gl-p' }, w)); } }, pt) : pt;
  }));
}
// full audit trail
function showAudit() {
  const body = el('div'); openSheet(t('log_title'), body); mount(body, skeleton());
  invAudit(S.agr.id, 200).then(r => {
    const ev = r.events || [];
    mount(body, [el('p', { class: 'iv-muted' }, t('log_sub')), ev.length ? el('div', { class: 'iv-tl' }, ev.map(e => el('div', null, [el('b', null, e.summary || e.action), el('small', null, new Date(e.at).toLocaleString('en-GB') + ' · ' + e.by + ' · ' + e.action)]))) : empty(t('log_none'))]);
  }).catch(ex => mount(body, el('div', { class: 'iv-err' }, err(ex))));
}

// ============================================================================
// PLAN tab — the full plan behind the investor's money (settings.business_plan, written in CC)
// ============================================================================
function renderPlan(host) {
  const bp = S.settings && S.settings.business_plan;
  if (!bp) { mount(host, [el('h1', { class: 'iv-h1' }, t('bp_title')), empty(t('bp_none'), 'doc')]); return; }
  const range = (lo, hi) => (Number(lo) || Number(hi)) ? (Number(lo) === Number(hi) || !Number(hi) ? money(lo) : money(lo) + ' – ' + money(hi)) : '—';
  const sum = (rows, k1, k2) => rows.reduce((a, r) => [a[0] + Number(r[k1] || 0), a[1] + Number(r[k2] || r[k1] || 0)], [0, 0]);
  const sect = (id, title, body, ic) => el('section', { class: 'iv-card iv-bp', id: 'bp-' + id }, [el('div', { class: 'iv-sec-row' }, [el('p', { class: 'iv-eyebrow', style: 'margin:0' }, title), ic ? icon(ic, '') : null]), body]);
  const tbl = (head, rows, cls) => el('div', { class: 'iv-tblwrap' }, el('table', { class: 'iv-tbl ' + (cls || '') }, [el('thead', null, el('tr', null, head.map(h => el('th', null, h)))), el('tbody', null, rows.map(r => el('tr', null, r.map(c => el('td', null, c)))))]));
  const jump = (id) => () => { const n = document.getElementById(id); if (n) n.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const setupT = sum(bp.setup || [], 'low', 'high'), m1 = sum((bp.monthly || []).filter(r => r.phase !== '2'), 'low', 'high'), m2 = sum(bp.monthly || [], 'low', 'high');
  const lvl = (l) => pill(t('bp_risk_' + (l || 'med')), l === 'high' ? 'due' : l === 'low' ? 'ok' : 'wait');
  const stStatus = (st) => st === 'done' ? 'done' : st === 'now' ? 'now' : '';
  const pos = S.agr.position || {};
  const toc = [['stand', t('bp_stand')], ['runway', t('bp_runway')], ['calc', t('bp_calc')], ['solver', t('bp_solver')], ['city', t('bp_city')], ['setup', t('bp_setup')], ['monthly', t('bp_monthly')], ['team', t('bp_team')], ['unit', t('bp_unit')], ['growth', t('bp_growth')], ['milestones', t('bp_milestones')], ['scen', t('bp_scen')], ['risks', t('bp_risks')], ['comp', t('bp_comp')], ['strat', t('bp_strat')], ['share', t('bp_share')]];
  mount(host, [
    agrPicker(), el('h1', { class: 'iv-h1' }, t('bp_title')), el('p', { class: 'iv-sub' }, t('bp_sub')),
    bp.status !== 'final' ? el('div', { class: 'iv-warn' }, [t('bp_draft'), bp.note ? el('div', { style: 'margin-top:6px;opacity:.85' }, bp.note) : null]) : null,
    el('div', { class: 'iv-toc' }, toc.map(([id, l]) => el('button', { type: 'button', onClick: jump('bp-' + id) }, l))),
    el('div', { class: 'iv-actions', style: 'margin:8px 0 14px;flex-wrap:wrap' }, [
      el('button', { class: 'iv-btn sm', onClick: () => planDoc(bp) }, [icon('download'), t('bp_download')]),
      el('button', { class: 'iv-btn sm', onClick: () => { S.tab = 'home'; renderShell(); setTimeout(() => { const n = document.querySelector('.iv-growth'); if (n) n.scrollIntoView({ behavior: 'smooth' }); }, 100); } }, t('bp_see_growth')),
      el('button', { class: 'iv-btn sm', onClick: () => showAgreement() }, t('bp_see_agreement')),
      el('button', { class: 'iv-btn sm', onClick: () => { S.tab = 'ledger'; renderShell(); } }, t('bp_see_ledger')),
    ]),
    el('div', { class: 'iv-home iv-bp-grid' }, [
      bp.stand ? sect('stand', t('bp_stand'), [el('p', { class: 'iv-bp-h' }, bp.stand.headline || ''), el('ul', { class: 'iv-bp-ul' }, (bp.stand.points || []).map(x => el('li', null, x)))], 'home') : null,
      planRunway(bp, pos), planCalc(bp, pos), planSolver(), planOptions(bp),
      bp.city ? sect('city', t('bp_city'), [el('p', { class: 'iv-bp-h' }, bp.city.chosen || '—'), el('ul', { class: 'iv-bp-ul' }, (bp.city.why || []).map(x => el('li', null, x))),
        (bp.city.alternatives || []).length ? el('div', null, [el('p', { class: 'iv-muted', style: 'margin:10px 0 4px;font-weight:700' }, t('bp_city_alt')), tbl(['', '+', '−'], bp.city.alternatives.map(a => [el('b', null, a.city), a.pros || '', a.cons || '']))]) : null], 'flag') : null,
      (bp.setup || []).length ? sect('setup', t('bp_setup'), [tbl(['', t('bp_range'), ''], bp.setup.map(r => [el('b', null, r.item), range(r.low, r.high), el('span', { class: 'iv-muted' }, r.note || '')])), el('div', { class: 'iv-bp-total' }, [el('span', null, t('bp_total_setup')), el('b', null, range(setupT[0], setupT[1]))])], 'office') : null,
      (bp.monthly || []).length ? sect('monthly', t('bp_monthly'), [
        el('p', { class: 'iv-muted', style: 'margin:0 0 4px;font-weight:700' }, t('bp_phase1')), tbl(['', t('bp_range'), ''], bp.monthly.filter(r => r.phase !== '2').map(r => [el('b', null, r.item), range(r.low, r.high), el('span', { class: 'iv-muted' }, r.note || '')])),
        el('div', { class: 'iv-bp-total' }, [el('span', null, t('bp_total_month') + ' · ' + t('bp_phase1')), el('b', null, range(m1[0], m1[1]))]),
        bp.monthly.some(r => r.phase === '2') ? el('div', null, [el('p', { class: 'iv-muted', style: 'margin:12px 0 4px;font-weight:700' }, t('bp_phase2')), tbl(['', t('bp_range'), ''], bp.monthly.filter(r => r.phase === '2').map(r => [el('b', null, r.item), range(r.low, r.high), el('span', { class: 'iv-muted' }, r.note || '')])), el('div', { class: 'iv-bp-total' }, [el('span', null, t('bp_total_month') + ' · ' + t('bp_phase2')), el('b', null, range(m2[0], m2[1]))])]) : null], 'rent') : null,
      (bp.team || []).length ? sect('team', t('bp_team'), el('div', { class: 'iv-team' }, bp.team.map(m => el('div', { class: 'iv-member' }, [
        el('div', { class: 'av' }, String(m.person || m.role || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()),
        el('div', null, [el('b', null, m.role), el('div', { class: 's' }, [m.person || '—', ' · ', m.status || '']), el('div', { class: 's' }, [el('span', { class: 'k' }, t('bp_salary')), ' ', range(m.salary_low, m.salary_high)]), m.why ? el('div', { class: 's why' }, m.why) : null]),
      ]))), 'salary') : null,
      bp.unit ? sect('unit', t('bp_unit'), [el('p', { class: 'iv-gl-p' }, bp.unit.per_truck || ''), el('p', { class: 'iv-bp-h', style: 'font-size:.95rem' }, bp.unit.breakeven || ''), (bp.unit.assumptions || []).length ? el('div', null, [el('p', { class: 'iv-muted', style: 'margin:8px 0 2px;font-weight:700' }, t('bp_assump')), el('ul', { class: 'iv-bp-ul' }, bp.unit.assumptions.map(x => el('li', null, x)))]) : null], 'ledger') : null,
      (bp.growth || []).length ? sect('growth', t('bp_growth'), tbl([t('bp_col_month'), t('bp_col_carriers'), t('bp_col_disp'), t('bp_col_loads'), t('bp_col_rev'), ''], bp.growth.map(g => [el('b', null, g.month), g.carriers, g.dispatchers, g.loads, g.revenue, el('span', { class: 'iv-muted' }, g.note || '')]), 'wide'), 'statements') : null,
      (bp.milestones || []).length ? sect('milestones', t('bp_milestones'), el('div', { class: 'iv-tl iv-ms' }, bp.milestones.map(m => el('div', { class: stStatus(m.status) }, [el('b', null, m.title), el('small', null, m.note || '')]))), 'flag') : null,
      (bp.scenarios || []).length ? sect('scen', t('bp_scen'), el('div', { class: 'iv-scen' }, bp.scenarios.map((sc, i) => el('div', { class: 'iv-scen-item ' + (i === 0 ? 'best' : i === (bp.scenarios.length - 1) ? 'worst' : 'base') }, [el('div', { class: 'h' }, [el('b', null, sc.name), el('span', null, t('bp_chance') + ': ' + (sc.chance || '—'))]), el('p', null, sc.description || ''), el('p', { class: 'eff' }, [el('span', null, t('bp_effect') + ' — '), sc.investor_effect || ''])]))), 'shield') : null,
      (bp.risks || []).length ? sect('risks', t('bp_risks'), el('div', { class: 'iv-list' }, bp.risks.map(r => el('div', { class: 'iv-row', style: 'cursor:default' }, [el('div', { class: 'ic' }, lvl(r.level)), el('div', null, [el('div', { class: 't' }, r.risk), el('div', { class: 's' }, [el('b', null, t('bp_mitig') + ': '), r.mitigation || ''])])]))), 'shield') : null,
      (bp.competitors || []).length ? sect('comp', t('bp_comp'), tbl(['', t('bp_what'), t('bp_win')], bp.competitors.map(c => [el('b', null, c.name), c.what || '', el('span', { style: 'color:var(--iv-green)' }, c.why_we_win || '')])), 'flag') : null,
      (bp.strategies || []).length ? sect('strat', t('bp_strat'), el('div', { class: 'iv-plan' }, bp.strategies.map(st => el('div', { class: 'iv-plan-item' }, [el('div', { class: 'h' }, el('b', null, st.title)), el('div', { class: 'r' }, st.detail || '')]))), 'doc') : null,
      bp.share ? sect('share', t('bp_share'), [el('p', { class: 'iv-gl-p' }, bp.share.text || ''), el('div', { class: 'iv-actions' }, [el('button', { class: 'iv-btn sm', onClick: () => showTerm('share') }, t('gl_what')), el('button', { class: 'iv-btn sm', onClick: () => showAgreement() }, t('bp_see_agreement'))])], 'payments') : null,
    ]),
    el('p', { class: 'iv-muted', style: 'font-size:.75rem' }, t('bp_asof') + ' ' + (bp.as_of ? fmtDate(bp.as_of) : '—')),
  ]);
}
function planDoc(bp) {
  const range = (lo, hi) => (Number(lo) || Number(hi)) ? (Number(lo) === Number(hi) || !Number(hi) ? money(lo) : money(lo) + ' – ' + money(hi)) : '—';
  const tables = [];
  if ((bp.setup || []).length) tables.push({ title: t('bp_setup'), head: ['', t('bp_range'), ''], rows: bp.setup.map(r => [r.item, range(r.low, r.high), r.note || '']) });
  if ((bp.monthly || []).length) tables.push({ title: t('bp_monthly'), head: ['', t('bp_range'), 'Phase', ''], rows: bp.monthly.map(r => [r.item, range(r.low, r.high), r.phase || '1', r.note || '']) });
  if ((bp.team || []).length) tables.push({ title: t('bp_team'), head: [t('bp_role'), t('bp_person'), t('bp_status'), t('bp_salary'), t('bp_why')], rows: bp.team.map(m => [m.role, m.person || '', m.status || '', range(m.salary_low, m.salary_high), m.why || '']) });
  if ((bp.growth || []).length) tables.push({ title: t('bp_growth'), head: [t('bp_col_month'), t('bp_col_carriers'), t('bp_col_disp'), t('bp_col_loads'), t('bp_col_rev'), ''], rows: bp.growth.map(g => [g.month, g.carriers, g.dispatchers, g.loads, g.revenue, g.note || '']) });
  if ((bp.milestones || []).length) tables.push({ title: t('bp_milestones'), head: ['', t('bp_status'), ''], rows: bp.milestones.map(m => [m.title, m.status, m.note || '']) });
  if ((bp.scenarios || []).length) tables.push({ title: t('bp_scen'), head: ['', t('bp_chance'), '', t('bp_effect')], rows: bp.scenarios.map(s => [s.name, s.chance || '', s.description || '', s.investor_effect || '']) });
  if ((bp.risks || []).length) tables.push({ title: t('bp_risks'), head: ['', '', t('bp_mitig')], rows: bp.risks.map(r => [r.risk, r.level, r.mitigation || '']) });
  if ((bp.competitors || []).length) tables.push({ title: t('bp_comp'), head: ['', t('bp_what'), t('bp_win')], rows: bp.competitors.map(c => [c.name, c.what || '', c.why_we_win || '']) });
  if ((bp.strategies || []).length) tables.push({ title: t('bp_strat'), head: ['', ''], rows: bp.strategies.map(s => [s.title, s.detail || '']) });
  brandDoc(t('bp_title'), (bp.status !== 'final' ? 'DRAFT · ' : '') + (bp.stand && bp.stand.headline || ''),
    [[t('bp_city'), bp.city && bp.city.chosen || '—'], [t('bp_unit'), bp.unit && bp.unit.per_truck || '—'], [t('bp_share'), bp.share && bp.share.text || '—']], tables, bp.note || '');
}

// ---------- plan: runway chart, two-ways table, what-if calculator, problem solver ----------
function planRunway(bp, p) {
  const sumHi = (rows) => rows.reduce((a, r) => a + Number(r.high || r.low || 0), 0), sumLo = (rows) => rows.reduce((a, r) => a + Number(r.low || 0), 0);
  const setupLo = sumLo(bp.setup || []), setupHi = sumHi(bp.setup || []);
  const m1 = (bp.monthly || []).filter(r => r.phase !== '2'); const mLo = sumLo(m1), mHi = sumHi(m1);
  if (!setupHi && !mHi) return null;
  const cap = Number(p.original_cap || p.commitment_cap || 0), funded = Number(p.funded || 0);
  const monthsHi = mLo ? Math.max(0, (cap - setupHi) / mLo) : 0, monthsLo = mHi ? Math.max(0, (cap - setupLo) / mHi) : 0;
  const pctSetup = cap ? Math.min(100, 100 * setupHi / cap) : 0, pctFunded = cap ? Math.min(100, 100 * funded / cap) : 0;
  return el('div', { class: 'iv-card iv-bp', id: 'bp-runway' }, [
    el('p', { class: 'iv-eyebrow' }, t('bp_runway')), el('p', { class: 'iv-muted', style: 'margin:0 0 10px' }, t('bp_runway_sub')),
    el('div', { class: 'iv-runway' }, [el('i', { class: 'setup', style: 'width:' + pctSetup + '%' }), el('i', { class: 'run', style: 'left:' + pctSetup + '%;width:' + (100 - pctSetup) + '%' }), el('b', { class: 'mark', style: 'left:' + pctFunded + '%' })]),
    el('div', { class: 'iv-kv' }, [kv(t('bp_runway_setup'), money(setupLo) + ' – ' + money(setupHi)), kv(t('bp_total_month') + ' · ' + t('bp_phase1'), money(mLo) + ' – ' + money(mHi)), kv(t('bp_runway_months') + ' (' + t('bp_runway_from') + ' ' + money(cap) + ')', Math.floor(monthsLo) + ' – ' + Math.floor(monthsHi)), kv(t('h_funded'), money(funded), 'ok')]),
  ]);
}
function planOptions(bp) {
  const o = bp.options || []; if (!o.length) return null;
  return el('div', { class: 'iv-card iv-bp', id: 'bp-options' }, [el('p', { class: 'iv-eyebrow' }, t('bp_options')),
    el('div', { class: 'iv-tblwrap' }, el('table', { class: 'iv-tbl' }, [el('thead', null, el('tr', null, ['', t('bp_runway_setup'), t('bp_total_month'), 'Ask', 'Max loss'].map(h => el('th', null, h)))),
      el('tbody', null, o.map(x => el('tr', null, [el('td', null, [el('b', null, x.name), el('div', { class: 'iv-muted', style: 'font-size:.76rem' }, x.note || '')]), el('td', null, x.setup || ''), el('td', null, x.monthly || ''), el('td', null, x.ask || ''), el('td', null, x.max_loss || '')])))]))]);
}
function planCalc(bp, p) {
  const u = bp.unit || {}; const m1 = (bp.monthly || []).filter(r => r.phase !== '2'); const costDef = m1.reduce((a, r) => a + Number(r.high || r.low || 0), 0) || 250000;
  const st = { trucks: 2, fee: Number(u.per_truck_pkr) || 400000, cost: costDef, collect: 85 };
  const pay = Number(p.payback_rate_pct || 0), share = Number(p.effective_share_pct || p.permanent_share_pct || 0), outstanding = Number(p.outstanding || p.recovery_target || 0);
  const out = el('div', { class: 'iv-kv' }); const line = el('div', { class: 'iv-calc-line' });
  const slider = (key, label, min, max, step, fmt) => { const v = el('b', null, fmt(st[key])); const r = el('input', { type: 'range', min, max, step, value: st[key] }); r.oninput = () => { st[key] = Number(r.value); v.textContent = fmt(st[key]); paint(); }; return el('div', { class: 'iv-slider' }, [el('div', { class: 'row' }, [el('span', null, label), v]), r]); };
  const paint = () => {
    const income = st.trucks * st.fee * st.collect / 100, profit = income - st.cost;
    const toYou = profit > 0 ? profit * (pay + share) / 100 : 0, rec = profit > 0 ? profit * pay / 100 : 0;
    const months = rec > 0 && outstanding > 0 ? Math.ceil(outstanding / rec) : null;
    mount(out, [kv(t('bp_c_collect'), money(income)), kv(t('bp_c_profit'), profit >= 0 ? money(profit) : t('bp_c_loss'), profit >= 0 ? 'ok' : 'warn'), kv(t('bp_c_you'), money(toYou), toYou ? 'ok' : ''), kv(t('bp_c_months'), months ? String(months) : '—')]);
    const w = Math.min(100, Math.max(0, 100 * income / Math.max(1, st.cost * 3)));
    mount(line, [el('i', { class: 'cost', style: 'width:' + Math.min(100, 100 * st.cost / Math.max(1, st.cost * 3)) + '%' }), el('i', { class: 'inc', style: 'width:' + w + '%' })]);
  };
  paint();
  return el('div', { class: 'iv-card iv-bp', id: 'bp-calc' }, [el('p', { class: 'iv-eyebrow' }, t('bp_calc')), el('p', { class: 'iv-muted', style: 'margin:0 0 8px' }, t('bp_calc_sub')),
    slider('trucks', t('bp_c_trucks'), 0, 10, 1, (v) => String(v)), slider('fee', t('bp_c_fee'), 100000, 800000, 25000, (v) => money(v)), slider('cost', t('bp_c_cost'), 50000, 800000, 10000, (v) => money(v)), slider('collect', t('bp_c_collect'), 40, 100, 5, (v) => v + '%'),
    line, out, el('p', { class: 'iv-muted', style: 'margin:8px 0 0;font-size:.74rem' }, pct(pay) + ' + ' + pct(share) + ' · ' + t('proj_note'))]);
}
function planSolver() {
  const go = { 1: () => { S.tab = 'ledger'; renderShell(); }, 2: () => { S.tab = 'home'; renderShell(); }, 3: () => showAgreement(), 4: () => { S.tab = 'home'; renderShell(); }, 5: () => { S.tab = 'ledger'; renderShell(); }, 6: () => showAgreement(), 7: () => showAgreement(), 8: () => showTerm('share'), 9: () => showAudit(), 10: () => { S.tab = 'statements'; renderShell(); } };
  return el('div', { class: 'iv-card iv-bp', id: 'bp-solver' }, [el('p', { class: 'iv-eyebrow' }, t('bp_solver')), el('p', { class: 'iv-muted', style: 'margin:0 0 8px' }, t('bp_solver_sub')),
    el('div', { class: 'iv-solver' }, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => el('button', { type: 'button', onClick: go[i] }, [el('b', null, t('ps_' + i + 'q')), el('span', null, t('ps_' + i + 'a')), el('i', null, '›')])))]);
}

// ============================================================================
// SIMPLE mode — Home = the record. Three numbers, one list, one download.
// ============================================================================
async function renderRecord(host) {
  mount(host, skeleton());
  if (!S.ledger) { try { S.ledger = await invLedger(S.agr.id); } catch (e) { mount(host, el('div', { class: 'iv-err' }, err(e))); return; } }
  if (!S.requests) { try { S.requests = (await invMyRequests(S.agr.id)).requests || []; } catch (_) { S.requests = []; } }
  let ups = []; try { ups = (await invUpdates(S.agr.id, 50)).updates || []; } catch (_) {}
  const L = S.ledger, p = L.position || S.agr.position || {};
  const ev = [];
  ups.forEach(u => ev.push({ t: u.created_at, kind: 'update', tag: u.kind === 'milestone' ? t('tag_milestone') : /team|hire|bharti|join/i.test(u.title + ' ' + u.body) ? t('tag_team') : t('tag_update'), title: u.title, sub: u.body, proof: null, amt: '', cls: '', open: () => openSheet(u.title, el('div', null, [el('p', { class: 'iv-muted' }, new Date(u.created_at).toLocaleString('en-GB')), el('p', { style: 'white-space:pre-line' }, u.body)])), ok: true }));
  (L.receipts || []).forEach(r => { if (r.state === 'confirmed' || r.state === 'awaiting_confirmation') ev.push({ t: r.received_date, kind: 'in', tag: t('tag_investment'), title: t('rec_in') + ' ' + money(r.amount), sub: (r.method || '') + (r.reference ? ' · ' + r.reference : '') + (r.state === 'confirmed' ? ' · ' + t('p_lb_confirmed') + ' ' + fmtDate(r.confirmed_at) : ' · ' + t('not_yet')), proof: !!r.proof_url, amt: '+' + money(r.amount), cls: 'pos', open: () => investmentSheet(r), ok: r.state === 'confirmed' }); });
  (L.expenses || []).forEach(x => ev.push({ t: x.date, kind: 'out', tag: catName(x.category), title: (x.reversed ? t('l_reversal') + ' · ' : '') + (x.vendor || catName(x.category)), sub: (vendorWhat(x.vendor, getLang()) || catWhat(x.category, getLang())) + (x.description ? ' — ' + x.description : ''), proof: !!x.receipt_url, amt: (x.reversed ? '+' : '−') + money(x.amount), cls: x.reversed ? 'pos' : 'neg', open: () => { S.tab = 'ledger'; renderShell(); }, ok: true, ack: x.acknowledged_at }));
  (L.payouts || []).forEach(po => { if (po.status === 'paid' && Number(po.total) > 0) ev.push({ t: po.paid_date, kind: 'payout', tag: t('tag_payout'), title: t('rec_payout') + ' ' + money(po.total), sub: (po.month ? fmtMonth(po.month) : t('h_wound')) + (po.confirmed_at ? ' · ✓' : ' · ' + t('not_yet')), proof: !!po.proof_url, amt: '+' + money(po.total), cls: 'pos', open: () => { S.tab = 'payments'; renderShell(); }, ok: !!po.confirmed_at }); });
  (S.requests || []).forEach(r => { if (r.status === 'pending') ev.push({ t: r.requested_at, kind: 'req', tag: t('tag_request'), title: t('rec_req') + ' ' + money(r.amount), sub: r.reason || '', proof: false, amt: money(r.amount), cls: '', open: () => openRequest(r), ok: false }); });
  ev.sort((a, b) => new Date(b.t) - new Date(a.t));
  const ic = { in: 'payments', out: 'ledger', payout: 'statements', req: 'requests', update: 'inbox' };
  const pendingReq = (S.requests || []).filter(r => r.status === 'pending').length;
  mount(host, [
    agrPicker(), el('h1', { class: 'iv-h1' }, t('rec_title')), el('p', { class: 'iv-sub' }, t('rec_sub')),
    stateBanner(p),
    pendingReq ? el('button', { class: 'iv-warn', style: 'width:100%;text-align:start;cursor:pointer;font:inherit', onClick: () => openRequest((S.requests || []).find(r => r.status === 'pending')) }, [el('b', null, t('rec_req') + ' ' + money((S.requests || []).find(r => r.status === 'pending').amount)), ' — ', (S.requests || []).find(r => r.status === 'pending').reason || '', ' ›']) : null,
    recHero(p),
    el('div', { class: 'iv-sect' }, el('h2', null, t('rec_all'))),
    ev.length ? el('div', { class: 'iv-list' }, ev.map(e => el('button', { class: 'iv-row', onClick: e.open }, [
      el('div', { class: 'ic ' + (e.kind === 'out' ? 'out' : 'in') }, icon(ic[e.kind])),
      el('div', null, [el('div', { class: 't' }, [el('span', { class: 'iv-tag ' + e.kind }, e.tag), e.title]), el('div', { class: 's' }, fmtDate(e.t) + (e.sub ? ' · ' + e.sub : '')), e.proof === null ? null : el('div', { class: 's what' }, [e.proof ? el('span', { class: 'iv-proof ok' }, '📎 ' + t('rec_proof')) : el('span', { class: 'iv-proof' }, t('rec_noproof')), e.kind === 'out' && !e.ack ? el('small', { class: 'iv-new', style: 'margin-left:6px' }, t('ack_new')) : null])]),
      el('div', { class: 'amt ' + e.cls }, e.amt),
    ]))) : empty(t('l_empty')),
    el('div', { class: 'iv-actions', style: 'justify-content:center;margin-top:14px' }, el('button', { class: 'iv-btn', onClick: () => expenseReport(L) }, [icon('download'), t('rec_dl')])),
    el('div', { class: 'iv-actions', style: 'justify-content:center;margin-top:18px' }, el('button', { class: 'iv-btn sm', onClick: async () => { await signOut(); renderLogin(); } }, t('sign_out'))),
  ]);
}
// Agreement tab — the document, your signature, what you can change, security, the audit log.
function renderAgreementTab(host) {
  const p = S.agr.position || {};
  const navRow = (ic, title, sub, fn, id) => el('button', { class: 'iv-row', onClick: fn }, [el('div', { class: 'ic' }, icon(ic)), el('div', null, [el('div', { class: 't' }, title), el('div', { class: 's', id: id || null }, sub)]), el('div', { class: 'amt' }, '›')]);
  mount(host, [
    agrPicker(), el('h1', { class: 'iv-h1' }, t('h_agreement')), el('p', { class: 'iv-sub' }, t('ag_tab_sub')),
    (p.open_questions || []).length ? el('div', { class: 'iv-open' }, [el('b', null, t('h_open')), el('ul', null, p.open_questions.map(q => el('li', null, t('oq_' + q, pct(p.permanent_share_pct)))))]) : null,
    el('div', { class: 'iv-card' }, [el('div', { class: 'iv-kv', style: 'margin-top:0' }, [kv(t('h_monthly'), (p.phase === 'recovering' ? pct(p.payback_rate_pct) + ' + ' : '') + pct(p.effective_share_pct), '', 'share'), kv(t('h_recovery'), money(p.recovered) + ' / ' + money(p.recovery_target), '', 'recovery'), kv(t('h_outstanding'), money(p.outstanding), '', 'outstanding'), kv(t('h_share_type'), p.share_type === 'equity' ? pct(p.equity_vested_pct) : p.share_type === 'profit_share' ? t('h_profit_share') : t('h_undecided'), '', 'share_type')])]),
    navRow('doc', t('doc_title'), S.agr.signed_date ? t('h_signed', fmtDate(S.agr.signed_date)) : t('h_draft'), () => showAgreement()),
    el('div', { style: 'height:8px' }),
    amendCard(p),
    navRow('shield', t('sec_title'), '…', () => showSecurity(), 'iv-sec-sub'),
    el('div', { style: 'height:8px' }),
    navRow('inbox', t('log_title'), t('log_sub'), () => showAudit()),
    el('div', { style: 'height:8px' }),
    navRow('inbox', t('gl_title'), t('gl_row'), () => showGlossary()),
  ]);
  mfaListFactors().then(f => { const on = (f.all || []).concat(f.totp || [], f.phone || []).some(x => x.status === 'verified'); const s = document.getElementById('iv-sec-sub'); if (s) s.textContent = on ? t('sec_on') : t('sec_off'); }).catch(() => {});
}

// ---------- Record hero v2: ring + five numbers + segmented bar + change-investment ----------
function recHero(p) {
  const cap = Number(p.commitment_cap || 0), funded = Number(p.funded || 0), spent = Number(p.spent || 0), fund = Number(p.fund_cash || 0);
  const toGive = Math.max(0, cap - funded);
  const pc = (n) => cap ? Math.max(0, Math.min(100, 100 * n / cap)) : 0;
  const seg = (cls, w, label, val) => el('div', { class: 'seg ' + cls, style: 'width:' + w + '%', title: label + ' · ' + val });
  return el('div', { class: 'iv-card hero iv-rec-hero' }, [
    el('div', { class: 'iv-rec-top' }, [
      ring(p.funded_pct, '', t('rc_used')),
      el('div', { class: 'iv-rec-nums' }, [
        el('div', { class: 'n1' }, [el('span', null, [t('rc_commit'), ' ', qBtn('commitment')]), el('b', null, money(cap))]),
        el('div', null, [el('span', null, [t('rec_given'), ' ', qBtn('funded')]), el('b', { class: 'ok' }, money(funded))]),
        el('div', null, [el('span', null, [t('rc_togive'), ' ', qBtn('to_give')]), el('b', null, money(toGive))]),
        el('div', null, [el('span', null, [t('rec_spent'), ' ', qBtn('spent')]), el('b', { class: 'warn' }, money(spent))]),
        el('div', null, [el('span', null, [t('rec_left'), ' ', qBtn('fund_cash')]), el('b', { class: 'ok' }, money(fund))]),
      ]),
    ]),
    el('div', { class: 'iv-segbar' }, [seg('spent', pc(spent), t('rc_seg_spent'), money(spent)), seg('fund', pc(fund), t('rc_seg_fund'), money(fund)), seg('left', pc(toGive), t('rc_seg_left'), money(toGive))]),
    el('div', { class: 'iv-legend' }, [el('span', { class: 'spent' }, t('rc_seg_spent') + ' ' + money(spent)), el('span', { class: 'fund' }, t('rc_seg_fund') + ' ' + money(fund)), el('span', { class: 'left' }, t('rc_seg_left') + ' ' + money(toGive))]),
    Number(p.total_paid_out) ? el('p', { class: 'iv-muted', style: 'margin:10px 0 0' }, t('rec_back') + ': ' + money(p.total_paid_out)) : null,
    (S.agr.status === 'wound_down' || S.agr.status === 'closed') ? null : el('button', { class: 'iv-btn block', style: 'margin-top:14px', onClick: () => { S.tab = 'agreement'; renderShell(); setTimeout(() => { const n = document.querySelector('.iv-choice'); if (n) n.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 120); } }, [icon('doc'), t('rc_change')]),
  ]);
}
// investment (tranche) detail sheet — status, proof, downloadable confirmation once LoadBoot confirmed
function investmentSheet(r) {
  const st = r.state === 'confirmed' ? pill(t('in_confirmed'), 'ok') : r.state === 'rejected' ? pill(t('in_rejected'), 'due') : pill(t('in_waiting'), 'wait');
  openSheet(t('in_title'), el('div', null, [
    el('div', { style: 'margin-bottom:10px' }, st),
    dl([[t('amount'), money(r.amount)], [t('date'), fmtDate(r.received_date)], [t('method'), r.method || '—'], [t('reference'), r.reference || '—'], [t('tr_from'), trFrom(r) || '—'], [t('tr_into'), trInto(r) || '—'], [t('p_you_declared'), r.declared_at ? fmtDate(r.declared_at) : '—'], [t('p_lb_confirmed'), r.confirmed_at ? fmtDate(r.confirmed_at) : t('not_yet')], r.rejected_reason ? [t('p_rejected_why'), r.rejected_reason] : [t('note'), r.note || '—']]),
    r.proof_url ? el('a', { class: 'iv-btn block', href: '#', onClick: async (e) => { e.preventDefault(); try { window.open(await invProofUrl(r.proof_url), '_blank', 'noopener'); } catch (ex) { alert(err(ex)); } } }, [icon('doc'), t('view') + ' ' + t('proof')]) : null,
    r.confirmed_at ? el('button', { class: 'iv-btn primary block', onClick: () => paymentConfirmation(r) }, [icon('download'), t('dl_confirm')]) : el('p', { class: 'iv-muted' }, t('d_two')),
    flagButton('receipt', r.id),
  ]));
}
