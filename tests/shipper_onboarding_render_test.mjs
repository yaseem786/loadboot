// bl_ship_0491 — render test for app/partner/shipper-onboarding.js (no browser: tiny fake DOM + vm modules).
// Run: node --experimental-vm-modules --test tests/shipper_onboarding_render_test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../app/partner/shipper-onboarding.js', import.meta.url), 'utf8');

class Element {
  constructor(text = '') { this.text = text; this.children = []; this.attrs = {}; this.className = ''; this.hidden = false; }
  appendChild(e) { this.children.push(e); return e; }
  append(...es) { es.forEach((e) => e != null && this.children.push(typeof e === 'string' ? new Element(e) : e)); }
  remove() { this.removed = true; }
  setAttribute(k, v) { this.attrs[k] = v; }
  set innerHTML(s) { this.text = s; this.children = []; }
  set textContent(s) { this.text = s; this.children = []; }
  get textContent() { return this.text + this.children.map((c) => c.textContent).join(''); }
}
const flush = () => new Promise((r) => setTimeout(r, 0));

const ITEMS = [
  { key: 'legal_entity', label: 'Legal business entity', section: 'identity', purpose: 'Carriers and brokers see exactly which company owes them.', type: 'form', required_for: ['direct', 'broker'], active: true, status: 'submitted' },
  { key: 'email_verify', label: 'Company email confirmed', section: 'identity', purpose: 'Proves you control the company inbox.', type: 'system', required_for: ['direct', 'broker'], active: true, status: 'verified' },
  { key: 'independent_callback', label: 'Independent call-back', section: 'identity', purpose: 'We call a number WE find.', type: 'staff', required_for: ['direct', 'broker'], active: true, status: 'pending' },
  { key: 'ein_letter', label: 'IRS EIN letter', section: 'identity', purpose: 'Only when no website.', type: 'upload', required_for: ['direct', 'broker'], active: false, status: 'pending' },
  { key: 'credit_application', label: 'Credit references', section: 'billing', purpose: 'Brokers run a credit check.', type: 'form', required_for: ['broker'], active: true, status: 'pending' },
  { key: 'platform_terms', label: 'LoadBoot Platform Terms', section: 'agreements', purpose: 'LoadBoot is software, not a broker.', type: 'accept', required_for: ['direct', 'broker'], active: true, status: 'unavailable' },
  { key: 'hazmat', label: 'Hazmat shipper details', section: 'special', purpose: '49 CFR 172.', type: 'form', required_for: ['direct', 'broker'], active: false, status: 'pending' },
  { key: 'ack_direct_choice', label: 'You choose the carrier', section: 'acks', purpose: 'You — not LoadBoot — choose the carrier.', type: 'ack', required_for: ['direct'], active: true, status: 'rejected', note: 'please re-confirm' },
];

async function load(apiOverrides) {
  const context = vm.createContext({
    document: { createElement: () => new Element(), createTextNode: (t) => new Element(t), head: new Element() },
    setTimeout, alert: () => {}, confirm: () => true, prompt: () => null, navigator: {},
  });
  const mod = new vm.SourceTextModule(source, { context });
  await mod.link(async (spec) => {
    const exports = spec.endsWith('api.js') ? Object.assign({
      shipperOnboarding: async () => ({ stage: 'new', items: ITEMS, callback: { status: null },
        direct: { ok: false, flag_on: true, missing: [{ label: 'Legal business entity' }, { label: 'Independent call-back' }] },
        broker: { ok: false, flag_on: true, missing: [{ label: 'Credit references' }] },
        limits: { graduated: false, max_open_loads: 3, max_cargo_value: 100000, graduate_paid_loads: 3, paid_loads: 0 } }),
      shipperItemSave: () => assert.fail('must not save on render'), shipperAgreement: () => assert.fail('no agreement on render'),
      shipperAgreementSign: () => assert.fail(), shipperFacilities: async () => [], shipperFacilitySave: () => assert.fail(),
      shipperFacilityArchive: () => assert.fail(), shipperPhoneCodeSend: () => assert.fail('must not call on render'), shipperCodeVerify: () => assert.fail(),
      shipperBrokers: async () => ({ available: false, lane_open: false, brokers: [], message: 'We are onboarding licensed, bonded freight brokers on LoadBoot right now. Please check back in 2–3 days.' }),
      shipperPostLoad: () => assert.fail(), partnerShipperCompanyEmail: () => assert.fail(), partnerVerifyCode: () => assert.fail(), onboardingSubmitItem: () => assert.fail(),
    }, apiOverrides || {}) : { uploadDocument: () => assert.fail('no upload on render') };
    return new vm.SyntheticModule(Object.keys(exports), function () { for (const [k, v] of Object.entries(exports)) this.setExport(k, v); }, { context });
  });
  await mod.evaluate();
  return mod.namespace;
}

test('verification page: sections, purposes, lane progress; inactive conditional items hidden', async () => {
  const ns = await load();
  const host = ns.shipperVerificationPage({ openModal: () => () => {} });
  await flush(); await flush();
  const t = host.textContent;
  assert.match(t, /Company verification/);
  assert.match(t, /nothing reaches carriers or brokers/);
  assert.match(t, /Carriers — post direct/); assert.match(t, /2 items left: Legal business entity, Independent call-back/);
  assert.match(t, /Brokers — send a tender/); assert.match(t, /1 item left: Credit references/);
  assert.match(t, /Company identity/); assert.match(t, /Carriers and brokers see exactly which company owes them/);
  assert.match(t, /In review/); assert.match(t, /Done ✓/); assert.match(t, /Coming soon/);
  assert.match(t, /Fix needed/); assert.match(t, /please re-confirm/);
  assert.match(t, /Credit references · for broker tenders/);
  assert.ok(!t.includes('IRS EIN letter'), 'manual-identity item is hidden when not triggered');
  assert.ok(!t.includes('Hazmat shipper details'), 'hazmat is hidden when the cargo is not hazmat');
  assert.ok(!t.includes('New-shipper limits'), 'limits only show once the carrier lane is open');
});

test('limits banner appears when the carrier lane is open and the shipper has not graduated', async () => {
  const ns = await load({ shipperOnboarding: async () => ({ stage: 'direct_ready', items: [], callback: {}, direct: { ok: true, missing: [] }, broker: { ok: false, missing: [{ label: 'Credit references' }] },
    limits: { graduated: false, max_open_loads: 3, max_cargo_value: 100000, graduate_paid_loads: 3, paid_loads: 1 } }) });
  const host = ns.shipperVerificationPage({ openModal: () => () => {} });
  await flush(); await flush();
  assert.match(host.textContent, /New-shipper limits: up to 3 open loads and \$100,000 cargo value per load, until 3 loads are confirmed paid by carriers \(1 so far\)/);
  assert.match(host.textContent, /✓ Carriers — post direct/);
});

test('brokers tab with no verified broker shows the polite coming-soon card', async () => {
  const ns = await load();
  const host = ns.shipperBrokersPage({ openModal: () => () => {} });
  await flush(); await flush();
  assert.match(host.textContent, /Verified brokers are joining LoadBoot/);
  assert.match(host.textContent, /check back in 2–3 days/);
  assert.match(host.textContent, /Post to verified carriers today/);
  assert.match(host.textContent, /\$75,000 BMC-84\/85 bond/);
});

test('dashboard lane card says LoadBoot is never the broker or carrier', async () => {
  const ns = await load();
  const host = ns.shipperLaneCard({});
  await flush(); await flush();
  assert.match(host.textContent, /Verify your company to start shipping/);
  assert.match(host.textContent, /2 verification items left/);
  assert.match(host.textContent, /never your broker or carrier, never sets your rate, never picks the carrier and never holds freight money/);
});
