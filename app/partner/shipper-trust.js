// shipper-trust.js — Shipper "request a quote in minutes" onboarding (bl_bp_0319).
// A shipper has no FMCSA authority to read, so the business is confirmed from the COMPANY EMAIL DOMAIN:
// signup on a company domain that receives mail (MX) → verified in under a minute; website on the domain is a
// bonus signal brokers see. Signed up with Gmail? enter the company address → a 6-digit code goes there.
// Quotes are non-binding, so a business-verified shipper posts requests right away; payment terms / credit
// application come before the FIRST BOOKING; the packet is three items (agreement · claims contact · billing).
// Self-contained (own h/mount); reuses the .bt-* styles from broker-trust.js.
import { partnerShipperStatus, partnerShipperVerify, partnerShipperCompanyEmail, partnerVerifyCode } from '../shared/api.js';
import { ensureCss as ensureTrustCss, decorateCards, progressRing } from './broker-trust.js';

const h = (tag, attrs, kids) => {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') e[k.toLowerCase()] = attrs[k];
    else if (attrs[k] != null && attrs[k] !== false) e.setAttribute(k, attrs[k]);
  }
  (Array.isArray(kids) ? kids : kids != null ? [kids] : []).forEach(c => c != null && e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return e;
};
const mount = (el, kids) => { el.innerHTML = ''; (Array.isArray(kids) ? kids : [kids]).forEach(c => c && el.appendChild(c)); };
const digits = (s) => String(s || '').replace(/[^0-9]/g, '');

const TIER = { new: ['info', 'Confirming your business'], business_verified: ['ok', 'Business confirmed'], verified: ['ok', 'Verified shipper'], hold: ['bad', 'On hold'] };

export function shipperBadge(t) {
  // used by the broker inbox: t = row.shipper_trust
  if (!t) return null;
  const tier = t.tier || 'new';
  const cls = tier === 'verified' ? 'green' : tier === 'business_verified' ? 'blue' : tier === 'hold' ? 'red' : 'gray';
  const txt = tier === 'verified' ? '✓ Verified shipper' : tier === 'business_verified' ? '✓ Business confirmed' + (t.domain ? ' · ' + t.domain : '') : tier === 'hold' ? 'On hold' : 'Business not confirmed';
  const el = h('span', { class: 'cp-pill ' + cls, title: (t.verified_by || '') + (t.site_title ? ' · site: ' + t.site_title : '') }, txt);
  return el;
}

let notice = null;
export function mountShipperTrust(host, opts = {}) {
  ensureTrustCss();
  let st = null; let timer = null; let alive = true;
  const stop = () => { alive = false; if (timer) clearInterval(timer); };

  function companyEmailForm(label) {
    const em = h('input', { class: 'bt-in', type: 'email', placeholder: 'you@yourcompany.com', style: 'flex:1 1 260px' });
    const btn = h('button', { class: 'bt-btn' }, 'Send me a code →');
    btn.onclick = async () => {
      notice = null; btn.disabled = true; btn.innerHTML = '<span class="bt-spin"></span>&nbsp; Sending…';
      try { const r = await partnerShipperCompanyEmail(em.value.trim()); notice = r && r.sent === false ? { ok: false, text: r.why || 'Could not send.' } : { ok: true, text: 'Code sent to ' + ((r && r.to) || 'that address') + ' — type it below.' }; }
      catch (e) { notice = { ok: false, text: (e && e.message) || 'Could not send.' }; }
      await refresh();
    };
    return h('div', null, [h('div', { class: 'bt-note', style: 'font-weight:800;color:#334155' }, label), h('div', { class: 'bt-row' }, [em, btn])]);
  }
  function codeBox() {
    const code = h('input', { class: 'bt-in', placeholder: '6-digit code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 12, style: 'flex:0 1 170px;letter-spacing:.2em;text-align:center' });
    const ok = h('button', { class: 'bt-btn orange' }, 'Confirm code →');
    ok.onclick = async () => {
      const d = digits(code.value); if (d.length !== 6) { notice = { ok: false, text: 'Enter the 6 digits from the email.' }; paint(); return; }
      ok.disabled = true; notice = null;
      try { const r = await partnerVerifyCode(d); notice = r && r.ok ? { ok: true, text: '✓ Address confirmed — checking the domain now (under a minute).' } : { ok: false, text: (r && r.why) || 'That code did not match.' }; }
      catch (e) { notice = { ok: false, text: (e && e.message) || 'Could not check the code.' }; }
      await refresh();
    };
    return h('div', { class: 'bt-code' }, [h('div', { class: 'm' }, 'Type the code from the email we sent to ' + (st.company_email_masked || 'your company address') + '.'), code, ok]);
  }
  function recheckBtn(label) {
    const b = h('button', { class: 'bt-btn ghost sm' }, label || 'Re-check');
    b.onclick = async () => { b.disabled = true; notice = null; try { const r = await partnerShipperVerify(); notice = r && r.queued ? { ok: true, text: 'Checking again — under a minute.' } : { ok: false, text: (r && (r.note || r.outcome)) || 'Could not start.' }; } catch (e) { notice = { ok: false, text: (e && e.message) || 'Could not start.' }; } await refresh(); };
    return b;
  }

  function ladder() {
    const s = st;
    const biz = s.tier === 'business_verified' || s.tier === 'verified';
    const step = (n, cls, t, d) => h('div', { class: 'bt-step ' + cls }, [h('span', { class: 'bt-step-n' }, cls === 'done' ? '✓' : String(n)), h('div', { class: 'bt-step-t' }, t), h('div', { class: 'bt-step-d' }, d)]);
    return h('div', { class: 'bt-ladder' }, [
      step(1, biz ? 'done' : 'now', 'Business confirmed', 'From your company email domain — no documents, under a minute.'),
      step(2, (s.tier === 'verified' || (biz && (s.shipments || 0) > 0)) ? 'done' : biz ? 'now' : 'lock', 'Request quotes', 'Post a shipment; brokers quote it. Quotes are non-binding — nothing to sign yet.'),
      step(3, s.tier === 'verified' ? 'done' : (biz && (s.shipments || 0) > 0) ? 'now' : 'lock', 'Before your first booking', 'Shipper Agreement (one click), payment terms and a claims contact — asked once, when you accept a quote.'),
      step(4, s.tier === 'verified' ? 'done' : 'lock', 'Verified shipper', 'Full packet on file → brokers see the badge and quote faster.'),
    ]);
  }

  function paint() {
    if (!st) { mount(host, h('div', { class: 'bt-wrap' }, h('div', { class: 'bt-card' }, [h('div', { class: 'bt-skel', style: 'width:40%' }), h('div', { class: 'bt-skel', style: 'width:90%' }), h('div', { class: 'bt-skel', style: 'width:70%' })]))); return; }
    const [cls, label] = TIER[st.tier] || TIER.new;
    const chk = st.check || {};
    const err = notice ? h('div', { class: 'bt-err', style: notice.ok ? 'color:#12a150' : '' }, notice.text) : null;
    const nDone = st.tier === 'verified' ? 4 : st.can_post ? ((st.shipments || 0) > 0 ? 2 : 1) : 0;
    const hero = h('div', { class: 'bt-hero' }, [
      h('div', { class: 'bt-hero-top' }, [h('div', { style: 'flex:1;min-width:260px' }, [
      h('div', { class: 'bt-hero-k' }, 'Shipper onboarding · ' + label),
      h('div', { class: 'bt-hero-t' }, st.tier === 'verified' ? 'You’re a verified shipper.' : st.can_post ? 'You can request quotes now.' : 'Request your first quote in minutes — no documents to start.'),
      h('div', { class: 'bt-hero-s' }, st.can_post ? 'Brokers quote your shipments. The short packet comes before your first booking, not before your first quote.' : 'Business confirmed from your company email — no PDFs. Documents only where they matter: your first booking.'),
      ]), progressRing(nDone, 4, st.tier === 'verified' ? 'verified' : 'steps done')]),
      ladder(),
    ]);
    let body;
    if (st.tier === 'hold') {
      body = h('div', { class: 'bt-card', style: 'border-left:4px solid #c62828' }, [h('h3', null, 'Posting is on hold'), h('div', { class: 'bt-sub' }, st.hold_reason || 'Contact support.')]);
    } else if (st.can_post) {
      // Premium: facts as tiles, the pre-booking items as chips — no paragraph.
      const pend = (st.packet || []).filter((p) => ['required', 'conditional'].includes(String(p.tag).toLowerCase()) && !['verified', 'waived'].includes(p.status)).map((p) => p.label.replace(' — before your first booking', ''));
      const fact = (k, v) => h('div', null, [h('b', null, k), v || '—']);
      body = h('div', { class: 'bt-card' }, [
        h('h3', null, '1 · ' + (st.company || 'Your company') + ' is confirmed'),
        h('div', { class: 'bt-sub' }, 'Business confirmed from your company domain — quotes are open.'),
        h('div', { class: 'bt-fact' }, [
          fact('Domain', st.domain || '—'),
          fact('Receives mail', chk.mx === false ? 'No' : 'Yes'),
          fact('Website', chk.site_title ? chk.site_title : chk.site_ok === false ? 'Not found (optional)' : (chk.site_ok ? 'Found' : '—')),
          fact('Confirmed', st.verified_at ? new Date(st.verified_at).toLocaleString() : '—'),
        ]),
        st.tier !== 'verified' && pend.length ? h('div', null, [
          h('div', { class: 'bt-note', style: 'margin-top:14px;font-weight:800;color:#334155;letter-spacing:.06em;text-transform:uppercase;font-size:.68rem' }, 'Before your first booking · asked once'),
          h('div', { class: 'bt-chips' }, pend.map((t) => h('span', { class: 'bt-chip' }, t))),
          h('div', { class: 'bt-row', style: 'margin-top:12px' }, [h('button', { class: 'bt-btn ghost', onClick: () => opts.goPacket && opts.goPacket() }, 'Open the packet (' + (st.packet_required_done || 0) + '/' + (st.packet_required_total || 0) + ') →')]),
        ]) : null,
      ]);
    } else if (chk.pending || chk.outcome === 'pending' || !chk.outcome) {
      body = h('div', { class: 'bt-card' }, [
        h('h3', null, '1 · Confirming your business'),
        h('div', { class: 'bt-row' }, [h('span', { class: 'bt-spin' }), h('span', { class: 'bt-sub' }, 'Checking ' + (st.domain || 'your company domain') + ' — that it receives mail and has a website. Usually under a minute.')]),
        h('div', { class: 'bt-note' }, 'Your signup address is on ' + (st.domain || 'a company domain') + ' — that is the check. No documents.'),
        err,
      ]);
    } else if (chk.outcome === 'free_mail') {
      body = h('div', { class: 'bt-card', style: 'border-left:4px solid #b45309' }, [
        h('h3', null, '1 · Confirm your company email'),
        h('div', { class: 'bt-sub' }, 'Personal inbox (' + (st.signup_email_masked || 'Gmail/Yahoo') + ') cannot prove a business. Enter your company address — we email it a 6-digit code.'),
        st.code_live ? codeBox() : companyEmailForm('Your company email'),
        st.code_live ? h('div', { class: 'bt-row', style: 'margin-top:6px' }, [h('button', { class: 'bt-btn ghost sm', onClick: () => { st.code_live = false; paint(); } }, 'Use a different address')]) : null,
        err,
        h('div', { class: 'bt-note' }, 'No company domain at all? Email hello@loadboot.com with your EIN letter or a recent freight invoice — our team confirms by hand.'),
      ]);
    } else {
      // no_mail / error
      body = h('div', { class: 'bt-card', style: 'border-left:4px solid #b45309' }, [
        h('h3', null, '1 · We could not confirm ' + (st.domain || 'your domain') + ' yet'),
        h('div', { class: 'bt-sub' }, (st.reason || chk.reason || 'The check did not complete.') + (chk.outcome === 'no_mail' ? ' A domain that receives no email is usually a typo or a parked domain.' : '')),
        st.code_live ? codeBox() : companyEmailForm('An address on your company’s real domain'),
        h('div', { class: 'bt-row', style: 'margin-top:6px' }, [recheckBtn('Re-check ' + (st.domain || 'the domain'))]),
        err,
        h('div', { class: 'bt-note' }, 'Still stuck? Email hello@loadboot.com with your EIN letter or a recent freight invoice — our team confirms by hand.'),
      ]);
    }
    mount(host, h('div', { class: 'bt-wrap' }, [hero, body]));
    decorateCards(host, { s1: st.can_post ? 'done' : 'now' });
  }

  async function refresh() {
    try { const s = await partnerShipperStatus(); if (!alive) return; st = s; } catch (e) { if (!st) { mount(host, h('div', { class: 'bt-card' }, h('div', { class: 'bt-err' }, (e && e.message) || 'Could not load.'))); return; } }
    if (st && st.can_post) notice = null;
    paint();
    try { opts.onStatus && opts.onStatus(st); } catch (_) {}
    const chk = (st && st.check) || {};
    const want = st && !st.can_post && st.tier !== 'hold' && (chk.pending || chk.outcome === 'pending' || !chk.outcome) ? 5000 : 0;
    if (timer && !want) { clearInterval(timer); timer = null; }
    if (want && !timer) timer = setInterval(refresh, want);
  }
  paint(); refresh();
  return { refresh, stop, get status() { return st; } };
}
