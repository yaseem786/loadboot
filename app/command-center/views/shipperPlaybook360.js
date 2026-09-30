// shipperPlaybook360.js — bl_ship_0503. "Specialist playbook" at the top of Shipper 360 → Two-lane verification.
// One place that tells the onboarding specialist, in order: what the risk signals say, whose turn each step is (staff or
// shipper), the ONE next move, and — when the shipper owes the next step — a ready follow-up message. Read-only: it only
// reads cc_shipper_verification (the same object the rest of the card uses); every action stays on its own card below.
import { el } from '../../shared/ui/dom.js';
// same markup as partner360-kit pill(); kept local so this module has no env/client imports (unit-testable in node)
const pill = (tone, text) => el('span', { class: 'cc-pill cc-pill-' + (tone || 'gray') }, text);

const DONE = (s) => s === 'verified' || s === 'waived';
const CONTACT = '📞💬 Call or WhatsApp · +1 (815) 365-1168';   // CLAUDE.md §7 — the one contact sign

export function riskFlags(v) {
  const t = v.trust || {}; const reg = (v.registry || {}).checks || {}; const f = [];
  if (v.stage === 'hold' || t.hold_reason) f.push({ tone: 'red', text: 'On hold: ' + (t.hold_reason || 'call-back failed') });
  if (t.name_collision) f.push({ tone: 'red', text: 'Name matches an SEC company' + (t.sec_names && t.sec_names[0] ? ' (' + t.sec_names[0] + ')' : '') + ' — treat as a possible impersonation until the registry number and a call-back to that company prove otherwise' });
  if (t.domain_created_at && (Date.now() - Date.parse(t.domain_created_at)) / 864e5 < 180) f.push({ tone: 'red', text: 'Email domain registered ' + String(t.domain_created_at).slice(0, 10) + ' — real established shippers rarely have a brand-new domain' });
  if (reg.young) f.push({ tone: 'red', text: 'Company formed ' + reg.age_days + ' days ago (registry)' });
  if ((t.shared_doc_orgs || []).length) f.push({ tone: 'red', text: 'Uploaded a document another LoadBoot account also uploaded' });
  if (t.mx_class === 'budget_host' && (!t.dmarc || t.dmarc === 'none' || t.dmarc === 'p_none')) f.push({ tone: 'amber', text: 'Email on a budget mail host with no DMARC' });
  if (t.domain && !t.domain_created_at && !t.mx_class) f.push({ tone: 'amber', text: 'Fraud signals never ran for this account (domain age, mail host, SEC name unknown) — ask the owner to re-run the domain check before judging it' });
  if (t.free_mail) f.push({ tone: 'amber', text: 'Signed up with a free email — the manual identity path (EIN letter + address proof) applies' });
  if (!t.site_ok && !t.free_mail) f.push({ tone: 'amber', text: 'No working website on the email domain' });
  return f;
}

export function playbookSteps(v) {
  const it = {}; (v.items || []).forEach((i) => { it[i.key] = i; });
  const st = (k) => (it[k] ? it[k].status : 'pending');
  const active = (k) => !!(it[k] && it[k].active);
  const cb = v.callback || {}; const reg = v.registry || {}; const ed = v.email_domain || {};
  const answers = ['legal_entity', 'physical_address', 'authorized_signer'];
  const ansMissing = answers.filter((k) => ['pending', 'rejected'].includes(st(k)));
  const ansToReview = answers.filter((k) => st(k) === 'submitted');
  const docs = ['ein_letter', 'address_proof'].filter(active);
  const docsMissing = docs.filter((k) => ['pending', 'rejected'].includes(st(k)));
  const docsToReview = docs.filter((k) => st(k) === 'submitted');
  const regDone = DONE(reg.status);
  const later = (v.items || []).filter((i) => i.active && ['billing', 'cargo', 'special', 'facilities', 'acks'].includes(i.section) && !DONE(i.status));
  const laterShipper = later.filter((i) => ['pending', 'rejected'].includes(i.status));
  const laterStaff = later.filter((i) => i.status === 'submitted');
  const agreements = ['platform_terms', 'shipper_carrier_terms'].filter((k) => it[k] && !DONE(st(k)) && st(k) !== 'unavailable');
  const label = (k) => (it[k] && it[k].label) || k;
  const idDone = ['identity_verified', 'broker_ready', 'direct_ready', 'both_ready'].includes(v.stage);
  const S = [];
  S.push({ who: 'shipper', title: 'Identity answers', state: ansMissing.length ? 'waiting' : 'done',
    do: ansMissing.length ? 'The shipper still owes: ' + ansMissing.map(label).join(', ') + '.' : 'Legal entity, address and signer are in.',
    owe: ansMissing.map(label) });
  S.push({ who: 'staff', title: 'State registry check', state: regDone ? 'done' : ['pending', 'rejected'].includes(st('legal_entity')) ? 'blocked' : 'now',
    do: regDone ? 'Registry record verified.' : 'Open the state record yourself (use "Fill from open data" where offered), attach a screenshot, then Save & verify. Mismatches are refused on purpose — reject with a clear note instead of forcing it.' });
  if (ed.sec_rule) S.push({ who: 'staff', title: 'Email domain (SEC-name rule)', state: ed.approved && ed.approved === ed.confirmed ? 'done' : ed.confirmed ? 'now' : 'waiting',
    do: ed.confirmed ? 'Approve ' + ed.confirmed + ' only if the SEC company itself lists it on a site or filing you found yourself. Otherwise leave it and escalate to the owner.' : 'The shipper has not confirmed a company inbox yet.' });
  S.push({ who: 'shipper', title: 'Company email + signer phone codes', state: DONE(st('email_verify')) && DONE(st('phone_verify')) ? 'done' : 'waiting',
    do: [!DONE(st('email_verify')) ? 'company email code' : null, !DONE(st('phone_verify')) ? 'signer phone code' : null].filter(Boolean).join(' and ') + (DONE(st('email_verify')) && DONE(st('phone_verify')) ? 'Both confirmed.' : ' — the shipper does these in Verification.'),
    owe: [!DONE(st('email_verify')) ? 'Confirm the company email' : null, !DONE(st('phone_verify')) ? 'Confirm the signer\'s phone' : null].filter(Boolean) });
  if (active('independent_callback')) S.push({ who: 'staff', title: 'Independent call-back', state: cb.status === 'confirmed' ? 'done' : cb.status === 'failed' ? 'blocked' : cb.status === 'calling' ? 'waiting' : regDone ? 'now' : 'blocked',
    do: cb.status === 'confirmed' ? 'Confirmed.' : cb.status === 'calling' ? 'Code call placed — whoever answered reads the code into the portal.' : cb.status === 'failed' ? 'Failed → the shipper is on hold.'
      : 'Call a number YOU found: the registry record, the company\'s own website, or "Find phone on Google" (registry address). Never the number the shipper typed.' });
  if (ansToReview.length) S.push({ who: 'staff', title: 'Verify the identity answers', state: regDone ? 'now' : 'blocked',
    do: 'Compare ' + ansToReview.map(label).join(', ') + ' with the registry card, then Verify each (section A below).' });
  if (docs.length) S.push({ who: docsMissing.length ? 'shipper' : 'staff', title: 'EIN letter + address proof', state: docsMissing.length ? 'waiting' : docsToReview.length ? (regDone ? 'now' : 'blocked') : 'done',
    do: docsMissing.length ? 'The shipper still owes: ' + docsMissing.map(label).join(', ') + '.' : docsToReview.length ? 'Open each file, then "Verify vs registry": name and address must be the registry\'s.' : 'Both verified.',
    owe: docsMissing.map(label) });
  if (agreements.length) S.push({ who: 'shipper', title: 'Agreements', state: 'waiting', do: 'The shipper signs ' + agreements.map(label).join(' and ') + ' in the portal. Staff never sign for them.', owe: agreements.map((k) => 'Sign ' + label(k)) });
  if (later.length) S.push({ who: laterShipper.length ? 'shipper' : 'staff', title: 'Billing, cargo, locations, acknowledgements', state: laterShipper.length ? 'waiting' : idDone ? 'now' : 'blocked',
    do: !laterShipper.length && !idDone ? laterStaff.length + ' submitted — review them only after identity (steps above) is verified.' : laterShipper.length ? laterShipper.length + ' left for the shipper: ' + laterShipper.map((i) => i.label).slice(0, 5).join(', ') + (laterShipper.length > 5 ? '…' : '') : laterStaff.length + ' submitted — review them in sections B–G.',
    owe: laterShipper.map((i) => i.label) });
  const open = (v.direct && v.direct.ok) || (v.broker && v.broker.ok);
  S.push({ who: 'staff', title: 'Lane open', state: open ? 'done' : 'waiting', do: open ? 'At least one lane is open. New-shipper limits apply until 3 carrier-confirmed paid loads.' : 'Opens by itself when every step above is done.' });
  return S;
}

export function followUpText(v, owe) {
  const name = (v.items || []).find((i) => i.key === 'authorized_signer');
  const hi = name && name.data && name.data.name ? 'Hi ' + String(name.data.name).split(' ')[0] + ',' : 'Hi,';
  return [hi, '', 'Thanks for signing up with LoadBoot. To open posting for your company, a few verification steps are still open in your portal (Verification tab):',
    ...owe.slice(0, 8).map((o) => '• ' + o), '', 'It takes about 10 minutes. If anything is unclear, reply here or reach us:', CONTACT, '', '— LoadBoot onboarding'].join('\n');
}

export function playbookCard(ctx, v) {
  const flags = riskFlags(v);
  const steps = playbookSteps(v);
  const hold = v.stage === 'hold';
  const next = steps.find((s) => s.state === 'now');
  const owe = steps.filter((s) => s.state === 'waiting' && s.who === 'shipper').flatMap((s) => s.owe || []);
  const red = flags.some((f) => f.tone === 'red');
  const icon = { done: '✓', now: '●', waiting: '…', blocked: '⛔' };
  const tone = { done: 'green', now: 'blue', waiting: 'amber', blocked: 'gray' };
  let moveTitle; let moveText;
  if (hold) { moveTitle = 'On hold — nothing moves'; moveText = 'Do not follow up about onboarding and do not verify items. Only the owner lifts a hold, after an independent call-back to the real company.'; }
  else if (next) { moveTitle = 'Your next move: ' + next.title; moveText = next.do; }
  else if (owe.length) { moveTitle = 'Waiting on the shipper'; moveText = 'Nothing for staff right now. Follow up (message below) — by hand, and only after CC → Unsubscribes → "Can I send this?" says yes for an email.'; }
  else { moveTitle = 'All steps done'; moveText = 'Nothing left for staff.'; }
  const copyBtn = (text) => el('button', { class: 'lb-btn lb-btn-sm', onClick: async (e) => { try { await navigator.clipboard.writeText(text); e.currentTarget.textContent = 'Copied ✓'; } catch (_) { /* clipboard blocked: the text is visible to copy by hand */ } } }, 'Copy message');
  const msg = !hold && owe.length ? followUpText(v, owe) : null;
  return el('div', { style: 'margin-top:12px;border:1px solid ' + (red ? '#fecaca' : '#dbe7fb') + ';border-radius:14px;padding:12px 14px;background:' + (red ? '#fff7f7' : '#f7faff') }, [
    el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [el('b', null, 'Specialist playbook'),
      red ? pill('red', flags.filter((f) => f.tone === 'red').length + ' red flag(s)') : pill('green', 'no red flags')]),
    flags.length ? el('ul', { style: 'margin:8px 0 0 18px;padding:0' }, flags.map((f) => el('li', { class: 'cc-sub', style: 'color:' + (f.tone === 'red' ? '#b91c1c' : '#92400e') }, f.text))) : null,
    red && !hold ? el('div', { class: 'cc-sub', style: 'margin-top:6px;font-weight:700;color:#b91c1c' }, 'Rule with a red flag: verify nothing until the registry record AND an independent call-back to a number you found both confirm the company. When in doubt, ask the owner to put it on hold.') : null,
    el('div', { style: 'margin-top:10px;border-radius:12px;padding:10px 12px;background:#fff;border:1px solid #e2e8f0' }, [
      el('div', { style: 'font-weight:800' }, moveTitle), el('div', { class: 'cc-sub', style: 'margin-top:3px' }, moveText)]),
    el('ol', { style: 'margin:10px 0 0 0;padding:0;list-style:none' }, steps.map((s, i) => el('li', { style: 'display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-top:' + (i ? '1px solid #eef2f7' : '0') }, [
      pill(tone[s.state], icon[s.state] + ' ' + (i + 1)),
      el('div', { style: 'flex:1;min-width:0' }, [el('div', null, [el('b', null, s.title), el('span', { class: 'cc-sub' }, '  ·  ' + (s.who === 'staff' ? 'staff' : 'shipper'))]), el('div', { class: 'cc-sub' }, s.do)]),
    ]))),
    msg ? el('details', { style: 'margin-top:8px' }, [el('summary', { style: 'cursor:pointer;font-weight:700' }, 'Follow-up message for the shipper (' + owe.length + ' open)'),
      el('pre', { class: 'cc-sub', style: 'white-space:pre-wrap;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px;margin:6px 0' }, msg), copyBtn(msg)]) : null,
    el('details', { style: 'margin-top:8px' }, [el('summary', { style: 'cursor:pointer;font-weight:700' }, 'How to judge a shipper (read once)'),
      el('ul', { class: 'cc-sub', style: 'margin:6px 0 0 18px;padding:0;line-height:1.5' }, [
        'Proof comes from records YOU pull (state registry, the company\'s own website, SEC filings) — never from what the shipper sends or types.',
        'Impersonation pattern: a big company\'s name + a domain a few days old + a budget mail host + a signer nobody can find. MII Brand Import (Sep 2026) looked exactly like this.',
        'Call back on a number you found, not the signup number. The system refuses the signup number on purpose (FBI freight-fraud advice).',
        'A document (EIN letter, bill, lease) only counts when its name and address match the registry record.',
        'A Google listing is a hint, not proof — anyone can create one. Trust it only when it sits at the registry address.',
        'Never quote, negotiate or discuss rates with a shipper. The shipper posts the rate and picks the carrier.',
        'Red flag and unsure? Do not verify. Write what you found in a note and ask the owner.',
      ].map((t) => el('li', null, t)))]),
  ]);
}

export default { playbookCard, playbookSteps, riskFlags, followUpText };
