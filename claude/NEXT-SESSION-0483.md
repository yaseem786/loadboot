# Next session — hand-off written 27 Sep 2026 (after bl_voice_0483)

Paste this whole file into the new session. Roman Urdu + English, be direct, CLAUDE.md applies.

## Ids
- Supabase prod `rwscphuhpjoudvljvmdk` · staging `snslhvmkjusozgjelghi`
- Netlify site `6882ea72-0dd6-4b16-80f8-64fe9136573e` (loadboot). Build = `python3 build_site.py`, publish `site/`.
- Branch `claude/funny-cerf-nl3rlr` = origin (contains `claude/dreamy-davinci-jkgpn8` 0481/0482 + this session's 0483). Not merged to main.

## State right now
- **DB (prod + staging) is live for everything up to `bl_voice_0483`.** anon SECDEF 36 / 35, names verified (baseline doc updated).
- **Site deploy pending for 0479 → 0483** (CC: AI chats tab, Carrier choices tab, Riley → Call plans, Plan-a-call buttons).
  Path: merge `claude/funny-cerf-nl3rlr` → `main` → push from GitHub Desktop → Netlify auto-build; or Netlify MCP
  `deploy-site` if the environment allows `registry.npmjs.org`.
- Nothing dials: `tool.schedule_riley_call` = prep / off. `source.voice` = live (plans only).

## Done this session — bl_voice_0483 Riley call plans (doc: `claude/RILEY-CALL-PLANS-0483.md`)
Staff press "Plan a Riley call" (Carrier 360 header · Carrier choices card) → brain job (route `voice_plan`, Sonnet 5,
≈ $0.02, 13 s) → CC → Riley → **Call plans** shows Goal / Opener / 5 talking points / Confirm / Do not say / Best time /
Language + cost line + consent basis; Copy · Edit · Redo · Mark called · Cancel. Staging throwaway verified end-to-end, rows deleted.
Owner decisions applied: carriers only (no dispatcher calls, §14.2), Riley stays on Retell's hosted LLM, booking waits on the tool flip.

## Next (in order)
1. **Deploy the site** (above). Then open CC → Riley → Call plans on prod, plan one call on a real carrier the owner
   picks (read-only for the carrier — nothing is sent or dialled), read the plan, judge the quality.
2. **Riley call plans, slice 2** — only when the owner says Riley may place calls: flip `tool.schedule_riley_call` to
   live in CC → AI Brain → Permissions, then build the executor + "Book with Riley" button + `call_analyzed` → plan
   `called` + `voice_followup` route. Spec in `claude/RILEY-CALL-PLANS-0483.md` → "Next slice".
3. **Retell balance line** in CC → Riley → Settings (§9 owner decision) — check whether the Retell API exposes balance;
   if not, a manual "balance as of" field in `retell_config` is the honest fallback.
4. `WHATSAPP-AI-DESK-0478` / `REP-PLAN-0477` — never committed; re-plan before build.

## Facts settled (do not re-investigate)
- `docs/audit-2026-09/anon-secdef-baseline.md` was missing `newsletter_request` / `newsletter_confirm` (0447, 26 Sep). Added 27 Sep; 36/35 is right.
- A data-modifying CTE's row is invisible to a function called in the same statement — test enqueues from SQL need two statements or a DO block.
- `brain_rpc` passes the UPDATED job row to `brain_sink` (status, result, usd already written).
