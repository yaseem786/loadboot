# Working agreement — LoadBoot

Read this before starting work in this repo. It is the owner's standing policy, not a
suggestion. Muhammad Yaseen builds LoadBoot alone; his usage limits are a real constraint
and his production system carries real carriers' money. Both matter, in that order of
difficulty: **save tokens everywhere it does not cost quality, and nowhere it does.**

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

- **The anon-executable SECURITY DEFINER count in `public` is 27.** Check it after every
  migration. If it changed, something opened a door.
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
