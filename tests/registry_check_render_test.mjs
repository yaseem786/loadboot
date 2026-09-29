// bl_ship_0502 — registry check: open-data adapters (offline fixtures) + the CC registry card render (tiny fake DOM + vm modules).
// Run: node --experimental-vm-modules --test tests/registry_check_render_test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { fetchRegistry, mapStatus, canPrefill } from '../app/command-center/views/registry-prefill.js';

const fakeFetch = (byDataset) => async (url) => {
  const ds = url.split('/resource/')[1].split('.json')[0];
  return { ok: true, json: async () => (byDataset[ds] || []) };
};

test('status words map to the server vocabulary', () => {
  assert.equal(mapStatus('Good Standing'), 'active');
  assert.equal(mapStatus('Delinquent'), 'suspended');
  assert.equal(mapStatus('Voluntarily Dissolved'), 'dissolved');
  assert.equal(mapStatus('Revoked'), 'revoked');
  assert.equal(mapStatus('Something odd'), '');
});

test('Colorado: status, principal address, agent, deep link; delinquent suffix stripped from the name', async () => {
  const src = { state: 'CO', od_domain: 'data.colorado.gov', od_dataset: '4ykn-tg5h', search_url: 'https://s', deep_link: 'https://co/rec?id={number}' };
  const r = await fetchRegistry(src, '19871342214', fakeFetch({ '4ykn-tg5h': [{ entityid: '19871342214', entityname: 'SOUTHWEST CONTRACTING, LLC, Delinquent May 1, 2016',
    entitystatus: 'Delinquent', entityformdate: '1978-02-28T00:00:00.000', principaladdress1: '22989 COUNTY RD F', principalcity: 'CORTEZ', principalstate: 'CO', principalzipcode: '81321',
    agentfirstname: 'Steven', agentmiddlename: 'G', agentlastname: 'Franchini' }] }));
  assert.equal(r.legal_name, 'SOUTHWEST CONTRACTING, LLC');
  assert.equal(r.status, 'suspended');
  assert.equal(r.formation_date, '1978-02-28');
  assert.equal(r.principal_address, '22989 COUNTY RD F, CORTEZ, CO, 81321');
  assert.deepEqual(r.people, ['Steven G Franchini (registered agent)']);
  assert.equal(r.registry_url, 'https://co/rec?id=19871342214');
  assert.equal(r.source, 'open_data');
});

test('Connecticut joins the Principals dataset; Pennsylvania pads the filing number and lists officers once', async () => {
  const ct = await fetchRegistry({ state: 'CT', od_domain: 'data.ct.gov', od_dataset: 'n7gp-d28j', search_url: 'https://s' }, '123',
    fakeFetch({ 'n7gp-d28j': [{ id: 'X1', name: 'ACME LLC', status: 'Active', accountnumber: '123', date_registration: '0001-01-01T00:00:00.000', billingstreet: '1 Elm St', billingcity: 'Hartford', billingstate: 'CT', billingpostalcode: '06103' }],
                'ka36-64k6': [{ business_id: 'X1', firstname: 'Ann', lastname: 'Lee', designation: 'Member' }] }));
  assert.equal(ct.status, 'active'); assert.equal(ct.formation_date, ''); assert.deepEqual(ct.people, ['Ann Lee (member)']);
  let asked = '';
  const pa = await fetchRegistry({ state: 'PA', od_domain: 'data.pa.gov', od_dataset: 'xvd7-5r2c', search_url: 'https://s' }, '6436709', async (url) => {
    asked = url; return { ok: true, json: async () => [
      { business_name: 'Macro, Inc.', filing_number: '0006436709', address_line1: '600 North Second Street', city: 'Harrisburg', state: 'PA', zip: '17101', creationdate: '2016-08-01T00:00:00.000', party_type: 'President', first_name: 'RICHARD', last_name: 'MCELLIGOTT' },
      { business_name: 'Macro, Inc.', filing_number: '0006436709', party_type: 'Governor' },
      { business_name: 'Macro, Inc.', filing_number: '0006436709', party_type: 'President', first_name: 'RICHARD', last_name: 'MCELLIGOTT' }] };
  });
  assert.match(asked, /filing_number=0006436709/);
  assert.deepEqual(pa.people, ['RICHARD MCELLIGOTT (president)']);
  assert.equal(pa.status, 'active');
});

test('not found → null; no open data or no number → a clear error', async () => {
  const src = { state: 'OR', od_domain: 'data.oregon.gov', od_dataset: 'tckn-sxa6', search_url: 'https://s' };
  assert.equal(await fetchRegistry(src, '1', fakeFetch({})), null);
  await assert.rejects(fetchRegistry({ state: 'DE', search_url: 'https://s' }, '1', fakeFetch({})), /No open data/);
  await assert.rejects(fetchRegistry(src, '', fakeFetch({})), /no entity number/);
  assert.equal(canPrefill({ state: 'DE' }), false); assert.equal(canPrefill(src), true);
});

// ───────────── the CC card ─────────────
class Element {
  constructor(text = '') { this.text = text; this.children = []; this.attrs = {}; this.className = ''; this.value = ''; this.listeners = {}; }
  appendChild(e) { this.children.push(e); return e; }
  setAttribute(k, v) { this.attrs[k] = v; if (k === 'value') this.value = v; }
  addEventListener(k, f) { this.listeners[k] = f; }
  get textContent() { return this.text + this.children.map((c) => c.textContent).join(''); }
  find(pred) { if (pred(this)) return this; for (const c of this.children) { const f = c.find && c.find(pred); if (f) return f; } return null; }
}
async function loadCard() {
  const context = vm.createContext({ document: { createElement: () => new Element(), createTextNode: (t) => new Element(t) }, window: {}, URLSearchParams, encodeURIComponent, Node: Element });
  const files = {
    card: new URL('../app/command-center/views/shipperRegistry360.js', import.meta.url),
    dom: new URL('../app/shared/ui/dom.js', import.meta.url),
    prefill: new URL('../app/command-center/views/registry-prefill.js', import.meta.url),
  };
  const cache = {};
  const mk = async (url) => { const m = new vm.SourceTextModule(await readFile(url, 'utf8'), { context, identifier: url.href }); cache[url.href] = m; return m; };
  const stub = (exports) => new vm.SyntheticModule(Object.keys(exports), function () { for (const [k, v] of Object.entries(exports)) this.setExport(k, v); }, { context });
  const root = await mk(files.card);
  await root.link(async (spec) => {
    if (spec.endsWith('dom.js')) return cache[files.dom.href] || mk(files.dom).then(async (m) => { await m.link(() => {}); return m; });
    if (spec.endsWith('registry-prefill.js')) return cache[files.prefill.href] || mk(files.prefill).then(async (m) => { await m.link(() => {}); return m; });
    if (spec.endsWith('api.js')) return stub({ shipperRegistryCheck: () => assert.fail('no save on render'), shipperDocVerify: () => assert.fail(), shipperEmailDomainApprove: () => assert.fail(), shipperPlacesLookup: () => assert.fail(), onboardingReviewItem: () => assert.fail() });
    if (spec.endsWith('storage.js')) return stub({ uploadDocument: () => assert.fail(), signedDocumentUrl: () => assert.fail() });
    if (spec.endsWith('components.js')) return stub({ openDrawer: () => ({ close() {} }) });
    if (spec.endsWith('errors.js')) return stub({ humanizeError: (e) => String(e), toast: () => {} });
    if (spec.endsWith('partner360-kit.js')) return stub({ pill: (tone, text) => { const e = new Element(text); e.className = 'pill-' + tone; return e; } });
    throw new Error('unexpected import ' + spec);
  });
  await root.evaluate();
  return root.namespace;
}
const V = (over) => Object.assign({
  items: [{ key: 'legal_entity', data: { legal_name: 'BL Test Foods LLC', state_of_formation: 'CO', entity_number: '20261234567' } },
          { key: 'physical_address', data: { street: '123 Main St', city: 'Denver', state: 'CO', zip: '80202' } },
          { key: 'authorized_signer', data: { name: 'Jane Roe' } }],
  trust: { name_collision: false },
  registry: { status: 'pending', record: null, checks: { blockers: ['Registry status is missing'], warnings: [] },
    source: { state: 'CO', name: 'Colorado Secretary of State — Business', search_url: 'https://co/search', deep_link: 'https://co/rec?id={number}', od_domain: 'data.colorado.gov', od_dataset: '4ykn-tg5h' } },
  email_domain: { sec_rule: false },
}, over || {});

test('registry card: shipper answers, registry links, open-data button; no blockers before a record exists', async () => {
  const ns = await loadCard();
  const host = ns.registryBlock({ orgId: 'o', manage: true }, V(), () => {});
  const t = host.textContent;
  assert.match(t, /State registry check/);
  assert.match(t, /Shipper says: BL Test Foods LLC · CO · #20261234567 · 123 Main St, Denver, CO, 80202 · signer Jane Roe/);
  assert.match(t, /Colorado Secretary of State — Business ↗/);
  assert.match(t, /open record #20261234567 ↗/);
  assert.match(t, /⤓ Fill from data.colorado.gov/);
  assert.ok(!t.includes('Registry status is missing'), 'blockers only show once staff entered a record');
  assert.ok(host.find((e) => e.attrs && e.attrs.href === 'https://co/rec?id=20261234567'), 'deep link carries the entity number');
});

test('registry card: checks, blockers, warnings and the young-company pill; unknown state links NASS', async () => {
  const ns = await loadCard();
  const v = V({ registry: { status: 'submitted', record: { legal_name: 'BL TEST FOODS LLC', state: 'CO', entity_number: '20261234567', status: 'active', formation_date: '2026-09-01', people: ['Bob Agent (registered agent)'] },
    checks: { state_ok: true, number_ok: true, name_ok: true, address_ok: false, signer_ok: false, active: true, young: true, age_days: 28,
      blockers: ['The signer is not among the registry\'s managers/officers'], warnings: ['Formed 28 days ago'] }, source: null } });
  const t = ns.registryBlock({ orgId: 'o', manage: true }, v, () => {}).textContent;
  assert.match(t, /formed 28 days ago/);
  assert.match(t, /✓ Entity number/); assert.match(t, /✗ Business address/); assert.match(t, /✗ Signer is a manager \/ officer/);
  assert.match(t, /✗ The signer is not among/); assert.match(t, /⚠ Formed 28 days ago/);
  assert.match(t, /NASS directory/);
  assert.ok(!t.includes('Fill from'), 'no open-data button without a source');
});

test('SEC-name email block only shows under the rule, and offers approval of the confirmed domain', async () => {
  const ns = await loadCard();
  assert.equal(ns.emailDomainBlock({ orgId: 'o', manage: true }, V(), () => {}), null);
  const t = ns.emailDomainBlock({ orgId: 'o', manage: true }, V({ email_domain: { sec_rule: true, confirmed: 'miibrandimport.com', approved: null } }), () => {}).textContent;
  assert.match(t, /miibrandimport.com not approved/);
  assert.match(t, /Approve miibrandimport.com/);
});
