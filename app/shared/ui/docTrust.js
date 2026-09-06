// docTrust.js — the single place that tells a user who can open the document they are
// about to upload.
//
// Why this exists: a carrier hands over a W-9 with their SSN on it, a voided check, and a
// photo of a CDL, inside a modal whose only microcopy was the accepted file format. People
// do not read a privacy policy before an upload — they read the sentence next to the
// button, or they read nothing. So the sentence has to be there, and it has to be TRUE.
//
// Every line below matches the "Every document we ask for" table on /privacy.html#documents
// and the access rules actually enforced in the database:
//   • storage RLS puts each file under the uploader's own {auth.uid()}/ folder
//   • doc_read_assigned_dispatcher whitelists exactly four types — authority, insurance,
//     w9, noa — so a dispatcher genuinely cannot open a bank_check
//   • documents are only ever served through short-lived signed links, never a public URL
// If any of that changes, change it here and on the privacy page in the same commit.
//
// No framework: the carrier and partner apps each define their own local h(), so this
// builds with plain DOM and works in both.

const PRIVACY_URL = '/privacy.html#documents';

// who: the one sentence shown in the badge. Keep it under ~140 chars — it is read standing
// at a truck stop on a phone, not at a desk.
export const DOC_TRUST = {
  // ---- carrier ----
  insurance:   { who: 'You, the LoadBoot staff who review it, and your assigned dispatcher — because a broker packet needs it.' },
  authority:   { who: 'You, the LoadBoot staff who review it, and your assigned dispatcher — because a broker packet needs it.' },
  mcs150:      { who: 'You and the LoadBoot staff who review it. Used to show brokers your filing is current.' },
  safety:      { who: 'You and the LoadBoot staff who review it. Used to show brokers your safety standing.' },
  w9:          { who: 'You, LoadBoot review staff and your dispatcher. Your EIN/SSN is stored encrypted and shown masked everywhere — including to us.', strong: true },
  noa:         { who: 'You, LoadBoot staff, your dispatcher, and the broker on loads you run — that is the whole point of an NOA.' },
  agreement:   { who: 'You and LoadBoot staff. You can download your copy any time.' },
  bank_check:  { who: 'You and LoadBoot finance only. Your dispatcher can never open this — the database rule that grants dispatcher access does not list it.', strong: true },
  hazmat_reg:  { who: 'You, LoadBoot review staff and your dispatcher. Only asked for because you told us you haul hazmat.' },
  hazmat_h:    { who: 'You, LoadBoot review staff and your dispatcher. The photo is used to confirm the H endorsement and nothing else.' },
  hazmat_coi:  { who: 'You, LoadBoot review staff and your dispatcher. Only asked for because you told us you haul hazmat.' },
  rate_con:    { who: 'You, LoadBoot staff, and both sides of that one load. Not visible on any other load.' },
  bol:         { who: 'You, LoadBoot staff, and both sides of that one load. Not visible on any other load.' },
  pod:         { who: 'You, LoadBoot staff, and both sides of that one load. This is the proof that gets you paid.' },
  payment_receipt: { who: 'You and LoadBoot finance only.' },
  other:       { who: 'You and the LoadBoot staff who review it.' },

  // ---- agent ----
  agent_id:    { who: 'You and LoadBoot finance only. Payouts go only to a verified identity — that is what stops someone else claiming your commission.', strong: true },
  agent_bank:  { who: 'You and LoadBoot finance only. It locks your commission to one destination that cannot be changed by an email.', strong: true },

  // ---- broker / shipper packet ----
  mc_authority:      { who: 'You and LoadBoot review staff. Carriers see your verification status, never the document.' },
  bmc84_bond:        { who: 'You and LoadBoot review staff. Carriers see that you are bonded, never the certificate.' },
  boc3:              { who: 'You and LoadBoot review staff.' },
  ucr:               { who: 'You and LoadBoot review staff.' },
  coi:               { who: 'You and LoadBoot review staff.' },
  broker_agreement:  { who: 'You and LoadBoot review staff.' },
  signed_agreement:  { who: 'You and LoadBoot review staff.' },
  credit_application:{ who: 'You and LoadBoot finance only. No carrier ever sees it.', strong: true },
  bank_instructions: { who: 'You and LoadBoot finance only — held to the same standard as a carrier’s bank details.', strong: true },
  billing_instructions: { who: 'You and LoadBoot staff.' },
  payment_terms:     { who: 'You and LoadBoot staff. Carriers never see your terms with us.' },
  claims_procedure:  { who: 'You, LoadBoot staff, and the carrier on a load — so a driver knows who to call when something goes wrong.' },
  claims_contact:    { who: 'You, LoadBoot staff, and the carrier on a load.' },
  facility_rules:    { who: 'You, LoadBoot staff, and the carrier on a load — it helps them deliver.' },
  cargo_profile:     { who: 'You and LoadBoot staff, and the carrier on a load where it affects the haul.' },
  insurance_requirements: { who: 'You, LoadBoot staff, and carriers quoting your freight.' },
  special_commodity: { who: 'You, LoadBoot staff, and the carrier on a load.' },
  references:        { who: 'You and LoadBoot review staff. Optional — it just speeds up carrier trust.' },
};

const FALLBACK = 'You and the LoadBoot staff who review it.';

// The two sentences true of EVERY upload, whatever it is.
const ALWAYS = 'Stored privately under your own account and only ever opened through a short-lived link. Never sold, never used for advertising.';

function elm(tag, attrs, kids) {
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : String(v));
  }
  (Array.isArray(kids) ? kids : [kids]).forEach((c) => {
    if (c == null || c === false || c === '') return;
    n.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  });
  return n;
}

/**
 * A compact "who can open this" badge for a document upload.
 * @param {string} key   document type key (see DOC_TRUST)
 * @param {object} [opt] { compact:boolean } — compact drops the ALWAYS line
 * @returns {HTMLElement}
 */
export function docTrustBadge(key, opt) {
  const o = opt || {};
  const spec = DOC_TRUST[key] || { who: FALLBACK };
  const accent = spec.strong ? '#15803d' : '#0883F7';
  const bg = spec.strong ? 'rgba(21,128,61,.06)' : 'rgba(8,131,247,.05)';
  const kids = [
    elm('div', { style: 'display:flex;gap:8px;align-items:flex-start' }, [
      elm('span', { style: 'flex:0 0 auto;font-size:14px;line-height:1.4' }, spec.strong ? '🔒' : '👁'),
      elm('div', null, [
        elm('b', { style: 'display:block;font-size:.78rem;letter-spacing:.06em;text-transform:uppercase;color:' + accent }, 'Who can open this'),
        elm('span', { style: 'display:block;margin-top:2px;line-height:1.55' }, spec.who),
      ]),
    ]),
  ];
  if (!o.compact) {
    kids.push(elm('div', { style: 'margin-top:7px;padding-top:7px;border-top:1px solid rgba(100,116,139,.16);line-height:1.5;opacity:.85' }, [
      ALWAYS + ' ',
      elm('a', { href: PRIVACY_URL, target: '_blank', rel: 'noopener', style: 'color:' + accent + ';font-weight:700;white-space:nowrap' }, 'See the full list →'),
    ]));
  }
  return elm('div', {
    class: 'lb-doctrust',
    style: 'margin-top:10px;padding:10px 12px;border-left:3px solid ' + accent + ';background:' + bg
         + ';border-radius:0 10px 10px 0;font-size:.82rem;color:#334155',
  }, kids);
}

/** Swap the badge inside a host element when the selected document type changes. */
export function mountDocTrust(host, key, opt) {
  if (!host) return;
  while (host.firstChild) host.removeChild(host.firstChild);
  host.appendChild(docTrustBadge(key, opt));
}

export default { DOC_TRUST, docTrustBadge, mountDocTrust };
