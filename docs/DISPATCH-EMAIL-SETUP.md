# Abdul's LoadBoot e-mail — free, his own credentials, receive + send (via Resend)

**Decided 29 Aug 2026.** No spare Namecheap mailbox slot · must stay free · AWS is not an option · Abdul must have his own login and be able to receive *and* send · he must never be able to read dispatch@ (LoadBoot's own mailbox: billing, factoring, insurance).

## The shape of the solution
| | How |
|---|---|
| **Address** | `abdul@loadboot.com` — an alias of the dispatch@ mailbox (free, already created) |
| **Receiving** | Namecheap filter rule "Abdul — alias mail": *Any recipient contains abdul@loadboot.com* → **Forward to** his Gmail + **Keep** a copy. Already built and tested. |
| **Sending** | Resend SMTP with **his own API key**. Resend has **no inbox and no IMAP** — the credential physically cannot read any mailbox. |
| **Revoke** | Delete that one API key in Resend. Sending stops instantly; nothing else is affected. |

Why not the other routes: 2FA on dispatch@ does not help — the App password it forces for mail clients works for **IMAP/POP3/SMTP** (Namecheap KB 10816) with no per-protocol scope, so he could read the whole mailbox. A new Namecheap mailbox costs $8.88/yr (Launch). Cloudflare Email Routing or Zoho on loadboot.com would replace the MX records and kill hello@, billing@ and dispatch@. Gmail's own SMTP fails DMARC (`p=quarantine`).

---

## Steps

### 1. Create Abdul's API key (2 min, you)
1. resend.com → log in → **API Keys** → **Create API Key**.
2. Name: `abdul-dispatch`
3. Permission: **Sending access**
4. Domain: **loadboot.com** (not "all domains").
5. **Copy the key now** — it is shown only once.

### 2. Give Abdul two values
- SMTP username: `resend`
- SMTP password: the API key

Send them on a call or through a password-manager link — not in a plain WhatsApp message. These open no mailbox.

### 3. His Gmail — "Send mail as" (5 min, do it together)
1. Gmail on desktop → gear → **See all settings** → **Accounts and Import**.
2. **Send mail as → Add another email address.**
3. Name: `Abdul Rafeh — LoadBoot Dispatch` · Email: `abdul@loadboot.com` · **untick "Treat as an alias"** → Next.
4. SMTP server: `smtp.resend.com` · Port: **465** · Username: `resend` · Password: the API key · **SSL** → **Add Account**.
5. Gmail sends a confirmation code to abdul@loadboot.com → the forward rule delivers it to his Gmail → paste the code.
6. Back in **Accounts and Import**: make `abdul@loadboot.com` the **default** address, and select **"Reply from the same address the message was sent to."**

### 4. Verify (1 min)
He mails you → open it → ⋮ → **Show original**. Expect:
- `DKIM: PASS` with `d=loadboot.com`
- `DMARC: PASS`
- SPF may show fail/neutral — that is normal and harmless here: the return-path belongs to Resend, and DMARC passes on DKIM alignment. This is exactly how LoadBoot's ~600 system e-mails a day already go out.

### 5. Signature (his Gmail → Settings → General → Signature, attached to abdul@)
```
Abdul Rafeh · LoadBoot Dispatch
abdul@loadboot.com
Dispatching for [Carrier name], MC [number]
```

---

## The one caveat, and how it is controlled
A Resend key with sending access to `loadboot.com` can technically put **any** `@loadboot.com` address in the From field — including billing@ or yours. Controls:

1. **Every send is logged.** Resend → **Emails** shows From, To, subject and status for each message sent with that key. Full audit trail, better than a normal mailbox.
2. **Instant revocation** — delete the key.
3. **Written rule for Abdul** (below).
4. If you ever want a hard technical lock: add `dispatch.loadboot.com` as a second domain in Resend and issue a key scoped to that subdomain — then he can only send as `abdul@dispatch.loadboot.com`. Cleaner security, longer address; not needed for a 10-day trial.

Quota: LoadBoot already sends ~600 e-mails/day through this account, so it is on a paid plan; Abdul's ~20–40/day is noise. (Resend's free tier is 100/day, 3,000/month.)

---

## Rules for Abdul
- Every broker, carrier and rate-confirmation e-mail goes out from **abdul@loadboot.com** — never his personal Gmail identity, never any other loadboot.com address.
- **CC dispatch@loadboot.com on every broker e-mail** — that is LoadBoot's record.
- Bank details, voided checks, factoring, insurance: never answer — forward to Yaseen.
- One channel otherwise: the WhatsApp group and the portal thread.

## Message to send him
> Your LoadBoot work e-mail is **abdul@loadboot.com**. Mail sent to it reaches your Gmail, and from today everything you write for LoadBoot goes out from that address. Use it for every broker, carrier and rate-confirmation e-mail — never your personal Gmail.
>
> We'll set it up together on a call, 5 minutes in your Gmail settings. I'll give you the mail-server username and password then.
>
> Rules: **CC dispatch@loadboot.com on every broker e-mail** — that's our record. Anything about bank details, voided checks, factoring or insurance: don't reply, forward it to me. Signature:
> `Abdul Rafeh · LoadBoot Dispatch · abdul@loadboot.com · dispatching for [Carrier], MC [number]`

## Sources
- Resend — SMTP settings (host, ports, username `resend`, password = API key; send-only, no inbox): https://resend.com/docs/send-with-smtp
- Resend — pricing / free tier: https://resend.com/docs/knowledge-base/what-is-resend-pricing
- Namecheap — App passwords cover IMAP/POP3/SMTP with no scope: https://www.namecheap.com/support/knowledgebase/article.aspx/10816/2178/how-to-use-app-passwords-for-private-email/
- Namecheap — 2FA (webmail only): https://www.namecheap.com/support/knowledgebase/article.aspx/10782/2306/new-how-to-set-up-twofactor-authentication-2fa-in-private-email/
- Namecheap — aliases, send + receive: https://www.namecheap.com/support/knowledgebase/article.aspx/10791/2306/new-how-to-create-an-alias-for-namecheap-private-email/
- Namecheap — additional mailbox prices: https://www.namecheap.com/support/knowledgebase/article.aspx/9185/2215/prices-for-additional-mailboxes-for-namecheap-private-email/
