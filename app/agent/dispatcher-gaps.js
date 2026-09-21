// Dispatcher re-application gap gate (bl_disp_0378).
//
// A rejected dispatcher may re-apply (bl_disp_0318), but until now the re-application was the same
// blank form: nothing named WHY the application was closed, and nothing stopped the candidate from
// submitting the identical answers again — which is what kept happening.
//
// This turns the rejection reason into a checklist the candidate must clear before Submit will fire.
//   codes = dispatcher_profiles.reject_reasons — the reasons staff ticked in the CC reject dialog
//           (bl_disp_0378). When that is empty (every candidate rejected before 0368, or a reject
//           typed as a free-text note only) the codes are DERIVED from the answers on the closed
//           application and labelled "likely" — never presented as the team's words.
//
// Exports: REASONS (catalog — shared with the CC reject dialog), deriveReasons(prof), reapplyGate().

export const REASONS = [
  ['no_own_board', 'No usable load-board access / no loads booked independently'],
  ['board_unknown', 'Load-board access unclear — ask (legacy application)'],
  ['no_booking_proof', 'Cannot show loads booked independently'],
  ['experience', 'Not enough US dispatch experience'],
  ['english', 'English not strong enough for broker calls'],
  ['availability', 'Hours / US overlap too thin'],
  ['no_cv', 'CV / résumé missing or unreadable'],
  ['no_id', 'Government ID not provided'],
  ['inconsistent', 'Answers contradicted each other'],
  ['other', 'Other — see the note'],
];
export const REASON_LABEL = REASONS.reduce((m, r) => { m[r[0]] = r[1]; return m; }, {});

// Best-effort read of the CLOSED application. Never invents a reason the answers do not support;
// capped at 3 so the candidate gets a checklist, not a wall.
export function deriveReasons(prof) {
  const s = (prof && prof.skills) || {};
  // The subscription does NOT have to be in the candidate's own name — an employer's or a
  // carrier's login counts, as long as they can log in and book loads themselves (owner rule,
  // 21 Sep 2026). Only "none", "will buy before trial" and "still learning" are a gap.
  const own = Array.isArray(s.own_board_access) ? s.own_board_access : [];
  const hasBoard = ['own_paid', 'employer'].includes(s.board_status) || own.some((x) => /(own|employer) login/i.test(String(x)));
  const out = [];
  // Legacy applications (before bl_disp_0319) only ever asked about a board in the candidate's OWN
  // name — someone on an employer's login had to tick "No own access". We cannot conclude they have
  // no board, only that we never asked. board_unknown says so, and asks.
  const legacy = !s.board_status;
  if (!hasBoard) out.push(legacy && s.can_source_loads !== 'learning' ? 'board_unknown' : 'no_own_board');
  if (['basic', 'conversational'].includes(String(prof && prof.english_level || ''))) out.push('english');
  if (Number((prof && prof.years_exp) || 0) < 1) out.push('experience');
  if (!s.id_doc) out.push('no_id');
  if (!s.cv_doc) out.push('no_cv');
  if (s.availability_hours === '20-30' || !s.us_hours_overlap) out.push('availability');
  return out.slice(0, 3);
}

const INPUT = 'width:100%;margin-top:8px;background:rgba(2,8,20,.55);border:1px solid rgba(130,165,225,.28);border-radius:10px;padding:10px 12px;color:#e8eefb;font:inherit;font-size:.88rem';
const ACK = 'display:flex;gap:8px;align-items:flex-start;margin-top:9px;font-size:.84rem;color:#dbe6f6;line-height:1.55;cursor:pointer';

// form: getters onto the live application form, supplied by app/carrier/app.js.
//   { board, ownBoards, english, years, trucks, hours, overlap, note, cv, id, focus(key) }
export function reapplyGate({ h, prof, form }) {
  const explicit = (Array.isArray(prof && prof.reject_reasons) ? prof.reject_reasons : []).filter((c) => REASON_LABEL[c]);
  const derived = explicit.length ? [] : deriveReasons(prof);
  const codes = explicit.length ? explicit : derived;
  if (!codes.length) return null;

  const ta = (ph, min) => h('textarea', { style: INPUT + ';min-height:74px;resize:vertical', placeholder: ph, 'data-min': String(min) });
  const tx = (ph) => h('input', { type: 'text', style: INPUT, placeholder: ph });
  const cb = () => h('input', { type: 'checkbox', style: 'margin-top:3px;flex:none' });

  const boardWho = tx('Which board, and the login you use on it — e.g. "DAT — dispatch@acmecarrier.com"');
  const proof = ta('Two loads you booked yourself — lane, broker, month and the rate for each.', 60);
  const englishAck = cb();
  const accurateAck = cb();
  const reply = ta('What has changed since your last application? Answer the note above directly.', 120);

  const DEF = {
    board_unknown: {
      title: 'Which load board you can log into',
      what: 'When you applied, our form only asked about a board in your OWN name. It does not have to be — an employer’s or a carrier’s login is fine. Tell us which board, which login, and two loads you booked on it.',
      extra: h('div', null, [boardWho, proof]), key: 'board',
      test: () => ['own_paid', 'employer'].includes(form.board()) && form.ownBoards().length > 0
        && boardWho.value.trim().length >= 6 && proof.value.trim().length >= 60,
      fail: () => (!['own_paid', 'employer'].includes(form.board())
        ? 'Section 2: pick your own paid subscription, or an employer’s / carrier’s login you can use today.'
        : !form.ownBoards().length ? 'Section 2: tick which board(s) you can log into.'
          : boardWho.value.trim().length < 6 ? 'Name the board and the login you use on it.'
            : 'Describe two loads you sourced and booked yourself — lane, broker, month and rate.'),
    },
    no_own_board: {
      title: 'Load-board access, and loads you booked yourself',
      what: 'The subscription does not have to be in your name — an employer’s or a carrier’s login is fine — but you must be able to log in today and book loads yourself.',
      extra: h('div', null, [boardWho, proof]), key: 'board',
      test: () => ['own_paid', 'employer'].includes(form.board()) && form.ownBoards().length > 0
        && boardWho.value.trim().length >= 6 && proof.value.trim().length >= 60,
      fail: () => (!['own_paid', 'employer'].includes(form.board())
        ? 'Section 2: pick your own paid subscription, or an employer’s / carrier’s login you can use today.'
        : !form.ownBoards().length ? 'Section 2: tick which board(s) you can log into.'
          : boardWho.value.trim().length < 6 ? 'Name the board and the login you use on it.'
            : 'Describe two loads you sourced and booked yourself — lane, broker, month and rate.'),
    },
    no_booking_proof: {
      title: 'Loads you booked yourself',
      what: 'Name two real loads you sourced and booked on your own — lane, broker, month and rate.',
      extra: proof, key: 'proof',
      test: () => proof.value.trim().length >= 60,
      fail: () => 'Describe two loads you booked yourself (at least a couple of lines).',
    },
    experience: {
      title: 'US dispatch experience on the record',
      what: 'Fill years of US dispatch experience and the most trucks you have run, and use “Why should we hire you?” to name the carriers, lanes and results.',
      key: 'years',
      test: () => Number(form.years() || 0) >= 1 && Number(form.trucks() || 0) >= 1 && form.note().trim().length >= 200,
      fail: () => (Number(form.years() || 0) < 1 ? 'Enter your years of US dispatch experience (section 2).'
        : Number(form.trucks() || 0) < 1 ? 'Enter the most trucks you have managed at once (section 2).'
          : 'Section 3: “Why should we hire you?” needs real detail — carriers, lanes, brokers, results.'),
    },
    english: {
      title: 'English for broker calls',
      what: 'Your English level must be Professional or Fluent, and a recorded spoken broker role-play is part of the next round.',
      extra: h('label', { style: ACK }, [englishAck, 'I agree to a recorded spoken broker role-play before any trial.']),
      key: 'english',
      test: () => ['fluent', 'professional'].includes(form.english()) && englishAck.checked,
      fail: () => (['fluent', 'professional'].includes(form.english()) ? 'Tick the spoken role-play agreement above.'
        : 'Section 2: English level must be Professional or Fluent for this role.'),
    },
    availability: {
      title: 'Hours and US overlap',
      what: 'This seat needs 40+ hours a week and real overlap with US business hours.',
      key: 'hours',
      test: () => ['40-50', '50+'].includes(form.hours()) && !!form.overlap(),
      fail: () => (['40-50', '50+'].includes(form.hours()) ? 'Section 1: confirm you can overlap with US business hours.'
        : 'Section 1: hours available per week must be 40–50 or 50+.'),
    },
    no_cv: {
      title: 'A readable CV / résumé',
      what: 'Upload your CV again in section 3 — PDF or DOC, and make sure it opens.',
      key: 'cv',
      test: () => !!form.cv(),
      fail: () => 'Section 3: upload your CV / résumé.',
    },
    no_id: {
      title: 'Government photo ID',
      what: 'Upload a passport, national ID or driver’s licence in section 3. It is required this time, not optional.',
      key: 'id',
      test: () => !!form.id(),
      fail: () => 'Section 3: upload a government photo ID.',
    },
    inconsistent: {
      title: 'Answers that agree with each other',
      what: 'Your last application contradicted itself. Re-read every answer before you submit.',
      extra: h('label', { style: ACK }, [accurateAck, 'I have re-read every answer and each one is accurate and current.']),
      key: 'board',
      test: () => accurateAck.checked && !!form.board(),
      fail: () => (!form.board() ? 'Section 2: answer the load-board access question.' : 'Confirm you have re-read your answers.'),
    },
    other: {
      title: 'Answer the team’s note',
      what: 'The note on your closed application is above. Say what has changed since.',
      extra: reply, key: 'reply',
      test: () => reply.value.trim().length >= 120,
      fail: () => 'Write a proper answer to the team’s note (a few sentences).',
    },
  };

  // no_own_board already carries the booking proof — a second row would re-mount the same node.
  if (codes.includes('no_own_board') && codes.includes('board_unknown')) { codes.splice(codes.indexOf('board_unknown'), 1); }
  if (codes.includes('no_own_board') || codes.includes('board_unknown')) { const i = codes.indexOf('no_booking_proof'); if (i >= 0) codes.splice(i, 1); }
  const rows = codes.map((c) => {
    const g = DEF[c]; if (!g) return null;
    const chip = h('span', { style: 'flex:none;width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:900;font-size:.78rem;border:1.5px solid rgba(252,83,5,.55);background:rgba(252,83,5,.12);color:#fdba74' }, '!');
    const node = h('div', { style: 'border-radius:14px;padding:13px 14px;margin-top:9px;background:rgba(2,8,20,.35);border:1px solid rgba(130,165,225,.18)' }, [
      h('div', { style: 'display:flex;gap:10px;align-items:flex-start' }, [chip, h('div', { style: 'flex:1;min-width:0' }, [
        h('div', { style: 'font-weight:850;color:#fff;font-size:.94rem;line-height:1.35' }, g.title),
        h('div', { class: 'cp-row-s', style: 'margin-top:3px;line-height:1.6' }, g.what),
      ])]),
      g.extra || '',
    ]);
    return { code: c, g, chip, node };
  }).filter(Boolean);

  const counter = h('div', { style: 'font-size:.78rem;font-weight:900;letter-spacing:.06em;color:#fdba74;margin-top:10px' }, '');

  const refresh = () => {
    let done = 0;
    rows.forEach((r) => {
      let ok = false; try { ok = !!r.g.test(); } catch (_) { ok = false; }
      if (ok) done++;
      r.chip.textContent = ok ? '✓' : '!';
      r.chip.style.borderColor = ok ? 'rgba(74,222,128,.6)' : 'rgba(252,83,5,.55)';
      r.chip.style.background = ok ? 'rgba(34,197,94,.14)' : 'rgba(252,83,5,.12)';
      r.chip.style.color = ok ? '#4ade80' : '#fdba74';
      r.node.style.borderColor = ok ? 'rgba(74,222,128,.32)' : 'rgba(130,165,225,.18)';
    });
    counter.textContent = done === rows.length ? '✓ ALL CLEAR — YOU CAN SUBMIT' : done + ' OF ' + rows.length + ' CLOSED';
    counter.style.color = done === rows.length ? '#4ade80' : '#fdba74';
    return done === rows.length;
  };

  // first unmet gap, or null when everything is closed
  const check = () => {
    for (const r of rows) {
      let ok = false; try { ok = !!r.g.test(); } catch (_) { ok = false; }
      if (!ok) { try { r.node.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {} return { code: r.code, msg: r.g.fail(), key: r.g.key }; }
    }
    return null;
  };

  const note = (prof && prof.review_note) ? h('div', { style: 'margin-top:10px;border-radius:12px;padding:11px 13px;background:rgba(2,8,20,.45);border-left:3px solid rgba(252,83,5,.75);font-size:.86rem;color:#dbe6f6;line-height:1.65;white-space:pre-wrap' }, 'Note from the team: ' + prof.review_note) : '';

  const node = h('div', { style: 'border-radius:20px;padding:20px 20px 18px;margin-bottom:14px;background:linear-gradient(150deg,#1b1206 0%,#14223c 58%,#0b1f3d 100%);border:1.5px solid rgba(252,83,5,.5);box-shadow:0 18px 40px -26px rgba(252,83,5,.65)' }, [
    h('div', { style: 'font-size:.7rem;font-weight:900;letter-spacing:.14em;color:#ff9c66' }, 'RE-APPLICATION · CLOSE THESE BEFORE YOU SUBMIT'),
    h('div', { style: 'font-size:1.2rem;font-weight:900;color:#fff;margin:7px 0 4px;line-height:1.2' }, explicit.length ? 'Why your last application was closed' : 'What is most likely holding your application back'),
    h('div', { class: 'cp-row-s', style: 'line-height:1.65' }, explicit.length
      ? 'These are the exact reasons the team closed your last application. Submit stays locked until each one is closed — the same answers as last time will not be reviewed again.'
      : 'Your file does not carry a coded reason, so this is read from the answers on your closed application. Close each one before you submit — the same answers as last time will not be reviewed again.'),
    note,
    ...rows.map((r) => r.node),
    counter,
  ]);

  refresh();
  return { node, codes, explicit: explicit.length > 0, refresh, check,
    answers: () => ({ codes, explicit: explicit.length > 0, board_access: boardWho.value.trim() || null,
      booking_proof: proof.value.trim() || null, english_ack: !!englishAck.checked,
      accurate_ack: !!accurateAck.checked, reply: reply.value.trim() || null, closed_at: new Date().toISOString() }) };
}
