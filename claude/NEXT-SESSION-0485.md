# Next session — hand-off written 27 Sep 2026 (after bl_voice_0485)

Paste this whole file into the new session. Roman Urdu + English, be direct, CLAUDE.md applies.

## Start here (28 Sep)
- Build **"One main line 815"** — first bullet under *Builds* in `claude/TASKS-RILEY-CALLS-0486.md` (Riley outbound caller ID = +1 (815) 365-1168). Step 1: read Retell's import-number / SIP-trunk docs and confirm the owner steps; only then write code.
- (The numbered list in that file is carriers — #6 there is Summit 15 Transport, not this build.)

## Ids
- Supabase prod `rwscphuhpjoudvljvmdk` · staging `snslhvmkjusozgjelghi` · Netlify site `6882ea72-0dd6-4b16-80f8-64fe9136573e`

## State right now
- DB prod + staging live up to **bl_voice_0485** (Riley booking + next step + lean brain block). anon SECDEF 36 / 35, names = baseline.
- Site: main carries 0484 (Retell balance card) + 0485 CC screens once pushed (check Netlify deploy for the latest main commit).
- `tool.schedule_riley_call` = live / **enabled false** / mode prep → nothing can be booked yet.
- Riley Outbound prompt has an UNPUBLISHED draft (the "account" source line). Booking stays blocked (`prompt_unpublished`) until published.

## Owner steps (in this order)
1. CC → Riley → Prompts → Outbound → read the new `"account"` line → **Publish**.
2. CC → AI Brain → Permissions → "Book Riley calls" → switch ON (leave mode = prep).
3. CC → Riley → Call plans → open a ready plan → **Book with Riley** → pick "Next allowed time".
4. After the call: the plan card shows "The call" + "Next step" → approve (2nd call / email / task) or dismiss.
5. Later, only if happy: mode = auto (the brain books its own 2nd calls; emails still wait for a person).

## Next build candidates
- §14.2 auto triggers (day-1 welcome, 48 h vanished, hot lead) through `riley_plan_new` with caps.
- Store Retell `call_cost` per call (verify unit) → real spend on the plan card + the balance card.
- CC list of Riley do-not-call numbers.

## Facts settled
- Details + test log: `claude/RILEY-SLICE2-0485.md`. Retell has no balance API (0484).
- `riley_plan_json` always has an `error` key → check `nullif(r->>'error','') is not null`, never `r ? 'error'`.
- `automation_tasks.id` is uuid. Staging carrier fixtures often have 7-digit phones (plans refuse them — correct).
