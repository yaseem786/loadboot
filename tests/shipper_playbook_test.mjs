// bl_ship_0503 — specialist playbook logic (pure functions; no DOM needed).
// Run: node --test tests/shipper_playbook_test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { playbookSteps, riskFlags, followUpText } from '../app/command-center/views/shipperPlaybook360.js';

const item = (key, section, status, extra) => Object.assign({ key, label: key, section, status, active: true, type: 'form' }, extra || {});
const base = (over) => Object.assign({ stage: 'new', trust: {}, callback: {}, registry: { status: 'pending' }, email_domain: {}, direct: { ok: false }, broker: { ok: false },
  items: [item('legal_entity', 'identity', 'pending', { label: 'Legal business entity' }), item('physical_address', 'identity', 'pending'), item('authorized_signer', 'identity', 'pending', { data: { name: 'Jason Kervax' } }),
    item('email_verify', 'identity', 'verified'), item('phone_verify', 'identity', 'pending'), item('independent_callback', 'identity', 'pending'),
    item('payment_terms', 'billing', 'submitted'), item('cargo_profile', 'cargo', 'submitted')] }, over || {});

test('MII pattern: red flags, registry blocked until the shipper answers, billing review blocked before identity', () => {
  const v = base({ trust: { name_collision: true, sec_names: ["Victoria's Secret & Co."], domain_created_at: '2026-09-24T00:00:00Z', mx_class: 'budget_host', dmarc: 'none', domain: 'miibrandimport.com' } });
  const f = riskFlags(v).map((x) => x.text).join(' | ');
  assert.match(f, /SEC company \(Victoria's Secret & Co\.\)/); assert.match(f, /registered 2026-09-24/); assert.match(f, /budget mail host/);
  const s = playbookSteps(v);
  assert.equal(s.find((x) => x.title === 'State registry check').state, 'blocked');
  assert.equal(s.find((x) => x.title.startsWith('Billing')).state, 'blocked', 'never review billing before identity');
  assert.ok(!s.some((x) => x.state === 'now'), 'nothing for staff to do yet');
});

test('signals never ran → amber flag asks for a re-run', () => {
  assert.match(riskFlags(base({ trust: { domain: 'sadvgrp.com' } })).map((x) => x.text).join(), /never ran/);
});

test('answers in → registry is the next staff move; call-back waits for the registry', () => {
  const v = base(); v.items.slice(0, 3).forEach((i) => { i.status = 'submitted'; });
  const s = playbookSteps(v);
  assert.equal(s.find((x) => x.state === 'now').title, 'State registry check');
  assert.equal(s.find((x) => x.title === 'Independent call-back').state, 'blocked');
  v.registry.status = 'verified';
  assert.equal(playbookSteps(v).find((x) => x.state === 'now').title, 'Independent call-back');
});

test('follow-up message lists what the shipper owes and carries the one contact sign', () => {
  const v = base(); const owe = playbookSteps(v).filter((x) => x.state === 'waiting' && x.who === 'shipper').flatMap((x) => x.owe || []);
  const m = followUpText(v, owe);
  assert.match(m, /^Hi Jason,/); assert.match(m, /• Legal business entity/); assert.match(m, /Confirm the signer's phone/);
  assert.match(m, /Call or WhatsApp · \+1 \(815\) 365-1168/); assert.ok(!/253-7575/.test(m));
});

// bl_ship_0504 — old-packet items (submitted before 0491: data null, answers only in `ref`)
test('old packet: detected, flagged red, never counted as form data', async () => {
  const { isOldPacket } = await import('../app/command-center/views/shipperPlaybook360.js');
  assert.equal(isOldPacket({ type: 'form', status: 'submitted', data: null, ref: 'Legal name: MII' }), true);
  assert.equal(isOldPacket({ type: 'form', status: 'submitted', data: {} }), true);
  assert.equal(isOldPacket({ type: 'form', status: 'submitted', data: { legal_name: 'X' } }), false);
  assert.equal(isOldPacket({ type: 'upload', status: 'submitted', data: null }), false, 'uploads never carry form data');
  assert.equal(isOldPacket({ type: 'form', status: 'pending', data: null }), false, 'not answered yet is not an old packet');
  const v = base(); v.items[0].status = 'submitted'; v.items[0].data = null; v.items[0].ref = 'Legal name: MII';
  assert.match(riskFlags(v).map((x) => x.text).join(' | '), /answer\(s\) came in the old packet.*Legal business entity/);
});
