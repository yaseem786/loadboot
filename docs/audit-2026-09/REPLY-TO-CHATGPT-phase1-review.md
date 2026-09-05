# Reply to ChatGPT — Phase 1 review, answers, and scoped GO for Sprint 1

> Paste everything below the line into ChatGPT. Items marked **[YASEEN: …]** are for you to fill or delete before pasting — I did not invent them.

---

Phase 1 reviewed. Good work on evidence discipline and UNKNOWN handling — that is exactly the standard I want. Two of your P0s were independently re-verified by me on production (read-only) and are confirmed:

- **F01 confirmed.** `lb_email_load_ingest(jsonb)`, `lb_email_ping_confirm_by_email(text,jsonb)`, `lb_email_reply_merge(text,jsonb)` are all `SECURITY DEFINER`, grant EXECUTE to `authenticated`, and contain no `auth.uid()` / role / service_role check.
- **F02 confirmed.** `supabase/functions/domain-check/index.ts:45` accepts any `Authorization` header that starts with `Bearer ey`.

## Corrections to your findings

1. **F03 is not a conflict — reclassify it.** My rule is: no AI sends a *one-off, personal* carrier- or broker-facing message; I send those myself. The broker outreach engine (`outreach.broker-d1…d7`) is approved *platform* email with templates I signed off. Do **not** pause it and do not propose a draft-only queue for it. What IS valid in F03: the Resend quota point. Keep that as a P1: measure actual daily volume against the real plan (see Q6) and make sure transactional mail (document decisions, codes, load offers) is never starved by outreach.
2. **Add a finding you could not see without prod data: automated checks did not run for a real signup.** Carrier GABE LOGISTICS LLC (org `f89c1bd0-…`, signed up 4 Sep) has **no row in `app_private.carrier_verifications`** and `documents.ai_verdict IS NULL` on all three uploads. Reviewing had to be done by hand. Treat as P1 in Sprint 2 ("reliable transaction"): find why `fmcsa-verify` / the AI doc check did not fire on signup/upload, and make the failure visible in CC instead of silent.
3. **Add a finding: one CC review = one email per item.** Each Approve/Reject on a compliance item fires `document.reviewed.valid/rejected` immediately. Reviewing four items sent the carrier four emails in two minutes, then a fifth hand-written summary. Propose: batch decisions made within N minutes into ONE digest email per carrier (or a "send decisions" button), keeping the per-item audit rows. P1, Sprint 2 or 3.
4. **Add to the COI review path: tamper detection.** We have already caught one carrier who photoshopped the certificate-holder box (multiple `%%EOF` markers, `AppendMode`, ModDate = upload evening). Automate the cheap checks (`%%EOF` count > 1, incremental-update markers, Creator/Producer mismatch, ModDate within hours of upload) and surface a "possible edit" flag to the reviewer — never auto-reject on it. P1, Sprint 2.
5. **Certificate-holder standard is decided:** every carrier COI must name **LoadBoot LLC, 30 N Gould St Ste N, Sheridan, WY 82801** as Certificate Holder. A COI with the carrier as its own holder is rejected as "revision required — certificate holder", never worded as a coverage problem. The portal already has a copy-the-address block on the insurance row; make sure the reject email and the Documents wizard say the same thing.
6. **W-9 standard is decided:** a single-member LLC marked "P = Partnership" is a reject (disregarded entity → "Individual/sole proprietor or single-member LLC", or C/S only with a corporate election). Add a soft pre-check in `w9-form.js`: if `truck_count = 1` and owner-drives, warn before allowing "P".
7. **Wedge section: accepted as an experiment, not a moat.** Fine. But do not let it soften the rest — Sprints 1–2 are about making the existing engine trustworthy for the carriers we already have. The wedge pilot (Sprint 4) is gated on Sprint 2 passing.

## Answers to your ten questions

1. **Outreach engine:** keep enabled (see correction 1). Do not change its schedule. Only fix: quota-aware sending order (transactional first).
2. **Licensed counterparty:** LoadBoot has **no broker authority** and never accepts freight itself. Shipper quote requests are routed to partner brokers on the platform; the partner broker is the contracting party with the shipper, and the carrier is appointed by that broker. LoadBoot is a dispatch service for the carrier. **[YASEEN: confirm this is exactly how you want it stated, and whether LoadBoot ever picks between two of its own carriers for one load.]** A transportation-attorney review is planned but deferred; until then make every page say the same thing (F04/F12/F13 copy alignment is approved for Sprint 2 as copy-only, no agreement changes).
3. **Fee:** 5% of gross linehaul on loads booked through LoadBoot and delivered; FSC/lumper/detention/layover/TONU excluded; settlement Net-30 from delivery as published in the FAQ. Payment rail (Stripe/ACH) is **not decided** — do not build one. **[YASEEN: is the fee due after the carrier is paid, or on delivery regardless? Who invoices — LoadBoot to carrier, or deduction from settlement?]**
4. **First pilot lane/cohort — candidates on prod today:**
   - WARREN'S COURIER AGENCY (MC-99849375, Hinesville GA) — active, 5/5 verified, 2026 Hino 26-ft box truck, 10,000 lb, dock-high + liftgate, min $2.10/mi.
   - Munster (New Richmond OH) — active, 30-ft gooseneck deck, **max 9,000 lb**, weekends home.
   - GABE LOGISTICS LLC (MC 1006869, Dover DE) — dry van, 2016 Mack + 53' Vanguard, authority since 2019, pending two document fixes.
   **[YASEEN: pick one — my note: GABE's dry van is the most broker-friendly equipment, but Warren is the only one fully active today.]**
5. **Genuine customers:** Warren and Munster are real and active. GABE is real, in `compliance_check`. "Trucking Inc" is a **test fixture** (compliance rows set valid by hand — never count it). Patterson and Pick N Nett are verified but have **0 trucks**. 59 `pending` carrier profiles have no org at all (dispatcher job-seekers, not carriers). 4 of the 8 "broker" orgs are LoadBoot's own agents. Use that as the eligibility baseline; do not trust `status='active'`.
6. **Plans/usage:** Supabase = Free (upgrade to Pro planned at ~50 verified carriers or ~300 MB). **[YASEEN: Netlify plan, Resend plan + monthly volume, Retell balance.]** "$0" means zero *advertising* spend; infrastructure stays on free tiers where possible.
7. **Staging fixtures:** ⚠️ staging **sends real email** and has a live Retell key — any staging test must use a mail sink or my own addresses, never a real carrier address. **[YASEEN: give one staging test login (carrier) and one (staff), or tell ChatGPT to create them with your email.]**
8. **Retention/access:** **[YASEEN: decide, or say "propose a default and I'll approve".]** Note F10 is real: `staff read documents` policy gives every active staff account access to W-9s and IDs.
9. **Approver:** I approve all legal, fee and shipper copy. **Google Business Profile: do NOT list** — the WY address is a registered agent, not a place of business; GBP requires an eligible location.
10. **Weekly time:** **[YASEEN: e.g. "2 hours for exceptions, 2 hours for one content item per week".]**

## HARD RULE for every message from now on: re-sync before you think

You are **not the only one working on this repo and these databases.** Claude sessions and other ChatGPT sessions push, deploy and apply migrations in parallel — sometimes within the same hour. Anything you remember from an earlier turn may already be stale. So, **at the start of every prompt, before proposing or changing anything:**

1. **Re-read the current state, do not recall it.** `git fetch` and read `main` HEAD (sha + `git log --oneline -20` since the last sha you worked from). If anything you are about to touch appears in that log, re-read the file in full before writing a line.
2. **Check both databases live:** `list_migrations` on prod (`rwscphuhpjoudvljvmdk`) and staging (`snslhvmkjusozgjelghi`) and compare with the high-water mark you last recorded. `pg_get_functiondef` any function you are about to modify — never patch from a copy you read earlier. `list_edge_functions` for the current version of any edge function before redeploying it.
3. **Check what is deployed vs what is on disk:** the live site can be behind `main`, and `main` can be behind disk. Read `docs/NEXT-SESSION-HANDOFF.md`, `SESSION-HANDOFF.md` and the newest files in `docs/` (sort by date) for what other lanes did. If a file you need has been changed by someone else, MERGE ONTO THEIRS — never revert, never overwrite from a stale base.
4. **Then re-plan from where we actually stand.** If the re-sync shows a finding is already fixed, a migration already applied, or a file already restructured, say so explicitly ("F05 was fixed by bl_bp_0321 on 6 Sep by another session — dropping it from Sprint 1"), adjust the sprint, and **update your own documents** (`PHASE1-AUDIT.md`, `90-DAY-PLAN.md`, `COMPETITION-AND-WEDGE.md` in `docs/audit-2026-09/`) in the same turn, with a dated changelog line at the top of each. Your docs must always describe the current repo, not the repo as it was on 5 Sep.
5. **Start every reply with a 3-line sync header:** `main = <sha> (<n> new commits since last turn: <one-line summary>)` · `prod migrations = <latest>, staging = <latest>` · `changed since I last looked: <files/functions that affect this sprint, or "nothing relevant">`. If you could not run the check, write `SYNC UNKNOWN — not proceeding` and stop.
6. **Never assume a number you recorded is still true** (anon-executable function counts, migration counts, org counts, cron lists). Re-query, then compare.

Skipping this re-sync is the one mistake I will not accept, because it is how a parallel session overwrote a large shared file from a stale base on 29 Aug and silently destroyed committed work.

## TWO ASSISTANTS, ONE BATON — how you and Claude share this work

You and Claude (Anthropic, running with this repo + both Supabase projects connected) will work the **same sprint plan in relay**. When one hits its usage limit, I type "continue" to the other, and it must pick up exactly where the first stopped — same branch, same item, same rules. Nobody starts over, nobody re-plans from scratch, nobody redoes a finished item.

The baton is one file in the repo: **`docs/audit-2026-09/HANDOFF.md`**. Protocol:

1. **On every "continue" (and every prompt in this thread): re-sync header first, then read `HANDOFF.md` in full.** Its `CURRENT STATE` tells you the sprint, branch, item table with owners/status, what is blocked on me, and what must not be touched. Its `NEXT ACTION` is the one concrete step "continue" means. If `HANDOFF.md` disagrees with the repo or DB, the repo/DB is right — fix the file, say so.
2. **Before you stop — for any reason, including "I am near my limit" —** rewrite the whole `CURRENT STATE` block (item statuses, branch, sha, migration marks, blockers), set a precise `NEXT ACTION` the other assistant can execute without asking me anything, and append one `LOG` line: `<UTC time> · ChatGPT · <what changed, which files/migrations, what was verified>`. Commit the file on the working branch with your code. If you cannot finish an item, leave it `in progress — <exact point reached, e.g. "migration written, staging test not run">`, never half-described.
3. **Never work an item marked `in progress` by Claude in the same hour without re-reading its files first**, and never mark someone else's item `done` — verify it yourself, then write `done (verified by ChatGPT <time>)`.
4. **Same identity rules for both of you:** feature branch `audit/s<N>-<topic>`, plan → diff → `node --check` → `BUILD OK` → staging verification → rollback, stop for my review; staging only; prod on my explicit word; migrations numbered from the live high-water mark you just re-read (another lane may have taken the next number — check before naming `bl_sec_0320`).
5. **Your three audit docs are shared too.** Claude may add dated changelog lines or corrections to `PHASE1-AUDIT.md`, `90-DAY-PLAN.md`, `COMPETITION-AND-WEDGE.md` when the repo moves; you do the same. Read the changelog at the top before assuming a doc still says what you wrote.

If `HANDOFF.md` is missing or its `Updated:` line is older than the newest commit touching `docs/audit-2026-09/` or `migrations/`, treat the state as UNKNOWN: re-derive it from the repo/DB, rewrite the block, and tell me before doing any work.

## GO — Sprint 1 only (days 1–14), with these exact boundaries

Approved scope:
- F01: inventory every legitimate caller of the three `lb_email_*` RPCs (I expect only the `inbound-mail` edge function via service_role). Then a **staging-only** migration `bl_sec_0320_email_ingest_grants` that revokes `authenticated` EXECUTE, adds an explicit service-role/caller guard inside the functions, and includes the prior grants/definitions in the file for rollback. Prove with a rollback-txn test on staging that (a) service_role path still works, (b) an `authenticated` JWT is refused, (c) zero rows land in `message_deliveries`. Then hand me the prod command — I apply it.
- F02: `domain-check` — verify the JWT properly (or require the service role from the pg_net collector), reject private/link-local/loopback IPs after DNS resolution **and** on every redirect hop, cap redirects/time/bytes. Deploy to **staging only**; keep the response shape the collector expects. Prod deploy is my call.
- F05: agent code resend idempotency — one delivery key per verification-code ID; test on staging with two deliberate resends against a mail sink.
- F07: `build_site.py` local default → staging, fail closed without staging config. Production context stays explicit.
- F18: fix `check_imports.py` false positive (dynamic destructured import), repair/remove the two dead test script references, add the GitHub Actions PR workflow (read-only perms, staging-only build, `node --check`, import gate). No prod credentials in CI.

Explicitly **not** in Sprint 1: any change to the outreach engine or its schedule; any auth-flow, DNS, email-identity, payment or agreement change; any new CC nav item; any production migration or deploy without my explicit "apply to prod" / "deploy".

Working rules still apply: one feature branch `audit/s1-boundaries`, show plan → diff → `node --check` → `BUILD OK` → staging verification → rollback steps, then stop for my review before the next item. Write `UNKNOWN` where you cannot verify. Never edit `app/carrier/app.js` or `app/shared/api.js` in this sprint — other work is pending in those files.

Start with the re-sync header, then the F01 caller inventory — show me the list before writing the migration.
