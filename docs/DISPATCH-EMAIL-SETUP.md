# dispatch@loadboot.com for Abdul — the correct setup (checked against your live DNS, 29 Aug 2026)

## What your domain actually has right now

| Record | Value | Meaning |
|---|---|---|
| NS | deborah/beau.ns.cloudflare.com | DNS is on Cloudflare ✔ |
| MX | mx1/mx2.privateemail.com | **Mail is hosted at Namecheap Private Email** — not Cloudflare, not Google |
| SPF | `v=spf1 include:spf.privateemail.com -all` | Only Namecheap may send as @loadboot.com (Resend/SES use the `send.` sub-domain — fine) |
| DMARC | `p=quarantine; adkim=r; aspf=r` | Anything not aligned to loadboot.com lands in **spam** |

**So do NOT turn on Cloudflare Email Routing.** Enabling it makes Cloudflare replace your MX records with its own — every existing mailbox on privateemail.com (hello@, and dispatch@ if it already exists) would stop receiving mail. Cloudflare Routing is only for domains with no mailbox provider.

Also: "Abdul sends from his Gmail with *Send as dispatch@loadboot.com* over Gmail's SMTP" **fails DMARC** — the envelope and DKIM are gmail.com, not loadboot.com, and `p=quarantine` sends it to spam. The fix is to send through Namecheap's SMTP with a real dispatch@ login — then SPF + DKIM align and it lands in the inbox.

## The setup (free if dispatch@ is already a mailbox; otherwise one extra mailbox on your Namecheap plan)

### Step 1 — Namecheap: make sure dispatch@loadboot.com is a real mailbox
1. namecheap.com → Account → **Dashboard → Private Email** (or Domain List → loadboot.com → Manage → Private Email).
2. If `dispatch@loadboot.com` is listed as a **mailbox** → open it, note/reset its password. Done, go to Step 2.
3. If it is only an **alias** (or does not exist) → **Add mailbox** → `dispatch` → set a strong password. (An alias can receive but cannot log in to SMTP, and Abdul needs SMTP to send aligned mail.) If your plan has no free seat, "Add mailbox" shows the price for one more seat — that is the only cost in this whole setup.
4. Do **not** give Abdul this password directly — you will paste it into his Gmail once (Step 3) so the credential lives in the app, not in a WhatsApp chat.

### Step 2 — Namecheap webmail: forward a copy to both of you
1. privateemail.com → log in as **dispatch@loadboot.com**.
2. Settings (gear) → **Mail → Filters/Forwarding** (label varies: "Auto Forward" / "Forwarding").
3. Add: forward to `20190myaseen@gmail.com` **and** `abdulrafeh85@gmail.com` — tick **keep a copy in the mailbox**. Save.
4. Send a test from any address to dispatch@loadboot.com → both Gmail inboxes should receive it within a minute.

### Step 3 — Abdul's Gmail: "Send mail as" dispatch@loadboot.com (5 minutes, do it with him on a call)
1. Gmail (desktop) → gear → **See all settings → Accounts and Import**.
2. **Send mail as → Add another email address.**
3. Name: `LoadBoot Dispatch` · Email: `dispatch@loadboot.com` · **untick "Treat as an alias"** → Next.
4. SMTP server: `mail.privateemail.com` · Port **465** · Username: `dispatch@loadboot.com` · Password: the mailbox password · **SSL** → Add account.
5. Gmail e-mails a confirmation code to dispatch@loadboot.com → it arrives in Abdul's Gmail via the forward from Step 2 → paste the code.
6. Back in Accounts and Import: set **"When replying to a message: reply from the same address the message was sent to"** and make dispatch@loadboot.com the **default** so every new mail he writes goes out as LoadBoot.
7. Test: he sends a mail from Gmail as dispatch@ to your Gmail → open it → ⋮ → **Show original** → you want `SPF: PASS`, `DKIM: PASS` (d=loadboot.com or privateemail), `DMARC: PASS`.

### Step 4 — LoadBoot side (already done today)
- Every staff notification (RC to approve, exceptions, cancellations) already e-mails **dispatch@loadboot.com** → now both of you see them.
- The carrier intro e-mail and the carrier card show **dispatch@loadboot.com** (and your US WhatsApp once you set it), never Abdul's number. Both values live in **CC → Settings → `dispatch.contact_email` / `dispatch.whatsapp`** — change them there any time, no code.

### Step 5 — Signature for Abdul (Gmail → Settings → General → Signature, attach to dispatch@)
```
Abdul Rafeh · LoadBoot Dispatch
dispatch@loadboot.com · WhatsApp +1 (xxx) xxx-xxxx
Dispatching for [Carrier name], MC [number] — rate confirmations to this address, please.
```

## Rules for Abdul on this mailbox
- Broker set-ups, rate confirmations, check-call e-mails: from dispatch@ only. Never from his Gmail identity.
- Never e-mail a carrier's bank letter / voided check — those requests come to you.
- Anything from a factoring company, insurance agent, or a broker's accounting → forward to you, do not answer.

## If you ever want a second seat later
A second mailbox in Namecheap Private Email is cheaper than moving to Zoho/Google, and keeps SPF/DKIM exactly as they are today. Zoho Mail Free would require changing MX away from Namecheap — same breakage risk as Cloudflare Routing.
