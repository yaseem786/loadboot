# Riley control plane — `bl_voice_0458` (26 Sep 2026)

Riley is the AI phone line (Retell). This migration + edge function + CC screen put her under the owner's
control from Command Center: **Team → Riley (AI phone)** (`#/riley`).

## What was found (prod, read from the Retell API on 26 Sep)

| Item | Found | Fixed by |
|---|---|---|
| Retell number inbound agent | **Riley Broker Outbound** — a one-off Fitzmark load script (Aug 26) with Munster's private rate floor in it, set 7 Sep 08:11 UTC | CC → Riley → Settings → **Fix number wiring** (or the dashboard) |
| Retell number outbound agent | same wrong agent | same; plus `retell_dial()` now sends `override_agent_id` so callbacks never depend on it |
| Prompts | only in the Retell dashboard, no copy anywhere, Munster/LDI leftovers, contradictions | `app_private.riley_prompts` seeded from `docs/voice-agent/prompts/*.md`, edited + published from CC |
| Role handling | one prompt, ignored `{{role}}`/`{{context}}` the inbound webhook sends | new inbound prompt with carrier / broker / shipper / dispatcher / other playbooks |
| WhatsApp line | no voice path to Riley; Riley number was the only way to reach her | `dialer_config.riley_wa_enabled` → `dialer_hook_event` transfers calls on `wa_number` to Riley |
| Retell credit | empty since ~3 Sep; owner added $30 on 26 Sep | — |

## Pieces

- `migrations/bl_voice_0458_riley_control.sql` — applied **staging ✓ (26 Sep)**, **prod ✓ (26 Sep)**. anon SECDEF: 36 prod / 35 staging, names unchanged.
- `supabase/functions/retell-admin/index.ts` — staff-gated (JWT → `get_my_staff_context`; write ops need `comm.manage` or `settings.manage`). Ops: `status`, `set_phone_agents`, `get_llm`, `publish`, `get_call`. Deployed staging ✓ prod ✓.
- `app/command-center/views/riley.js` (+ `api.js` `ccRiley*`, `rileyAdmin`; `app.js` tab + route).
- Canonical prompts: `docs/voice-agent/prompts/riley-inbound.md`, `riley-outbound.md`. The DB row is what gets published; keep the files in step when the owner edits in CC (copy back).

## Owner steps, in order

1. **CC → Riley → Settings & wiring → Fix number wiring.** This points the Retell number at Riley Inbound / Riley Outbound. Until then every inbound call gets the Fitzmark script. (Dashboard alternative: Phone Numbers → (469) … → inbound agent = Riley Inbound, outbound agent = Riley Outbound.)
2. **CC → Riley → Prompts → Publish** inbound, then outbound. Read them first; the facts are lifted from `build_site.py` as of 26 Sep (5 % of gross line-haul, accessorials 100 % carrier's, detention $60/h after 2 h, TONU $250, layover $250/day, broker posting free, referral 1 % + overrides, US Truck Dispatcher trial, 48 states). Publishing also installs the shared post-call analysis (caller_type, mc_number, contact_email, interest_level, next_step, needs_human) on both agents.
3. **Test by web call** in the Retell dashboard (Agents → Riley Inbound → Test) — costs cents, no phone needed. Try: "I run two reefers out of Dallas", "I'm a broker with a load Chicago to Atlanta", "I'm a dispatcher, can I use your board for my carriers".
4. **Telnyx portal, one time:** Numbers → +1 (815) 365-1168 → Voice → connection/application = **LoadBoot Inbound** (the Voice API app the dispatcher lines use). WhatsApp messaging on the number is separate and unaffected (assumption — confirm a WhatsApp message still arrives afterwards).
5. **CC → Riley → WhatsApp line → switch ON.** Then call +1 (815) 365-1168 from your own phone. Expected: Riley answers within ~5 s with the unknown-caller opener; the call appears under Riley → Calls within seconds (`in-progress`), recording + transcript after hangup; the Telnyx leg appears under WhatsApp line as "Riley answered".
   - Check `from_number` on that call is YOUR number, not the 815 line. If it shows 815, Telnyx is not passing caller id through the transfer and the inbound briefing (`retell_inbound_verified`) cannot identify callers — tell Claude, the transfer `from` needs a different value.
6. **Enforce Retell signatures** once that call shows `signature_ok` in `app_private.retell_hook_log`:
   `update app_private.retell_config set allow_unsigned_webhook = false where id = 1;` (prod). Observe mode has been open since 7 Sep waiting for exactly this call.

## How the WhatsApp-line call flows

```
caller → +1 815 (Telnyx) → telnyx-hook → dialer_hook_event
   riley_wa_enabled + to = wa_number → dialer_calls row (source 'riley', status 'ringing', dispatcher NULL)
   → Telnyx transfer to retell_config.from_number, from = caller's number
Retell (469) rings → retell-inbound-hook → retell_inbound_verified → {{name}}/{{role}}/{{context}} for Riley
Riley answers → Telnyx call.answered (leg b) → dialer_calls 'forwarded' + answered_at
Riley busy / no credit → leg b hangup → existing chain: voicemail greeting → recording → callback (dispatcher NULL → shows in CC → Riley → WhatsApp line)
Retell webhooks (call_started / ended / analyzed) → retell_webhook → lc_calls (recording_url, transcript, analysis) → CC → Riley → Calls
```

Verified on staging with synthetic Telnyx events: answered path (forwarded, duration 30 s, no callback), unanswered path (voicemail, one NULL-dispatcher callback). Test rows deleted.

## Costs (estimates, not checked against today's price pages — the container could not reach them)
Retell ≈ $0.13/min all-in + $2/mo per number (from `LAUNCH-PLAN.md`). Telnyx inbound + transferred outbound leg ≈ $0.01–0.02/min. At 30 calls × 3 min a month: ≈ $14 Retell + ≈ $3 Telnyx. Auto-recharge on Retell is the important part — voice OTP (`retell_dial_verify`) uses the same balance.

## Known gaps / next
- **Outbound caller id is the Riley number.** Retell can only dial from a number it owns. To call out as the 815 line, import 815 into Retell over a Telnyx SIP trunk (Retell "Import number"). That also removes the forwarding hop. Separate task; needs portal work on both sides.
- Site copy still says "Riley on the phone 24/7" in `build_site.py` (pricing list ~2311, dispatch-OS card ~2070, callback microcopy ~2300). Not a number, so the §7 build guard does not catch it. Fine once the WhatsApp line is Riley — she *is* on the phone — but the "Riley is calling you right now" microcopy should say the AI assistant is calling.
- Prompts say Riley is the AI assistant in the opener (Retell handbook `ai_disclosure` is also on). Owner decision to keep or soften; several states require it for AI voice calls.
- Compliance note (not legal advice): outbound calls are only placed to people who asked (website/chat form) or whom the team is already talking to (`cc` source). Keep it that way; TCPA.
- `lc_calls` has no per-call cost. `retell-admin get_call` returns Retell's `call_cost` if the owner wants a spend column later.
