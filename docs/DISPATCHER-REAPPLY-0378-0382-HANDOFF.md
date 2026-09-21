# Dispatcher re-application — bl_disp_0378 → 0382

Status at 21 Sep 2026. **Production DB is fully applied. 36 invitation e-mails are queued on prod.**
The site code is committed on `main` and waiting to be pushed.

## What this is

A rejected dispatcher applicant used to get a free-text note and a blank re-application form: nothing
named why they were closed, and nothing stopped them submitting the identical answers again. Now:

1. **Rejected status** is a premium panel — the decision, the team's note, the named points to close.
2. **CC reject dialog** collects machine-readable reason codes alongside the candidate-facing note.
3. **The re-application is gated** — one checklist row per reason, live state, and Submit refuses with
   the specific unmet gap. The form is pre-filled from the previous answers.
4. **Already-rejected applicants get one invitation e-mail** naming their own points and their own date.

## The rule that decides everything (owner, 21 Sep 2026)

The test is **how the candidate finds loads**, not whose name the load-board login is in.

- A load board counts — their own paid login **or** an employer's or a carrier's.
- Facebook / WhatsApp freight groups count. Brokers they already know count. Direct shippers count.
  Broker e-mail blasts count.
- Only **"Not yet — I have not sourced a load myself"** is a gap.
- To clear the gate they must also say **where exactly** (which board, group or brokers, and the login
  or handle) and name **two loads they sourced and booked themselves** (lane, broker, month, rate).

The application asks this directly: a multi-select in section 2 → `skills.sourcing_channels`.

## Reason codes

`board_unknown` · `no_own_board` · `no_booking_proof` · `experience` · `english` · `availability` ·
`no_cv` · `no_id` · `inconsistent` · `other`

The catalog lives in **three** places and must be changed in all three or a code is silently dropped:
`app/agent/dispatcher-gaps.js` (`REASONS`), `app_private.disp_gap_text()`, and the `c_codes`
validator inside `public.cc_dispatcher_set_reject_reasons()`.

**`board_unknown` exists for honesty.** Every applicant rejected before today answered the old form,
which only ever asked whether the board was in their *own* name — someone booking out of freight
groups or an employer's login had no way to say so. We cannot conclude they cannot source, only that
we never asked, so their e-mail asks. `no_own_board` (firmer) goes only to those whose own answer was
"still learning".

## Production state

| Thing | State |
|---|---|
| `bl_disp_0378` (reject_reasons + setter) | **applied** (owner) |
| `bl_disp_0379` (+0381, 0382 merged — invite e-mail) | **applied** 21 Sep |
| anon SECDEF surface | **33**, unchanged — both new functions are authenticated-only |
| Invitations queued | **36** in `app_private.message_deliveries`, `template_key = 'dispatcher.reapply_invite'` |
| Site code | committed on `main`, **push pending** |

**Two applicants were deliberately excluded from the send** and still have `reapply_invite_at = null`,
so they can be invited later if wanted:

- **Asim Latif** (`asimmr749@gmail.com`) — the co-founder's test account, taken off the roster 20 Sep.
- **Abdul Rafeh** (`aabdulrafeh85@gmail.com`) — the derivation finds no gap, so he would have received
  the generic fallback line. He was a real trial dispatcher and deserves a decision written by hand.

## Guards on the send

`status = 'rejected'` · under the 3-application limit · `reapply_invite_at` blocks a second
invitation · `cc_dispatcher_reapply_invite` is **dry by default** and sends nothing until
`p_dry => false`. `cc_dispatcher_decide` was deliberately left at three arguments, so the site deploy
and the migration can go in either order.

## Traps hit while building this (do not repeat)

- **`text[] || 'literal'`** in plpgsql parses the literal as an array and throws. Append
  `array['x']`. Caught on the first dry run.
- **`node --check` is not enough** — a half-written patch left a reference to a variable that did not
  exist and `node --check` passed it. Verify app JS with **esbuild**.
- A python patch script that `sys.exit()`s mid-loop writes **nothing**, so earlier replacements in the
  same run are lost silently. Check the file afterwards, not the script's output.
- The git index is shared with other sessions. A parallel session's commit swept three of these files
  into `8ff775c`; `c0efa03` is an empty commit that records what that actually contained.

## bl_disp_0383 — coded points in the rejection e-mail (21 Sep 2026, LIVE staging + prod)

`migrations/bl_disp_0383_reject_email_coded_points.sql`.

- New `app_private.disp_reject_point(code)` — the same nine codes as `disp_gap_text`, but phrased as a
  statement ("A CV we can open and read.") instead of a request ("please send us..."). `other` returns
  null on purpose: the staff note already carries it.
- `app_private.disp_reject_email` now reads `dispatcher_profiles.reject_reasons` and renders a
  **"What we were looking for"** block under the note, in both the HTML and the plain-text part.
  The CC calls `cc_dispatcher_set_reject_reasons` BEFORE `cc_dispatcher_decide('reject')`, so the
  codes are on the row by the time the e-mail is built.
- **Additive:** with no codes the e-mail is byte-identical to the old one (verified: 1992 chars, no
  block). With three codes it is 3090 chars.
- Verified on staging against the throwaway `agent@lb.test` profile inside one transaction — the
  queued `message_deliveries` row was deleted and the profile restored in the same block, so nothing
  was sent and nothing was left behind. `disp_reject_email` is now byte-identical on both databases.
- Prod anon-executable SECURITY DEFINER surface re-checked after apply: **33**, unchanged.

## Screening rule corrected in the CC (21 Sep 2026)

The old "must bring their own DAT / Truckstop login" wording drove screening from three places in the
Command Center. All three now state the current rule — the board may be in anyone's name, and the real
test is whether the applicant finds and books loads himself (any board login, Facebook/WhatsApp
freight groups, his own brokers, direct shippers):

- `app/command-center/views/dispatcher-360.js:651` — the red screening flag
- `app/command-center/views/dispatcher-360.js:795` — the Skills key/value row
- `app/command-center/views/dispatchers.js:457` — the roster drawer key/value row

`app/agent/dispatcher-gaps.js` already read the new rule and was left alone. The operating-model docs
("the dispatcher works on the carrier's own DAT/Truckstop seat") describe what happens AFTER hiring
and are a different rule — deliberately not touched. Verified with **esbuild**, not `node --check`.

## Open

- `python build_site.py` cannot be run on the owner's machine without `LOADBOOT_STAGING_ANON_KEY`.
- Replies arriving at `dispatch@` to the 36 invitations still need a follow-up pass.
