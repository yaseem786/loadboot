# loadboot.com email spoofing — findings & exact fixes (2026-08-16)

**Trigger:** three phishing emails on 16 Aug (07:02, 08:00, 10:45) showing
`Loadboot . <no-reply@loadboot.com>` → `hello@loadboot.com`, subject
"[hello@loadboot.com]: Please confirm to continue.", body "Your Assigned Password For
hello@loadboot.com expires today, 16 August, 202617:44:56 PM.." with a
**STAY WITH THE CURRENT PASSWORD** button. All three landed in **Spam**.

This is the mass-market "your password expires today" credential-phishing kit. The broken
timestamp (`202617:44:56 PM`) is the template's own bug. Nobody needs access to loadboot.com to
put `no-reply@loadboot.com` in a From: header — the From header is free text on the internet.
The only thing that stops it being *accepted* by other mail providers is **DMARC**.

---

## 1. The root cause — the DMARC record is malformed, so there is effectively NO DMARC

Published at `_dmarc.loadboot.com` right now:

```
v=DMARC1; v=DMARC1; p=quarantine; sp=quarantine; adkim=r; aspf=r; rua=mailto:hello@loadboot.com; pct=100; rua=mailto:hello@loadboot.com
```

`v=DMARC1` appears **twice** and `rua=` appears **twice**. RFC 7489 §6.3: the record must begin
with exactly one `v=DMARC1` and **tags must not be duplicated** — a record with duplicate tags is
"discarded" as syntactically invalid. Strict receivers therefore treat loadboot.com as having
**no DMARC policy at all**. That is why the Aug-15 hardening did not actually protect anything.

## 2. SPF also regressed — it is `~all` (softfail), not `-all`

```
v=spf1 include:spf.privateemail.com ~all
```

`~all` = "probably not us, deliver anyway and mark it". `-all` = "not us, reject".

## 3. The Resend setup has a copy-paste error

| Host | Type | Current value | Verdict |
|---|---|---|---|
| `send.loadboot.com` | MX | `10 feedback-smtp.us-east-1.amazonses.com` | ✅ correct |
| `send.loadboot.com` | TXT | `feedback-smtp.us-east-1.amazonses.com` | ❌ **the MX value pasted into a TXT** |
| `send.loadboot.com` | TXT | *(missing)* | ❌ needs `v=spf1 include:amazonses.com ~all` |
| `resend._domainkey.loadboot.com` | TXT | DKIM key present | ✅ correct |

Effect: every Resend/Supabase email fails SPF on its envelope domain and only survives on DKIM.
Deliverability drag, and bounce feedback is not being processed.

## 4. DKIM is fine — both selectors are live

`privateemail._domainkey.loadboot.com` (v=DKIM1, RSA-2048) and `resend._domainkey.loadboot.com`
both resolve correctly. Nothing to do here.

## 4b. ⚠️ The 2026-08-15 hardening never actually went live

On 15 Aug the DMARC record was fixed (the doubled `v=DMARC1` was noted and corrected) and SPF was
set to `-all`. As of today **both changes are absent from live DNS** — SPF is back to `~all` and the
DMARC record is doubled again. Nameservers are `beau.ns.cloudflare.com` / `deborah.ns.cloudflare.com`,
so **Cloudflare is authoritative** — an edit made anywhere else (registrar zone, Porkbun) has no
effect. Make the change in the Cloudflare dashboard, then verify from outside before calling it done:

```
https://dns.google/resolve?name=_dmarc.loadboot.com&type=TXT
https://dns.google/resolve?name=loadboot.com&type=TXT
```

## 5. You are blind to the abuse data

`rua=` points at `hello@loadboot.com`, and the incoming Yahoo DMARC aggregate reports are sitting
in **Spam**. Those XML reports are the exact record of who is spoofing the domain and how often.

---

## The fixes — in order

### A. Cloudflare DNS (do this first, 5 minutes)

Replace / add these. TTL: leave Auto. These are DNS-only records, no proxy involved.

| Action | Host | Type | Value |
|---|---|---|---|
| **EDIT** | `_dmarc` | TXT | `v=DMARC1; p=quarantine; sp=quarantine; adkim=r; aspf=r; pct=100; fo=1; rua=mailto:dmarc@loadboot.com` |
| **EDIT** | `@` (loadboot.com) | TXT | `v=spf1 include:spf.privateemail.com -all` |
| **DELETE** | `send` | TXT | `feedback-smtp.us-east-1.amazonses.com` *(wrong record type — the MX already covers this)* |
| **ADD** | `send` | TXT | `v=spf1 include:amazonses.com ~all` |

Keep `resend._domainkey` and the `send` **MX** exactly as they are.

Then, after 3–5 days of clean DMARC reports, come back and change `p=quarantine; sp=quarantine`
to **`p=reject; sp=reject`**. That flip is what actually stops other providers from delivering
fake loadboot.com mail to your carriers and brokers. Do not skip it — quarantine only means
"spam folder", reject means "refused at the door".

Optional but cheap, for subdomains that must never send mail:
`app.loadboot.com` TXT → `v=spf1 -all`, and `_dmarc.app.loadboot.com` TXT →
`v=DMARC1; p=reject;`.

### B. Make the DMARC reports readable

Create `dmarc@loadboot.com` (or an alias on hello@) and **whitelist** `dmarc.yahoo.com`,
`google.com` and `microsoft.com` senders so the reports stop going to Spam. Easiest alternative:
point `rua=` at a free aggregator that parses the XML for you and emails a weekly digest —
Postmark's is free and needs no account beyond a verification record.
Also rescue the Yahoo reports currently in Spam: those tell us the spoofing volume and the
sending IPs, which is what an abuse complaint needs.

### C. PrivateEmail account lockdown

1. **Confirm no `no-reply@` mailbox or alias exists** — PrivateEmail dashboard → Mailboxes /
   Aliases. `no-reply@loadboot.com` is only ever a *From address used by Resend*, never a mailbox.
   If a mailbox by that name exists and you did not create it, that is a breach, not a spoof.
2. Change the **hello@loadboot.com** password and enable **2FA**.
3. Check **forwarding rules / auto-reply / filters** on hello@ — attackers plant a silent
   forward-a-copy rule. Also revoke any app passwords you do not recognise.
4. Check the **Sent** folder and login history for anything you did not send.
5. DKIM is already on for this domain (`privateemail._domainkey`) — nothing to change.

### D. Rotate the Resend key if there is any doubt

If the headers show the phishing mail was DKIM-signed `d=loadboot.com` via Resend, then your
`RESEND_API_KEY` is compromised: rotate it in Resend, update the Supabase Edge Function secret
`RESEND_API_KEY` and the Supabase SMTP settings in **both** projects, and read Resend's send log.
If the headers show SPF softfail / no DKIM (the expected outcome), the key is fine.

### E. Protect the carriers and brokers

1. DMARC `p=reject` (step A) is the single measure that protects them — it is not optional.
2. Add a permanent line to `security.html` and to outgoing system emails:
   *"LoadBoot will never email you asking for your password, and never asks you to 'confirm' or
   'reactivate' a password. Our email only ever comes from @loadboot.com and we will never link
   you to a login page from an email."*
3. Report the phishing URL behind that button — Google Safe Browsing
   (`safebrowsing.google.com/safebrowsing/report_phish/`) and the hosting provider's abuse@.
   Do **not** click it; copy the link target.

---

## How to prove spoof vs. breach (30 seconds)

Open the message in webmail → click the **`</>`** icon in the toolbar (view source) → look at the
top of the headers for `Authentication-Results:` and `Received:`.

- **Spoof (expected):** `spf=softfail` or `spf=fail`, `dkim=none`, `dmarc=fail`, and the first
  `Received:` shows some unrelated IP / hosting provider. Nothing of yours is compromised —
  fix the DNS.
- **Breach (act immediately):** `spf=pass` **and** `dkim=pass header.d=loadboot.com`, with a
  `Received:` from `privateemail.com` or `amazonses.com`. Then someone is sending through your
  own account or your Resend key — rotate credentials first, DNS second.

The fact that all three copies were filed into **Spam** by your own provider already points
strongly at spoof.
