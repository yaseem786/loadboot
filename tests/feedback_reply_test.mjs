import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Inject mailbox boundaries so these tests cannot contact a live account.
const source = readFileSync(new URL('../app/command-center/views/feedbackReply.js', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replace('export async function', 'async function');
const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const el = (tag, attrs = {}, children = []) => ({ tag, attrs: attrs || {}, children: [children].flat(), value: '', isConnected: true,
  replaceChildren(...kids) { this.children = kids; }, focus() {},
  get innerHTML() { return this.children.map(c => typeof c === 'object' ? '<' + c.tag + '>' + c.innerHTML + '</' + c.tag + '>' : esc(c)).join(''); } });
const nodes = n => [n, ...n.children.filter(c => c && typeof c === 'object').flatMap(nodes)];
async function setup(overrides = {}) {
  let body; const saves = [], sends = [];
  const stats = { can_draft: true, can_send: true, mailboxes: [{ mailbox: 'dispatch@loadboot.com', known: true }] };
  const api = {
    mailStats: async () => stats,
    mailComposeSave: async data => { saves.push(data); return { id: 'draft-1', thread_key: 'thread-1' }; },
    mailSend: async id => { sends.push(id); return { ok: true }; }, ...overrides,
  };
  const build = new Function('el', 'openDrawer', 'mailStats', 'mailComposeSave', 'mailSend', 'humanizeError', source + '\nreturn feedbackReply;');
  const reply = build(el, (_title, b) => { body = b; return { close() {} }; }, api.mailStats, api.mailComposeSave, api.mailSend, e => e.message);
  await reply({ email: 'dispatcher@example.test', feedback: { id: 'help-123', kind: 'help', note: '<img src=x onerror=alert(1)>' } });
  const find = tag => nodes(body).find(n => n.tag === tag);
  const click = name => nodes(body).find(n => n.tag === 'button' && n.children[0] === name).attrs.onClick();
  return { body, find, click, saves, sends };
}
test('draft stays unsent, carries request context and escapes customer text', async () => {
  const s = await setup(); s.find('textarea').value = '<script>unsafe</script>';
  await s.click('Save draft');
  assert.equal(s.sends.length, 0); assert.equal(s.saves.length, 1);
  assert.equal(s.saves[0].to, 'dispatcher@example.test');
  assert.match(s.saves[0].subject, /help-123/);
  assert.match(s.saves[0].bodyHtml, /&lt;script&gt;/);
  assert.match(s.saves[0].bodyHtml, /&lt;img/);
});
test('empty reply never creates a draft', async () => {
  const s = await setup(); await s.click('Send email'); assert.equal(s.saves.length, 0);
});
test('repeat send is guarded after success', async () => {
  const s = await setup(); s.find('textarea').value = 'We can help';
  await s.click('Send email'); await s.click('Send email');
  assert.equal(s.saves.length, 1); assert.deepEqual(s.sends, ['draft-1']);
  assert.equal(s.find('textarea').disabled, true);
});
test('rejected send preserves the same draft for retry', async () => {
  let tries = 0;
  const s = await setup({ mailSend: async () => { if (++tries === 1) throw new Error('Recipient has unsubscribed'); return { ok: true }; } });
  s.find('textarea').value = 'We can help'; await s.click('Send email');
  assert.equal(s.find('textarea').disabled, false);
  assert.ok(nodes(s.body).some(n => n.textContent === 'Recipient has unsubscribed'));
  await s.click('Send email'); assert.equal(s.saves[1].draftId, 'draft-1');
});
test('draft-only roles have no Send action', async () => {
  const s = await setup({ mailStats: async () => ({ can_draft: true, can_send: false, mailboxes: [{ mailbox: 'hello@loadboot.com' }] }) });
  assert.ok(!nodes(s.body).some(n => n.children[0] === 'Send email'));
});
test('missing mail permission fails closed', async () => {
  const s = await setup({ mailStats: async () => ({ can_draft: false }) });
  assert.ok(!s.find('textarea')); assert.equal(s.saves.length, 0);
});
