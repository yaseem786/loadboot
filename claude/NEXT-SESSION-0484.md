# Next session — hand-off written 27 Sep 2026 (after bl_voice_0484)

Paste this whole file into the new session. Roman Urdu + English, be direct, CLAUDE.md applies.

## Ids
- Supabase prod `rwscphuhpjoudvljvmdk` · staging `snslhvmkjusozgjelghi`
- Netlify site `6882ea72-0dd6-4b16-80f8-64fe9136573e` (loadboot). Build = `python3 build_site.py`, publish `site/`.

## State right now
- **Site deployed**: main `e278e06` (0479 → 0483: AI chats tab, Carrier choices, Riley → Call plans, Plan-a-call) is live
  on loadboot.com (Netlify deploy `6ab97c68212dd9000893a5f9`, bundle checked for the new strings).
- **DB (prod + staging) live up to `bl_voice_0484`.** anon SECDEF 36 / 35, names checked against the baseline, unchanged.
- `bl_voice_0484` Retell balance line: DB live on both; the CC card (`app/command-center/views/riley.js`) ships with
  the next main deploy. Retell has NO balance API — the figure is typed from the Retell dashboard.
- Nothing dials: `tool.schedule_riley_call` = prep / off.

## Next (in order)
1. Owner: CC → Riley → Settings & wiring → **Retell balance** → type the figure from the Retell dashboard (Billing).
2. Owner: CC → Riley → Call plans — plan one call on a real carrier you pick (nothing is sent or dialled), judge quality.
3. **Riley call plans, slice 2** — only after the owner flips `tool.schedule_riley_call` to live (CC → AI Brain →
   Permissions). Spec: `claude/RILEY-CALL-PLANS-0483.md` → "Next slice".
4. `WHATSAPP-AI-DESK-0478` / `REP-PLAN-0477` — never committed; re-plan before build.

## Facts settled
- Retell API (checked 27 Sep): no balance/credit endpoint. Per-call cost is `call_cost.combined_cost` on get-call /
  list-calls; we do not store it yet (lc_calls has duration_sec only). If $ spend is wanted later: capture
  `call_cost` in retell-hook — verify the unit (cents vs dollars) on a real call first.
