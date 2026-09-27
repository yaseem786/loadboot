# Carrier choices — own CC tab + Action Center item (bl_disp_0481, 27 Sep 2026)

**What changed.** A candidate's carrier choice (bl_disp_0442 — they pick a carrier from the Fleet Book in their
portal) used to be decidable only on that one candidate's Dispatcher 360 page, Carriers tab. Now:

1. **CC → Dispatchers & agents → Carrier choices** (`#/carrier-choices`, `app/command-center/views/carrierChoices.js`).
   Every pending choice across all candidates, oldest first. Each card: candidate (name → 360 deep link, status,
   equipment, years, skills-test score, boards, city/tz), carrier (name → carrier page, MC/DOT, equipment, trucks,
   home base, floor $/mi, still-available), match pill, "also chosen by N others", the candidate's note, and a
   plain-words line saying what Accept will ask for (terms first when the candidate is not yet on trial/verified/active).
   **Accept / Decline are on the card** and run the *same* functions as the 360 — `choiceAcceptFlow`,
   `choiceDeclineFlow`, `sopDrawer`, now exported from `views/dispatcher-360.js` (the 360's own `acceptChoice` /
   `declineChoice` / `editSop` are thin wrappers over them). "Decided recently" table underneath (last 40).
   `#/carrier-choices?id=<choice>` highlights + scrolls to that card.
2. **CC home (Action Center)**: KPI tile "Carrier choices" (count → the tab) and one "Carrier choice" row per pending
   choice in *Needs you now* (priority high, overdue after 48 h) linking to `#/carrier-choices?id=<choice>`.
   Migration extends `public.cc_action_center` (`choices_pending` + the `choice` queue rows) and
   `public.cc_dispatcher_choices` (+ `carrier.mc`, `carrier.dot`). Prod's `cc_action_center` also picks up the
   `task_type` field on task rows that staging already had (the UI's `DESK` links use it).
3. Dispatchers tab → triage strip → "Carrier choices" filter now carries a link to the dedicated screen.
4. Bell (`dispatcher.carrier.chosen`) still deep-links to the 360 Carriers tab — unchanged on purpose.

**Gate.** Migration `migrations/bl_disp_0481_carrier_choices_tab.sql` applied staging ✅ then prod ✅.
Anon SECURITY DEFINER surface: 35 staging / 36 prod, names compared against `docs/audit-2026-09/anon-secdef-baseline.md`
(md5 of the sorted name list identical before/after). ACL of both functions unchanged
(`postgres, authenticated, service_role`; no anon, no public).

**Not touched.** `cc_dispatcher_choice_decide` (the decision itself, e-mails, competing-choice handling) is exactly
bl_disp_0442. No new e-mail, no new brain tool.
