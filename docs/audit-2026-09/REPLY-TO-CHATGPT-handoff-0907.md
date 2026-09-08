# Paste this to ChatGPT / Codex — handoff, 7 Sep 2026 ~09:30 UTC

---

Continue from here. Re-sync first, then item 2 below is the actual work.

## Re-sync

- Prod newest migration: **`bl_web_0333_contact_channel_switch`** (`20260907082942`)
- Staging newest: **`bl_sec_0334_lc_ob_get_key_floor`** (`20260907092609`) — staging is **one ahead**, that one migration only
- Prod edge fns: `domain-check` v5, `retell-hook` v2, `retell-inbound-hook` v2, `load-mail` v9, `doc-precheck` v5
- The site was rebuilt and deployed twice today; `build_site.py` changed and is merged

## What landed on PROD since your last turn

| item | state |
|---|---|
| F02 `domain-check` v5 | deployed + live-checked: `::1`, metadata, `fe90::1`, `febf::1`, v4-mapped loopback all refused; **public-IPv6 control NOT refused** (reaches the network, fails on TLS) |
| F14 first instance | `retell-hook` v2 + `bl_sec_0329/b/c`. `allow_unsigned_webhook` is **TRUE** (observe), so the live Retell chain is untouched. Signed end-to-end chain proven on prod with zero writes |
| F14 second instance | `retell-inbound-hook` v2 + `bl_sec_0330/0331`. `retell_inbound_verified` was built **from prod's own definition** and proven byte-identical by md5 (`43b69a24…`). `public.retell_inbound` and its anon grant are **UNCHANGED**, deliberately |
| `bl_sec_0332` | Retell signs with a **separate** webhook key, not the API key — see below |
| `bl_web_0333` | website contact-channel switch (phone ↔ WhatsApp), inert, defaults to `phone` |

## Two things worth knowing, because they were both learned the hard way

**1. Retell signs with a different key than we had stored.** Change 1 went live, a real delivery arrived, and
observe mode logged `digest_mismatch`. Rather than assume a format problem I had Yaseen compare his dashboard
keys against a *fingerprint* of the stored one (first 4 / last 4 / length — the key never crossed a chat). The
stored key matched **"loadboot-cc"**, the general API key; his dashboard also holds **"Secret Key Webhook"**.
`bl_sec_0332` now tries the signing key first, falls back to the API key, and reports `key_used`.
**Yaseen still has to run one line on prod** and has not yet:
`update app_private.retell_config set webhook_signing_key = '<paste>' where id = 1;`
Until then real deliveries log `digest_mismatch` — harmless, observe mode forwards them anyway.

**2. A UI bug of mine reached production and only a browser caught it.** The contact switch stored its
replacement label as HTML inside a data attribute. Source markup was correct and quote-balanced — I re-rendered
the template to check — but the browser mis-parsed it live and `WhatsApp us +1 (928) 393-6198">` appeared as
visible text in the top bar of every page. Netlify said "ready"; the source read fine; neither would have found
it. Fixed (short token + `textContent`) and **verified in a browser after the deploy**, which is now the rule for
any front-end change.

## NEW FINDING — F34 (P3, latent). This is where I stopped.

I swept the rest of F14. The exact shape both instances had — **SECURITY DEFINER + granted to anon + a single
UNNAMED parameter** (what makes PostgREST expose it as a raw-body RPC) — returns **exactly the two functions
already handled**. That shape is exhausted.

Widening to all anon-executable SECURITY DEFINER functions gives **33**. Most are public by design or gated by an
unguessable uuid token. The interesting group is live chat, gated by a **visitor key the browser mints itself**:

| function | returns | key check |
|---|---|---|
| `lc_history(p_visitor_key)` | last 10 conversations + previews | length **16–64** |
| `lc_ob_get(p_visitor_key)` | onboarding record: role, step, `data`, `docs`, **`account_email`** | length **≥ 8** |

Same secret, two standards — and the weaker guard returns the more personal record. The key was also minted with
`Math.random()`, and its storage-failure path returned `'novkey' + Date.now().toString(36) + 'xxxxxxxx'`, i.e.
**fully predictable from the clock**.

**Evidence it is latent, not an incident** (prod, read-only): 67 `lc_conversations`, 1 `lc_onboarding` row,
**zero** with a `novkey` prefix, shortest key in use **26 chars**. So the predictable path was never taken, and
raising the floor locks out nobody.

Fixed: `bl_sec_0334` on **staging** (floor 8 → 16–64, `novkey` prefix refused) and `build_site.py` now mints the
key with `crypto.getRandomValues` (192-bit, 49 chars) with a still-random failure path. Test PASS on 4 cases —
case 1 deliberately first: *a real key must keep working*, because a guard that locks out the people it protects
is not a fix.

## YOUR NEXT PIECE

**Finish the live-chat slice.** The same visitor key gates **`lc_send`, `lc_poll`, `lc_rate`, `lc_ob_save`,
`lc_start`** and none of them has been reviewed against this standard. For each, answer plainly: what does an
anonymous caller need to know, and what do they get or change if they guess it? Read-only first, then propose
staging-first fixes with rollback-txn tests. **Do not apply anything to prod.**

## Do NOT do without Yaseen's explicit word
- `bl_sec_0334` to prod
- `allow_unsigned_webhook = false` (closes the old `retell_webhook` door) — only after a real signed delivery
  verifies in `app_private.retell_hook_log`
- revoking `anon`/`authenticated` on `public.retell_inbound` — same condition, inbound side
- Retell credit is empty and the last real call was 2026-09-03, so those two cannot be verified yet. Nothing is
  urgent and nothing is exposed that was not exposed before.

Also unchanged: outreach stays **enabled** (his decision), SEO/F33/WhatsApp parked, F10 needs the
role-by-document-type matrix before any policy change, and F08/F09/F18 are yours on
`audit/remaining-gaps-20260906`.

`HANDOFF.md` and `PHASE1-AUDIT.md` carry all of this with the request ids and the LOG line.
