// dispatcher-test.js — grading the dispatcher skills test (bl_disp_0317, 17 Sep 2026).
//
// v2 test = a bank drawn per candidate, auto-scored MCQ + numeric items, and written items scored on
// 0–5 behaviourally-anchored levels with a tick-list of the findings a strong answer contains. This
// panel shows per-domain sub-scores, the four pass gates, integrity signals, and one card per question.
// Old (v1) attempts render through the same panel: no options, no rubric, a plain points box.
//
// Nothing here is e-mailed by accident: Save is private; "Passed" e-mails the result (no number); the
// score e-mail goes out on save only when every served question carries a mark (bl_disp_0314).
//
// renderTestPanel(host, { userId, name, onChange })
import { el, mount } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { fmtDateTime, askConfirm } from '../../shared/ui/components.js';
import { ccDispatcherTestInvite, ccDispatcherTestReview, ccDispatcherTestScore, ccDispatcherTestSendScore } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';

const INVITE_MINUTES = 75;   // v2: 18 items incl. 5 written — 45 was the v1 budget
const INVITE_START_HOURS = 48;
const pill = (txt, tone, ic) => el('span', { class: 'd3-pill ' + (tone || '') }, [ic ? icon(ic, 12) : '', txt]);
const btn = (label, onClick, tone, ic, extra) => el('button', Object.assign({ class: 'd3-btn ' + (tone || ''), type: 'button', onClick }, extra || {}), [ic ? icon(ic, 15) : '', label]);
const fmtS = (s) => { s = Math.round(Number(s || 0)); return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's'; };
const KIND = { mcq: 'Multiple choice', number: 'Numeric · auto', short: 'Short answer · rubric', long: 'Scenario · rubric' };

function style() {
  if (document.getElementById('dtest-css')) return;
  const s = document.createElement('style'); s.id = 'dtest-css';
  s.textContent = `
.dt-hd{background:linear-gradient(120deg,#0b1a2e,#10223B 55%,#152d4c);color:#fff;padding:16px 18px;border-radius:14px}
.dt-hd .t{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.dt-hd h3{font-size:17px;color:#fff;display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin:0}
.dt-hd .sub{color:#9db3cf;font-size:12.3px;margin-top:5px;display:flex;gap:14px;flex-wrap:wrap}
.dt-hd .sub span{display:inline-flex;gap:5px;align-items:center}.dt-hd .sub .cc-ico{color:#5f7a9c}
.dt-big{margin-left:auto;display:flex;align-items:center;gap:18px}
.dt-score{text-align:right}.dt-score b{font:800 34px/1 var(--lb-head,inherit);font-variant-numeric:tabular-nums}
.dt-score span{font-size:10px;letter-spacing:.1em;color:#8fa6c2;font-weight:800;display:block;margin-top:4px}
.dt-nav{display:flex;gap:5px;align-items:center;flex-wrap:wrap;padding:10px 0}
.dt-nav b{width:28px;height:28px;border-radius:8px;border:1.5px solid var(--line);background:#fff;display:grid;place-items:center;font:800 11.5px var(--lb-head,inherit);color:var(--mut);cursor:pointer}
.dt-nav b.ok{background:rgba(22,163,74,.1);border-color:#b7e2c6;color:#15803d}.dt-nav b.no{background:rgba(220,38,38,.08);border-color:#f2c1c1;color:#b91c1c}
.dt-nav b.td{background:#fff7f2;border-color:#f5b78f;color:#c2410c}.dt-nav b.part{background:rgba(217,119,6,.1);border-color:#f3d2ba;color:#b45309}
.dt-nav .lg{display:flex;gap:12px;margin-left:auto;font-size:11px;color:var(--mut);font-weight:700}
.dt-nav .lg i{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.dt-side{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin:12px 0}
.dt-dm{display:grid;grid-template-columns:1fr 54px;gap:8px;align-items:center;padding:5px 0;font-size:12.1px;white-space:nowrap}
.dt-dm .d3-tr{grid-column:1/-1;margin-top:-2px}.dt-dm .w{color:var(--faint);font-size:10.5px;font-weight:800;margin-left:4px}
.dt-gate{display:flex;gap:10px;font-size:12.2px;padding:8px 0;align-items:flex-start;border-top:1px solid var(--line2)}.dt-gate:first-child{border-top:0}.dt-gate .cc-ico{margin-top:2px}
.dt-q{background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 1px 1px rgba(16,34,59,.04),0 2px 6px rgba(16,34,59,.04);margin-bottom:14px;overflow:hidden}
.dt-q.need{border-color:#f5b78f;box-shadow:0 0 0 3px rgba(252,83,5,.08)}
.dt-qt{display:flex;gap:12px;align-items:flex-start;padding:15px 18px 10px}
.dt-num{width:30px;height:30px;border-radius:9px;background:var(--n);color:#fff;display:grid;place-items:center;font:800 12.5px var(--lb-head,inherit);flex:none}
.dt-q.need .dt-num{background:var(--o)}
.dt-p{font-weight:700;font-size:13.5px;line-height:1.5;white-space:pre-wrap}
.dt-meta{font-size:11.5px;color:var(--mut);margin-top:6px;display:flex;gap:7px;flex-wrap:wrap;align-items:center;font-weight:600}
.dt-meta span{display:inline-flex;gap:4px;align-items:center}.dt-meta .cc-ico{color:var(--faint)}
.dt-tag{display:inline-flex;gap:4px;align-items:center;font-size:10.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;padding:2px 7px;border-radius:6px;background:#eef2f7;color:#475569}
.dt-tag.o{background:rgba(252,83,5,.12);color:#c2410c}
.dt-pts{text-align:right;flex:none;display:flex;align-items:center;gap:6px}.dt-pts b{font:800 17px ui-monospace,monospace}.dt-pts small{color:var(--mut);font:600 12px ui-monospace,monospace}
.dt-pts input{width:64px;text-align:right}
.dt-ctx{margin:0 18px 12px;padding:12px 14px;border-radius:11px;background:#0e1f36;color:#cfe0f2;font:11.8px/1.7 ui-monospace,monospace;white-space:pre-wrap;position:relative}
.dt-ctx:before{content:"SHOWN TO THE CANDIDATE";position:absolute;top:-9px;left:12px;background:var(--o);color:#fff;font:800 9px/1 var(--lb-head,inherit);letter-spacing:.09em;padding:5px 8px;border-radius:6px}
.dt-ans{margin:0 18px 12px;padding:12px 14px;border-radius:11px;background:#f7f9fc;border:1px solid #e9eef5;border-left:3px solid var(--b);font-size:12.7px;line-height:1.65;white-space:pre-wrap}
.dt-ans.blank{color:var(--mut);font-style:italic}
.dt-opt{margin:0 18px 6px;display:flex;gap:10px;align-items:flex-start;padding:9px 12px;border-radius:10px;border:1.5px solid var(--line);font-size:12.6px}
.dt-opt .k{width:22px;height:22px;border-radius:7px;display:grid;place-items:center;font:800 11px var(--lb-head,inherit);background:#eef2f7;color:#475569;flex:none}
.dt-opt.right{border-color:#b7e2c6;background:#f2fbf6}.dt-opt.right .k{background:var(--ok);color:#fff}
.dt-opt.wrong{border-color:#f2c1c1;background:#fff5f5}.dt-opt.wrong .k{background:var(--bad);color:#fff}
.dt-auto{margin:6px 18px 12px;display:flex;gap:10px;align-items:flex-start;padding:10px 13px;border-radius:11px;font-size:12.6px}
.dt-auto.ok{background:#f2fbf6;border:1px solid #c6ead6}.dt-auto.ok .cc-ico{color:var(--ok)}
.dt-auto.no{background:#fff5f5;border:1px solid #f4cccc}.dt-auto.no .cc-ico{color:var(--bad)}
.dt-rub{border-top:1px solid var(--line2);background:#fbfcfe;padding:13px 18px}
.dt-fk{display:grid;grid-template-columns:1fr 1fr;gap:0 20px;margin-top:7px}
.dt-f{display:flex;gap:8px;align-items:flex-start;font-size:12.3px;padding:4px 0;cursor:pointer;user-select:none}
.dt-f .bx{width:16px;height:16px;border-radius:5px;border:1.5px solid #cbd5e1;flex:none;margin-top:1px;display:grid;place-items:center;color:#fff}
.dt-f.on .bx{background:var(--ok);border-color:var(--ok)}.dt-f.on.gate .bx{background:var(--b);border-color:var(--b)}
.dt-f .g{font-size:10px;font-weight:800;color:#c2410c;margin-left:4px}
.dt-chips{display:flex;gap:7px;flex-wrap:wrap;margin:8px 0 0}
.dt-chip{border:1px solid var(--line);background:#fff;border-radius:10px;padding:7px 10px;font-size:11.8px;font-weight:800;cursor:pointer;max-width:210px;flex:1 1 120px}
.dt-chip em{display:block;font-style:normal;font-weight:500;color:var(--mut);font-size:11px;margin-top:2px;line-height:1.35}
.dt-chip.on{border-color:var(--b);background:rgba(8,131,247,.07);box-shadow:0 0 0 2px rgba(8,131,247,.14)}
.dt-chip.zero{border-color:#f0b4b4}.dt-chip.zero.on{background:rgba(220,38,38,.06);box-shadow:0 0 0 2px rgba(220,38,38,.14)}
.dt-key{margin-top:10px;font-size:12px;color:var(--mut);line-height:1.6}
.dt-key summary{cursor:pointer;font-weight:800;color:var(--ink2)}
.dt-foot{position:sticky;bottom:0;background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 12px 32px -16px rgba(16,34,59,.28);padding:12px 18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;z-index:5}
.dt-foot .n{flex:1;min-width:200px}
.dt-mini{display:grid;grid-template-columns:1fr 1fr;gap:9px}.dt-mini>div{border:1px solid var(--line);border-radius:11px;padding:9px 11px}
.dt-mini b{display:block;font:800 17px var(--lb-head,inherit);font-variant-numeric:tabular-nums}.dt-mini span{font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--faint);font-weight:800;display:block;margin-top:2px}
@media (max-width:760px){.dt-hd{padding:14px}.dt-big{margin-left:0;width:100%;justify-content:space-between}.dt-nav .lg{display:none}.dt-fk{grid-template-columns:1fr}.dt-qt,.dt-rub{padding-left:14px;padding-right:14px}.dt-ctx,.dt-ans,.dt-auto,.dt-opt{margin-left:14px;margin-right:14px}}`;
  document.head.appendChild(s);
}

export function renderTestPanel(host, opts) {
  style();
  const { userId, name } = opts; const onChange = opts.onChange || (() => {});
  mount(host, el('div', { class: 'd3-empty' }, 'Loading skills test…'));
  let t = null; const draft = {};   // question id -> { level, findings:Set, points, note }
  let dirty = false; let busy = false;

  const reload = async () => { t = await ccDispatcherTestReview(userId).catch((e) => ({ error: humanizeError(e) })); Object.keys(draft).forEach((k) => delete draft[k]); dirty = false; paint(); };

  function inviteBtn(again) {
    return btn(again ? 'Send another' : 'Send skills test', async () => {
      const ok = await askConfirm(again ? 'Send another skills test?' : 'Send the skills test?', {
        body: (again ? 'This issues a fresh attempt — the previous one stays on the record. ' : '') + 'The candidate gets one e-mail with a button into their portal: ' + INVITE_MINUTES + ' minutes once they press Start, must start within ' + INVITE_START_HOURS + ' hours. Bank v2 draws one item per group, so no two candidates get the same test.',
        confirmLabel: 'Send it' });
      if (!ok) return;
      const r = await ccDispatcherTestInvite(userId, INVITE_MINUTES, INVITE_START_HOURS).catch((e) => ({ error: humanizeError(e) }));
      if (r && r.error) { toast(r.error); return; }
      toast('✓ Skills test sent'); await reload(); onChange();
    }, 'p', 'send');
  }

  const card = (title, sub, ic, body, actions) => el('div', { class: 'd3-card' }, [el('div', { class: 'd3-ch' }, [el('div', { class: 'ico' }, icon(ic, 15)), el('div', null, [el('h3', null, title), sub ? el('div', { class: 'sub' }, sub) : '']), el('div', { class: 'sp' }, actions || [])]), body]);

  function statusCard() {
    const st = t.state; let body; const actions = [];
    if (st === 'none') { body = 'Not sent yet. The candidate gets a short e-mail with one button into the test screen in their portal.'; actions.push(inviteBtn(false)); }
    else if (st === 'invited') body = 'Invited ' + fmtDateTime(t.invited_at) + ' — not started yet. Must start by ' + fmtDateTime(t.start_by) + ' (' + t.minutes + ' minutes once started).';
    else if (st === 'in_progress') body = 'In progress — started ' + fmtDateTime(t.started_at) + ', clock ends ' + fmtDateTime(t.ends_at) + '. Nothing to grade until it is submitted.';
    else if (st === 'expired') { body = 'Expired without a submission. Send another only if there was a real reason — a lapsed invite is itself a signal.'; actions.push(inviteBtn(true)); }
    return card('Skills test', st === 'none' ? 'Bank v2 · ' + (t.bank_size || '—') + ' live items' : 'Attempt ' + (t.attempt_no || 1), 'clipboard', el('div', { class: 'd3-pad' }, [el('div', { style: 'font-size:12.8px;line-height:1.6' }, body),
      (t.history || []).length > 1 ? el('div', { class: 'd3-mut', style: 'font-size:11.8px;margin-top:8px' }, 'Earlier: ' + t.history.filter((h) => h.no !== t.attempt_no).map((h) => 'attempt ' + h.no + ' · ' + h.status + (h.score != null ? ' · ' + h.score : '') + (h.decision ? ' · ' + h.decision : '')).join(' · ')) : '']), actions);
  }

  // ---- per-question current values (draft over saved)
  const cur = (q) => {
    const d = draft[q.id] || {};
    return { level: d.level !== undefined ? d.level : (q.level != null ? q.level : null), findings: d.findings || new Set(Array.isArray(q.ticked) ? q.ticked : []), points: d.points !== undefined ? d.points : (q.staff_points != null ? Number(q.staff_points) : null), note: d.note !== undefined ? d.note : (q.staff_note || '') };
  };
  const isAuto = (q) => q.kind === 'mcq' || q.kind === 'number';
  const ptsOf = (q) => { const c = cur(q); if (c.points != null) return c.points; if (c.level != null) return Math.round(q.max_points * c.level / 5 * 10) / 10; if (q.auto_points != null) return Number(q.auto_points); return null; };
  const graded = (q) => ptsOf(q) != null;
  const touch = (q, patch) => { draft[q.id] = Object.assign(draft[q.id] || { findings: new Set(cur(q).findings) }, patch); dirty = true; paintScore(); };

  let scoreNode, footScore, gradeBar;
  function totals() { const qs = t.questions || []; const tot = qs.reduce((a, q) => a + (ptsOf(q) || 0), 0); const max = qs.reduce((a, q) => a + Number(q.max_points || 0), 0); return { tot: Math.round(tot * 10) / 10, max, n: qs.filter(graded).length, all: qs.length }; }
  function paintScore() { const s = totals(); if (scoreNode) scoreNode.textContent = String(s.tot); if (footScore) mount(footScore, [el('b', { class: 'd3-mono', style: 'font-size:19px' }, String(s.tot)), el('span', { class: 'd3-mut' }, ' / ' + s.max), ' ', s.max ? pill(s.tot >= 0.7 * s.max ? 'Above the 70% bar' : 'Below the 70% bar', s.tot >= 0.7 * s.max ? 'green' : 'amber') : '', dirty ? pill('unsaved', 'orange') : '']); if (gradeBar) mount(gradeBar, [el('div', { class: 'd3-tr', style: 'height:8px' }, el('i', { style: 'width:' + Math.round(100 * s.n / Math.max(1, s.all)) + '%;background:linear-gradient(90deg,#0883F7,#16a34a)' })), el('div', { class: 'd3-mut', style: 'font-size:12px;margin-top:7px' }, s.n + ' of ' + s.all + ' questions carry a mark · ' + (t.questions || []).filter(isAuto).length + ' auto-scored')]); }

  function head() {
    const ig = t.integrity || {}; const s = totals(); const st = t.state;
    scoreNode = el('b', null, String(s.tot));
    return el('div', { class: 'dt-hd' }, el('div', { class: 't' }, [
      el('div', null, [el('h3', null, ['Skills test · ' + (name || ''), st === 'scored' ? pill((t.decision === 'pass' ? 'Passed' : 'Failed') + ' · ' + (t.staff_score != null ? t.staff_score + ' / ' + t.max_score : ''), t.decision === 'pass' ? 'green' : 'red', t.decision === 'pass' ? 'award' : 'x') : pill('Submitted — not scored', 'amber', 'clock'), pill('Attempt ' + t.attempt_no, 'dark'), pill('Bank v' + (t.bank_version || 1), 'dark')]),
        el('div', { class: 'sub' }, [el('span', null, [icon('cal', 14), 'Submitted ' + fmtDateTime(t.submitted_at)]), el('span', null, [icon('timer', 14), 'used ' + (ig.used_minutes != null ? ig.used_minutes : '?') + ' of ' + t.minutes + ' min']), el('span', null, [icon('list', 14), 'answered ' + (ig.answered != null ? ig.answered : '?') + ' of ' + (t.questions || []).length]), t.reviewed_at ? el('span', null, [icon('eye', 14), 'last graded ' + fmtDateTime(t.reviewed_at)]) : ''])]),
      el('div', { class: 'dt-big' }, [el('div', { class: 'dt-score' }, [scoreNode, el('span', null, 'OF ' + s.max + (st === 'scored' ? '' : ' · PROVISIONAL'))]),
        el('div', { style: 'display:flex;flex-direction:column;gap:7px' }, [btn('Save scores', () => save(null), 'p', 'check'), st === 'scored' ? btn('Send another', () => inviteBtn(true).click(), 'dk', 'send') : btn('Mark passed', () => save('pass'), 'dk', 'award')])]),
    ]));
  }
  function nav() {
    const qs = t.questions || [];
    return el('div', { class: 'dt-nav' }, [el('span', { class: 'd3-sec', style: 'margin-right:6px' }, 'Questions')].concat(qs.map((q) => {
      const p = ptsOf(q); const cls = p == null ? 'td' : p >= Number(q.max_points) ? 'ok' : p === 0 ? 'no' : 'part';
      return el('b', { class: cls, title: 'Q' + q.seq + ' · ' + (q.domain || ''), onClick: () => { const n = document.getElementById('dtq-' + q.id); if (n) n.scrollIntoView({ block: 'start', behavior: 'smooth' }); } }, String(q.seq));
    })).concat([el('div', { class: 'lg' }, [el('span', null, [el('i', { style: 'background:#b7e2c6' }), 'full marks']), el('span', null, [el('i', { style: 'background:#f3d2ba' }), 'partial']), el('span', null, [el('i', { style: 'background:#f2c1c1' }), 'zero']), el('span', null, [el('i', { style: 'background:#f5b78f' }), 'needs you'])])]));
  }
  function sideCards() {
    const doms = t.domains || []; const gates = t.gates || []; const ig = t.integrity || {};
    gradeBar = el('div');
    const domCard = card('Domain scores', 'Weighted · ' + doms.length + ' domains · saved values', 'layers', el('div', { class: 'd3-pad', style: 'padding-top:8px' }, doms.length ? doms.map((d) => { const pct = d.max ? Math.round(100 * Number(d.points || 0) / d.max) : 0; return el('div', { class: 'dt-dm' }, [el('span', null, [el('b', null, d.label), el('span', { class: 'w' }, d.max + ' pts')]), el('span', { class: 'd3-mono', style: 'text-align:right;font-weight:800;color:' + (d.graded ? (pct >= 70 ? 'inherit' : '#b45309') : 'var(--faint)'), title: d.graded ? 'all items graded' : 'partly graded — some items still need a mark' }, (d.points != null ? Number(d.points).toFixed(1).replace(/\.0$/, '') : '—') + '/' + d.max + (d.graded ? '' : '*')), el('div', { class: 'd3-tr' }, el('i', { style: 'width:' + pct + '%;background:' + (pct >= 80 ? 'var(--ok)' : pct >= 60 ? 'var(--b)' : 'var(--o)') }))]); }) : el('div', { class: 'd3-mut', style: 'font-size:12px' }, 'Sub-scores appear after the first save.')));
    const gateCard = card('Gates', 'All four must clear · re-computed on every save', 'shield', el('div', { class: 'd3-pad', style: 'padding-top:4px' }, gates.length ? gates.map((g) => el('div', { class: 'dt-gate' }, [el('span', { style: 'color:' + (g.ok === true ? 'var(--ok)' : g.ok === false ? 'var(--bad)' : 'var(--faint)') }, icon(g.ok === true ? 'check' : g.ok === false ? 'x' : 'clock', 15)), el('div', null, [el('b', null, g.label), el('div', { class: 'd3-mut' }, g.detail || '')])])) : el('div', { class: 'd3-mut', style: 'font-size:12px' }, 'Gates appear after the first save.')));
    const intCard = card('Integrity', 'Signals, not proof', 'eye', el('div', { class: 'd3-pad', style: 'padding-top:8px' }, [el('div', { class: 'dt-mini', style: 'margin-bottom:10px' }, [[ig.pastes || 0, 'Pastes'], [ig.blur || 0, 'Tab leaves'], [(ig.used_minutes != null ? ig.used_minutes : '?') + 'm', 'Of ' + t.minutes + ' used'], [ig.away_seconds ? Math.round(ig.away_seconds) + 's' : '0s', 'Away']].map(([v, l]) => el('div', null, [el('b', null, String(v)), el('span', null, l)]))), el('div', { class: 'd3-mut', style: 'font-size:11.8px;line-height:1.6' }, (t.bank_version >= 2 ? 'Bank drawn per candidate — he saw ' + (t.questions || []).length + ' of ' + (t.bank_size || '—') + ' live items. ' : '') + 'Paste and tab-leave counts are recorded, never used to block. The mock broker call is the real check.')]));
    const progCard = card('Grading progress', null, 'clipboard', el('div', { class: 'd3-pad', style: 'padding-top:8px' }, [gradeBar, btn('Jump to next ungraded', () => { const q = (t.questions || []).find((x) => !graded(x)); if (!q) { toast('Everything carries a mark'); return; } const n = document.getElementById('dtq-' + q.id); if (n) n.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 'sm', 'arrow', { style: 'margin-top:10px;width:100%;justify-content:center' })]));
    return el('div', { class: 'dt-side' }, [domCard, gateCard, intCard, progCard]);
  }
  function qCard(q) {
    const c = cur(q); const p = ptsOf(q); const need = p == null;
    const meta = el('div', { class: 'dt-meta' }, [el('span', { class: 'dt-tag' }, q.section || q.domain || ''), el('span', { class: 'dt-tag' }, KIND[q.kind] || q.kind), el('span', null, [icon('timer', 12), fmtS(q.seconds)]), el('span', null, [icon('copy', 12), (q.paste_count || 0) + ' paste' + (q.paste_count === 1 ? '' : 's')]), q.gate ? el('span', { class: 'dt-tag o' }, [icon('shield', 11), 'Auto-fail gate']) : '', q.suggested_minutes ? el('span', null, [icon('clock', 12), q.suggested_minutes + ' min suggested']) : '']);
    const ptsIn = el('input', { class: 'd3-in dt-in', type: 'number', min: '0', max: String(q.max_points), step: '0.5', value: p == null ? '' : String(p), title: 'Override the points directly' });
    ptsIn.addEventListener('input', () => { const v = ptsIn.value === '' ? null : Math.min(Math.max(0, Number(ptsIn.value)), Number(q.max_points)); touch(q, { points: v }); });
    const ptsBox = el('div', { class: 'dt-pts' }, [isAuto(q) ? el('b', { style: 'color:' + (p == null ? 'var(--faint)' : p >= q.max_points ? 'var(--ok)' : p === 0 ? 'var(--bad)' : 'inherit') }, p == null ? '—' : String(p)) : ptsIn, el('small', null, '/ ' + q.max_points)]);
    const parts = [el('div', { class: 'dt-qt' }, [el('div', { class: 'dt-num' }, String(q.seq)), el('div', { style: 'flex:1;min-width:0' }, [el('div', { class: 'dt-p' }, q.prompt), meta]), ptsBox])];
    if (q.context) parts.push(el('div', { class: 'dt-ctx' }, q.context));
    if (q.kind === 'mcq' && Array.isArray(q.options)) {
      const given = String(q.answer || '').trim().toUpperCase(); const correct = String(q.correct || '').trim().toUpperCase();
      q.options.forEach((o) => { const k = String(o.k).toUpperCase(); const cls = k === correct ? 'right' : (k === given ? 'wrong' : ''); parts.push(el('div', { class: 'dt-opt ' + cls }, [el('span', { class: 'k' }, o.k), el('span', { style: 'flex:1' }, o.text), k === given ? pill('his answer', k === correct ? 'green' : 'red') : '', k === correct && k !== given ? pill('correct', 'green') : ''])); });
      if (!given) parts.push(el('div', { class: 'dt-auto no' }, [icon('x', 15), el('div', null, 'Left blank — scored 0.')]));
      parts.push(el('div', { class: 'd3-mut', style: 'margin:4px 18px 12px;font-size:12px' }, q.answer_key || ''));
    } else {
      parts.push(el('div', { class: 'dt-ans' + (q.answer ? '' : ' blank') }, q.answer || '(left blank)'));
      if (q.kind === 'number') parts.push(el('div', { class: 'dt-auto ' + (p != null && p >= q.max_points ? 'ok' : 'no') }, [icon(p != null && p >= q.max_points ? 'check' : 'x', 15), el('div', null, [el('b', null, 'Auto-scored ' + (q.auto_points != null ? q.auto_points : '—') + ' / ' + q.max_points + '. '), q.answer_key || ''])]));
    }
    if (!isAuto(q)) {
      const rub = el('div', { class: 'dt-rub' });
      const fl = Array.isArray(q.findings) ? q.findings : [];
      const fkList = el('div', { class: 'dt-fk' });
      const fkHead = el('div', { style: 'display:flex;gap:9px;align-items:center;flex-wrap:wrap' });
      const paintF = () => {
        const c2 = cur(q); const n = fl.filter((f) => c2.findings.has(f.k)).length;
        mount(fkHead, [el('span', { class: 'd3-sec' }, 'What a strong answer contains'), fl.length ? pill(n + ' of ' + fl.length + ' found', n === fl.length ? 'green' : n ? 'blue' : 'line') : '', fl.length ? el('span', { class: 'd3-mut', style: 'margin-left:auto;font-size:11.5px' }, 'click a line to toggle') : '']);
        mount(fkList, fl.map((f) => el('div', { class: 'dt-f' + (c2.findings.has(f.k) ? ' on' : '') + (f.gate ? ' gate' : ''), onClick: () => { const s = new Set(cur(q).findings); if (s.has(f.k)) s.delete(f.k); else s.add(f.k); touch(q, { findings: s }); paintF(); } }, [el('span', { class: 'bx' }, c2.findings.has(f.k) ? icon('check', 11) : ''), el('span', null, [f.text, f.gate ? el('span', { class: 'g' }, 'GATE') : ''])])));
      };
      paintF();
      const rl = Array.isArray(q.rubric) ? q.rubric : [];
      const chips = el('div', { class: 'dt-chips' });
      const paintChips = () => { const c2 = cur(q); mount(chips, rl.map((r) => el('div', { class: 'dt-chip' + (c2.level === r.level ? ' on' : '') + (r.level === 0 ? ' zero' : ''), onClick: () => { touch(q, { level: r.level, points: null }); ptsIn.value = String(Math.round(q.max_points * r.level / 5 * 10) / 10); paintChips(); } }, [String(r.level), el('em', null, r.anchor)]))); };
      paintChips();
      const note = el('input', { class: 'd3-in', style: 'width:100%;margin-top:10px;font-size:12.3px', placeholder: 'Grader note for this answer (internal)', value: c.note || '' });
      note.addEventListener('input', () => touch(q, { note: note.value }));
      mount(rub, [fl.length ? fkHead : '', fl.length ? fkList : '', rl.length ? el('div', { style: 'margin-top:' + (fl.length ? '12px' : '0') }, [el('span', { class: 'd3-sec' }, 'Score this answer — 0 to 5, anchors are internal'), chips]) : '', note,
        q.answer_key ? el('details', { class: 'dt-key' }, [el('summary', null, 'What a good answer looks like'), el('div', { style: 'margin-top:5px' }, q.answer_key)]) : '']);
      parts.push(rub);
    }
    return el('div', { class: 'dt-q' + (need ? ' need' : ''), id: 'dtq-' + q.id }, parts);
  }
  function foot() {
    footScore = el('div');
    const note = el('input', { class: 'd3-in n', placeholder: 'Note for the record — internal only…', value: t.review_note || '' });
    const mailBtn = btn(t.score_email_at ? 'Re-send score e-mail' : 'E-mail score', async () => {
      if (busy) return; const sc = t.staff_score != null ? t.staff_score : null;
      if (sc == null) { toast('Save the scores first — there is nothing to send'); return; }
      const again = !!t.score_email_at;
      if (!(await askConfirm(again ? 'Send the score again?' : 'E-mail the score to the candidate?', { body: 'They get one e-mail with the number only — ' + sc + ' out of ' + (t.max_score || '—') + '. Your notes, the per-question marks, the anchors and the answer key are never included.' + (again ? ' You already sent a score on ' + fmtDateTime(t.score_email_at) + '.' : ''), confirmLabel: 'Send the score' }))) return;
      busy = true; const r = await ccDispatcherTestSendScore(t.attempt).catch((e) => ({ error: humanizeError(e) })); busy = false;
      if (!r || r.error) { toast((r && r.error) || 'Could not send'); return; }
      toast('✓ Score e-mailed · ' + r.score + ' / ' + r.max); await reload(); onChange();
    }, '', 'mail');
    const row = el('div', { class: 'dt-foot' }, [footScore, note, btn('Save scores', () => save(null, note), '', 'check'), mailBtn, btn('Failed', () => save('fail', note), 'g', 'x'), btn(t.decision === 'pass' ? 'Passed ✓' : 'Passed', () => save('pass', note), 'p', 'award')]);
    row.noteEl = note;
    return row;
  }
  async function save(decision, noteEl) {
    if (busy) return;
    const scores = {};
    (t.questions || []).forEach((q) => { const d = draft[q.id]; if (!d) return; const o = {}; if (d.level !== undefined && d.level !== null) o.level = d.level; if (d.points !== undefined && d.points !== null) o.points = d.points; if (d.findings) o.findings = Array.from(d.findings); if (d.note !== undefined) o.note = d.note; if (Object.keys(o).length) scores[q.id] = o; });
    if (decision && !(await askConfirm(decision === 'pass' ? 'Mark this test as passed?' : 'Mark this test as failed?', {
      body: decision === 'pass' ? 'The candidate stays in the pipeline — next is the carrier and truck details, then the paid trial. This sends one e-mail: you passed, a coordinator will be in touch. No number, no notes.' : 'This records the decision on the test. It does not reject the application — use Reject for that. Nothing is e-mailed.',
      confirmLabel: decision === 'pass' ? 'Mark passed' : 'Mark failed', danger: decision === 'fail' }))) return;
    const noteVal = noteEl ? noteEl.value.trim() : null; const noteDirty = noteEl && noteVal !== (t.review_note || '').trim();
    busy = true;
    const r = await ccDispatcherTestScore(t.attempt, scores, decision || null, noteDirty ? noteVal : null).catch((e) => ({ error: humanizeError(e) }));
    busy = false;
    if (!r || r.error) { toast((r && r.error) || 'Could not save'); return; }
    toast((decision ? (decision === 'pass' ? '✓ Passed' : '✕ Failed') : '✓ Saved') + ' · ' + r.score + ' / ' + r.max);
    await reload(); onChange();
  }

  function paint() {
    if (!t || t.error) { mount(host, el('div', { class: 'd3-empty' }, (t && t.error) || 'Could not load the test')); return; }
    if (!['submitted', 'scored'].includes(t.state)) { mount(host, statusCard()); return; }
    const qs = t.questions || [];
    mount(host, [head(), nav(), sideCards(), el('div', null, qs.map(qCard)), foot(), el('div', { class: 'd3-mut', style: 'font-size:11.8px;margin-top:10px;line-height:1.6' }, 'Saving is private — the candidate sees nothing. Passed e-mails the result with no number. The score e-mail goes out on save, once, only when every served question carries a mark; you can re-send it from here.')]);
    paintScore();
  }
  reload();
  return { reload };
}

export default { renderTestPanel };
