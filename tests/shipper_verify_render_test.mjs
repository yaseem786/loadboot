// bl_ship_0504 — Shipper 360 → Two-lane verification card render.
//   * host.replaceChildren() never receives null (a real DOM prints it as the text "null");
//   * an old-packet form item (data null, answers in `ref`) shows the ref text + label and has no Verify button.
// Run: node --experimental-vm-modules --test tests/shipper_verify_render_test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { isOldPacket } from '../app/command-center/views/shipperPlaybook360.js';

class Element {
  constructor(text = '') { this.text = text; this.children = []; this.attrs = {}; this.className = ''; this.value = ''; this.listeners = {}; }
  appendChild(e) { this.children.push(e); return e; }
  // like the real DOM: a non-Node argument becomes a text node of String(arg) — so null prints "null"
  replaceChildren(...nodes) { this.children = nodes.map((n) => (n instanceof Element ? n : new Element(String(n)))); }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(k, f) { this.listeners[k] = f; }
  get textContent() { return this.text + this.children.map((c) => c.textContent).join(''); }
  findAll(pred, out = []) { if (pred(this)) out.push(this); this.children.forEach((c) => c.findAll && c.findAll(pred, out)); return out; }
}

async function render(v) {
  const context = vm.createContext({ document: { createElement: () => new Element(), createTextNode: (t) => new Element(t) }, window: {}, Node: Element, Date });
  const files = { card: new URL('../app/command-center/views/shipperVerify360.js', import.meta.url), dom: new URL('../app/shared/ui/dom.js', import.meta.url) };
  const stub = (exports) => new vm.SyntheticModule(Object.keys(exports), function () { for (const [k, x] of Object.entries(exports)) this.setExport(k, x); }, { context });
  const root = new vm.SourceTextModule(await readFile(files.card, 'utf8'), { context, identifier: files.card.href });
  let host;
  await root.link(async (spec) => {
    if (spec.endsWith('dom.js')) { const m = new vm.SourceTextModule(await readFile(files.dom, 'utf8'), { context, identifier: files.dom.href }); await m.link(() => {}); return m; }
    if (spec.endsWith('components.js')) return stub({ card: (kids) => { host = new Element(); host.replaceChildren(...kids); return host; }, openDrawer: () => ({ close() {} }) });
    if (spec.endsWith('api.js')) return stub({ shipperVerification: async () => v, shipperCallbackStart: () => assert.fail(), shipperCallbackFail: () => assert.fail(), shipperLimitsLift: () => assert.fail(), onboardingReviewItem: () => assert.fail('no review on render'), shipperAgreementCopy: () => assert.fail('no copy on render') });
    if (spec.endsWith('errors.js')) return stub({ humanizeError: (e) => String(e), toast: () => {} });
    if (spec.endsWith('partner360-kit.js')) return stub({ pill: (tone, text) => { const e = new Element(text); e.className = 'pill-' + tone; return e; } });
    if (spec.endsWith('shipperRegistry360.js')) return stub({ registryBlock: () => null, openDocVerify: () => {}, emailDomainBlock: () => null, openPlacesLookup: () => {} });
    if (spec.endsWith('shipperPlaybook360.js')) return stub({ playbookCard: () => null, isOldPacket });
    if (spec.endsWith('agreementCopy.js')) return stub({ openAgreementCopy: () => assert.fail('no copy on render') });  // bl_ship_0508
    throw new Error('unexpected import ' + spec);
  });
  await root.evaluate();
  root.namespace.shipperVerifyCard({ orgId: 'o1', manage: true });
  await new Promise((r) => setTimeout(r, 0));
  return host;
}

const V = () => ({
  stage: 'new', trust: { domain: 'miibrandimport.com' }, callback: {}, direct: { ok: false, missing: [] }, broker: { ok: false, missing: [] }, graduated: false, signatures: [],
  items: [
    { key: 'legal_entity', label: 'Legal business entity', section: 'identity', type: 'form', active: true, status: 'submitted', data: null, ref: 'Legal name: MII Brand Import LLC · EIN 12-3456789' },
    { key: 'physical_address', label: 'Physical address', section: 'identity', type: 'form', active: true, status: 'submitted', data: { street: '1 Main St', city: 'Columbus' } },
  ],
});

test('no "null" text anywhere when reasons / sigs / registry blocks are null', async () => {
  const host = await render(V());
  const nulls = host.findAll((e) => e.text === 'null' && !e.children.length);
  assert.equal(nulls.length, 0, nulls.length + ' bare "null" text node(s) rendered');
});

test('old packet: ref shown with the label, no Verify button; a new-form item keeps Verify', async () => {
  const host = await render(V());
  assert.match(host.textContent, /Old packet — answers not in the new form/);
  assert.match(host.textContent, /Legal name: MII Brand Import LLC · EIN 12-3456789/);
  const verify = host.findAll((e) => e.text === 'Verify');
  assert.equal(verify.length, 1, 'only the physical_address item has Verify');
  assert.equal(host.findAll((e) => e.text === 'Reject').length, 2, 'Reject stays on both');
});
