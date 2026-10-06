// bl_disp_0526 — the re-application gate must render the sourcing fields it tests.
// A board_unknown row once rendered with NO inputs (the no_own_board row's div re-parented them), so the gate could
// never close, Submit never called dispatcher_apply and the re-applicant's answers were never saved.
// Run: node --test tests/dispatcher_gaps_render_test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { reapplyGate, noteContradictsBoardRule } from '../app/agent/dispatcher-gaps.js';

// Tiny fake DOM: appendChild RE-PARENTS a node, exactly like the browser does — that is the behaviour that hid the fields.
const mk = (tag) => {
  const e = { tag, children: [], parent: null, style: {}, attrs: {}, value: '', checked: false, textContent: '',
    setAttribute(k, v) { this.attrs[k] = v; }, scrollIntoView() {},
    appendChild(c) { if (c.parent) c.parent.children.splice(c.parent.children.indexOf(c), 1); c.parent = this; this.children.push(c); return c; } };
  return e;
};
const h = (tag, attrs, kids) => {
  const e = mk(tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  (Array.isArray(kids) ? kids : kids != null ? [kids] : []).forEach((c) => c != null && e.appendChild(typeof c === 'string' ? Object.assign(mk('#text'), { textContent: c }) : c));
  return e;
};
const inputsUnder = (n) => (n.tag === 'input' || n.tag === 'textarea' ? [n] : []).concat(...n.children.map(inputsUnder));
const form = (over) => Object.assign({ board: () => 'own_paid', ownBoards: () => ['DAT'], english: () => 'fluent', years: () => '3', trucks: () => '5',
  hours: () => '40-50', overlap: () => true, note: () => '', cv: () => 'cv.pdf', id: () => 'id.png',
  channels: () => ['Load board (DAT / Truckstop / 123Loadboard / Relay)'], channelsOk: () => true }, over || {});

// Bushra's shape: legacy application, no coded reason, "No own access" -> derived board_unknown only.
const legacyProf = { status: 'applied', reapply_count: 1, english_level: 'fluent', years_exp: 3,
  review_note: 'Note', skills: { own_board_access: ['No own access'], can_source_loads: 'yes_with_board', availability_hours: '40-50', us_hours_overlap: true, cv_doc: 'cv.pdf', id_doc: 'id.png' } };

test('derived board_unknown row renders the "where exactly" + "two loads" fields, and they close the gate', () => {
  const g = reapplyGate({ h, prof: legacyProf, form: form() });
  assert.deepEqual(g.codes, ['board_unknown']);
  const fields = inputsUnder(g.node);
  assert.equal(fields.length, 2, 'both sourcing fields must be mounted inside the gate card');
  assert.ok(g.check(), 'gate is open while the fields are empty');
  const [where, loads] = fields;
  where.value = 'DAT, own login';
  loads.value = 'Dallas TX -> Atlanta GA, TQL, Aug 2026, $2,400; Chicago IL -> Memphis TN, CH Robinson, Sep 2026, $1,850';
  assert.equal(g.check(), null, 'gate closes once the fields are filled');
  assert.equal(g.answers().board_access, 'DAT, own login');
  assert.match(g.answers().booking_proof, /TQL/);
});

test('explicit no_own_board (+ board_unknown + no_booking_proof) still renders the fields exactly once', () => {
  const g = reapplyGate({ h, prof: Object.assign({}, legacyProf, { reject_reasons: ['board_unknown', 'no_own_board', 'no_booking_proof'] }), form: form() });
  assert.deepEqual(g.codes, ['no_own_board']);
  assert.equal(inputsUnder(g.node).length, 2);
});

test('no_booking_proof on its own renders its proof field', () => {
  const g = reapplyGate({ h, prof: Object.assign({}, legacyProf, { reject_reasons: ['no_booking_proof'] }), form: form() });
  assert.deepEqual(g.codes, ['no_booking_proof']);
  assert.equal(inputsUnder(g.node).length, 1);
});

// The note 35 applicants were rejected with (21 Sep – 6 Oct 2026) and the wording it was replaced with (bl_disp_0526).
const OLD_NOTE = 'Thank you for applying to LoadBoot Dispatch. For this role we need dispatchers who already hold their own active load board subscription (DAT, Truckstop or 123Loadboard) and can find and book loads independently from the first week. Based on your application, that requirement is not met at this time, so we are not moving forward. This is not a reflection of your effort — if this changes, you are welcome to reapply.';
export const NEW_NOTE = 'Thank you for applying to LoadBoot Dispatch. For this role we need dispatchers who can find and book loads on their own from the first week. That does not have to be a load board in your own name: a login you use through an employer or a carrier, Facebook or WhatsApp freight groups, brokers you already know or direct shippers all count, as long as you find the load and book it yourself. Your application did not show this, so we are not moving forward at this time. This is not a reflection of your effort. When you re-apply, tick every route you use to find loads and name two loads you booked yourself.';

test('a reject note that sets the retired "own subscription" rule is caught; rule-consistent wording is not', () => {
  assert.equal(noteContradictsBoardRule(OLD_NOTE), true);
  assert.equal(noteContradictsBoardRule('You need your own DAT login.'), true);
  assert.equal(noteContradictsBoardRule('The subscription must be in your own name.'), true);
  assert.equal(noteContradictsBoardRule('Candidate needs an own load board.'), true);
  assert.equal(noteContradictsBoardRule(NEW_NOTE), false);
  assert.equal(noteContradictsBoardRule('Not enough US dispatch experience, and English was too basic for broker calls.'), false);
  assert.equal(noteContradictsBoardRule(''), false);
  assert.equal(noteContradictsBoardRule(null), false);
});
