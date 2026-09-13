# LoadBoot — session handoff

Paste this at the start of a new session. It replaces having to re-explain anything.

---

## 1. Who you are working with

**Yaseen** — owner of LoadBoot (US truck dispatch company, Wyoming LLC). Second person on the
team is **Asim**.

House rules, learned the hard way. Follow them without being reminded:

- **Reply in Roman Urdu.** Technical terms, code and any text he will paste elsewhere stay in English.
- **He signs external mail as "Mike".**
- **He sends every carrier / broker / candidate message himself.** You draft; you never send.
  Do not put drafts in code blocks — he copies them straight out of the reply.
- **Never invent data.** Unknown means NULL plus a note saying it is unknown.
- **Token-efficient.** Minimum tool output for maximum work; his usage limit is the constraint.
- **Never test on prod.** Staging first. On prod: rolled-back transactions only, unless he
  explicitly asks for a real change.
- **Additive and reversible changes only.** Never delete test accounts or user data.
- **Never handle his passwords or log into third-party dashboards for him.**
- If a previous session's conclusion is flagged as wrong, **re-verify from source** — do not defend it.
- Long WhatsApp drafts get split into 2–3 short messages.

---

## 2. Infrastructure

| Thing | Value |
|---|---|
| Repo (his machine) | `C:\Users\HP\Documents\GitHub\loadboot` |
| Working branch | `feat/dispatcher-model` → PR → `main` |
| `origin/main` at handoff | `13ca4e7` |
| Deploy | Netlify, auto-deploys on push to `main` |
| Supabase **prod** | `rwscphuhpjoudvljvmdk` |
| Supabase **staging** | `snslhvmkjusozgjelghi` |
| Migrations | `migrations/bl_*.sql`, applied staging → prod |

Practical notes:

- **His checkout is CRLF.** Files written with LF show as whole-file diffs. Convert every
  deliverable: `sed 's/$/\r/'` or write with `newline='\r\n'`.
- **Pushing from the container is blocked** by the git proxy (`not in this session's authorized
  repository set`). Do not look for a workaround. He commits and pushes from **GitHub Desktop** —
  he has no standalone git on the machine, so command-line instructions are useless to him.
- **Device bridge**: the repo folder is connected, so files can be written straight into it with
  `device_commit_files` (stage → SendUserFile → commit with the returned `fileUuid`). The local
  Linux VM (`device_bash`) has been failing to start — *"Workspace unavailable"* — so use
  stage/commit, not a shell on his machine. The bridge also drops out; when it does, deliver via
  SendUserFile and say so.
- `app_private` is not exposed through PostgREST. Everything reaches it via `security definer` RPCs.
- Email pipeline: `app_private.sys_email(to, template, subject, html, text, idem)` →
  `message_deliveries` → pg_cron `delivery-worker-minutely` → Resend. The body passed is the INNER
  body; `supabase/functions/delivery-worker/index.ts` wraps it in the branded shell. `categoryOf()`
  routes `dispatcher.*` to **LoadBoot Dispatch <dispatch@loadboot.com>**.
- Usefultechniques: patch functions in place with `pg_get_functiondef` + an anchor `position()`
  assert + `replace` + `execute` inside a `DO` block. Test as a user with
  `set_config('request.jwt.claims', json_build_object('sub', uid, 'role','authenticated')::text, true)`.
- Headless verification: chromium at
  `/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`, harnesses served over
  `python3 -m http.server` (file:// breaks ES module CORS).

---

## 3. The dispatcher hiring pipeline

Pipeline: `applied → screening → skills_test → trial (10 working days) → verified → active`.

**Commercials:** during the trial, **2.5% of gross line haul per delivered load, no base salary**.
If the trial goes well: base + commission + bonus, negotiated then.

**Skills test** — built over migrations `bl_disp_0304` … `bl_disp_0311`. It is a real in-portal,
server-clocked assessment, not an e-mail questionnaire.

- 9 questions, 100 points, 45 minutes, must start within 48 hours, one attempt.
- Tables: `skills_test_questions`, `skills_test_attempts`, `skills_test_answers` (all `app_private`).
- Candidate RPCs: `dispatcher_test_my / _start / _save / _submit`. Questions are only returned while
  the attempt is `in_progress`; the answer key never leaves the server.
- Staff RPCs: `cc_dispatcher_test_invite`, `cc_dispatcher_test_review`, `cc_dispatcher_test_score`,
  `cc_dispatcher_test_send_score`.
- Sweeper `lb-skills-test-sweep` (pg_cron, every 10 min) auto-submits expired attempts that have
  answers, expires the empty ones, and sends one reminder ~12 h before `start_by`.
- Portal screen: `app/agent/skills-test.js` (briefing / live / receipt / dead). Integrity telemetry
  — tab blurs, seconds away, paste counts — is recorded as **signals, not proof**.
- CC review card: `app/command-center/views/dispatchers.js`, `paintTest()`.

**Which button sends what e-mail** (as of this session):

| Button | E-mail |
|---|---|
| Send skills test | The invite, with one CTA into the portal |
| Save scores | none |
| **✓ Passed** | "You passed" — result only, **no number** |
| **E-mail score** | The number only, e.g. 79 / 100 |
| ✕ Failed | none |
| Move to trial | Status e-mail whose **entire body is whatever is typed in the note box** |

Both new e-mails are once-only, stamped by `passed_email_at` / `score_email_at`. The internal
review note is never sent to a candidate.

---

## 4. Abdul Aziz Shinwari — the live candidate

- user `e7cad80b-92b4-4a59-964f-5ac9dc05382a` · `abdulazizshinwari6@gmail.com` · Kabul time
- attempt `eb7f3d08-7566-4648-91ca-e0bd6dc585cb` · status `scored` · decision `pass` · **79 / 100**
- Reviewed by Yaseen's staff user `b7b28e16-608a-4ff7-9197-f763b80857e8`

Written test first scored 71; regraded to **79** during this session:

- **Q4 was marked wrong by mistake — the answer key was wrong, not him.** The rate con read
  *"detention after 2 hours, $35/hour, maximum 5 hours"*, he billed **$157.50** (4.5 × $35), and
  that is correct. "Maximum 5 hours" is a ceiling on the payout; it never rounds 4.5 up. He held
  his answer politely when pushed back on, and said he was happy to be corrected. The key in the
  question bank has been fixed. **3 → 9.**
- Q7 (broker MC vs carrier MC) **6 → 8** after a follow-up in which he said the carrier name and MC
  on the rate con must be the hauling carrier, a mismatch breaks payment and liability, and the fix
  is to get a corrected rate con. He still does not name **double-brokering**, and does not say to
  hold the truck until the corrected rate con is in hand.

**Negotiation drill — passed.** The live call was replaced with a voice note, because Yaseen is not
confident on an English call. Aziz pushed back correctly that a rate and two cities is not enough to
negotiate on, and asked for a flatbed example; he was given a 715-mile Joliet IL → Atlanta GA
flatbed load, 44,000 lb kiln-dried lumber, must be tarped, broker offering $1,650 all-in, floor
$2.40/mi. He asked for commodity, weight and both appointment windows before touching the rate,
anchored $2,000, used the hold-with-driver move, and closed at **$1,900 = $2.66/mi** — $184 above
the floor.

Call gaps to train, not blockers: he did not bill **tarp as its own line item**; he never defended
the floor **in per-mile terms**; and he said "close to $3 per mile" while asking $2,000, which is
internally inconsistent and a sharp broker would catch it.

Integrity read: 25 blurs, 387 s away, 3 pastes, 44.4 of 45 minutes used, all 9 answered. English
errors are consistent across all nine answers, which reads as his own writing.

**Where it stands right now:** he has been told nothing. Only three e-mails have ever reached him —
welcome, load-received, and the 12 Sep test invite. No pass e-mail, no score, and his portal still
shows only *"Test submitted"*.

---

## 5. Open items

1. **Send the pass message.** He is waiting. The plan Yaseen set: WhatsApp first, then press
   **Change → ✓ Passed** in CC (which sends the pass e-mail). **Do not press "Move to trial"** —
   the trial only starts after Aziz sees the truck details and agrees.
2. **Pick the carrier.** Aziz says 95% of his experience is flatbeds. Live equipment in prod:
   - **MUNSTER LOGISTICS LLC** (MC 84057665) — Hotshot, 30 ft gooseneck **flatbed**, Batavia OH,
     9,000 lb, 102" wide, ~34" deck, 200-mile radius, min $1.50/mi. Tarps/chains/straps/ramps on
     board, but driver **Justin would rather not tarp** — treat tarp loads as a last resort.
   - **EZHAUL LLC** — Hotshot, 40 ft gooseneck, Golden CO, 10,000 lb, tarps + chains, radius 5,000 mi,
     min $1.00/mi. No MC/DOT on record.
   - **WARREN'S COURIER AGENCY** (MC 99849375) — rented 26 ft Hino box truck, Hinesville GA,
     10,000 lb, dock-high + liftgate, radius 1,000 mi, min $2.10/mi, driver Anthony Robinson.
   - **PICK N NETT LLC** (MC 1775072) — Hotshot, Conway SC, 12,000 lb, tarps + chains. Rate, radius
     and trailer detail are blank on record — confirm before quoting anything.
   None of them is a 48' flatbed, so be honest with him about the mismatch. Yaseen also still has to
   confirm which authority is actually the older one.
3. **Set `commission_pct` to 2.5 before moving anyone to trial** — otherwise every delivered load
   pays the dispatcher nothing.
4. **The invite e-mail still promises a live call:** *"After the written test there is one 15-minute
   call where you negotiate a real load with me."* That is no longer true — it is a voice note now.
   Offered, not yet done.
5. **The applicant-facing portal still advertises the role as salaried** — "Your salaried dispatch
   career starts here", `dSalary()`, "How should we pay your salary?" — which contradicts the
   commission model. Blocked on Yaseen's post-trial figures.
6. Offered and not built: a CC editor for the test questions; question variants to stop leakage;
   removing the now-dead `app_private.disp_skills_test_html`.
7. **Deploy pending.** Both migrations are already applied to prod and staging. The two JS files
   were delivered into the chat but the bridge dropped before they could be written to the repo:
   `app/command-center/views/dispatchers.js` and `app/shared/api.js`. Until they are pushed, CC has
   no "E-mail score" button and still shows the old button behaviour.

---

## 6. Earlier context worth carrying

- **Abdul Rafeh** (the previous dispatcher) failed his 10-day trial — zero loads found, no group
  activity — and was removed. His Resend API key was deleted. One correction on the record: a
  previous session "fixed" his address from `aabdulrafeh85@gmail.com` to `abdulrafeh85@gmail.com`;
  the double-a was correct, so the 29 Aug welcome e-mail went to the wrong inbox.
- Other candidates drafted to this cycle: Rakshona Bakhadirovna, Yusuf Madadov, Frohar Niazai,
  Sean Wood Suba, Mirian Valdez.
- The LinkedIn post was written for **Asim's** account, SEO-focused, for a **fully independent**
  dispatcher — own load board access, books A to Z. LinkedIn's free-post limit was hit.
- Aziz asked how LoadBoot pays; Western Union and Hawala came up. Yaseen decided to skip the
  test-transfer offer and handle payment himself.
