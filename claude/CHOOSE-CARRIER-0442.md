# Choose your carrier — the Carrier Fleet Book inside the dispatcher portal (bl_disp_0442)

**Status (25 Sep 2026):** migration applied to **STAGING** (`snslhvmkjusozgjelghi`) and the rollback test
passes there (8 checks, ends ROLLBACK-OK). **NOT on prod yet** — owner tests staging first, then prod.

## What changed, in one paragraph

Until now a candidate who passed the skills test got a hand-built PDF ("LoadBoot · Carrier Fleet Book")
by e-mail and replied with the carrier they wanted; LoadBoot then moved them to trial and assigned the
carrier by hand. Now: the moment the pass is released (the same stamp that shows the verdict in the
portal), a **Choose your carrier** tab opens in `/app/agent/`. It lists every available carrier with the
depth of the book (trucks + specs, loading gear, preferences + floor, FMCSA authority age, cargo, timeline,
NULL / CONFIRM items for the first call). Carriers whose equipment the candidate said they can manage come
first as **exact match**; with none the banner says *"No exact match with your profile — but you can still
choose from the following available carriers"*; with every carrier assigned it says none is open. Choosing
puts the carrier on hold, sends CC an in-app card + e-mail, and the candidate a receipt. In CC, **Accept =
trial terms + SOP + assignment in one step**; **Decline** frees the carrier and tells the candidate to choose
again. The test-passed e-mail now points at the portal instead of "a coordinator will reach out".

## Files

| Layer | File | What |
|---|---|---|
| DB | `migrations/bl_disp_0442_choose_your_carrier.sql` | table `app_private.dispatcher_carrier_choices`; helpers (`disp_equip_norm/class/label`, `disp_carrier_equipment`, `disp_dispatcher_equipment`, `disp_choice_match`, `disp_carrier_available`, `disp_choice_eligibility`, `disp_carrier_book`); public RPCs `dispatcher_carrier_options`, `dispatcher_choose_carrier`, `dispatcher_withdraw_choice`, `cc_dispatcher_choices`, `cc_dispatcher_choice_decide`; 3 catalog rows; `disp_test_pass_email` copy |
| Test | `tests/bl_disp_0442_rollback_test.sql` | run on staging after the migration; ends ROLLBACK-OK |
| API | `app/shared/api.js` | 5 wrappers (`dispatcherCarrierOptions`, `dispatcherChooseCarrier`, `dispatcherWithdrawChoice`, `ccDispatcherChoices`, `ccDispatcherChoiceDecide`) |
| Portal | `app/agent/choose-carrier.js` (new) | the tab: hero + KPIs, match banner, carrier cards, the full **Fleet Book** sheet, choose dialog, pending card with withdraw, history |
| Portal | `app/carrier/app.js` | `skills_test` → chooser first, test result one tab over; `trial`/`verified` with no carrier → chooser above the workspace |
| CC | `app/command-center/views/dispatchers.js` | queue triage cell **Carrier choices** + list → "Decide" opens the 360 |
| CC | `app/command-center/views/dispatcher-360.js` | **Carrier choice waiting** card (overview + Carriers tab): Accept (terms → SOP → one call) / Decline (reason → candidate e-mailed) |

## Rules baked in (owner decisions, 25 Sep 2026)

- **Available** = `organizations.kind='carrier'`, status active, `is_demo=false`, `carrier_onboarding.stage='approved'`,
  no `dispatcher_assignments` row in `active`/`paused`, and not on hold (`pending` choice) for another candidate.
- **Eligible** = `dispatcher_profiles.status='skills_test'` with a pass whose `passed_email_at` is set, OR
  `trial`/`verified` with no assignment. One pending choice per candidate, one hold per carrier (partial unique indexes).
- **Match** (equipment normalised: "BOX"/"Box truck" → box truck, "gooseneck flatbed" → hotshot, "Van" → dry van …):
  `exact` = the candidate can manage everything the carrier runs · `partial` = some · `related` = same class
  (open deck / van / reefer / power only) · `unknown` = carrier has no equipment on file · `none`. Sort: exact →
  partial → related → unknown → none, then by approval date (waiting longest first).
- **Before assignment the candidate does NOT see** owner/driver names, phones, e-mails, MC/DOT dockets,
  documents, bank/factoring. Those still arrive with `dispatcher.assigned.brief` after Accept. Carriers on hold
  for another candidate are not listed and not counted ("never tell a candidate how many carriers LoadBoot has").
- Accept is atomic: if `cc_dispatcher_assign` fails, the trial transition rolls back with it.
- E-mails: `dispatcher.carrier.chosen` (S, staff_internal → dispatch@ via `disp_contact()`),
  `dispatcher.carrier.chosen.receipt` (T, account_critical), `dispatcher.carrier.declined` (T, account_critical).
  All use `{{contact_inline}}`; no number is hard-coded (the test asserts it).
- Anon SECURITY DEFINER surface: unchanged. Staging reads 33 names after apply — the 33rd is
  `get_public_site_facts` (market-data work, not this migration); `retell_inbound` is prod-only. None of the
  five new RPCs is anon-executable (test c8).

## Owner test on staging (localhost against the staging DB)

1. Pick a staging candidate: set `dispatcher_profiles.status='skills_test'` and give them a scored attempt with
   `decision='pass'` and `passed_email_at=now()` (or press **Passed** on a real submitted test in CC).
2. Make ≥1 carrier available: `carrier_onboarding.stage='approved'`, no active assignment, `is_demo=false`.
   Give it a truck with `equipment` set, and prefs (`min_rpm`, `preferred_equipment`) so the book has content.
3. Sign in as the candidate → `/app/agent/` → the **Choose your carrier** tab. Check: the exact-match banner,
   the card KPIs (payload / length / floor / radius), **Fleet book** sheet (Account · Preferences · Truck · Confirm
   on the first call · Timeline), **Choose this carrier** → note → receipt card.
4. CC → Dispatchers → queue cell **Carrier choices** → **Decide** → the 360 shows *Carrier choice waiting* →
   **Accept** (terms → SOP) → status `trial`, assignment created, trial + brief + carrier-intro e-mails queued
   (`app_private.message_deliveries`). Or **Decline** → candidate gets the e-mail and the tab re-opens.
5. Withdraw from the portal releases the carrier (staff card `dispatcher.carrier.withdrawn`).

Note: staging's contact switch is currently `phone` (the Riley line), so `{{contact_inline}}` expands to that
number on staging e-mails. Prod is `whatsapp`. Flip staging in CC if you want parity while testing.

## Prod apply (after the staging test)

1. `apply_migration` the file to `rwscphuhpjoudvljvmdk` (idempotent: `if not exists` / `create or replace` / `on conflict`).
2. Run the anon SECURITY DEFINER query from `docs/audit-2026-09/anon-secdef-baseline.md` — expect **34** names on prod: the staging 33 plus `retell_inbound` (prod-only). Verified 25 Sep 2026 pre-apply: prod reads exactly those 34; the diff vs staging is `retell_inbound` alone.
3. Compare `md5(pg_get_functiondef)` of the 15 functions between staging and prod.
4. Deploy the front-end (Netlify build from `main`).

## Open items / later

- 5 prod candidates already sit at `skills_test` with a released pass — they will see the tab immediately after
  the prod deploy. Decide whether to e-mail them (the new pass e-mail only fires for future passes).
- The CC "Move to trial" button still exists for candidates who never chose; unchanged.
- If the owner wants candidates to see driver names before assignment, flip `p_full` in
  `dispatcher_carrier_options` (one argument) — the book already carries the fields behind the flag.
