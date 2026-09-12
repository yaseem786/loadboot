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
// signals, not proof, and the 15-minute broker call is what actually exposes borrowed answers.
import { dispatcherTestMy, dispatcherTestStart, dispatcherTestSave, dispatcherTestSubmit } from '../shared/api.js';

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
    document.body.appendChild(back);
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

  mount(host, h('div', null, [
    hero('Your dispatcher skills test', 'LOADBOOT DISPATCH', 'Nine questions about real dispatch situations. It is the last step before a paid trial on a live carrier account.'),
    h('div', { style: CARD }, [
      factRow([
        [d.minutes + ' minutes', 'The clock starts when you press Start, and it runs on our server — closing this tab does not pause it.'],
        [d.question_count + ' questions', 'Rate maths, hours of service, paperwork, brokers, market and one written task.'],
        ['One attempt', 'Answers save as you type. You can move between questions freely until you submit.'],
      ]),
      h('div', { class: 'cp-row-s', style: 'margin-top:14px;line-height:1.8' }, [
        h('div', { style: 'font-weight:800;color:#fff;margin-bottom:4px' }, 'Before you start'),
        h('div', null, '· Give yourself a clear ' + d.minutes + ' minutes. There is no pause button.'),
        h('div', null, '· Answer in your own words. After this there is a 15-minute call where you negotiate a real load with us — that call makes borrowed answers obvious.'),
        h('div', null, '· If you do not know something, write “I don’t know”. An honest gap costs you far less than an answer you cannot defend.'),
        h('div', null, '· Show your working on the number questions. We score the reasoning, not just the figure.'),
      ]),
      d.start_by ? h('div', { style: 'margin-top:14px;padding:11px 14px;border-radius:10px;background:rgba(251,146,60,.1);border:1px solid rgba(251,146,60,.35);color:#fdba74;font-size:.85rem;line-height:1.6' },
        'This invitation expires in about ' + hoursLeft(d.start_by) + ' hours — by ' + whenET(d.start_by) + '. If it lapses, ask us for a new one.') : null,
      h('div', { style: 'margin-top:16px' }, go), msg,
    ]),
  ]));
}

function receipt(host, d) {
  mount(host, h('div', null, [
    hero('Test submitted', 'LOADBOOT DISPATCH', 'Thank you — your answers are with us.', 'rgba(74,222,128,.45)'),
    h('div', { style: CARD }, [
      h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, [
        h('span', { class: 'cp-pill', style: 'font-weight:800;color:#4ade80' }, '✓ Submitted'),
        d.submitted_at ? h('span', { class: 'cp-row-s' }, whenET(d.submitted_at)) : null,
      ]),
      h('div', { class: 'cp-row-s', style: 'margin-top:12px;line-height:1.8' }, [
        h('div', { style: 'font-weight:800;color:#fff;margin-bottom:4px' }, 'What happens next'),
        h('div', null, '1. We read every answer ourselves — this is not machine-marked.'),
        h('div', null, '2. If it looks right, we book a 15-minute call: you negotiate one real load, we play the broker.'),
        h('div', null, '3. After that call comes the paid trial on a live carrier account.'),
        h('div', { style: 'margin-top:8px;opacity:.85' }, 'You will hear from us by e-mail. Nothing else is needed from you right now.'),
      ]),
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
  const timerWrap = h('div', { style: 'display:flex;align-items:center;gap:9px;padding:9px 14px;border-radius:12px;background:rgba(8,131,247,.14);border:1px solid rgba(8,131,247,.4)' }, [
    h('span', { style: 'font-size:.7rem;font-weight:900;letter-spacing:.1em;color:#7cc0ff' }, 'TIME LEFT'), timerEl]);
  const progEl = h('span', { class: 'cp-row-s' }, '');
  const saveEl = h('span', { class: 'cp-row-s', style: 'color:#94a3b8' }, 'All answers saved');

  const bar = h('div', { style: 'position:sticky;top:0;z-index:40;margin:-4px -4px 14px;padding:12px 14px;border-radius:0 0 16px 16px;background:rgba(11,21,38,.96);backdrop-filter:blur(8px);border-bottom:1px solid rgba(130,165,225,.2);display:flex;gap:12px;align-items:center;flex-wrap:wrap' }, [
    h('div', { style: 'flex:1;min-width:160px' }, [
      h('div', { style: 'font-weight:900;color:#fff' }, 'Dispatcher skills test'),
      h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-top:2px' }, [progEl, saveEl]),
    ]),
    timerWrap,
  ]);

  const refreshProgress = () => {
    const total = (d.questions || []).length;
    const done = (d.questions || []).filter((q) => (per[q.id].el.value || '').trim()).length;
    progEl.textContent = done + ' of ' + total + ' answered';
  };
  const refreshSaveState = () => {
    const dirty = Object.values(per).some((p) => p.dirty || p.saving);
    saveEl.textContent = dirty ? 'Saving…' : 'All answers saved';
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
      const total = (d.questions || []).length;
      const done = (d.questions || []).filter((q) => (per[q.id].el.value || '').trim()).length;
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

  // ---- per-question cards, grouped by section
  const cards = []; let lastSection = null;
  (d.questions || []).forEach((q) => {
    if (q.section !== lastSection) {
      lastSection = q.section;
      cards.push(h('div', { style: 'margin:18px 0 6px;font-size:.72rem;font-weight:900;letter-spacing:.12em;color:#7cc0ff;text-transform:uppercase' }, q.section));
    }
    const status = h('span', { class: 'cp-row-s', style: 'color:#64748b' }, '');
    const box = h('textarea', {
      class: 'cp-in',
      style: 'min-height:' + (q.kind === 'long' ? 150 : q.kind === 'short' ? 96 : 72) + 'px;line-height:1.6',
      placeholder: q.kind === 'number' ? 'Give the numbers and show your working…' : 'Your answer…',
    });
    box.value = q.answer || '';
    const p = per[q.id] = { seconds: 0, paste: 0, dirty: false, saving: false, el: box, status, focusedAt: 0 };
    box.oninput = () => { p.dirty = true; status.textContent = 'Unsaved'; status.style.color = '#fbbf24'; refreshProgress(); refreshSaveState(); };
    box.onfocus = () => { p.focusedAt = Date.now(); };
    box.onblur = () => { if (p.focusedAt) { p.seconds += (Date.now() - p.focusedAt) / 1000; p.focusedAt = 0; } flush(q.id); };
    box.onpaste = () => { p.paste += 1; };

    cards.push(h('div', { style: CARD }, [
      h('div', { style: 'display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap' }, [
        h('div', { style: 'flex-shrink:0;width:28px;height:28px;border-radius:9px;background:rgba(8,131,247,.16);color:#7cc0ff;font-weight:900;display:flex;align-items:center;justify-content:center;font-size:.85rem' }, String(q.seq)),
        h('div', { style: 'flex:1;min-width:min(100%,220px)' }, [
          h('div', { style: 'color:#e6edf8;font-size:.97rem;line-height:1.65;font-weight:600' }, q.prompt),
          q.hint ? h('div', { class: 'cp-row-s', style: 'margin-top:4px;color:#94a3b8' }, q.hint) : null,
        ]),
        h('span', { class: 'cp-pill', style: 'flex-shrink:0;color:#94a3b8' }, q.max_points + ' pts'),
      ]),
      h('div', { style: 'margin-top:10px' }, box),
      h('div', { style: 'margin-top:5px;display:flex;justify-content:flex-end' }, status),
    ]));
  });

  const submitBtn = h('button', { class: 'cp-btn cp-btn-lg', onClick: () => submit(false) }, 'Submit my test');
  cards.push(h('div', { style: CARD + ';text-align:center' }, [
    h('div', { class: 'cp-row-s', style: 'margin-bottom:10px;line-height:1.7' }, 'Check your answers before you submit. Once submitted the test is closed and cannot be reopened.'),
    submitBtn,
  ]));

  mount(host, h('div', null, [bar].concat(cards)));
  refreshProgress(); refreshSaveState();

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
