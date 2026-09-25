# Carrier report → permanent block, and the contact rule in both portals (bl_disp_0443)

Status 25 Sep 2026: **staging applied**, `tests/bl_disp_0443_rollback_test.sql` green (6 checks, ROLLBACK-OK),
`tests/bl_disp_0442_rollback_test.sql` re-run green with the 0442 revision. **NOT on prod** — goes with 0442 after the
owner's staging test. Front-end on `claude/serene-ptolemy-uk3hgy` (owner merges → main → Netlify).

## Owner decisions (25 Sep 2026)

1. **No identity before acceptance.** Until Command Center accepts the choice the candidate sees no company name, no
   contact, no MC/DOT — only the operation and the AGE of the authority. Label shown: `Carrier 7F3A` (stable, from the
   org id). Candidate-facing receipt / declined e-mails use the label; staff e-mails keep the real name. (0442 revision.)
2. **Terms in the dispatcher portal.** The contact rules (`app_private.disp_conduct_terms()`, v1-2026-09-25) are shown
   in full on the first "Choose this carrier" confirm and must be ticked; accepted once per version
   (`dispatcher_profiles.conduct_terms_accepted_at / _version`); `dispatcher_choose_carrier` refuses with
   `code=terms_required` otherwise. The rule is repeated: banner on the list, red block in the workspace carrier card,
   box in the trial e-mail (anchor patch on `disp_trial_email`).
3. **Warning + report in the carrier portal.** Dispatcher tab card "Protect yourself — one rule": the dispatcher reaches
   you only from the LoadBoot line + LoadBoot group; anything else → **Report a contact** (kind, channel, number seen,
   detail) → `public.carrier_report_dispatcher`; work outside LoadBoot channels is not covered. One line on the dashboard
   dispatcher card. Box in the carrier intro e-mail (anchor patch on `disp_assign_email_html`).
4. **CC decides.** Dispatchers queue cell **Carrier reports** → 360 card "Carrier report waiting" → **Uphold** (confirm +
   note) = `cc_dispatcher_report_decide(...,'uphold')`: status `suspended` + `blocked_at`, every assignment ended (carrier
   free), pending choice withdrawn, other open reports closed, `disp_offboard(...,'ended')` (line + mailbox + WA threads
   released, ONE offboard e-mail with the reason, carrier change e-mail), then the decision letter `dispatcher.blocked`
   and the carrier's `dispatcher.report.upheld`. `cc_dispatcher_decide` refuses reinstate/trial/verify/activate while
   `blocked_at` is set; `dispatcher_reapply` returns `reason=blocked`. **Dismiss** = `dispatcher.report.dismissed` to the
   carrier, nothing else changes. **Mark reviewing** = status only.
5. **E-mail the candidates who already passed.** `app_private.disp_choice_backfill_email()` — run by hand on prod AFTER
   the Netlify deploy (the tab must exist). Idempotent (`disppass.choose:<attempt>`). 6 candidates on 25 Sep.

6. **Capacity policy (§11, evening):** trial = **1** carrier (the chosen one); verified/active = up to **3 carriers / 5
   trucks**, added by LoadBoot only, and only with **3 delivered loads** on the current carrier(s) and **no open/upheld
   report**. Numbers live once in `app_private.disp_capacity_policy()`; the portal reads `public.dispatcher_capacity()`
   (card "How many carriers can you dispatch for?" on the chooser; a line in the workspace carrier card); CC enforcement is
   an anchor patch on `cc_dispatcher_assign` (also the path Accept takes). Existing assignments are untouched — David
   Thompson keeps his 3 unless CC unassigns.

## Files

| Layer | File |
|---|---|
| DB | `migrations/bl_disp_0442_choose_your_carrier.sql` (revised: §3b label + terms, book/options/choose/decide) · `migrations/bl_disp_0443_carrier_report_and_block.sql` |
| Tests | `tests/bl_disp_0442_rollback_test.sql` (c1/c1b/c2 extended) · `tests/bl_disp_0443_rollback_test.sql` |
| Dispatcher portal | `app/agent/choose-carrier.js` (label, terms block + tick, banner) · `app/agent/dispatcher-workspace.js` (contact-rule block in the carrier card) |
| Carrier portal | `app/carrier/dispatcher-desk.js` (Protect yourself card + report form) · `app/carrier/dispatcher-card.js` (one line) |
| CC | `app/command-center/views/dispatcher-360.js` (reportCards, decideReport, blocked card) · `views/dispatchers.js` (queue cell + list) |
| API | `app/shared/api.js` (dispatcherAcceptConductTerms, carrierReportDispatcher, ccDispatcherReports, ccDispatcherReportDecide) |

Catalog rows (rule §6): `dispatcher.report.staff` (S), `dispatcher.report.receipt` / `.upheld` / `.dismissed` (T carrier),
`dispatcher.blocked` (T dispatcher), `dispatcher.carrier.open` (T dispatcher, backfill). All `{{contact_inline}}`, no number.
Anon SECURITY DEFINER surface: unchanged (guard at the end of the migration; test c6).

## Owner test on staging — localhost against the staging DB

Fixture is SET on staging (25 Sep): `agent@lb.test` = `skills_test` with a released pass, terms not yet accepted; carriers
`cc000000…0001` (Dry Van + Reefer → partial) and `f2e3d0fa…` (Reefer → exact) approved + free. Staff: `owner@lb.test`.

```
cd C:\Users\HP\Documents\GitHub\loadboot
git pull
python build_site.py
start-servers.bat
```
Then:
1. http://localhost:8080/app/agent/ as `agent@lb.test` → **Choose your carrier**: cards say `Carrier XXXX` (no name), authority
   age in the badges, red "Contact rules apply" banner (Read the rules). **Choose this carrier** → the rules + tick box →
   receipt card. Withdraw → choose again (tick gone: already accepted).
2. http://localhost:8083/app/command-center/ as `owner@lb.test` → Dispatchers → **Carrier choices** → Decide → Accept
   (terms → SOP). Trial e-mail (`message_deliveries`, `dispatcher.trial.welcome`) has the box "Contact rule — permanent
   block"; carrier intro has "Protect yourself — one rule".
3. http://localhost:8080/app/carrier/ as the owner of the chosen carrier (e-mails in the session hand-off) → dashboard
   dispatcher card line → **Dispatcher** tab → card "Protect yourself — one rule" → **Report a contact** → send.
4. CC → Dispatchers → **Carrier reports** → Decide → 360 "Carrier report waiting" → **Dismiss** (carrier e-mailed) or
   **Uphold** → dispatcher `suspended`, "Permanently blocked" card, assignment ended, carrier free again; `Reinstate` refused.
5. Reset for another round: re-run the fixture block (it is in the session transcript / the 0442 test's fixture section).

## Prod apply (after the staging test)

1. `apply_migration` 0442 (full file) then 0443 to `rwscphuhpjoudvljvmdk`.
2. Anon SECURITY DEFINER names: expect the same **34** (staging 33 + `retell_inbound`).
3. md5 parity staging↔prod on 0442's 15 + 0443's functions.
4. Owner: merge → push → Netlify deploy from `main`.
5. `select app_private.disp_choice_backfill_email();` on prod (after the deploy) → expect `sent: 6`.
