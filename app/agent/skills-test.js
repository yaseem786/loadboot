// skills-test.js — the dispatcher skills test, as a real assessment inside the portal (bl_disp_0306).
//
// Yaseen 12 Sep 2026: "portal mn test design karo jesy real company test leti hain … email mn sirf
// CTA jay". The e-mail is now a one-button invite; everything else happens here.
//
// What is deliberately on the SERVER, not here: the clock (`ends_at`), the single attempt, which
// questions exist, and the answer key. This module never sees a correct answer, and the countdown it
// paints is cosmetic — every save re-reads `remaining` from the server, and a save after time-up is
// refused there. Closing the tab does not pause anything.
//
// Integrity telemetry (tab blurs, time away, paste events, seconds per question) is collected and
// sent with the submission. It is shown to staff as counts and never blocks or auto-fails: these are
// signals, not proof, and the live broker-call role-play is what actually exposes borrowed answers.
//
// bl_disp_0317 (17 Sep 2026) — v2 test: one question at a time with a navigator, multiple-choice
// items, a context panel (the rate confirmation the question is about), paste blocked on written
// items (counted, and the candidate is told), flag-for-review, and section progress in the bar.
// The save / clock / telemetry logic below is unchanged from v1.
import { dispatcherTestMy, dispatcherTestStart, dispatcherTestSave, dispatcherTestSubmit } from '../shared/api.js';
import { lockPage, unlockPage } from '../shared/ui/scrollLock.js';   // bl_ui_0413: page lock behind every sheet/drawer

const h = (tag, attrs, kids) => {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') e[k.toLowerCase()] = attrs[k];
    else if (attrs[k] != null && attrs[k] !== false) e.setAttribute(k, attrs[k]);
  }
  (Array.isArray(kids) ? kids : kids != null ? [kids] : []).forEach((c) => c != null && e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return e;
};
const mount = (el, kids) => { el.innerHTML = ''; (Array.isArray(kids) ? kids : [kids]).forEach((c) => c && el.appendChild(c)); };

const CARD = 'border-radius:18px;padding:22px;margin-bottom:14px;background:rgba(255,255,255,.03);border:1px solid rgba(130,165,225,.16)';
const mmss = (s) => { s = Math.max(0, s | 0); const m = Math.floor(s / 60); return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const whenET = (iso) => { try { return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'; } catch (_) { return ''; } };
const hoursLeft = (iso) => Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 3600000));

// ---------------------------------------------------------------- shell pieces
const hero = (title, kicker, sub, accent) => h('div', { style: 'border-radius:18px;padding:24px;margin-bottom:14px;background:linear-gradient(135deg,#10223B 0%,#0d2a4d 55%,#0b1f3d 100%);border:1px solid ' + (accent || 'rgba(8,131,247,.35)') }, [
  h('div', { style: 'font-size:.72rem;font-weight:900;letter-spacing:.12em;color:#7cc0ff' }, kicker),
  h('div', { style: 'font-size:1.5rem;font-weight:900;color:#fff;margin:6px 0 4px;line-height:1.2' }, title),
  sub ? h('div', { class: 'cp-row-s', style: 'max-width:640px;line-height:1.65' }, sub) : null,
]);

const factRow = (items) => h('div', { style: 'display:flex;gap:9px;flex-wrap:wrap;margin-top:4px' }, items.map((it) =>
  h('div', { style: 'flex:1;min-width:170px;border-radius:12px;padding:12px 14px;background:rgba(8,131,247,.06);border:1px solid rgba(8,131,247,.2)' }, [
    h('div', { style: 'font-weight:800;color:#7cc0ff;font-size:.9rem' }, it[0]),
    h('div', { class: 'cp-row-s', style: 'margin-top:3px;line-height:1.5' }, it[1]),
  ])));

function confirmBox(title, body, okLabel) {
  return new Promise((resolve) => {
    const close = (v) => { try { document.body.removeChild(back); } catch (_) {} resolve(v); };
    const back = h('div', { style: 'position:fixed;inset:0;background:rgba(2,8,20,.72);z-index:9500;display:flex;align-items:center;justify-content:center;padding:18px' }, [
      h('div', { style: 'max-width:440px;width:100%;background:#0f1e35;border:1px solid rgba(130,165,225,.22);border-radius:16px;padding:20px' }, [
        h('div', { style: 'font-weight:900;color:#fff;font-size:1.05rem;margin-bottom:6px' }, title),
        h('div', { class: 'cp-row-s', style: 'line-height:1.7' }, body),
        h('div', { style: 'display:flex;gap:8px;justify-content:flex-end;margin-top:16px' }, [
          h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => close(false) }, 'Cancel'),
          h('button', { class: 'cp-btn cp-btn-sm', onClick: () => close(true) }, okLabel || 'Confirm'),
        ]),
      ]),
    ]);
    document.body.appendChild(back); lockPage(back);
  });
}

// ---------------------------------------------------------------- states
function briefing(host, d, reload) {
  const go = h('button', { class: 'cp-btn cp-btn-lg', onClick: async (ev) => {
    const b = ev.currentTarget; b.disabled = true; b.textContent = 'Starting…';
    const r = await dispatcherTestStart().catch((e) => ({ error: (e && e.message) || 'could not start' }));
    if (r && r.error) { b.disabled = false; b.textContent = 'Start the test'; msg.textContent = r.error; return; }
    reload();
  } }, 'Start the test');
  const msg = h('div', { class: 'cp-err', style: 'margin-top:8px' });
  const n = d.question_count || '—';
  const secs = Array.isArray(d.sections) && d.sections.length ? d.sections.map((x) => x.label || x).join(' · ') : 'rate maths, broker vetting, hours of service, paperwork, negotiation, market, equipment';
  const rule = (ic, title, body) => h('div', { style: 'display:flex;gap:12px;padding:9px 0;border-top:1px solid rgba(130,165,225,.12)' }, [
    h('div', { style: 'width:32px;height:32px;border-radius:9px;background:rgba(8,131,247,.14);color:#7cc0ff;display:flex;align-items:center;justify-content:center;font-weight:900;flex-shrink:0' }, ic),
    h('div', { class: 'cp-row-s', style: 'line-height:1.6' }, [h('b', { style: 'color:#fff;display:block' }, title), body])]);

  mount(host, h('div', null, [
    hero('Your dispatcher skills test', 'LOADBOOT DISPATCH', n + ' questions about real dispatch situations — the last step before a paid trial on a live carrier account.'),
    h('div', { style: CARD }, [
      factRow([
        [d.minutes + ' minutes', 'The clock starts when you press Start and runs on our server — closing this tab does not pause it.'],
        [n + ' questions', secs + '.'],
        ['One attempt', 'Answers save as you type. Move between questions freely until you submit.'],
      ]),
      h('div', { style: 'margin-top:14px' }, [
        h('div', { style: 'font-weight:800;color:#fff;margin-bottom:4px' }, 'What this test is'),
        rule('⏱', d.minutes + ' minutes, one sitting.', 'There is no pause button. Give yourself a clear block of time.'),
        rule('#', 'Some questions are arithmetic.', 'Use a calculator — we expect you to. Show the numbers you used, not just the answer.'),
        rule('⇄', 'Your questions are drawn from a larger bank.', 'Two candidates do not get the same test, so comparing notes does not help.'),
        rule('✎', 'Your own words.', 'Pasting is off on the written questions and we can see it. Everyone who passes also does a short live broker-call role-play — an answer you cannot defend out loud counts for nothing.'),
        rule('✓', 'There is no trick.', 'This is the work: read a rate con, run the math, spot the risk, write the e-mail. If you do this job well you will do well here. If you do not know something, write “I don’t know” — an honest gap costs far less than an answer you cannot defend.'),
      ]),
      d.start_by ? h('div', { style: 'margin-top:14px;padding:11px 14px;border-radius:10px;background:rgba(251,146,60,.1);border:1px solid rgba(251,146,60,.35);color:#fdba74;font-size:.85rem;line-height:1.6' },
        'This invitation expires in about ' + hoursLeft(d.start_by) + ' hours — by ' + whenET(d.start_by) + '. If it lapses, ask us for a new one.') : null,
      h('div', { style: 'margin-top:16px' }, go), msg,
    ]),
  ]));
}

function receipt(host, d) {
  // bl_disp_0312: `result` / `score` arrive ONLY after staff pressed Passed / E-mail score — the same
  // once-only stamps as the e-mails — so this card can never show a verdict before the candidate is told.
  const passed = d.result === 'pass';
  const hasScore = d.score != null;
  const pct = hasScore ? Math.round((Number(d.score) / (Number(d.max_score) || 100)) * 100) : null;
  const ring = hasScore ? h('div', { style: 'position:relative;width:118px;height:118px;flex:none;border-radius:50%;background:conic-gradient(#4ade80 ' + pct + '%,rgba(255,255,255,.08) 0);display:grid;place-items:center' }, [
    h('div', { style: 'width:92px;height:92px;border-radius:50%;background:#0d2240;display:grid;place-items:center;text-align:center' }, [
      h('div', null, [h('div', { style: 'font-size:1.7rem;font-weight:900;color:#fff;line-height:1' }, String(d.score)),
                      h('div', { style: 'font-size:.68rem;font-weight:800;letter-spacing:.1em;color:#7cc0ff;margin-top:3px' }, '/ ' + (d.max_score || 100))]),
    ]),
  ]) : null;
  const next = passed ? [
    h('div', null, '1. We agree the truck with you — you see the carrier, the equipment and the lanes before anything starts.'),
    h('div', null, '2. Then the paid trial begins on that live account: 10 working days, commission on every load you deliver.'),
    h('div', { style: 'margin-top:8px;opacity:.85' }, 'We will message you with the truck details. Nothing else is needed from you right now.'),
  ] : [
    h('div', null, '1. We read every answer ourselves — this is not machine-marked.'),
    h('div', null, '2. If it looks right, you negotiate one real load with us — we play the broker.'),
    h('div', null, '3. After that comes the paid trial on a live carrier account.'),
    h('div', { style: 'margin-top:8px;opacity:.85' }, 'You will hear from us by e-mail. Nothing else is needed from you right now.'),
  ];
  mount(host, h('div', null, [
    passed
      ? hero('You passed the skills test', 'LOADBOOT DISPATCH · RESULT', 'Your written test is approved' + (d.result_at ? ' on ' + whenET(d.result_at) : '') + '. Welcome to the next step.', 'rgba(74,222,128,.55)')
      : hero('Test submitted', 'LOADBOOT DISPATCH', 'Thank you — your answers are with us.', 'rgba(74,222,128,.45)'),
    h('div', { style: CARD }, [
      h('div', { style: 'display:flex;gap:18px;align-items:center;flex-wrap:wrap' }, [
        ring,
        h('div', { style: 'flex:1;min-width:200px' }, [
          h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, [
            h('span', { class: 'cp-pill', style: 'font-weight:800;color:#4ade80' }, passed ? '✓ Passed' : '✓ Submitted'),
            d.submitted_at ? h('span', { class: 'cp-row-s' }, 'submitted ' + whenET(d.submitted_at)) : null,
          ]),
          hasScore ? h('div', { class: 'cp-row-s', style: 'margin-top:8px;line-height:1.6' }, 'Your score: ' + d.score + ' of ' + (d.max_score || 100) + ' points (' + pct + '%). Every answer was read by a person, not a machine.')
                   : (passed ? h('div', { class: 'cp-row-s', style: 'margin-top:8px' }, 'Your score will appear here once it is released.') : null),
        ]),
      ]),
      h('div', { class: 'cp-row-s', style: 'margin-top:14px;line-height:1.8' }, [
        h('div', { style: 'font-weight:800;color:#fff;margin-bottom:4px' }, 'What happens next'),
      ].concat(next)),
    ]),
  ]));
}

function dead(host, d) {
  const expired = d.state === 'expired';
  mount(host, h('div', null, [
    hero(expired ? 'This test has expired' : 'No test assigned yet', 'LOADBOOT DISPATCH',
      expired ? 'The time ran out, or the invitation lapsed before it was started.' : 'Your application is with us. When it moves to the skills test, the test appears here and we e-mail you.',
      expired ? 'rgba(248,113,113,.45)' : null),
    expired ? h('div', { style: CARD }, h('div', { class: 'cp-row-s', style: 'line-height:1.8' },
      'If something went wrong — power cut, connection dropped — reply to the e-mail we sent you and ask for another attempt. We can issue one. Tests are not re-opened simply because the time ran out.')) : null,
  ]));
}

// ---------------------------------------------------------------- the live test
function live(host, d, reload) {
  // The countdown is computed from an absolute deadline, never by decrementing a counter: a
  // background tab throttles setInterval to about once a minute, and a decrementing clock would
  // then show twenty minutes left when two remain. `deadline` is re-anchored from the server's
  // `remaining` on every save and on every return to the tab.
  const state = { deadline: Date.now() + (d.remaining || 0) * 1000, blur: 0, away: 0, awaySince: 0, submitting: false };
  const secsLeft = () => Math.max(0, Math.round((state.deadline - Date.now()) / 1000));
  const anchor = (remaining) => { if (typeof remaining === 'number') state.deadline = Date.now() + remaining * 1000; };
  const per = {};              // question id -> { seconds, paste, dirty, saving, el, status, focusedAt }
  let submitted = false;

  let tick = null, saver = null, onHide = null, onLeave = null;
  const cleanup = () => {
    if (tick) { clearInterval(tick); tick = null; }
    if (saver) { clearInterval(saver); saver = null; }
    if (onHide) { document.removeEventListener('visibilitychange', onHide); onHide = null; }
    if (onLeave) { window.removeEventListener('beforeunload', onLeave); onLeave = null; }
  };
  const timerEl = h('span', { style: 'font-variant-numeric:tabular-nums;font-weight:900;font-size:1.15rem;color:#fff' }, mmss(secsLeft()));
  const timerWrap = h('div', { style: 'display:flex;align-items:center;gap:9px;padding:9px 14px;border-radius:12px;background:rgba(8,131,247,.14);border:1px solid rgba(8,131,247,.4);flex-shrink:0' }, [
    h('span', { style: 'font-size:.7rem;font-weight:900;letter-spacing:.1em;color:#7cc0ff' }, 'TIME LEFT'), timerEl]);
  const saveEl = h('span', { class: 'cp-row-s', style: 'color:#94a3b8' }, 'All answers saved');
  const secHost = h('div', { style: 'display:flex;gap:14px;flex:1;min-width:0;overflow-x:auto;scrollbar-width:none' });
  const navHost = h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(38px,1fr));gap:6px' });
  const qHost = h('div');
  const qs = d.questions || [];
  let cur = 0; const flagged = new Set();

  const bar = h('div', { style: 'position:sticky;top:0;z-index:40;margin:-4px -4px 14px;padding:12px 14px;border-radius:0 0 16px 16px;background:rgba(11,21,38,.96);backdrop-filter:blur(8px);border-bottom:1px solid rgba(130,165,225,.2);display:flex;gap:12px;align-items:center;flex-wrap:wrap' }, [
    h('div', { style: 'flex:1;min-width:200px;display:flex;flex-direction:column;gap:6px' }, [
      h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, [h('div', { style: 'font-weight:900;color:#fff' }, 'Dispatcher skills test'), saveEl]),
      secHost,
    ]),
    timerWrap,
  ]);

  const answered = (q) => (per[q.id].el.value || '').trim() !== '';
  const refreshProgress = () => {
    // section strip: one segment per question, coloured by answered / current
    const bySec = []; qs.forEach((q, i) => { let s2 = bySec.find((x) => x.k === (q.domain || q.section)); if (!s2) { s2 = { k: q.domain || q.section, label: q.section, idx: [] }; bySec.push(s2); } s2.idx.push(i); });
    mount(secHost, bySec.map((s2) => h('div', { style: 'display:flex;flex-direction:column;gap:5px;min-width:120px;flex-shrink:0' }, [
      h('div', { style: 'font-size:.68rem;font-weight:800;color:' + (s2.idx.includes(cur) ? '#fff' : '#7f95b3') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, s2.label),
      h('div', { style: 'display:flex;gap:3px' }, s2.idx.map((i) => h('i', { style: 'height:5px;flex:1;border-radius:4px;background:' + (i === cur ? '#0883F7' : answered(qs[i]) ? '#22c55e' : 'rgba(255,255,255,.14)') }))),
    ])));
    mount(navHost, qs.map((q, i) => h('button', { type: 'button', onClick: () => show(i), title: q.section,
      style: 'aspect-ratio:1;border-radius:9px;border:1.5px solid ' + (i === cur ? '#0883F7' : flagged.has(q.id) ? '#FC5305' : answered(q) ? 'rgba(34,197,94,.5)' : 'rgba(130,165,225,.22)') + ';background:' + (i === cur ? '#0883F7' : answered(q) ? 'rgba(34,197,94,.12)' : 'rgba(255,255,255,.03)') + ';color:' + (i === cur ? '#fff' : flagged.has(q.id) ? '#FC5305' : answered(q) ? '#4ade80' : '#94a3b8') + ';font:800 .78rem inherit;cursor:pointer' }, String(i + 1))));
  };
  const refreshSaveState = () => {
    const dirty = Object.values(per).some((p) => p.dirty || p.saving);
    saveEl.textContent = dirty ? 'Saving…' : '✓ All answers saved';
    saveEl.style.color = dirty ? '#fbbf24' : '#94a3b8';
  };

  // seconds spent on a question includes the time it is focused right now — otherwise the question
  // someone worked on for twenty minutes and then submitted from would be recorded as 0s.
  const spent = (p) => Math.round(p.seconds + (p.focusedAt ? (Date.now() - p.focusedAt) / 1000 : 0));

  async function flush(qid) {
    const p = per[qid];
    if (!p || !p.dirty || p.saving || submitted) return;
    p.saving = true; p.dirty = false; refreshSaveState();
    const r = await dispatcherTestSave(qid, p.el.value, spent(p), p.paste).catch((e) => ({ error: (e && e.message) || 'save failed' }));
    p.saving = false;
    if (r && r.error) {
      if (r.state === 'expired' || r.state === 'submitted') { reload(); return; }
      p.dirty = true; p.status.textContent = 'Not saved — retrying'; p.status.style.color = '#f87171';
    } else {
      anchor(r.remaining);                                   // the server owns the clock
      p.status.textContent = 'Saved'; p.status.style.color = '#4ade80';
    }
    refreshSaveState();
  }
  const flushAll = () => Promise.all(Object.keys(per).map(flush));

  async function submit(auto) {
    if (submitted || state.submitting) return;
    if (!auto) {
      const total = qs.length;
      const done = qs.filter(answered).length;
      const ok = await confirmBox('Submit your test?',
        done < total ? ('You have answered ' + done + ' of ' + total + '. Unanswered questions score zero, and the test cannot be reopened.')
                     : 'All ' + total + ' answered. Once submitted, nothing can be changed.', 'Submit');
      if (!ok) return;
    }
    state.submitting = true; submitted = true;
    if (state.awaySince) { state.away += (Date.now() - state.awaySince) / 1000; state.awaySince = 0; }
    await flushAll();
    await dispatcherTestSubmit({
      blur: state.blur,
      away_seconds: Math.round(state.away),
      auto_submitted: !!auto,
      pastes: Object.values(per).reduce((a, p) => a + p.paste, 0),
      ua: (navigator.userAgent || '').slice(0, 180),
      tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || ''),
    }).catch(() => null);
    reload();
  }

  // ---- one input per question, built once so typed text survives navigation; only the card is re-mounted
  qs.forEach((q) => {
    const status = h('span', { class: 'cp-row-s', style: 'color:#64748b' }, '');
    let box;
    if (q.kind === 'mcq' && Array.isArray(q.options)) {
      // a hidden input holds the chosen key so save/flush works exactly like a textarea
      box = h('input', { type: 'hidden' }); box.value = q.answer || '';
    } else {
      box = h('textarea', { class: 'cp-in', style: 'min-height:' + (q.kind === 'long' ? 190 : q.kind === 'short' ? 110 : 80) + 'px;line-height:1.7;font-size:.95rem', placeholder: q.kind === 'number' ? 'Give the numbers and show your working…' : 'Your answer, in your own words…' });
      box.value = q.answer || '';
    }
    const p = per[q.id] = { seconds: 0, paste: 0, dirty: false, saving: false, el: box, status, focusedAt: 0, pasteNote: null };
    box.oninput = () => { p.dirty = true; status.textContent = 'Unsaved'; status.style.color = '#fbbf24'; refreshProgress(); refreshSaveState(); };
    box.onfocus = () => { p.focusedAt = Date.now(); };
    box.onblur = () => { if (p.focusedAt) { p.seconds += (Date.now() - p.focusedAt) / 1000; p.focusedAt = 0; } flush(q.id); };
    // written items: paste is BLOCKED and counted; number items: allowed (calculator output) but counted
    box.onpaste = (e) => { p.paste += 1; if (q.kind === 'short' || q.kind === 'long') { e.preventDefault(); if (p.pasteNote) { p.pasteNote.style.display = 'block'; } } };
  });

  function card(i) {
    const q = qs[i]; const p = per[q.id];
    const kindLabel = q.kind === 'mcq' ? 'Multiple choice' : q.kind === 'number' ? 'Arithmetic — show your numbers' : q.kind === 'short' ? 'Short answer' : 'Written answer';
    const pillS = 'display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;font-size:.72rem;font-weight:800;background:rgba(255,255,255,.06);border:1px solid rgba(130,165,225,.2);color:#cfe0f2';
    const tSpent = h('span', { style: pillS + ';margin-left:auto;color:#94a3b8' }, '');
    const tick2 = setInterval(() => { if (!document.body.contains(tSpent)) { clearInterval(tick2); return; } tSpent.textContent = '⏱ ' + mmss(spent(p)) + ' on this question'; }, 1000);
    tSpent.textContent = '⏱ ' + mmss(spent(p)) + ' on this question';
    let answerUi;
    if (q.kind === 'mcq' && Array.isArray(q.options)) {
      const paintOpts = () => mount(answerUi, q.options.map((o) => { const on = String(p.el.value || '').toUpperCase() === String(o.k).toUpperCase(); return h('button', { type: 'button', onClick: () => { p.el.value = o.k; p.el.oninput(); p.seconds += 1; flush(q.id); paintOpts(); },
        style: 'display:flex;gap:11px;align-items:flex-start;width:100%;text-align:left;border-radius:12px;padding:12px 14px;margin-top:9px;font:inherit;font-size:.93rem;line-height:1.55;cursor:pointer;color:#e6edf8;background:' + (on ? 'rgba(8,131,247,.14)' : 'rgba(255,255,255,.03)') + ';border:1.5px solid ' + (on ? '#0883F7' : 'rgba(130,165,225,.2)') }, [
        h('span', { style: 'width:24px;height:24px;border-radius:7px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:.78rem;background:' + (on ? '#0883F7' : 'rgba(255,255,255,.08)') + ';color:#fff' }, o.k), h('span', null, o.text)]); }));
      answerUi = h('div'); paintOpts();
    } else {
      p.pasteNote = h('div', { style: 'display:none;margin-top:8px;padding:9px 12px;border-radius:10px;background:rgba(251,146,60,.1);border:1px solid rgba(251,146,60,.35);color:#fdba74;font-size:.82rem;line-height:1.6' }, 'Pasting is off on written questions — we want your words, not a search result. The paste was counted.');
      answerUi = h('div', null, [p.el, p.pasteNote, h('div', { style: 'display:flex;justify-content:space-between;margin-top:5px' }, [
        h('span', { class: 'cp-row-s', style: 'color:#64748b' }, q.kind === 'number' ? 'Numbers are scored automatically with a tolerance — write the values clearly (e.g. $2.13/mi, $752.23).' : (q.kind === 'long' ? 'A strong answer here is usually 120–250 words. Specific beats long.' : 'Two or three precise sentences are enough.')), p.status])]);
    }
    const flagBtn = h('button', { type: 'button', class: 'cp-btn cp-btn-sm ghost', onClick: () => { if (flagged.has(q.id)) flagged.delete(q.id); else flagged.add(q.id); refreshProgress(); show(i); } }, flagged.has(q.id) ? '⚑ Flagged' : '⚑ Flag for review');
    const last = i === qs.length - 1;
    return h('div', { style: CARD + ';padding:0;overflow:hidden' }, [
      h('div', { style: 'padding:18px 22px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
        h('span', { style: pillS + ';background:rgba(252,83,5,.14);border-color:rgba(252,83,5,.4);color:#ffb27a' }, 'Question ' + (i + 1) + ' of ' + qs.length),
        h('span', { style: pillS }, kindLabel), h('span', { style: pillS }, q.max_points + ' pts'),
        q.suggested_minutes ? h('span', { style: pillS }, '~' + q.suggested_minutes + ' min') : null, tSpent]),
      h('div', { style: 'padding:12px 22px 0;color:#fff;font-size:1.05rem;line-height:1.55;font-weight:700;white-space:pre-wrap' }, q.prompt),
      q.context ? h('div', { style: 'margin:14px 22px 0;border-radius:13px;background:#07131f;border:1px solid rgba(130,165,225,.25);padding:42px 16px 14px;color:#cfe0f2;font:.83rem/1.75 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;position:relative' }, [
        h('span', { style: 'position:absolute;top:10px;left:14px;background:#FC5305;color:#fff;font:900 .62rem/1 inherit;letter-spacing:.09em;padding:5px 8px;border-radius:6px' }, 'READ THIS FIRST'), q.context]) : null,
      q.hint && q.kind !== 'mcq' ? h('div', { class: 'cp-row-s', style: 'padding:8px 22px 0;color:#94a3b8' }, q.hint) : null,
      h('div', { style: 'padding:14px 22px 0' }, answerUi),
      h('div', { style: 'display:flex;gap:10px;align-items:center;padding:14px 22px;margin-top:14px;border-top:1px solid rgba(130,165,225,.14);flex-wrap:wrap' }, [
        h('button', { type: 'button', class: 'cp-btn cp-btn-sm ghost', disabled: i === 0 ? '' : null, onClick: () => show(i - 1) }, '← Back'), flagBtn,
        h('span', { style: 'flex:1' }),
        last ? h('button', { type: 'button', class: 'cp-btn cp-btn-sm', onClick: () => submit(false) }, 'Review & submit') : h('button', { type: 'button', class: 'cp-btn cp-btn-sm', onClick: () => show(i + 1) }, 'Next question →'),
      ]),
    ]);
  }
  function show(i) {
    if (i < 0 || i >= qs.length) return;
    // leaving a question: close its focus clock and save
    const prev = qs[cur]; if (prev && per[prev.id].focusedAt) { per[prev.id].seconds += (Date.now() - per[prev.id].focusedAt) / 1000; per[prev.id].focusedAt = 0; }
    if (prev) flush(prev.id);
    cur = i; refreshProgress();
    mount(qHost, card(i));
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) {}
    const q = qs[i]; if (q.kind !== 'mcq') { try { per[q.id].el.focus({ preventScroll: true }); } catch (_) {} }
  }

  const submitBtn = h('button', { class: 'cp-btn cp-btn-lg', onClick: () => submit(false) }, 'Submit my test');
  const navCard = h('div', { style: CARD }, [
    h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px' }, [h('div', { style: 'font-size:.72rem;font-weight:900;letter-spacing:.12em;color:#7cc0ff' }, 'QUESTIONS'), h('span', { class: 'cp-row-s', style: 'color:#94a3b8' }, 'green = answered · orange = flagged')]),
    navHost,
    h('div', { class: 'cp-row-s', style: 'margin-top:10px;line-height:1.6;color:#94a3b8' }, 'Move between questions freely. Everything saves as you type — if your connection drops, you come back to exactly where you were.'),
  ]);
  mount(host, h('div', null, [bar, qHost, navCard, h('div', { style: CARD + ';text-align:center' }, [
    h('div', { class: 'cp-row-s', style: 'margin-bottom:10px;line-height:1.7' }, 'Check your answers before you submit. Once submitted the test is closed and cannot be reopened.'), submitBtn])]));
  // resume where he left off: first unanswered question
  cur = Math.max(0, qs.findIndex((q) => !answered(q))); if (cur < 0) cur = 0;
  refreshProgress(); refreshSaveState(); mount(qHost, card(cur));

  // ---- clock: painted here, owned by the server. Every save re-syncs `remaining`.
  tick = setInterval(() => {
    // bl_disp_0309: if the SPA navigated away this host is gone — stop everything rather than run a
    // clock and a beforeunload prompt for a screen that is no longer on the page.
    if (!document.body.contains(host)) { cleanup(); return; }
    if (submitted) { cleanup(); return; }
    const left = secsLeft();
    timerEl.textContent = mmss(left);
    if (left <= 300) { timerWrap.style.background = 'rgba(248,113,113,.16)'; timerWrap.style.borderColor = 'rgba(248,113,113,.5)'; }
    if (left === 0) { clearInterval(tick); submit(true); }
  }, 1000);

  // ---- periodic flush so a dropped connection loses seconds, not answers
  saver = setInterval(() => { if (submitted || !document.body.contains(host)) { cleanup(); return; } flushAll(); }, 20000);

  // ---- integrity telemetry: counted, reported, never used to block
  onHide = async () => {
    if (document.visibilityState === 'hidden') { state.blur += 1; state.awaySince = Date.now(); return; }
    if (state.awaySince) { state.away += (Date.now() - state.awaySince) / 1000; state.awaySince = 0; }
    if (submitted) return;
    await flushAll();
    // Re-anchor from the server even when nothing was dirty: a save is what normally corrects the
    // clock, and someone who left the tab for ten minutes and typed nothing would otherwise come back
    // to a clock that is minutes fast and be cut off without warning.
    const fresh = await dispatcherTestMy().catch(() => null);
    if (!fresh || fresh.error) return;
    if (fresh.state !== 'in_progress') { reload(); return; }
    anchor(fresh.remaining);
    timerEl.textContent = mmss(secsLeft());
  };
  document.addEventListener('visibilitychange', onHide);
  onLeave = (e) => { if (!submitted) { flushAll(); e.preventDefault(); e.returnValue = ''; return ''; } };
  window.addEventListener('beforeunload', onLeave);
  host._lbTestCleanup = cleanup;
}

// ---------------------------------------------------------------- entry point
export async function mountSkillsTest(host) {
  try { if (host._lbTestCleanup) host._lbTestCleanup(); } catch (_) {}
  host._lbTestCleanup = null;
  mount(host, h('div', { class: 'cp-muted' }, 'Opening your test…'));
  let d = null;
  try { d = await dispatcherTestMy(); } catch (e) { d = { error: (e && e.message) || 'could not load the test' }; }
  if (!d || d.error) {
    mount(host, h('div', { style: CARD }, h('div', { class: 'cp-row-s' }, 'Could not open the test (' + ((d && d.error) || 'unknown error') + '). Pull to refresh and try again.')));
    return;
  }
  const again = () => mountSkillsTest(host);
  if (d.state === 'invited') return briefing(host, d, again);
  if (d.state === 'in_progress') return live(host, d, again);
  if (d.state === 'submitted' || d.state === 'scored') return receipt(host, d);
  return dead(host, d);
}

export default { mountSkillsTest };
