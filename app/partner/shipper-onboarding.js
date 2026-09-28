// shipper-onboarding.js — bl_ship_0491: the shipper side of the two-lane marketplace.
//   • shipperVerificationPage — onboarding re-imagined as sections A–G (identity · billing · agreements · cargo ·
//     special · locations · acknowledgements). Every item says in one line WHY we ask. Progress is shown per lane:
//     "Carriers" (post direct, you choose the carrier) and "Brokers" (send a tender to a verified broker).
//   • shipperBrokersPage — the Brokers tab: verified brokers only (FMCSA broker authority + $75k bond), or a
//     polite "we are onboarding brokers" card when none is live yet.
//   • shipperLaneCard — the dashboard card: which lane is open, what is left, the new-shipper limits.
// Server truth lives in bl_ship_0491–0493 (shipper_lane_gate). This file only renders it; it decides nothing.
// Self-contained (own h/mount + scoped .so-* styles) like shipper-trust.js.
import {
  shipperOnboarding, shipperItemSave, shipperAgreement, shipperAgreementSign, shipperFacilities, shipperFacilitySave,
  shipperFacilityArchive, shipperPhoneCodeSend, shipperCodeVerify, shipperBrokers, shipperPostLoad,
  partnerShipperCompanyEmail, partnerVerifyCode, onboardingSubmitItem,
} from '../shared/api.js';
import { uploadDocument } from '../shared/storage.js';

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
const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

let cssDone = false;
function ensureCss() {
  if (cssDone) return; cssDone = true;
  const s = document.createElement('style');
  s.textContent = `
  .so-hero{border-radius:18px;padding:18px 20px;background:linear-gradient(135deg,#0b1a33,#10284f);color:#e2e8f0;margin-bottom:14px}
  .so-hero h2{margin:0 0 4px;font-size:1.25rem;color:#fff}
  .so-hero p{margin:0;color:#b6c4dc;font-size:.88rem;line-height:1.5}
  .so-lanes{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;margin-top:14px}
  .so-lane{border-radius:14px;padding:12px 14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12)}
  .so-lane b{display:block;color:#fff;font-size:.95rem}
  .so-lane small{display:block;color:#b6c4dc;margin-top:3px;line-height:1.45}
  .so-lane.ok{border-color:rgba(34,197,94,.55);background:rgba(34,197,94,.12)}
  .so-bar{height:6px;border-radius:6px;background:rgba(255,255,255,.14);margin-top:8px;overflow:hidden}
  .so-bar i{display:block;height:100%;background:#22c55e;border-radius:6px}
  .so-sec{border:1px solid #e6ebf3;border-radius:16px;background:#fff;margin-bottom:12px;overflow:hidden}
  .so-sech{display:flex;align-items:center;gap:10px;padding:13px 16px;cursor:pointer;user-select:none}
  .so-sech h3{margin:0;font-size:.98rem;flex:1;color:#0b1220}
  .so-letter{width:28px;height:28px;border-radius:9px;background:#eef4ff;color:#1d4ed8;font-weight:900;display:flex;align-items:center;justify-content:center;font-size:.85rem;flex:none}
  .so-count{font-size:.78rem;font-weight:800;color:#64748b}
  .so-count.done{color:#15803d}
  .so-body{border-top:1px solid #f1f5f9}
  .so-item{display:flex;gap:12px;align-items:center;padding:12px 16px;border-bottom:1px solid #f1f5f9}
  .so-item:last-child{border-bottom:0}
  .so-item .t{font-weight:800;font-size:.9rem;color:#0f172a}
  .so-item .p{font-size:.8rem;color:#64748b;margin-top:2px;line-height:1.45}
  .so-item .n{font-size:.8rem;color:#b91c1c;margin-top:3px;font-weight:700}
  .so-pill{font-size:.72rem;font-weight:800;border-radius:999px;padding:3px 9px;white-space:nowrap}
  .so-pill.ok{background:#dcfce7;color:#166534}.so-pill.wait{background:#fef3c7;color:#92400e}
  .so-pill.bad{background:#fee2e2;color:#991b1b}.so-pill.todo{background:#f1f5f9;color:#475569}.so-pill.soon{background:#e0e7ff;color:#3730a3}
  .so-btn{border:0;border-radius:10px;padding:8px 13px;font-weight:800;font-size:.82rem;cursor:pointer;background:#0883F7;color:#fff;white-space:nowrap}
  .so-btn.ghost{background:#eef4ff;color:#1d4ed8}.so-btn.orange{background:#FC5305}
  .so-btn[disabled]{opacity:.55;cursor:default}
  .so-f label{display:block;font-weight:800;font-size:.8rem;color:#334155;margin:10px 0 4px}
  .so-f .hint{font-weight:500;color:#64748b;font-size:.76rem;margin-top:3px}
  .so-f input,.so-f select,.so-f textarea{width:100%;box-sizing:border-box;border:1.5px solid #dbe3ef;border-radius:10px;padding:9px 11px;font-size:.9rem;font-family:inherit}
  .so-f textarea{min-height:70px}
  .so-chips{display:flex;flex-wrap:wrap;gap:6px}
  .so-chip{border:1.5px solid #dbe3ef;border-radius:999px;padding:6px 11px;font-size:.8rem;font-weight:700;cursor:pointer;background:#fff;color:#334155}
  .so-chip.on{background:#0883F7;border-color:#0883F7;color:#fff}
  .so-err{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:10px;padding:9px 11px;font-size:.82rem;margin-top:10px}
  .so-ok{background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;border-radius:10px;padding:9px 11px;font-size:.82rem;margin-top:10px}
  .so-q{background:#fffbeb;border:1px solid #fde68a;color:#78350f;border-radius:10px;padding:10px 12px;font-size:.84rem;margin-top:10px}
  .so-note{font-size:.82rem;color:#475569;background:#f8fafc;border-radius:12px;padding:10px 12px;line-height:1.5}
  .so-agree{white-space:pre-wrap;font-size:.84rem;line-height:1.55;max-height:46vh;overflow:auto;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px}
  .so-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
  .so-bcard{border:1px solid #e6ebf3;border-radius:16px;padding:14px 16px;background:#fff}
  .so-empty{border-radius:18px;padding:22px;background:linear-gradient(135deg,#f8fbff,#eef4ff);border:1px solid #dbe7fb;text-align:center}
  .so-empty h3{margin:6px 0;color:#0b1220}
  .so-empty p{color:#475569;max-width:560px;margin:6px auto 0;line-height:1.6;font-size:.9rem}
  @media (max-width:600px){.so-item{flex-wrap:wrap}.so-item .so-btn{width:100%}}
  `;
  document.head.appendChild(s);
}

/* ------------------------------------------------------------------ picklists (match app_private.shipper_validate) */
const COMMODITIES = [
  ['general_merchandise', 'General merchandise'], ['apparel_textiles', 'Apparel & textiles'], ['electronics', 'Electronics'],
  ['appliances', 'Appliances'], ['furniture', 'Furniture'], ['building_materials', 'Building materials'], ['lumber', 'Lumber'],
  ['steel_metals', 'Steel & metals'], ['machinery', 'Machinery'], ['auto_parts', 'Auto parts'], ['paper_packaging', 'Paper & packaging'],
  ['plastics_rubber', 'Plastics & rubber'], ['chemicals_nonhaz', 'Chemicals (non-hazardous)'], ['household_goods', 'Household goods'],
  ['retail_consumer', 'Retail / consumer goods'], ['beverages', 'Beverages'], ['food_dry', 'Food — dry / shelf-stable'],
  ['food_refrigerated', 'Food — refrigerated'], ['frozen_food', 'Frozen food'], ['produce', 'Fresh produce'],
  ['meat_poultry_seafood', 'Meat, poultry & seafood'], ['dairy', 'Dairy'], ['pharmaceuticals', 'Pharmaceuticals'],
  ['medical_supplies', 'Medical supplies'], ['agricultural', 'Agricultural'], ['livestock_feed', 'Livestock feed'],
  ['hazmat', 'Hazardous materials'], ['high_value_goods', 'High-value goods'], ['other', 'Other'],
];
const EQUIPMENT = [
  ['dry_van', 'Dry van'], ['reefer', 'Reefer'], ['flatbed', 'Flatbed'], ['step_deck', 'Step deck'], ['double_drop', 'Double drop'],
  ['lowboy', 'Lowboy'], ['conestoga', 'Conestoga'], ['power_only', 'Power only'], ['box_truck', 'Box truck'], ['hotshot', 'Hotshot'],
  ['sprinter_van', 'Sprinter / cargo van'], ['tanker', 'Tanker'], ['container', 'Container / drayage'], ['auto_carrier', 'Auto carrier'],
  ['dump', 'Dump'], ['hopper', 'Hopper'],
];
const US_STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR'.split(' ');

const SECTIONS = [
  ['identity', 'A', 'Company identity', 'Who you are — checked against the state registry and an independent call-back, so no one can pose as your company.'],
  ['billing', 'B', 'Billing & credit', 'How carriers and brokers get paid by you — the first thing they check before taking your freight.'],
  ['agreements', 'C', 'Agreements', 'Signed once, right here. LoadBoot is software and a marketplace — never a broker, carrier or party to your freight.'],
  ['cargo', 'D', 'Cargo & liability', 'What you ship, what it is worth and who is liable — so only properly insured carriers see your loads.'],
  ['special', 'E', 'Special freight', 'Only shown when your cargo needs it: hazmat, food, high value.'],
  ['facilities', 'F', 'Pickup & delivery locations', 'Your docks, hours and detention rules, reused on every load.'],
  ['acks', 'G', 'Acknowledgements', 'Three short confirmations the law and carriers expect from every shipper.'],
];

const ACK_TEXT = {
  ack_non_coercion: 'We will not coerce, pressure or require any driver to operate in violation of federal safety rules, hours-of-service limits or hazardous-materials rules (49 CFR 390.6) — including through appointment times, detention, or threats to withhold freight.',
  ack_accurate_declarations: 'The weight, commodity description, piece count, value and hazmat information we give for each load will be accurate and complete. We are responsible for fines or losses caused by our own mis-declaration.',
  ack_direct_choice: 'When we post a load to carriers, we choose and accept the carrier ourselves. LoadBoot shows FMCSA, insurance and performance information, but it does not select, assign or approve carriers for us, does not set our rates, and does not collect or hold freight payments.',
};

// Form definitions — keys match app_private.shipper_validate. type: text|email|tel|number|select|multi|bool|textarea|refs|docs
const FORMS = {
  legal_entity: [
    { k: 'legal_name', l: 'Legal company name', hint: 'Exactly as registered with your Secretary of State.' },
    { k: 'dba', l: 'Doing business as (optional)', opt: true },
    { k: 'ein', l: 'EIN (Federal tax ID)', hint: '9 digits, e.g. 12-3456789.' },
    { k: 'entity_type', l: 'Entity type', type: 'select', o: [['llc', 'LLC'], ['corporation', 'Corporation'], ['s_corp', 'S corporation'], ['partnership', 'Partnership'], ['sole_proprietor', 'Sole proprietor'], ['nonprofit', 'Nonprofit'], ['other', 'Other']] },
    { k: 'state_of_formation', l: 'State of formation', type: 'select', o: US_STATES.map(s => [s, s]) },
    { k: 'entity_number', l: 'State entity / file number', hint: 'From your Secretary of State record. Not needed for a sole proprietor.' },
  ],
  physical_address: [
    { k: 'street', l: 'Street address', hint: 'The physical location — a PO box or mailbox is not accepted.' },
    { k: 'city', l: 'City' }, { k: 'state', l: 'State', type: 'select', o: US_STATES.map(s => [s, s]) },
    { k: 'zip', l: 'ZIP code' },
    { k: 'mailing_same', l: 'Mailing address is the same', type: 'bool', def: true },
    { k: 'mailing', l: 'Mailing address (if different)', opt: true },
  ],
  authorized_signer: [
    { k: 'name', l: 'Full name' }, { k: 'title', l: 'Title', hint: 'Owner, CEO, logistics manager…' },
    { k: 'phone', l: 'Direct phone', type: 'tel', hint: 'We call this number with a one-time code.' },
    { k: 'email', l: 'Company email', type: 'email' },
  ],
  payment_terms: [
    { k: 'terms', l: 'Your payment terms', type: 'select', o: [['quick_pay', 'Quick pay (within 7 days)'], ['net_15', 'Net 15'], ['net_30', 'Net 30'], ['net_45', 'Net 45'], ['net_60', 'Net 60']], hint: 'Counted from the day a correct invoice with POD reaches you.' },
  ],
  billing_instructions: [
    { k: 'invoice_email', l: 'Email where invoices go', type: 'email' },
    { k: 'required_docs', l: 'Documents that must come with an invoice', type: 'multi', o: [['rate_agreement', 'Rate agreement'], ['bol', 'Signed BOL'], ['pod', 'Proof of delivery'], ['po_number', 'PO number on invoice'], ['lumper_receipt', 'Lumper receipts'], ['scale_ticket', 'Scale ticket']] },
    { k: 'portal', l: 'Supplier / AP portal (optional)', opt: true, hint: 'If invoices must be uploaded somewhere, say where.' },
    { k: 'notes', l: 'Anything else about invoicing (optional)', type: 'textarea', opt: true },
  ],
  ap_contact: [{ k: 'name', l: 'AP contact name' }, { k: 'phone', l: 'AP phone', type: 'tel' }, { k: 'email', l: 'AP email', type: 'email' }],
  credit_application: [
    { k: 'years_in_business', l: 'Years in business', type: 'number' },
    { k: 'monthly_loads', l: 'Loads per month (approx.)', type: 'number', opt: true },
    { k: 'duns', l: 'D-U-N-S number (optional)', opt: true },
    { k: 'trade_refs', l: 'Trade references (at least two)', type: 'refs' },
    { k: 'bank_ref', l: 'Bank reference (optional)', opt: true, hint: 'Bank name and a contact. Never enter account numbers here.' },
  ],
  cargo_profile: [
    { k: 'commodities', l: 'What you ship', type: 'multi', o: COMMODITIES },
    { k: 'other_commodity', l: 'If "Other", describe it', opt: true },
    { k: 'equipment', l: 'Equipment you need', type: 'multi', o: EQUIPMENT },
    { k: 'typical_value', l: 'Typical cargo value per load ($)', type: 'number' },
    { k: 'max_value', l: 'Maximum cargo value per load ($)', type: 'number' },
    { k: 'temp_controlled', l: 'Temperature-controlled freight', type: 'bool' },
    { k: 'food_grade', l: 'Needs a food-grade trailer', type: 'bool' },
    { k: 'hazmat', l: 'Includes hazardous materials', type: 'bool' },
  ],
  insurance_requirements: [
    { k: 'min_cargo', l: 'Minimum cargo insurance you require ($)', type: 'number', hint: '$100,000 is the usual carrier cover.' },
    { k: 'min_auto_liability', l: 'Minimum auto liability you require ($)', type: 'number', hint: 'Federal minimum for general freight is $750,000; most shippers ask $1,000,000.' },
  ],
  declared_value_policy: [
    { k: 'policy', l: 'Liability basis', type: 'select', o: [['full_value', 'Full value — the carrier is liable for actual loss (federal default)'], ['released_value', 'Released value — a lower agreed limit']] },
    { k: 'released_amount', l: 'Released value amount ($) — only for released value', type: 'number', opt: true },
    { k: 'released_basis', l: 'Released value basis', type: 'select', opt: true, o: [['per_lb', 'Per lb'], ['per_shipment', 'Per shipment']] },
  ],
  claims_contact: [{ k: 'name', l: 'Claims contact name' }, { k: 'phone', l: 'Claims phone', type: 'tel' }, { k: 'email', l: 'Claims email', type: 'email' }],
  hazmat: [
    { k: 'emergency_phone', l: '24-hour emergency response phone', type: 'tel', hint: 'Must be monitored at all times while the load moves — an answering machine does not qualify (49 CFR 172.604).' },
    { k: 'emergency_contact', l: 'Emergency contact or service name', hint: 'e.g. CHEMTREC contract, or your safety manager.' },
    { k: 'phmsa_status', l: 'PHMSA hazmat registration', type: 'select', o: [['registered', 'Registered'], ['not_required', 'Not required for what we ship']] },
    { k: 'phmsa_number', l: 'PHMSA registration number (if registered)', opt: true },
    { k: 'shipping_papers_ack', l: 'We provide proper hazmat shipping papers with every load', type: 'bool' },
    { k: 'training_ack', l: 'Our hazmat employees are trained (49 CFR 172.704)', type: 'bool' },
  ],
  food_sanitary: [
    { k: 'temperature', l: 'Temperature requirement', hint: 'e.g. 34–38°F, or "ambient".' },
    { k: 'precool', l: 'Trailer must be pre-cooled', type: 'bool' },
    { k: 'cleaning', l: 'Trailer cleaning / washout requirement', type: 'textarea' },
    { k: 'prior_cargo', l: 'Prior-cargo restrictions', hint: 'e.g. "no raw meat, no chemicals in the last 3 loads", or "none".' },
    { k: 'written_ack', l: 'These requirements go to the carrier in writing with each load', type: 'bool' },
  ],
  high_value: [
    { k: 'min_cargo_cover', l: 'Cargo cover a carrier must carry for these loads ($)', type: 'number' },
    { k: 'tracking_ack', l: 'Live tracking is required on high-value loads', type: 'bool' },
    { k: 'security', l: 'Extra security (optional)', opt: true, hint: 'e.g. team drivers, no stops in the first 250 miles, high-security seal.' },
  ],
};

/* ------------------------------------------------------------------ small helpers */
function pill(st) {
  const map = { verified: ['ok', 'Done ✓'], waived: ['ok', 'Waived'], submitted: ['wait', 'In review'], rejected: ['bad', 'Fix needed'], unavailable: ['soon', 'Coming soon'], expired: ['bad', 'Expired'] };
  const m = map[st] || ['todo', 'To do'];
  return h('span', { class: 'so-pill ' + m[0] }, m[1]);
}
const isDone = (st) => st === 'verified' || st === 'waived';
function fieldEl(f, val) {
  if (f.type === 'select') {
    const s = h('select', null, [h('option', { value: '' }, 'Choose…'), ...f.o.map(([v, t]) => h('option', { value: v }, t))]);
    s.value = val == null ? '' : String(val); return { el: s, get: () => s.value || null };
  }
  if (f.type === 'bool') {
    let on = val == null ? !!f.def : !!val;
    const b = h('button', { type: 'button', class: 'so-chip' + (on ? ' on' : '') }, on ? 'Yes' : 'No');
    b.onclick = () => { on = !on; b.className = 'so-chip' + (on ? ' on' : ''); b.textContent = on ? 'Yes' : 'No'; };
    return { el: b, get: () => on };
  }
  if (f.type === 'multi') {
    const sel = new Set(Array.isArray(val) ? val : []);
    const wrap = h('div', { class: 'so-chips' }, f.o.map(([v, t]) => {
      const c = h('button', { type: 'button', class: 'so-chip' + (sel.has(v) ? ' on' : '') }, t);
      c.onclick = () => { if (sel.has(v)) sel.delete(v); else sel.add(v); c.className = 'so-chip' + (sel.has(v) ? ' on' : ''); };
      return c;
    }));
    return { el: wrap, get: () => Array.from(sel) };
  }
  if (f.type === 'refs') {
    const rows = (Array.isArray(val) && val.length ? val : [{}, {}]).map(r => ({ ...r }));
    const box = h('div');
    const draw = () => mount(box, [...rows.map((r, i) => h('div', { style: 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:6px' }, [
      (() => { const x = h('input', { placeholder: 'Company', value: r.company || '' }); x.oninput = () => { r.company = x.value; }; return x; })(),
      (() => { const x = h('input', { placeholder: 'Contact', value: r.contact || '' }); x.oninput = () => { r.contact = x.value; }; return x; })(),
      (() => { const x = h('input', { placeholder: 'Phone or email', value: r.reach || '' }); x.oninput = () => { r.reach = x.value; }; return x; })(),
    ])), h('button', { type: 'button', class: 'so-btn ghost', onClick: () => { rows.push({}); draw(); } }, '+ Add reference')]);
    draw();
    return { el: box, get: () => rows.filter(r => (r.company || '').trim() && (r.reach || '').trim()) };
  }
  if (f.type === 'textarea') { const t = h('textarea'); t.value = val == null ? '' : String(val); return { el: t, get: () => t.value.trim() || null }; }
  const i = h('input', { type: f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text', inputmode: f.type === 'number' ? 'decimal' : null });
  i.value = val == null ? '' : String(val);
  return { el: i, get: () => { const v = i.value.trim(); return v === '' ? null : (f.type === 'number' ? Number(v) : v); } };
}

/* ------------------------------------------------------------------ item editors */
function openForm(it, ctx) {
  const defs = FORMS[it.key]; if (!defs) return;
  const data = it.data || {};
  const getters = {};
  const kids = [h('div', { class: 'so-note' }, it.purpose || '')];
  const f = h('div', { class: 'so-f' });
  defs.forEach((d) => {
    const fe = fieldEl(d, data[d.k]); getters[d.k] = fe.get;
    f.appendChild(h('label', null, d.l));
    f.appendChild(fe.el);
    if (d.hint) f.appendChild(h('div', { class: 'hint' }, d.hint));
  });
  kids.push(f);
  const msg = h('div');
  const save = h('button', { class: 'so-btn', style: 'margin-top:14px;width:100%' }, 'Save');
  const collect = () => { const o = {}; Object.keys(getters).forEach(k => { const v = getters[k](); if (v !== null && v !== undefined) o[k] = v; }); return o; };
  const run = async (confirm) => {
    save.disabled = true; save.textContent = 'Saving…'; mount(msg, []);
    try {
      const r = await shipperItemSave(it.key, collect(), !!confirm);
      if (r && r.ok) { close(); ctx.toast(r.status === 'verified' ? 'Saved ✓' : 'Saved — our team verifies it within 1 business day.'); ctx.reload(); return; }
      if (r && r.errors) mount(msg, h('div', { class: 'so-err' }, [h('b', null, 'Please fix:'), h('ul', { style: 'margin:6px 0 0 18px;padding:0' }, r.errors.map(e => h('li', null, e)))]));
      else if (r && r.confirm) mount(msg, h('div', { class: 'so-q' }, [h('b', null, 'Please confirm'), h('ul', { style: 'margin:6px 0 8px 18px;padding:0' }, r.confirm.map(e => h('li', null, e))),
        h('button', { class: 'so-btn orange', onClick: () => run(true) }, 'Yes — keep it and save'), ' ', h('span', { style: 'font-size:.8rem' }, 'or change the answer above.')]));
    } catch (e) { mount(msg, h('div', { class: 'so-err' }, (e && e.message) || 'Could not save.')); }
    save.disabled = false; save.textContent = 'Save';
  };
  save.onclick = () => run(false);
  kids.push(msg, save);
  const close = ctx.openModal(it.label, kids);
}

function openAck(it, ctx) {
  let on = !!(it.data && it.data.accepted);
  const box = h('button', { type: 'button', class: 'so-chip' + (on ? ' on' : ''), style: 'margin-top:12px' }, on ? '✓ We confirm' : 'Tick to confirm');
  box.onclick = () => { on = !on; box.className = 'so-chip' + (on ? ' on' : ''); box.textContent = on ? '✓ We confirm' : 'Tick to confirm'; };
  const msg = h('div');
  const save = h('button', { class: 'so-btn', style: 'margin-top:14px;width:100%' }, 'Save');
  save.onclick = async () => {
    save.disabled = true;
    try { const r = await shipperItemSave(it.key, { accepted: on, text: ACK_TEXT[it.key] }, false); if (r && r.ok) { close(); ctx.toast('Confirmed ✓'); ctx.reload(); return; } mount(msg, h('div', { class: 'so-err' }, (r && r.errors || ['Tick the box to confirm']).join(' · '))); }
    catch (e) { mount(msg, h('div', { class: 'so-err' }, (e && e.message) || 'Could not save.')); }
    save.disabled = false;
  };
  const close = ctx.openModal(it.label, [h('div', { class: 'so-note' }, it.purpose || ''), h('p', { style: 'font-size:.92rem;line-height:1.6;color:#0f172a;margin:12px 0 0' }, ACK_TEXT[it.key] || ''), box, msg, save]);
}

async function openAgreement(it, ctx, signerData) {
  const kind = it.key === 'platform_terms' ? 'shipper_platform' : 'shipper_carrier';
  let ag; try { ag = await shipperAgreement(kind); } catch (e) { ctx.toast((e && e.message) || 'Could not load the agreement.', true); return; }
  if (!ag || !ag.available) { ctx.openModal(it.label, [h('div', { class: 'so-note' }, (ag && ag.message) || 'This agreement is being finalised.')]); return; }
  if (ag.signed) { ctx.openModal(ag.title + ' (v' + ag.version + ')', [h('div', { class: 'so-ok' }, 'Signed by ' + ag.signer_name + ', ' + ag.signer_title + ' on ' + String(ag.signed_at || '').slice(0, 10) + ' ✓'), h('div', { class: 'so-agree', style: 'margin-top:10px' }, ag.body_md || '')]); return; }
  const f = h('div', { class: 'so-f' });
  const nm = h('input', { value: (signerData && signerData.name) || '' }), tt = h('input', { value: (signerData && signerData.title) || '' });
  f.append(h('label', null, 'Your full name (this is your signature)'), nm, h('label', null, 'Your title'), tt);
  let consent = false;
  const cb = h('button', { type: 'button', class: 'so-chip', style: 'margin-top:12px;text-align:left' }, 'I agree to sign electronically, I have authority to bind my company, and my typed name is my signature.');
  cb.onclick = () => { consent = !consent; cb.className = 'so-chip' + (consent ? ' on' : ''); };
  const msg = h('div');
  const go = h('button', { class: 'so-btn orange', style: 'margin-top:14px;width:100%' }, 'Sign ' + ag.title);
  go.onclick = async () => {
    go.disabled = true; mount(msg, []);
    try { await shipperAgreementSign(kind, ag.version, ag.body_sha256, nm.value.trim(), tt.value.trim(), consent); close(); ctx.toast('Signed ✓ — a copy stays in your account.'); ctx.reload(); return; }
    catch (e) { mount(msg, h('div', { class: 'so-err' }, (e && e.message) || 'Could not sign.')); }
    go.disabled = false;
  };
  const close = ctx.openModal(ag.title + ' (v' + ag.version + ')', [h('div', { class: 'so-agree' }, ag.body_md || ''), f, cb, msg, go], { wide: true });
}

function openEmailVerify(it, ctx) {
  const em = h('input', { type: 'email', placeholder: 'you@yourcompany.com' });
  const code = h('input', { placeholder: '6-digit code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 12 });
  const msg = h('div');
  const send = h('button', { class: 'so-btn ghost', style: 'margin-top:8px' }, 'Send me a code');
  send.onclick = async () => { send.disabled = true; try { const r = await partnerShipperCompanyEmail(em.value.trim()); mount(msg, h('div', { class: r && r.sent === false ? 'so-err' : 'so-ok' }, r && r.sent === false ? (r.why || 'Could not send.') : 'Code sent to ' + ((r && r.to) || 'that address') + '. It works for 24 hours.')); } catch (e) { mount(msg, h('div', { class: 'so-err' }, (e && e.message) || 'Could not send.')); } send.disabled = false; };
  const ok = h('button', { class: 'so-btn', style: 'margin-top:8px' }, 'Confirm code');
  ok.onclick = async () => { ok.disabled = true; try { const r = await partnerVerifyCode(code.value.replace(/\D/g, '')); if (r && r.ok) { close(); ctx.toast('Company email confirmed ✓'); ctx.reload(); return; } mount(msg, h('div', { class: 'so-err' }, (r && r.why) || 'That code did not match.')); } catch (e) { mount(msg, h('div', { class: 'so-err' }, (e && e.message) || 'Could not check the code.')); } ok.disabled = false; };
  const close = ctx.openModal(it.label, [h('div', { class: 'so-note' }, it.purpose + ' If you signed up with a company address and clicked the sign-up link, this is already done.'),
    h('div', { class: 'so-f' }, [h('label', null, 'Company email address'), em, send, h('label', null, 'Code from that inbox'), code, ok]), msg]);
}

function openPhoneVerify(it, ctx, purpose) {
  const code = h('input', { placeholder: '6-digit code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 12 });
  const msg = h('div');
  const kids = [h('div', { class: 'so-note' }, it.purpose)];
  if (purpose === 'signer') {
    const call = h('button', { class: 'so-btn ghost', style: 'margin-top:10px' }, '📞 Call the signer now');
    call.onclick = async () => { call.disabled = true; try { const r = await shipperPhoneCodeSend(); mount(msg, h('div', { class: r && r.ok ? 'so-ok' : 'so-err' }, r && r.ok ? (r.already ? 'Already confirmed ✓' : 'Calling ' + (r.to || 'the signer') + ' now — the code is read out. It works for 15 minutes.') : ((r && r.why) || 'Could not place the call.'))); } catch (e) { mount(msg, h('div', { class: 'so-err' }, (e && e.message) || 'Could not place the call.')); } call.disabled = false; };
    kids.push(call);
  } else {
    kids.push(h('div', { class: 'so-note', style: 'margin-top:8px' }, it.cbStatus === 'calling'
      ? 'We called your company\'s publicly listed number. Whoever answered was given a one-time code — enter it below (valid 24 hours).'
      : 'Our team finds your company\'s public number (state registry, your website or a public listing) and calls it within 1 business day. The person who answers gets a one-time code for you to enter here.'));
  }
  const ok = h('button', { class: 'so-btn', style: 'margin-top:8px' }, 'Confirm code');
  ok.onclick = async () => { ok.disabled = true; try { const r = await shipperCodeVerify(code.value); if (r && r.ok) { close(); ctx.toast('Confirmed ✓'); ctx.reload(); return; } mount(msg, h('div', { class: 'so-err' }, (r && r.why) || 'That code did not match.')); } catch (e) { mount(msg, h('div', { class: 'so-err' }, (e && e.message) || 'Could not check the code.')); } ok.disabled = false; };
  kids.push(h('div', { class: 'so-f' }, [h('label', null, 'Code'), code, ok]), msg);
  const close = ctx.openModal(it.label, kids);
}

function openUpload(it, ctx) {
  let file = null;
  const fi = h('input', { type: 'file', accept: 'application/pdf,image/*', style: 'display:none' });
  const meta = h('div', { class: 'hint' });
  fi.onchange = () => { file = fi.files && fi.files[0]; meta.textContent = file ? '✓ ' + file.name : ''; };
  const pick = h('button', { class: 'so-btn ghost', type: 'button', onClick: () => fi.click() }, '📎 Choose PDF or photo');
  const msg = h('div');
  const go = h('button', { class: 'so-btn', style: 'margin-top:14px;width:100%' }, 'Upload');
  go.onclick = async () => {
    if (!file) { mount(msg, h('div', { class: 'so-err' }, 'Choose the file first.')); return; }
    go.disabled = true; go.textContent = 'Uploading…';
    try { const m = await uploadDocument(file, 'onboarding-' + it.key); await onboardingSubmitItem(it.key, 'file:' + m.path, null); close(); ctx.toast('Uploaded — our team reviews it within 1 business day.'); ctx.reload(); return; }
    catch (e) { mount(msg, h('div', { class: 'so-err' }, (e && e.message) || 'Upload failed.')); }
    go.disabled = false; go.textContent = 'Upload';
  };
  const close = ctx.openModal(it.label, [h('div', { class: 'so-note' }, it.purpose), h('div', { class: 'so-f', style: 'margin-top:10px' }, [pick, fi, meta]), msg, go]);
}

const FAC = [
  { k: 'name', l: 'Location name', hint: 'e.g. Dallas DC, Plant 2.' },
  { k: 'kind', l: 'Used for', type: 'select', o: [['both', 'Pickup and delivery'], ['pickup', 'Pickup'], ['delivery', 'Delivery']] },
  { k: 'street', l: 'Street' }, { k: 'city', l: 'City' }, { k: 'state', l: 'State', type: 'select', o: US_STATES.map(s => [s, s]) }, { k: 'zip', l: 'ZIP' },
  { k: 'dock_hours', l: 'Dock hours', hint: 'e.g. Mon–Fri 06:00–14:00.' },
  { k: 'appointment', l: 'Appointments', type: 'select', o: [['required', 'Appointment required'], ['fcfs', 'First come, first served'], ['either', 'Either']] },
  { k: 'load_type', l: 'Live load or drop trailer', type: 'select', o: [['live', 'Live load / unload'], ['drop', 'Drop trailer'], ['either', 'Either']] },
  { k: 'who_loads', l: 'Who loads the freight', type: 'select', o: [['shipper_load_count', 'We load and count (shipper load & count)'], ['driver_assist', 'Driver assists'], ['driver_load', 'Driver loads']] },
  { k: 'lumper', l: 'Lumper policy', type: 'select', o: [['none', 'No lumper'], ['shipper_pays', 'We pay the lumper'], ['carrier_pays_reimbursed', 'Carrier pays, we reimburse with receipt'], ['receiver_pays', 'Receiver pays']] },
  { k: 'ppe', l: 'PPE required (optional)', opt: true, hint: 'e.g. hi-vis vest, steel toes, hard hat.' },
  { k: 'detention_free_hours', l: 'Detention free time (hours)', type: 'number', hint: 'Two hours is common.' },
  { k: 'detention_rate', l: 'Detention rate after free time ($/hour)', type: 'number' },
  { k: 'site_contact_name', l: 'Site contact name' }, { k: 'site_contact_phone', l: 'Site contact phone', type: 'tel' },
  { k: 'notes', l: 'Notes for the driver (optional)', type: 'textarea', opt: true },
];
async function openFacilities(it, ctx) {
  const list = h('div');
  const close = ctx.openModal('Pickup & delivery locations', [h('div', { class: 'so-note' }, it.purpose), list], { wide: true });
  const edit = (fac) => {
    const getters = {}; const f = h('div', { class: 'so-f' });
    FAC.forEach((d) => { const fe = fieldEl(d, fac ? fac[d.k] : (d.k === 'kind' ? 'both' : null)); getters[d.k] = fe.get; f.append(h('label', null, d.l), fe.el); if (d.hint) f.append(h('div', { class: 'hint' }, d.hint)); });
    const msg = h('div');
    const save = h('button', { class: 'so-btn', style: 'margin-top:14px;width:100%' }, 'Save location');
    const c2 = ctx.openModal(fac ? 'Edit location' : 'Add a location', [f, msg, save], { wide: true });
    save.onclick = async () => {
      save.disabled = true; const o = fac ? { id: fac.id } : {};
      Object.keys(getters).forEach(k => { const v = getters[k](); if (v !== null) o[k] = v; });
      try { const r = await shipperFacilitySave(o); if (r && r.ok) { c2(); ctx.toast('Location saved ✓'); draw(); ctx.reload(); return; } mount(msg, h('div', { class: 'so-err' }, [h('b', null, 'Please fill: '), (r.errors || []).join(', ')])); }
      catch (e) { mount(msg, h('div', { class: 'so-err' }, (e && e.message) || 'Could not save.')); }
      save.disabled = false;
    };
  };
  async function draw() {
    let rows = []; try { rows = await shipperFacilities() || []; } catch (_) {}
    mount(list, [
      ...rows.map((f) => h('div', { class: 'so-item' }, [
        h('div', { style: 'flex:1;min-width:0' }, [h('div', { class: 't' }, f.name), h('div', { class: 'p' }, [f.street, f.city, f.state, f.zip].filter(Boolean).join(', ') + ' · ' + f.dock_hours + ' · detention after ' + f.detention_free_hours + 'h at ' + money(f.detention_rate) + '/h')]),
        h('button', { class: 'so-btn ghost', onClick: () => edit(f) }, 'Edit'),
        h('button', { class: 'so-btn ghost', onClick: async () => { if (!confirm('Remove ' + f.name + '?')) return; try { await shipperFacilityArchive(f.id); draw(); ctx.reload(); } catch (e) { ctx.toast((e && e.message) || 'Could not remove.', true); } } }, 'Remove'),
      ])),
      rows.length ? null : h('div', { class: 'so-note', style: 'margin-top:10px' }, 'No locations yet. Add every dock carriers will pick up from or deliver to.'),
      h('button', { class: 'so-btn', style: 'margin-top:12px', onClick: () => edit(null) }, '+ Add a location'),
    ]);
  }
  draw();
  return close;
}

/* ------------------------------------------------------------------ pages */
function laneTile(title, g, sub) {
  const miss = (g && g.missing) || [];
  const ok = g && g.ok;
  return h('div', { class: 'so-lane' + (ok ? ' ok' : '') }, [
    h('b', null, (ok ? '✓ ' : '') + title),
    h('small', null, ok ? sub : (g && g.hold) ? 'On hold — contact hello@loadboot.com' : (g && g.flag_on === false) ? 'Paused by LoadBoot for now.' : miss.length + ' item' + (miss.length === 1 ? '' : 's') + ' left: ' + miss.slice(0, 3).map(m => m.label).join(', ') + (miss.length > 3 ? '…' : '')),
  ]);
}

export function shipperVerificationPage(opts = {}) {
  ensureCss();
  const host = h('div', null, h('div', { class: 'so-note' }, 'Loading your verification…'));
  const openSec = new Set();
  const ctx = {
    openModal: opts.openModal,
    toast: (m, bad) => { try { opts.toast ? opts.toast(m, bad) : alert(m); } catch (_) {} },
    reload: () => { load(); if (opts.onChange) opts.onChange(); },
  };
  async function load() {
    let d; try { d = await shipperOnboarding(); } catch (e) { mount(host, h('div', { class: 'so-err' }, (e && e.message) || 'Could not load.')); return; }
    const items = (d.items || []).filter(it => it.active);
    const signer = (items.find(i => i.key === 'authorized_signer') || {}).data;
    const total = items.length, done = items.filter(i => isDone(i.status)).length;
    const hero = h('div', { class: 'so-hero' }, [
      h('h2', null, 'Company verification'),
      h('p', null, 'Carriers and brokers trust a shipper who is who they say they are. Until your verification opens a lane you can explore, check rates and save drafts — nothing reaches carriers or brokers.'),
      h('div', { class: 'so-bar' }, h('i', { style: 'width:' + Math.round(100 * done / Math.max(total, 1)) + '%' })),
      h('div', { style: 'font-size:.78rem;color:#b6c4dc;margin-top:4px' }, done + ' of ' + total + ' done'),
      h('div', { class: 'so-lanes' }, [
        laneTile('Carriers — post direct', d.direct, 'Open. You post, carriers request, you choose the carrier.'),
        laneTile('Brokers — send a tender', d.broker, 'Open. Send tenders to verified brokers from the Brokers tab.'),
      ]),
    ]);
    const lim = d.limits || {};
    const limits = (d.direct && d.direct.ok && !lim.graduated) ? h('div', { class: 'so-note', style: 'margin-bottom:12px;border:1px solid #dbe7fb;background:#f5f9ff' },
      '🆕 New-shipper limits: up to ' + lim.max_open_loads + ' open loads and ' + money(lim.max_cargo_value) + ' cargo value per load, until ' + lim.graduate_paid_loads + ' loads are confirmed paid by carriers (' + (lim.paid_loads || 0) + ' so far). This protects carriers while your payment record builds.') : null;
    const secs = SECTIONS.map(([key, letter, title, blurb]) => {
      const its = items.filter(i => i.section === key);
      if (!its.length) return null;
      const n = its.filter(i => isDone(i.status)).length;
      const isOpen = openSec.has(key) || (!openSec.size && n < its.length && !secs_opened.v && (secs_opened.v = key));
      const body = h('div', { class: 'so-body' }, its.map((it) => {
        let btn = null;
        const label = isDone(it.status) ? 'View / edit' : it.status === 'rejected' ? 'Fix' : it.status === 'submitted' ? 'Edit' : 'Start';
        if (FORMS[it.key]) btn = h('button', { class: 'so-btn' + (isDone(it.status) ? ' ghost' : ''), onClick: () => openForm(it, ctx) }, label);
        else if (it.type === 'ack') btn = h('button', { class: 'so-btn' + (isDone(it.status) ? ' ghost' : ''), onClick: () => openAck(it, ctx) }, isDone(it.status) ? 'View' : 'Confirm');
        else if (it.type === 'accept') btn = h('button', { class: 'so-btn' + (isDone(it.status) ? ' ghost' : ' orange'), onClick: () => openAgreement(it, ctx, signer) }, isDone(it.status) ? 'View signed copy' : it.status === 'unavailable' ? 'Details' : 'Read & sign');
        else if (it.key === 'email_verify' && !isDone(it.status)) btn = h('button', { class: 'so-btn', onClick: () => openEmailVerify(it, ctx) }, 'Confirm email');
        else if (it.key === 'phone_verify' && !isDone(it.status)) btn = h('button', { class: 'so-btn', onClick: () => openPhoneVerify(it, ctx, 'signer') }, 'Call me');
        else if (it.key === 'independent_callback' && !isDone(it.status)) btn = h('button', { class: 'so-btn ghost', onClick: () => openPhoneVerify(Object.assign({}, it, { cbStatus: d.callback && d.callback.status }), ctx, 'callback') }, d.callback && d.callback.status === 'calling' ? 'Enter code' : 'How it works');
        else if (it.key === 'facility_rules') btn = h('button', { class: 'so-btn' + (isDone(it.status) ? ' ghost' : ''), onClick: () => openFacilities(it, ctx) }, isDone(it.status) ? 'Manage' : 'Add locations');
        else if (it.type === 'upload') btn = h('button', { class: 'so-btn' + (isDone(it.status) ? ' ghost' : ''), onClick: () => openUpload(it, ctx) }, it.file ? 'Replace' : 'Upload');
        const lanes = (it.required_for || []);
        const laneTxt = lanes.length === 2 ? '' : lanes[0] === 'direct' ? ' · for posting to carriers' : lanes[0] === 'broker' ? ' · for broker tenders' : '';
        return h('div', { class: 'so-item' }, [
          h('div', { style: 'flex:1;min-width:0' }, [h('div', { class: 't' }, it.label + laneTxt), h('div', { class: 'p' }, it.purpose || ''), it.note ? h('div', { class: 'n' }, '✕ ' + it.note) : null]),
          pill(it.status), btn,
        ]);
      }));
      const sec = h('div', { class: 'so-sec' }, [
        h('div', { class: 'so-sech', onClick: () => { if (openSec.has(key)) openSec.delete(key); else openSec.add(key); body.hidden = !openSec.has(key); } }, [
          h('span', { class: 'so-letter' }, letter),
          h('div', { style: 'flex:1;min-width:0' }, [h('h3', null, title), h('div', { class: 'p', style: 'font-size:.78rem;color:#64748b;margin-top:2px' }, blurb)]),
          h('span', { class: 'so-count' + (n === its.length ? ' done' : '') }, n + '/' + its.length),
        ]), body]);
      body.hidden = !isOpen;
      if (isOpen) openSec.add(key);
      return sec;
    });
    mount(host, [hero, limits, ...secs]);
  }
  const secs_opened = { v: null };
  load();
  return host;
}

export function shipperLaneCard(opts = {}) {
  ensureCss();
  const host = h('div', { class: 'cp-card', style: 'border-left:4px solid #0883F7' }, h('div', { class: 'so-note' }, 'Loading…'));
  (async () => {
    let d; try { d = await shipperOnboarding(); } catch (_) { host.remove(); return; }
    const dOk = d.direct && d.direct.ok, bOk = d.broker && d.broker.ok;
    const left = ((d.direct && d.direct.missing) || []).length;
    mount(host, [
      h('div', { class: 'cp-cardhead' }, [h('h3', null, dOk || bOk ? 'Where do you want to send freight?' : 'Verify your company to start shipping')]),
      h('div', { class: 'so-grid', style: 'margin-top:8px' }, [
        h('div', { class: 'so-bcard' }, [h('b', null, '🚚 Post to verified carriers'), h('div', { style: 'font-size:.82rem;color:#64748b;margin-top:6px;line-height:1.5' }, 'You set the rate, carriers request, you choose the carrier. Payment goes from you straight to the carrier.'),
          h('div', { style: 'margin-top:10px' }, dOk ? h('button', { class: 'so-btn', onClick: () => opts.onPost && opts.onPost() }, 'Post a load →') : h('button', { class: 'so-btn ghost', onClick: () => opts.goVerify && opts.goVerify() }, left + ' verification item' + (left === 1 ? '' : 's') + ' left →'))]),
        h('div', { class: 'so-bcard' }, [h('b', null, '🏢 Tender to a verified broker'), h('div', { style: 'font-size:.82rem;color:#64748b;margin-top:6px;line-height:1.5' }, 'A licensed, bonded broker takes the load and finds the truck — under the broker\'s own contract with you.'),
          h('div', { style: 'margin-top:10px' }, h('button', { class: 'so-btn ghost', onClick: () => opts.goBrokers && opts.goBrokers() }, 'See brokers →'))]),
      ]),
      h('div', { class: 'so-note', style: 'margin-top:10px' }, 'LoadBoot is the software and the marketplace. It is never your broker or carrier, never sets your rate, never picks the carrier and never holds freight money.'),
    ]);
  })();
  return host;
}

function openTender(b, ctx) {
  const F = [
    { k: 'origin', l: 'Pickup city, state' }, { k: 'destination', l: 'Delivery city, state' },
    { k: 'ready_date', l: 'Ready date', type: 'date' },
    { k: 'equipment', l: 'Equipment', type: 'select', o: EQUIPMENT },
    { k: 'commodity', l: 'Commodity' }, { k: 'weight', l: 'Weight (lb)', type: 'number' }, { k: 'pieces', l: 'Pieces / pallets', type: 'number' },
    { k: 'cargo_value', l: 'Cargo value ($)', type: 'number' }, { k: 'ref_po', l: 'Load / PO reference' },
    { k: 'pickup_contact', l: 'Pickup contact (name + phone)' }, { k: 'delivery_contact', l: 'Delivery contact (name + phone)' },
    { k: 'facility_notes', l: 'Facility notes', type: 'textarea' }, { k: 'dock_hours', l: 'Dock hours' },
    { k: 'temperature', l: 'Temperature (reefer only)', opt: true }, { k: 'hazmat', l: 'Hazmat', type: 'bool' },
    { k: 'hazmat_info', l: 'Hazmat info (class, UN/NA, shipping name)', opt: true }, { k: 'notes', l: 'Notes for the broker (optional)', type: 'textarea', opt: true },
  ];
  const getters = {}; const f = h('div', { class: 'so-f' });
  F.forEach((d) => {
    let fe;
    if (d.type === 'date') { const i = h('input', { type: 'date' }); fe = { el: i, get: () => i.value || null }; }
    else fe = fieldEl(d, null);
    getters[d.k] = fe.get; f.append(h('label', null, d.l), fe.el);
  });
  const msg = h('div');
  const go = h('button', { class: 'so-btn orange', style: 'margin-top:14px;width:100%' }, 'Send tender to ' + b.name);
  go.onclick = async () => {
    go.disabled = true; const o = { broker_org: b.id };
    Object.keys(getters).forEach(k => { const v = getters[k](); if (v !== null) o[k] = v; });
    try { await shipperPostLoad(o); close(); ctx.toast('Tender sent to ' + b.name + ' ✓'); return; }
    catch (e) { mount(msg, h('div', { class: 'so-err' }, (e && e.message) || 'Could not send the tender.')); }
    go.disabled = false;
  };
  const close = ctx.openModal('Tender to ' + b.name, [h('div', { class: 'so-note' }, 'The broker reviews your tender and accepts, declines or quotes it. Once accepted, the broker books the truck under its own contract with you.'), f, msg, go], { wide: true });
}

export function shipperBrokersPage(opts = {}) {
  ensureCss();
  const host = h('div', null, h('div', { class: 'so-note' }, 'Loading brokers…'));
  const ctx = { openModal: opts.openModal, toast: (m, bad) => { try { opts.toast ? opts.toast(m, bad) : alert(m); } catch (_) {} } };
  (async () => {
    let d; try { d = await shipperBrokers(); } catch (e) { mount(host, h('div', { class: 'so-err' }, (e && e.message) || 'Could not load brokers.')); return; }
    const head = h('div', { class: 'so-hero' }, [h('h2', null, 'Verified freight brokers'),
      h('p', null, 'Every broker here holds active FMCSA broker authority and a $75,000 BMC-84/85 bond, checked before you see them. You choose the broker and send a tender; the broker books the truck under its own contract with you.')]);
    if (!d.available) {
      mount(host, [head, h('div', { class: 'so-empty' }, [
        h('div', { style: 'font-size:2rem' }, '🤝'),
        h('h3', null, 'Verified brokers are joining LoadBoot'),
        h('p', null, d.message || 'We are onboarding licensed, bonded freight brokers right now. Please check back in 2–3 days.'),
        h('div', { style: 'margin-top:14px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap' }, [
          h('button', { class: 'so-btn', onClick: () => opts.onPost && opts.onPost() }, 'Post to verified carriers today'),
          h('button', { class: 'so-btn ghost', onClick: async () => { const url = 'https://loadboot.com/create-broker-account.html'; try { await navigator.clipboard.writeText(url); ctx.toast('Link copied — send it to your broker ✓'); } catch (_) { prompt('Copy this link for your broker:', url); } } }, 'Invite the broker you already use'),
        ]),
      ])]);
      return;
    }
    mount(host, [head, !d.lane_open ? h('div', { class: 'so-q', style: 'margin-bottom:12px' }, 'Finish company verification to send tenders — brokers only receive freight from verified shippers.') : null,
      h('div', { class: 'so-grid' }, d.brokers.map((b) => h('div', { class: 'so-bcard' }, [
        h('div', { style: 'display:flex;gap:10px;align-items:center' }, [h('div', { class: 'so-letter', style: 'width:38px;height:38px' }, (b.name || '?').slice(0, 1)), h('div', null, [h('b', null, b.name), h('div', { class: 'p', style: 'font-size:.78rem;color:#64748b' }, 'MC ' + (b.mc || '—') + (b.dot ? ' · USDOT ' + b.dot : ''))])]),
        h('div', { style: 'margin-top:10px;display:flex;gap:6px;flex-wrap:wrap' }, [h('span', { class: 'so-pill ok' }, 'Broker authority ✓'), h('span', { class: 'so-pill ok' }, '$75k bond ✓'), h('span', { class: 'so-pill todo' }, (b.loads_delivered || 0) + ' delivered on LoadBoot')]),
        h('button', { class: 'so-btn', style: 'margin-top:12px;width:100%', disabled: d.lane_open ? null : 'disabled', onClick: () => openTender(b, ctx) }, 'Send a tender →'),
      ])))]);
  })();
  return host;
}
