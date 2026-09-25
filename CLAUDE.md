# Working agreement — LoadBoot

Read this before starting work in this repo. It is the owner's standing policy, not a
suggestion. Muhammad Yaseen builds LoadBoot alone; his usage limits are a real constraint
and his production system carries real carriers' money. Both matter, in that order of
difficulty: **save tokens everywhere it does not cost quality, and nowhere it does.**

---

## 0. Git branch rule (set 19 Sep 2026) — read before any commit

- **All work is committed on `main`.** Do NOT create or switch to feature branches
  (`feat/*`, `stripe-fee-billing`, `seo/*`, etc.) — those are all fully merged and retired.
- Never run `git checkout <branch>`. The working tree stays on `main`; the owner pushes
  from GitHub Desktop, and every session shares this one working tree.
- Commit only your own files (`git add <paths>`), never `git add -A`.
- If you truly need a branch (risky experiment), create it, merge it back to `main` the
  same session, and return to `main` before finishing.

---

## 1. Model routing — decide this yourself, do not ask

The owner does not want to choose models. Classify the work and route it. He is on the
Claude desktop app; the main-loop model is whatever he last set, and you cannot change it
from inside a session. What you CAN control is where the work actually happens — a
subagent's model is yours to pick, and that is where most of the saving lives.

### Keep on the main loop (the expensive one). Never delegate:

- Anything that writes to the production database, or decides a migration's shape
- Security: RLS, SECURITY DEFINER, RBAC, the anon-executable invariant
- Anything touching money — payouts, commissions, settlements, bank details
- Compliance and legal: FMCSA, IRS, Play/Apple policy, contracts
- Debugging a live outage
- Deciding what to build, and in what order
- Anything irreversible, or anything that emails or calls a real customer

The main loop is where judgement happens. Downgrading it is where quality dies, and one
bad production migration costs more than a month of saved tokens.

### Delegate to a `fable` or `haiku` subagent — mechanical, verifiable, low-judgement:

- Grepping the repo; import/export audits; "which files reference X"
- Reading long logs and returning only the matching lines
- Image work: padding, resizing, format conversion, screenshot prep
- Bulk find-and-replace where the pattern is already decided
- Summarising a long document you will then check
- Fetching and extracting facts from documentation pages

### Delegate to a `sonnet` subagent — needs writing ability, not deep judgement:

- Blog article drafts (the weekly article task already does this: Fable-first, Opus-fallback)
- Outreach copy, email templates, store-listing text
- Documentation and changelog prose

**Rule of thumb:** if being wrong would be caught immediately by a build, a test, or your
own eyes — delegate it. If being wrong would only surface later, in production, or in
front of a carrier — do it yourself.

---

## 2. Session hygiene — you raise this, he should not have to

Every message resends the whole conversation, so a long session makes even a one-line
question expensive. The owner has agreed to start fresh sessions; he needs YOU to tell him
when.

**Say "ab session change kar lein" when any of these is true:**

- The topic changes materially (compliance work → app store work → sales follow-up)
- A milestone is done and the next piece does not need this one's context
- You have pulled several large dumps (full function bodies, whole files, long logs)
- Roughly two hours of working time has passed

**When you say it, hand off properly** — a short note in the same message:
what was finished, what is in flight, the exact next step, and any ids/paths needed. He
pastes that into the new session. Never make him reconstruct context from memory.

---

## 3. Cheap habits that cost nothing in quality

- **Never** `select pg_get_functiondef(...)` in full when you only need a few lines. Use
  `unnest(string_to_array(pg_get_functiondef(oid), E'\n'))` and filter. Ten times cheaper.
- Read file ranges, not whole files. Grep first, then read around the hit.
- Batch independent tool calls into one message — they run in parallel and cost less.
- Patch production functions by reading their current definition and replacing one anchor
  string, rather than retyping them. Cheaper AND safer.
- Do not re-read a file you just edited to check it. The edit tool would have errored.

---

## 4. Non-negotiables

- **The anon-executable SECURITY DEFINER surface in `public` is 34 on prod** (33 on staging; the
  two differ only by `retell_inbound`). It was 33/32 until 25 Sep 2026, when `bl_mkt_0442` added
  `get_public_site_facts` (the public-site build's registry read, same reason as `get_public_market_rates`). Check it after every migration and **compare the NAMES, not just the
  count** - two changes that cancel out leave the count unmoved. The full list, what each name
  is for, and the query are in `docs/audit-2026-09/anon-secdef-baseline.md`. If a name appears
  that is not on that list, something opened a door. (This said "27" until 9 Sep 2026; neither
  database had read 27 for some time, and a stale number is worse than none - it gets ignored.)
  **Every new `public` function gets an explicit `anon=X` from Supabase's default ACL at creation** -
  `revoke ... from public` does not remove it. A migration that creates a `public` function must
  `revoke execute on function ... from public, anon` explicitly (six investor-lane functions slipped
  through this way on 24 Sep 2026; `bl_sec_0436` closed them).
- Never run a diagnostic against a live customer account. A probe against a real agent
  once fired a real "your payout was approved" notification that could not be recalled.
- Never enter his identity documents, payment details, API keys or passwords into any
  form. Prepare the exact values for him to type himself.
- Test destructive paths on a throwaway record, then clean it up. Two real bugs — a
  missing `expired` status and a warning ladder that fired on day one — were caught this
  way and would otherwise have failed silently in production for weeks.
- Demo/store-review accounts (`play.*@loadboot.com`, `organizations.is_demo`) must never
  become visible to real carriers. The isolation is symmetric and fail-closed; keep it so.

---

## 5. How he writes, and how to answer

Roman Urdu mixed with English. Match it. Be direct — he would rather be told a thing is
wrong than be managed. When you are guessing, say you are guessing; he has asked before
whether an answer was searched or assumed, and he was right to.

---

## 6. Email rule — every email lives in the catalog (set 22 Sep 2026)

There is now one registry for every email LoadBoot can send: `app_private.email_catalog`
(behind Command Center → CRM & outreach → **Email catalog**, `#/email-catalog`).

**When the owner asks for a new email — a reminder, a notice, a nudge, anything that
leaves the system — it is created THROUGH the catalog, never as a loose template or a
hard-coded `sys_email` call with a brand-new key nobody registered.** In practice:

1. Pick a key in the existing convention (`area.thing`, lower case, dots — never a new
   underscore family) and check `email_catalog` first so you are not re-inventing a key
   that already exists (`document.reviewed.valid`, not `document.reviewed`).
2. Give it a row: name, purpose, class (T/O/P/M/S), audience, trigger type + the exact
   function that fires it, cadence, cap, stop condition, preference group, unsub allowed,
   and the CC deep link where it belongs. `public.cc_email_template_new(...)` does the
   template and the catalog row in one step; a code-fired email gets its row in the
   migration that adds the sender.
3. `app_private.sys_email` reads the catalog at send time: the category, the preference
   group it must honour, and any active override. A key that is not in the catalog is
   filed as `undocumented` on first use and shows up in the CC screen — that is a bug to
   fix, not a normal state.
4. Preference groups are the only opt-out mechanism. `account_critical` and
   `staff_internal` can never be blocked; everything else must be opt-out-able —
   except billing notices about the person's own money (`billing` group with
   `unsub_allowed=false`: invoices, receipts, settlement and dispute notices), which
   always send (owner decision, 22 Sep 2026, `bl_comm_0402`). Billing *reminders* stay
   opt-out-able.

Docs: `claude/EMAIL-AUDIT-0391.md` (the audit) and `claude/EMAIL-CATALOG-PROD-0395.md`
(what is live, and what is left).

5. **Unsubscribes are law (set 25 Sep 2026, `bl_comm_0446`).** Before ANY email is sent by hand —
   the owner asks you to email someone, a one-off `sys_email`, a test send, an outreach draft — run
   `select public.cc_email_can_send('<address>', '<catalog key>')` (or open CC → Unsubscribes → "Can I
   send this?"). If `allowed` is false, do not send and do not look for another route: tell the owner
   the `reason` sentence verbatim (it names the category, the date, the route they used and what they
   said). `app_private.sys_email` refuses the same way at send time and files it in `email_blocked_log`,
   so a send that "went through" but never arrived is visible in CC → Unsubscribes → Blocked sends.
   Essential mail (account & security, billing notices, staff alerts) is the only thing that passes.
   Every unsubscribe/resubscribe, by any route, is written ONLY through `app_private.unsub_apply` —
   never insert into `suppressions`, `email_pref_optouts` or `comm_preferences` by hand. Doc:
   `claude/UNSUBSCRIBE-ENGINE-0446.md`.

---

## 7. Contact line — WhatsApp through the ONE switch, never the Riley phone (set 24 Sep 2026)

The owner does not want the Retell/"Riley" line **+1 (469) 253-7575** shown to customers as the way to
reach LoadBoot. Every email, template, CC screen and popup must use the contact switch instead:

- Source of truth: `app_private.contact_channel` (CC contact-channel toggle; read with
  `public.lb_contact_channel()`). On 24 Sep 2026 it is `whatsapp` = **+1 (815) 365-1168**,
  link **https://wa.me/18153651168** (the Telnyx WhatsApp number).
- In SQL-built emails write the tokens, never a number: `{{contact_inline}}`, `{{contact_sig}}`,
  `{{whatsapp_url}}`, `{{whatsapp_display}}`. `app_private.contact_expand` fills them at send time
  (`sys_email`, `outreach_prepare`), so flipping the switch changes every email with no deploy.
- The `delivery-worker` footer (v18, `bl_comm_0438`) already follows the switch: WhatsApp line +
  "Open WhatsApp" link when the channel is `whatsapp`, the call line only when it is `phone`/`both`.
- Before shipping any new email, grep it for `253-7575` / `2537575`. The only allowed exceptions:
  SMS START/STOP instructions (they must name the SMS number) and Riley's own caller id.

## 8. Command Center popups — one component (set 24 Sep 2026)

Every CC popup is `openDrawer()` in `app/shared/ui/components.js` — a centred premium dialog on
desktop and a bottom sheet on phones (`bl_ui_0439`). Do not build a new side drawer or a hand-rolled
`position:fixed` overlay. Pass `size: 'sm'` for confirmations, `'lg'` for wide tables (5+ columns
auto-upgrade to `lg`). Esc closes it and the page behind does not scroll.
