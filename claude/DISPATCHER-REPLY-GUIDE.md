# Replying to dispatcher candidates — what changed on 25 Sep 2026

For the session that drafts replies to dispatcher applicants / candidates. Read this before replying.
Source of truth: `claude/CHOOSE-CARRIER-0442.md`, `claude/CARRIER-REPORT-0443.md`, `migrations/bl_disp_0444_unassign_email.sql`.

## 1. The old way is gone

Until 25 Sep a candidate who passed the skills test got a hand-built **Carrier Fleet Book PDF** by e-mail and replied
with the carrier they wanted; LoadBoot then moved them to trial by hand. **Do not send fleet-book PDFs any more and do
not ask anyone to "reply with the carrier you want".** Everything happens in the portal now.

## 2. The new flow (what to tell a candidate)

1. **Pass the skills test** → the pass e-mail links to the portal. A tab **Choose your carrier** opens at
   https://loadboot.com/app/agent/#dashboard (sign in with the account they applied with).
2. The tab lists every carrier open for a dedicated dispatcher, with the full fleet book: equipment, trucks, payload,
   floor, radius, home state, the **age of the authority**, open gaps. Carriers matching the equipment they said they
   can manage are listed first.
3. **No carrier name, contact, MC/DOT or documents before LoadBoot accepts.** Carriers show as `Carrier 7F3A`. Never
   give a candidate a carrier's name, number or MC by e-mail before acceptance either.
4. Before the first choice they must read and tick the **contact rules** (below). Without the tick the choice is refused.
5. They choose one carrier. **Choosing does not reserve it** — other candidates may choose the same carrier.
   LoadBoot (Command Center) accepts one. The others get an automatic e-mail "your chosen carrier was assigned to
   another dispatcher — choose again", and the tab opens again for them.
6. On acceptance: paid trial starts (10 working days, commission per delivered load), trial terms e-mail + the full
   carrier brief (names, contacts, MC/DOT) arrive by e-mail, the carrier gets an intro.
7. They can **withdraw** a pending choice in the portal and pick another. One pending choice at a time.

## 3. Rules to repeat when relevant

- **Contact rule:** every contact with a carrier goes through LoadBoot channels only — the carrier's LoadBoot WhatsApp
  group, the LoadBoot line, the LoadBoot mailbox. Never a personal phone/WhatsApp/e-mail/social, never move a carrier,
  driver, broker or load off LoadBoot. Carriers can **Report a contact** in their portal; an upheld report =
  same-day suspension + **permanent block**, no reinstatement, no re-application.
- **How many carriers:** trial = **1 carrier** (the one they chose). After the trial LoadBoot may add up to
  **3 carriers / 5 trucks**, only with **3 delivered loads** and no carrier report. They never add a carrier themselves.
- **Pay:** unchanged — commission on delivered loads during the trial; the carrier is never charged for the dispatcher.

## 4. Ready answers

| They write | Answer |
|---|---|
| "Please send me the carrier / fleet book" | It is in your portal now: sign in → **Choose your carrier**. Every open carrier's full book is there. |
| "Which carrier is it? Name / MC?" | Names, contacts and MC/DOT are shared after LoadBoot confirms your choice — that protects the carrier. The book shows everything you need to decide. |
| "I chose one, what now?" | LoadBoot reviews it, usually within one working day. You get an e-mail either way. You can withdraw and pick another until then. |
| "It says my carrier went to someone else" | Several candidates can choose the same carrier; LoadBoot assigned it to another dispatcher. Your tab is open again — choose another. Nothing is held against you. |
| "No carrier is open / list is empty" | Every carrier currently has a dispatcher. We onboard carriers every week; the tab shows new ones the moment they open and you get an e-mail. |
| "Can I take 2–3 carriers?" | One during the trial. After it, LoadBoot can add up to 3 carriers / 5 trucks once you have 3 delivered loads and a clean record. |
| "Can I call the carrier directly / use my WhatsApp?" | No — LoadBoot channels only (group, LoadBoot line, LoadBoot mailbox). Anything else is a permanent block if reported. |
| "The Choose button does nothing" | They must tick the contact rules first; if still stuck, ask for a screenshot. |

## 5. Contact line and e-mails

- Point people to WhatsApp via the contact switch (currently **+1 (815) 365-1168**, https://wa.me/18153651168).
  **Never** give the Riley line (469) 253-7575.
- Any new e-mail LoadBoot sends goes through `app_private.email_catalog` (CLAUDE.md §6) — do not invent loose templates.
  Relevant keys: `dispatcher.test_passed`, `dispatcher.carrier.open`, `dispatcher.carrier.chosen.receipt`,
  `dispatcher.carrier.assigned_elsewhere`, `dispatcher.carrier.declined`, `dispatcher.unassigned`, `dispatcher.blocked`.

## 6. State on 25 Sep 2026 (evening)

- 6 candidates who passed before the tab existed were e-mailed "Choose your carrier — the tab is open"
  (Navjot Kaur, Aleena Nazir, Muhammad Raza, Gursewak Singh, Yusuf Madadov, Jugraj Singh). Expect replies like
  "I got the e-mail, what next?" → section 4.
- 6 carriers are open. David Thompson (trial) keeps **PICK N NETT** only; GABE LOGISTICS and MUNSTER LOGISTICS were
  unassigned under the trial rule and are open again. PICK N NETT's WhatsApp intro **failed** (number not on WhatsApp)
  — confirm with them by e-mail/phone.
