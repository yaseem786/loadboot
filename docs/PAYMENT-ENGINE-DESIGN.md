# LoadBoot Payment Engine — Design (2026-07-12)
Maqsad: Uber Freight / Amazon Relay jaisa payment system — mostly AUTO, human sirf
jab majboori ho. Neeche pehle "bare log kaise karte hain", phir LoadBoot ka 3-phase plan.

---

## 1. Bare brands kaise karte hain (research summary)

**Uber Freight** — wo khud BROKER-OF-RECORD hai (shipper Uber ko pay karta hai, Uber carrier ko).
Standard: POD approve hone ke 30 din mein ACH. Fast options: Top Carrier status = 2 din FREE;
Quick Pay = 2 din, 2.5% fee; Uber Freight Card = same-day (POD ke 2 ghante baad tak).
Sabaq: **speed ek PRODUCT hai** — jaldi paisa chahiye to fee do, warna free net-30.

**Amazon Relay** — invoices AUTO-GENERATE hote hain (carrier kuch nahi banata), weekly cycle
(Sun–Sat ka kaam agle Friday pay), disputes portal ke andar 30 din tak. 1–3 din payment bhi
offer karte hain, bina fee. Sabaq: **carrier se invoice mat mangwao — system khud banaye.**

**TriumphPay** — brokers/factors/carriers ke beech ka payments NETWORK. Factor-of-record +
NOA (Notice of Assignment) handle karta hai, OCR+ML se fraud/audit. Sabaq: factoring
integration zaroori hai — bohot carriers factor use karte hain, unka paisa factor ko jata hai.

**DAT + OTR Solutions** — load board par "blue checkmark" = ye load factoring-approved hai,
book karo aur minutes mein paisa (Bolt instant funding). Sabaq: **"guaranteed pay" ka nishan
board par hi dikhao** — booking barhti hai.

**Licensing ki asal baat:** koi bhi apna "wallet" nahi banata. Paise hold karna US mein
money-transmission license mangta hai (state-by-state). Bachne ke 3 halal raste:
(a) khud freight BROKER-OF-RECORD bano (MC authority + $75k BMC-84 bond) — freight charges
collect/pay karna brokerage ka normal hissa hai (Uber/Amazon yehi hain);
(b) payments LICENSED PROCESSOR ke through karo (Stripe Connect — "agent of payee" structure);
(c) FACTORING partner ke saath integrate karo (paisa unke license par chalta hai).
LoadBoot in teeno ko phases mein use karega.

---

## 2. LoadBoot ka 3-phase plan

### PHASE 0 — ABHI (0 license, 0 company, Payoneer) · "Direct pay + auto ledger"
Paisa LoadBoot ke haath se NAHI guzarta — sirf TRACK aur ENFORCE hota hai.

Flow (sab auto):
1. POD approve → **invoice khud ban jaye** (Amazon-style) broker ke naam, PDF + email
   hello@ se; due date = rate con ki terms (default Net 30). Carrier kuch type nahi karta.
2. Broker carrier ko DIRECT pay karta hai (ACH/check — jaise ab hota hai).
3. Portal mein dono taraf status chips: `INVOICED → DUE IN 12d → PAID / OVERDUE`.
   Carrier "✓ Payment mili" dabaye ya 3 din tak kuch na kare to auto-reminder.
4. Reminders auto: due se 3 din pehle broker ko, due par, overdue +3/+7/+14 par
   (14+ = CC exceptions queue mein aa jaye — YAHAN pehli dafa human aata hai).
5. **LoadBoot ki 5% fee:** har hafta carrier ko auto STATEMENT (jitne trips settle hue,
   5% ka total) + **Payoneer payment-request link** usi email mein. Overdue 7 din =
   board access pause (enforcement ka asli hathiyar — koi ladai nahi, system khud rokta hai).
6. Carrier jo factor use karta hai: profile mein "Factoring company + NOA upload" field —
   invoice PDF par khud likha aaye "Pay to: <factor name>" (TriumphPay-style NOA respect).

Banane ki cheezein (DB/RPC — Claude banayega): `lb_invoices` (auto-gen on POD approval),
`payment_ledger` (double-entry: kis ne kisko kitna, kis cheez ka), `fee_statements`,
`dunning_events` (kaunsa reminder kab gaya), CC "Money Radar" page (aging buckets 0-30/31-60/
61-90, exceptions queue), carrier `#payments` tab, broker `Billing` tab + due-date widget.

### PHASE 1 — 3–6 mahine (US LLC + Stripe Connect) · "Paisa LoadBoot ke through"
Ab broker LoadBoot ko pay karta hai, LoadBoot 5% kaat kar carrier ko bhejta hai — sab auto.

- **Company: US LLC** (Wyoming/Delaware — doola/Firstbase/Atlas se remote ban jati hai) +
  EIN + Mercury bank + **Stripe US**. UK Ltd bhi Stripe deta hai LEKIN US brokers ka
  standard rail **ACH** hai jo US Stripe/US bank par native hai (UK par Bacs hota hai, ACH
  nahi) — customers 100% US hain to US LLC behtar. Payoneer sath chalta rahega (owner payouts).
  ⚠️ Foreign-owned LLC = IRS Form 5472 har saal lazmi ($25k penalty miss par) — accountant rakho.
- **Collect:** Stripe se broker ACH debit (sasta, ~0.8%) ya card (+3% surcharge broker par).
- **Pay out:** Stripe **Connect** — har carrier ek connected account (Stripe KYC/onboarding
  khud karta hai, 1099 bhi). Payment aate hi split: 95% carrier, 5% platform fee LoadBoot.
  Money-transmission ka bojh Stripe (licensed) par — hum agent-of-payee structure mein.
- **QuickPay product (revenue!):** POD approve → carrier ko option: "Standard (broker pay
  hone par, free)" ya "QuickPay 2 din — 2% fee" (Uber 2.5% leta hai). Shuru mein QuickPay
  sirf un brokers ke loads par jo pehle time par pay karte rahe (risk control), funding
  LoadBoot ke working capital ya factoring partner se.
- **Broker credit:** naya broker = FMCSA bond check auto + chhoti credit limit; time par
  pay karta jaye to limit auto barhe. Late = board par uske loads ka "pay score" girta hai.

### PHASE 2 — Scale · "Broker-of-record ya factoring network"
Do raste (dono compatible):
- **LoadBoot khud broker authority le** (MC + $75k BMC-84 bond, ~$3-5k/yr cost): shipper/
  broker LoadBoot ko pay karta hai as broker — Uber Freight model, poora margin control,
  "guaranteed pay by LoadBoot" har load par. Ye tab jab volume justify kare.
- **Factoring partnership (OTR/Triumph-style):** board par "⚡ Instant pay" checkmark —
  carrier book karte waqt hi jaanta hai ke ye load minutes mein pay hoga. Factor risk leta
  hai, LoadBoot referral fee kamata hai.

---

## 3. Automation rules (human kab aaye)
AUTO: invoice banna, bhejna, reminders, statements, fee requests, status chips, aging,
board-pause on overdue, NOA-respect, payout splits (Phase 1), QuickPay offer/execution.
HUMAN sirf jab: (1) dispute file ho (amount/detention par ikhtilaf), (2) payment aayi lekin
amount match nahi (reconciliation fail), (3) overdue 14+ din (call karna parega),
(4) fraud flag (naya broker + bara load + jaldi ki demand). Ye chaaron CC "Money Radar"
ke EXCEPTIONS queue mein aayen — baqi sab kuch kabhi insaan ke saamne na aaye.

## 4. Pehla qadam (is hafte, Claude coding)
Phase 0 ka core: auto-invoice on POD approval + due-date tracking + reminders + carrier
#payments tab + CC Money Radar. Ye sab staging par banega, aap test karoge.
⚠️ Ye document business design hai — company formation/tax/licensing se pehle ek
US-familiar accountant/lawyer se 1 consult zaroor (main lawyer nahi hun).

## Sources
- Uber Freight payments/QuickPay: help.uber.com · uber.com/legal (Quick Pay T&C) · uberfreight.com blog
- Amazon Relay FAQ/payments: relay.amazon.com/faq · truckinfo.net/guide/amazon-relay
- TriumphPay network/factor-of-record: triumph.io · support.triumphpay.com
- DAT+OTR instant funding: otrsolutions.com/partnership/dat-freight-analytics · dat.com/blog
- Money transmission/agent-of-payee: moderntreasury.com/journal/how-do-money-transmission-laws-work · cooley.com (CA agent-of-payee)
- FMCSA broker financial responsibility rule (2026): fmcsa.dot.gov
- US LLC for non-residents / Form 5472: stripe.com/resources · docs.stripe.com/atlas
