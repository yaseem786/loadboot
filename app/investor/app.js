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
import { getSession, signInWithPassword, signOut, onAuthChange, resetPassword,
         mfaVerify, mfaListFactors, mfaEnrollTotp, mfaEnrollPhone, mfaChallenge, mfaVerifyChallenge, mfaRequiredAny } from '../shared/session.js';
import { el, mount } from '../shared/ui/dom.js';
import { invMe, invMyRequests, invDeclarePayment, invLedger, invStatements, invConfirmPayout,
         invSetLang, invFlag, invMyFlags, invSettings, invCurrentDoc, invSignDoc, invGrowth, invProjection,
         invUploadProof, invProofUrl } from '../shared/api.js';
import { mdToHtml } from './agreement-template.js';
import { t, setLang, getLang, LANGS } from './i18n.js';

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
    el('div', { class: 'brand' }, [el('img', { src: '/logo-text-dark.png', alt: 'LoadBoot' }), el('div', null, 'Investor Portal')]),
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
const TABS = ['home', 'requests', 'ledger', 'payments', 'statements'];
function renderShell() {
  const pendingReq = (S.requests || []).filter(r => r.status === 'pending').length;
  const initials = (S.me.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const pane = el('div');
  mount(root, el('div', { class: 'iv-shell' }, [
    el('div', { class: 'iv-top' }, [
      el('img', { src: '/logo-text-dark.png', alt: 'LoadBoot' }),
      el('div', { class: 'iv-topright' }, [langSwitch(), el('button', { class: 'iv-avatar', style: 'border:0;cursor:pointer', title: S.me.name, 'aria-label': t('sec_title'), onClick: () => showSecurity() }, initials)]),
    ]),
    pane,
    el('nav', { class: 'iv-tabs', 'aria-label': 'Sections' }, TABS.map(id =>
      el('button', { class: 'iv-tab' + (S.tab === id ? ' on' : ''), 'aria-current': S.tab === id ? 'page' : null, onClick: () => { S.tab = id; renderShell(); } }, [
        icon(id, ''), t('nav_' + id), (id === 'requests' && pendingReq) ? el('i', { class: 'dot', 'aria-label': pendingReq + ' pending' }) : null,
      ]))),
  ]));
  root.removeAttribute('aria-busy');
  ({ home: renderHome, requests: renderRequests, ledger: renderLedger, payments: renderPayments, statements: renderStatements })[S.tab](pane);
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
const kv = (k, v, cls) => el('div', null, [el('div', { class: 'k' }, k), el('div', { class: 'v ' + (cls || '') }, v)]);

// ---------- HOME ----------
function renderHome(host) {
  const p = S.agr.position || {};
  const recovering = p.phase === 'recovering';
  const open = p.open_questions || [];
  const shareTypeVal = p.share_type === 'equity' ? pct(p.equity_vested_pct) : p.share_type === 'profit_share' ? t('h_profit_share') : t('h_undecided');
  mount(host, [
    agrPicker(),
    el('h1', { class: 'iv-h1' }, t('h_title')), el('p', { class: 'iv-sub' }, t('h_sub')),
    stateBanner(p),
    el('div', { class: 'iv-card hero' }, [
      el('p', { class: 'iv-eyebrow' }, t('h_funded')),
      el('div', { class: 'iv-big' }, [money(p.funded), el('small', null, t('of') + ' ' + money(p.commitment_cap))]), usdLine(p.funded),
      el('div', { class: 'iv-prog' }, [
        el('div', { class: 'row' }, [el('span', null, t('h_commit_used')), el('b', null, pct(p.funded_pct))]),
        el('div', { class: 'bar' }, el('i', { style: 'width:' + Math.min(100, Number(p.funded_pct || 0)) + '%' })),
      ]),
      el('div', { class: 'iv-kv' }, [
        kv(t('h_unfunded'), money(p.unfunded)),
        kv(t('h_fund_cash'), money(p.fund_cash), Number(p.fund_cash) < 0 ? 'warn' : 'ok'),
        kv(t('h_spent'), money(p.spent)),
        kv(t('h_total_paid'), money(p.total_paid_out)),
      ]),
    ]),
    el('div', { class: 'iv-card' }, [
      el('div', { class: 'iv-sec-row' }, [el('p', { class: 'iv-eyebrow', style: 'margin:0' }, t('h_recovery')),
        p.phase === 'wound_down' ? pill(t('h_wound'), 'due') : p.commitment_closed && recovering ? pill(t('h_stopped'), 'wait') : recovering ? pill(t('h_recovering'), 'blue') : pill(t('h_recovered'), 'ok')]),
      el('div', { class: 'iv-prog' }, [
        el('div', { class: 'row' }, [el('span', null, money(p.recovered) + ' ' + t('of') + ' ' + money(p.recovery_target)), el('b', null, pct(p.recovered_pct))]),
        el('div', { class: 'bar' }, el('i', { class: recovering ? '' : 'done', style: 'width:' + Math.min(100, Number(p.recovered_pct || 0)) + '%' })),
      ]),
      el('div', { class: 'iv-kv' }, [
        kv(t('h_outstanding'), money(p.outstanding)),
        kv(t('h_monthly'), recovering ? (pct(p.payback_rate_pct) + ' + ' + pct(p.effective_share_pct)) : pct(p.effective_share_pct)),
        kv(t('h_share_paid'), money(p.share_paid)),
        kv(p.share_type === 'equity' ? t('h_equity_vested') : t('h_share_type'), shareTypeVal),
      ]),
      p.exit_participation_pct != null ? el('p', { class: 'iv-muted', style: 'margin:10px 0 0' }, t('h_exit') + ': ' + t('h_exit_val', pct(p.exit_participation_pct))) : null,
      recovering ? el('p', { class: 'iv-muted', style: 'margin:10px 0 0' }, t('h_note_recovering', pct(p.payback_rate_pct), pct(p.effective_share_pct))) : null,
    ]),
    open.length ? el('div', { class: 'iv-open' }, [el('b', null, t('h_open')), el('ul', null, open.map(q => el('li', null, t('oq_' + q, pct(p.permanent_share_pct)))))]) : null,
    projectionCard(), growthCard(),
    el('button', { class: 'iv-row', onClick: () => showAgreement() }, [
      el('div', { class: 'ic' }, icon('doc')),
      el('div', null, [el('div', { class: 't' }, t('h_agreement')), el('div', { class: 's' }, S.agr.signed_date ? t('h_signed', fmtDate(S.agr.signed_date)) : t('h_draft'))]),
      el('div', { class: 'amt' }, '›'),
    ]),
    el('button', { class: 'iv-row', style: 'margin-top:8px', onClick: () => showSecurity() }, [
      el('div', { class: 'ic' }, icon('shield')),
      el('div', null, [el('div', { class: 't' }, t('sec_title')), el('div', { class: 's', id: 'iv-sec-sub' }, '…')]),
      el('div', { class: 'amt' }, '›'),
    ]),
    el('div', { class: 'iv-actions', style: 'justify-content:center;margin-top:20px' }, el('button', { class: 'iv-btn sm', onClick: async () => { await signOut(); renderLogin(); } }, t('sign_out'))),
  ]);
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
    dl([[t('amount'), money(x.amount)], [t('date'), fmtDate(x.date)], [t('l_vendor'), x.vendor], [t('l_details'), x.description],
        [t('l_paid_from'), x.tranche ? t('l_tranche', fmtDate(x.tranche)) : null], [t('l_recurring'), x.recurring ? t('l_yes') : t('l_no')]]),
    x.receipt_url ? el('a', { class: 'iv-btn block', href: '#', onClick: async (e) => { e.preventDefault(); try { window.open(await invProofUrl(x.receipt_url), '_blank', 'noopener'); } catch (ex) { alert(err(ex)); } } }, t('view') + ' ' + t('receipt')) : el('p', { class: 'iv-muted' }, t('l_no_receipt')),
    flagButton('expense', x.id),
  ]));
  mount(host, [
    agrPicker(), el('h1', { class: 'iv-h1' }, t('l_title')), el('p', { class: 'iv-sub' }, t('l_sub')),
    el('div', { class: 'iv-card hero' }, [
      el('p', { class: 'iv-eyebrow' }, t('l_remaining')), el('div', { class: 'iv-big' }, money(p.fund_cash)),
      el('p', { class: 'iv-muted', style: 'margin:6px 0 0' }, t('l_came_spent', money(p.funded), money(p.spent))),
      cats.length ? el('div', { class: 'iv-cats' }, cats.map(([c, v]) => el('div', { class: 'iv-cat' }, [el('span', null, catName(c)), el('div', { class: 'bar' }, el('i', { style: 'width:' + Math.round(100 * Number(v) / max) + '%' })), el('b', null, money(v))]))) : null,
    ]),
    exp.length ? el('div', { class: 'iv-list' }, exp.map(x => el('button', { class: 'iv-row', onClick: () => expSheet(x) }, [
      el('div', { class: 'ic ' + (x.reversed ? 'in' : 'out') }, x.reversed ? icon('arrowBack') : catIcon(x.category)),
      el('div', null, [el('div', { class: 't' }, x.reversed ? t('l_reversal') + ' · ' + catName(x.category) : (x.vendor || catName(x.category))), el('div', { class: 's' }, fmtDate(x.date) + (x.description ? ' · ' + x.description : ''))]),
      el('div', { class: 'amt ' + (x.reversed ? 'pos' : 'neg') }, [(x.reversed ? '+' : '−') + money(x.amount), x.receipt_url ? el('small', null, t('receipt') + ' ✓') : null]),
    ]))) : empty(t('l_empty')),
    el('div', { class: 'iv-actions', style: 'justify-content:center' }, el('button', { class: 'iv-btn sm', onClick: exportCsv }, [icon('download'), t('l_export')])),
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
    dl([[t('amount'), money(r.amount)], [t('date'), fmtDate(r.received_date)], [t('method'), r.method], [t('reference'), r.reference],
        [t('p_you_declared'), r.declared_at ? fmtDate(r.declared_at) : null], [t('p_lb_confirmed'), r.confirmed_at ? fmtDate(r.confirmed_at) : t('not_yet')],
        r.rejected_reason ? [t('p_rejected_why'), r.rejected_reason] : [t('note'), r.note],
        [t('proof'), r.proof_url ? el('a', { href: '#', onClick: async (e) => { e.preventDefault(); try { window.open(await invProofUrl(r.proof_url), '_blank', 'noopener'); } catch (ex) { alert(err(ex)); } } }, t('view')) : null]]),
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
    const me = await invMe();
    if (!me || me.ok === false) { renderNotLinked(); return; }
    S.me = me.investor; S.agreements = me.agreements || [];
    try { localStorage.setItem('lb_last_portal', '/app/investor/'); } catch (_) {}
    if (!S.agreements.length) { renderNotLinked(); return; }
    let saved = null; try { saved = localStorage.getItem('lb-inv-lang'); } catch (_) {}
    setLang(saved || S.me.lang || 'en');
    S.agr = S.agreements.find(a => S.agr && a.id === S.agr.id) || S.agreements[0];
    if (!S.requests) { try { S.requests = (await invMyRequests(S.agr.id)).requests || []; } catch (_) { S.requests = []; } }
    if (!S.settings) { try { S.settings = await invSettings(); } catch (_) { S.settings = {}; } }
    renderShell();
  } catch (e) { renderLogin(err(e)); }
}
async function boot() {
  let saved = null; try { saved = localStorage.getItem('lb-inv-lang'); } catch (_) {}
  setLang(saved || 'en');
  const s = await getSession();
  if (!s) { renderLogin(); return; }
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

function growthCard() {
  const box = el('div', { class: 'iv-card' }, [el('p', { class: 'iv-eyebrow' }, t('growth')), el('div', { class: 'iv-sk', style: 'height:14px;width:70%' })]);
  const tile = (n, l) => el('div', null, [el('div', { class: 'n' }, String(Number(n || 0).toLocaleString('en-US'))), el('div', { class: 'l' }, l)]);
  const bars = (series, label) => {
    if (!series || !series.length) return null;
    const max = Math.max(1, ...series.map(s => Number(s.n || 0)));
    return el('div', { class: 'iv-bars-wrap' }, [
      el('p', { class: 'iv-muted', style: 'margin:12px 0 0;font-size:.78rem' }, label),
      el('div', { class: 'iv-bars' }, series.map(s => el('div', { style: 'height:' + Math.max(5, Math.round(100 * Number(s.n || 0) / max)) + '%', title: s.n }, el('span', null, new Date(s.month).toLocaleDateString('en-GB', { month: 'short' }))))),
    ]);
  };
  const paint = (g) => mount(box, [
    el('p', { class: 'iv-eyebrow' }, t('growth')), el('p', { class: 'iv-muted', style: 'margin:0' }, t('growth_sub')),
    el('div', { class: 'iv-growth' }, [
      tile(g.carriers_total, t('g_carriers')), tile(g.carriers_active, t('g_active')), tile(g.carriers_in_review, t('g_review')),
      tile(g.trucks_active, t('g_trucks')), tile(g.dispatcher_assignments_active, t('g_assigned')), tile(g.brokers_total, t('g_brokers')),
      tile(g.loads_booked, t('g_loads')), tile(g.trips_delivered, t('g_delivered')), tile(g.trips_delivered_30d, t('g_del30')),
    ]),
    el('div', { class: 'iv-kv', style: 'margin-top:10px' }, [kv(t('g_fees'), money(g.fees_collected_total, 'USD')), kv(t('g_fees30'), money(g.fees_collected_30d, 'USD'))]),
    bars(g.carriers_by_month, t('g_new_carriers')),
    el('p', { class: 'iv-muted', style: 'margin:10px 0 0;font-size:.72rem' }, t('g_as_of') + ' ' + new Date(g.as_of).toLocaleString('en-GB')),
  ]);
  (S.growth ? Promise.resolve(S.growth) : invGrowth().then(g => { S.growth = g; return g; })).then(paint)
    .catch(ex => mount(box, [el('p', { class: 'iv-eyebrow' }, t('growth')), el('p', { class: 'iv-muted' }, err(ex))]));
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

  const chooser = () => mount(body, [
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
      guide, el('div', { style: 'text-align:center' }, qr), secret, msg, field(t('sec_code'), code), btn,
      el('div', { class: 'iv-actions' }, el('button', { class: 'iv-btn sm', type: 'button', onClick: chooser }, '‹ ' + t('sec_choose'))),
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
  const view = el('div', { class: 'iv-doc' + (lang === 'ur' ? ' rtl' : '') });
  view.innerHTML = mdToHtml(doc.body_md);
  const sigStatus = el('div', null, [
    mine ? el('div', { class: 'iv-signed' }, [icon('check', ''), el('div', null, [el('b', null, t('doc_signed_you')), ' · ', mine.signer_name, ' · ', fmtDate(mine.signed_at)])]) : null,
    co ? el('div', { class: 'iv-signed' }, [icon('check', ''), el('div', null, [el('b', null, t('doc_signed_co')), ' · ', co.signer_name + (co.signer_title ? ', ' + co.signer_title : ''), ' · ', fmtDate(co.signed_at)])]) : null,
    doc.fully_signed ? el('div', { class: 'iv-ok' }, t('doc_done')) : mine && !co ? el('div', { class: 'iv-warn' }, t('doc_await_co')) : !mine ? el('div', { class: 'iv-warn' }, t('doc_await_you')) : null,
  ]);
  const body = el('div');
  const close = openSheet(t('doc_title'), body);
  const signBlock = () => {
    if (mine) return null;
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
  mount(body, [
    el('p', { class: 'iv-muted', style: 'margin:0 0 8px' }, [el('b', null, doc.title), ' · ', t('doc_v', doc.version), ' · ', fmtDate(doc.published_at)]),
    sigStatus, view,
    el('p', { class: 'iv-muted', style: 'margin:8px 0 0;font-size:.72rem' }, t('doc_hash')), el('div', { class: 'iv-hash' }, doc.hash),
    signBlock(),
    el('div', { class: 'iv-actions', style: 'margin-top:12px' }, [
      el('button', { class: 'iv-btn sm', type: 'button', onClick: () => { const w = window.open('', '_blank'); if (!w) return; w.document.write('<!doctype html><title>' + doc.title + '</title><style>body{font-family:Georgia,serif;max-width:760px;margin:30px auto;padding:0 20px;line-height:1.6}' + (lang === 'ur' ? 'body{direction:rtl}' : '') + '.ph{background:#FEF3C7}</style>' + mdToHtml(doc.body_md) + '<hr><p style="font-family:monospace;font-size:11px">SHA-256 ' + doc.hash + '</p>' + (doc.signatures || []).map(s => '<p>' + (s.party === 'investor' ? 'Investor' : 'Company') + ': ' + s.signer_name + ' — ' + new Date(s.signed_at).toLocaleString() + '</p>').join('')); w.document.close(); } }, t('doc_download')),
      el('button', { class: 'iv-btn sm', type: 'button', onClick: () => { close(); showTermsSummary(); } }, t('h_agreement')),
    ]),
    flagButton('agreement', a.id),
  ]);
}
