# bl_lc_0475 / bl_brain_0475 — live chat widget v6, named specialists, chat on Sonnet 5 (27 Sep 2026)

Owner's ask (27 Sep): make the chat dock "premium, Amazon/Uber standard", have specialists with names answer by
department, and keep the AI honest when asked. The cost question in the same breath: which brain work is worth paying
for before there are paying customers.

## What shipped

### Widget — `app/shared/ui/liveChatCore.js` v6 (marketing site via `/lc-init.js`, portals via `chatWidget.js`)
- Premium shell: 392×640 panel, 22 px radius, layered shadow; taller header with the specialist's avatar (gradient per
  desk, online ring), name + small role pill, subtitle; grouped bubbles (one "who" line per run of the same sender);
  day dividers with rules; pill composer with focus ring and a round orange send; pulsing launcher ring (off while
  open, off when docked in a portal header); full-screen sheet with safe-area padding on phones; `prefers-reduced-motion`.
- **Named desks.** `SPECIALISTS` = Riley (general), Sara (billing & payments), Omar (onboarding & verification),
  Ali (technical support), Maya (plans & pricing), Daniel (dispatch & loads). The model starts a reply with
  `[[as:<desk>]]`; the widget strips it, switches avatar/header/who-line, and (after the first desk) drops a system
  line "Sara · Billing & payments is with you now". No tag (Gemini fallback, staff) → Riley. Desk resets on a new chat.
- Honesty kept: welcome says "I'm Riley, LoadBoot's assistant"; the header pill says *Assistant* on the general desk;
  the menu has **🙋 Talk to a person** at the top; `rule.chat_specialists` tells the model to say plainly that it is an
  AI assistant when asked and to offer a person. Nothing claims to be human.
- `app/shared/ui/chatText.js` `parseDirectives` strips the tag for the CC and returns it as `desk`.

### Brain — `migrations/bl_brain_0475_chat_model.sql` (staging ✅ · prod ✅) + `supabase/functions/brain` v2 (staging ✅ · prod ✅)
- `brain_config.model_by_route` (jsonb): per-route model override, `{"chat":"claude-sonnet-5"}`. `brain_enqueue`
  resolves `model_by_route ->> route`, then `model`. Everything else (assist, verdicts, sweeps, test) stays on Fable 5.1.
- `price`: cache_write corrected to the **1-hour TTL** rate the function actually uses (2× base: Fable $20/M,
  Haiku $2/M) and `claude-sonnet-5` added (in $2, out $10, cache_read $0.20, cache_write $4). Before this the CC
  under-reported every cold job by ~37 % (prod job 4: shown $0.31, billed ~$0.48).
- `rule.chat_specialists` (rule row, on, `allow`): the desk tag + the honesty line. Switch off in CC → AI Brain →
  Permissions to go back to a single Riley voice — no deploy.
- Brain function v2: `betas` + `fallbacks: "default"` are sent only when the model is Fable/Opus/Mythos.

## Cost picture the owner decided on (prod numbers, 27 Sep)
| | Fable 5.1 | Sonnet 5 | Haiku 4.5 |
|---|---|---|---|
| Cold hour: write the 23.5k-token system block | $0.47 | $0.09 | $0.05 |
| One reply, cache warm | $0.03–0.05 | $0.006–0.01 | $0.003–0.005 |
| 10-message chat, cache warm | $0.30–0.50 | $0.06–0.10 | $0.03–0.05 |

Decision: visitor chat on Sonnet 5 (`source.chat` cap $10/day is generous — $3/day is plenty until paying traffic);
staff suggested replies stay on Fable ($3/day); sales / voice / WhatsApp / email sources stay off.

## Staging gate (jobs 47–48) — see the session note in the commit for the transcript summary.

## Not done
- CC → AI Brain → Overview does not yet show `model_by_route`; the owner sets it by SQL / this migration for now.
- Spanish desk names untested (the tag is language-neutral; the model answers in the visitor's language).
