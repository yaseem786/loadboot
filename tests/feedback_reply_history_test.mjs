import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../app/command-center/views/feedbackReplyHistory.js', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replaceAll('export ', '');
const requestReplies = new Function(source + '\nreturn requestReplies;')();
const attachReplyThread = new Function(source + '\nreturn attachReplyThread;')();
test('thread RPC rows inherit the actual mailbox thread key for working links', () => {
  const row = { id: 'sent-1', body_text: 'Reply' };
  assert.equal(attachReplyThread([row], 'actual:thread')[0].thread_key, 'actual:thread');
  assert.equal(row.thread_key, undefined);
});
test('history shows only sent replies for the exact requester and request', () => {
  const sent = { direction: 'out', status: 'sent', peer_email: 'Dispatcher@example.test', subject: 'Re: Dispatcher help request · help-123' };
  const messages = [sent, { ...sent, status: 'draft' }, { ...sent, direction: 'in' },
    { ...sent, peer_email: 'someone-else@example.test' }, { ...sent, subject: 'Another request' }];
  assert.deepEqual(requestReplies(messages, 'dispatcher@example.test', 'help-123'), [sent]);
  assert.deepEqual(requestReplies(null, 'dispatcher@example.test', 'help-123'), []);
});
