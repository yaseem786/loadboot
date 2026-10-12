# Email shell + premium body kit — bl_comm_0543 (12 Oct 2026)

Owner ask: "standard shell banao taake Claude kabhi ghalti na kare — jo main premium kahun woh standard shell
istemal kare; Amazon/Uber standard; mobile + desktop responsive."

## What exists
| Piece | Where | What it does |
|---|---|---|
| Shell | `supabase/functions/_shared/email-shell.ts` | Navy header with the real logo (`email-logo-white-2x.png`), blue→orange bar, body slot, call/WhatsApp band (from the CC contact switch), 3-column footer, legal lines. `@media (max-width:620px)`: full-bleed card, 22px gutters, columns stack. |
| Worker | `supabase/functions/delivery-worker/index.ts` v23 | Wraps every non-outreach email in the shell. v23 only MOVED the shell into `_shared` — 32/32 renders byte-identical to v22 (checked 12 Oct). |
| Body kit | `app_private.email_kit(jsonb)` (`migrations/bl_comm_0543_email_kit.sql`) | The one premium body. Escapes text, accepts only https:// or `{{token}}` URLs, table-based for Outlook, link colours on inner `<span>`. Not executable by anon/authenticated. |
| Preview | `tools/email-preview/preview.mjs` | Renders a body through the real shell; page shows desktop (660px) + phone (375px). Node ≥ 22.18. |

## How to make a premium email
1. Catalog key + row (CLAUDE.md §6).
2. Body: `select app_private.email_kit(jsonb_build_object('eyebrow', …, 'title', …, 'card', …, 'step', …, 'cta', …))`.
   Customer data inside `intro_html` goes through `app_private.h_esc`.
3. Preview: save the fragment, `node tools/email-preview/preview.mjs body.html --subject "…" --out preview.html`.
4. `cc_email_can_send(address, key)` (staff session) → `app_private.sys_email(to, key, subject, body)`.

## Status
- Staging: `email_kit` live (+ card-icon tweak `bl_comm_0543b`).
- Prod: applied 12 Oct 2026 (same md5 as staging). First use: onboarding.carrier_next_steps (bl_comm_0544).
- delivery-worker v23 is NOT deployed: production output is identical, so there is no rush; deploy with the next
  worker change (include `_shared/email-shell.ts` in the deploy files).
- Known limit: the CTA button is not full-width on phones (the shell's `.lb-btn` rule makes the cell block-level but
  the button table still shrinks). Fixing it means one CSS line in the shell = a worker deploy; left for the owner.
