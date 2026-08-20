# LoadBoot — Payment System Design + Which Account (20 Aug 2026)

**Faisla jo aap ne kiya (aur yeh bilkul durust hai):**
LoadBoot broker se payment **nahin** leta. Broker seedha **carrier ke bank** mein pay karta hai, ya agar
carrier factoring par hai to **factor ko NOA ke tehat** (UCC §9-406). LoadBoot sirf **apni dispatch fee**
leta hai carrier se.

Yeh already `docs/research/independent-dispatcher-payment-model.md` mein documented hai aur
FMCSA 88 FR 39368 ke saath match karta hai. Ab sirf **rails** banane hain.

---

## 1. Sab se pehle — is faisle ne masla 90% chhota kar diya

Freight money LoadBoot ke account se nahin guzarta. To LoadBoot ke account ko sirf **teen** kaam karne hain:

| # | Flow | Size |
|---|---|---|
| A | Carrier → LoadBoot: **5% dispatch fee** aata hua | chhoti raqmein, US se |
| B | LoadBoot → Agent: **1% referral** jata hua | chhoti raqmein, US ko |
| C | LoadBoot → Owner: draw | Pakistan |

Yeh **normal B2B service business** ka profile hai — money-transmission ka profile nahin.
Isi liye Payoneer jaisa account ab kaam kar sakta hai. **Agar aap freight money route karte, to koi
provider tikta hi nahin.**

---

## 2. Account — ek bank nahin, teen layer

### Layer 1 — abhi: **Payoneer Business (LoadBoot LLC)** ✅
Yehi receive-layer hai. (Production `payment_config` mein already Payoneer likha hua hai — matlab yeh
plan pehle se system mein hai, bas account nahin bana.)

- USD Receiving Account milta hai (routing + account no., Community Federal Savings Bank) → carriers
  aur factors **ACH push** kar sakte hain.
- **Request a Payment** feature: carrier ko link jata hai, wo **ACH ya card** se pay kar deta hai.
- PKR withdrawal HBL ke through.
- Business category: **Logistics / freight dispatch services**. ❌ "payments", "financial services",
  "money transfer" kabhi mat likhein.

**Hadd:** check deposit nahin, Stripe payout destination nahin, ACH **debit** (auto-deduct) nahin.

### Layer 2 — backup: **Airwallex** (free try, ummeed kam)
Pakistan onboarding-eligible list par nahin hai lekin prohibited bhi nahin. Apply kar lein — mil gaya to
bonus, warna kuch nahin gaya. **Ispe plan mat banayein.**

### Layer 3 — 2–3 mahine mein: **asli US bank (ITIN + US visit → Wells Fargo)**
Yeh wo darwaza hai jo baqi sab kholta hai:
- **Stripe** → card + **ACH auto-debit** (fee collection ka asal hal)
- **QuickBooks Payments** → QBO ke production keys pehle se LIVE hain, sirf US bank + ITIN ki kami hai
- Check deposit (US brokers/carriers abhi bhi check bhejte hain)
- Melio/Bill.com se agent payouts

❌ Mercury, Relay, Wise Business — apply hi mat karein (Pakistan residence).

---

## 3. Payment system — chaar flows, alag alag rails

### Flow 1 — Freight money (LoadBoot ka nahin)
- **Non-factored:** broker → carrier ka apna bank, ACH, net-30/45.
- **Factored:** broker → factor ka remit-to (NOA). Broker NOA milne ke baad carrier ko pay kare to
  **debt discharge nahin hota** — usay do baar pay karna par sakta hai (UCC §9-406).
- **LoadBoot ka kaam:** ledger, POD proof, pay-by deadline, reminders, factor ka remit-to broker ko
  dikhana (`pay_instructions`, `cc_factoring_verify` — pehle se bana hua). **Zero dollars.**

### Flow 2 — 5% dispatch fee ANDAR (carrier → LoadBoot) ⭐ asal masla yehi hai
Teen tareeqe, reliability ke hisab se:

**(a) Factor deduction — sab se behtar.**
Carrier apne factor ko **likhit authorization** deta hai: "meri funding se LoadBoot ki dispatch fee
kaat kar LoadBoot ko bhej do." Paisa carrier ke funds se nikalta hai, factor sirf disburse karta hai.
Collection risk **khatam**.
- Zaroori wording: *"Carrier directs its factor to pay LoadBoot's invoice **out of Carrier's funds**"* —
  **na** yeh ke LoadBoot freight ka hissa le raha hai. Yeh farq compliance ke liye ahem hai.
- Har factor ka apna process hai — Apex, OTR Solutions, RTS, TAFS, Triumph se **likhit** confirm karein
  ke wo third-party deduction support karte hain. Zabani par bharosa na karein.
- Naye carriers ki barri tadaad factoring par hoti hai → coverage achi hogi.

**(b) ACH auto-debit carrier ke bank se** — dispatch agreement mein authorization (capped + revocable).
Iske liye ACH originator chahiye (Stripe/GoCardless/Moov) → **Layer 3 ke baad**. Yeh long-term default
hona chahiye.

**(c) Invoice + carrier khud pay kare** (Payoneer request link: ACH ya card) — **aaj yehi available hai**.
⚠️ Industry mein dispatchers ki fee ka acha khasa hissa isi tareeqe se doob jata hai. Isliye:
- weekly cadence (mahana nahin — jitna purana invoice, utna kam wasool),
- naye carrier se pehle 2–4 hafte **card on file** ya deposit,
- 15-din dispute window ke baad service pause (agreement §8/§14 already allow karte hain).

➡️ **Aaj ka rule:** carrier factoring par hai → (a). Warna → (c) + weekly. (b) Layer 3 ke baad default.

### Flow 3 — Agent ka 1% BAHAR
- Payoneer "Make a Payment" (US bank ya Payoneer-to-Payoneer). Baad mein Melio/QBO.
- ⚠️ **W-9 + 1099-NEC:** US agent ko saal mein $600+ diya to 1099-NEC file karna parega. Iska matlab
  **agent onboarding par W-9 lena zaroori hai**. `w9-form.js` abhi carrier ke liye hai — agent/referral
  flow par bhi lagana paray ga. Abhi payouts 0 hain, isliye ab karna aasan hai.

### Flow 4 — Owner draw
Payoneer → HBL (PKR). Books mein **owner draw/distribution** likhein, salary nahin. FBR Wealth
Statement mein LLC declare karna hai.

---

## 4. 🚩 Teen cheezein product mein theek karni hain (paisa chalne se PEHLE)

**1. Dispatch agreement §7 ka lafz "settlement deduction" khatarnak hai.**
Abhi likha hai: *"collected by settlement deduction or invoice as selected at onboarding."*
"Settlement deduction" ka matlab banta hai ke LoadBoot carrier ko settle karta hai — yani freight money
LoadBoot ke paas aati hai. Yeh **theek wohi cheez hai jo 88 FR 39368 ke tehat broker bana deti hai**,
aur ye aap ke apne compliance guide ke khilaf hai.

Badal kar yeh karein:
> "The fee is collected by invoice, by Carrier-authorized ACH debit, or by Carrier's written
> authorization to its factoring company to remit the fee **from Carrier's funds**. LoadBoot does not
> hold, receive, or disburse freight payments."

Aakhri jumla carrier ke liye bhi **trust signal** hai — fraud-heavy market mein yeh bechne layaq baat hai.

**2. Production payment instructions abhi dead-end hain.**
`payment_config` kehta hai "Payoneer: request a payment link from billing@loadboot.com" — lekin Payoneer
account mojood nahin. Jo bhi pay karne ki koshish karega wo atak jayega. Ya to Payoneer aaj banayein, ya
text abhi soft kar dein.

**3. Abhi tak kuch beha nahin — yeh achi khabar hai.**
Production: 1 invoice, 1 settlement, 2 partner invoices, 0 referral payouts, 0 settlements table.
Yani **saaf slate**. Ab theek kar lein, baad mein migrate karna 10 guna mushkil hoga.

---

## 5. Tarteeb

| Kab | Kaam |
|---|---|
| Hafta 1 | Payoneer Business apply (logistics category) · dispatch agreement §7 ka lafz theek · payment_config text update |
| Hafta 1 | ITIN (Form W-7, CAA ke zariye) shuru — 2–3 mahine lagte hain, aaj shuru karein |
| Hafta 2 | Factor deduction: 3–4 factors se likhit confirmation + ek 1-page "Third-Party Payment Authorization" template banayein |
| Hafta 2 | Agent onboarding mein W-9 add karein |
| Hafta 3 | Onboarding mein fee-collection method ka choice: `factor_deduction` / `invoice` / `ach_debit` (future) — DB field + carrier ko dikhana |
| Mahina 2–3 | ITIN → US visit → Wells Fargo → phir Stripe ACH debit + QuickBooks Payments on karein |

---

## Sources
- [FMCSA 88 FR 39368 — broker / bona fide agent / dispatch services](https://www.federalregister.gov/documents/2023/06/16/2023-13080/definitions-of-broker-and-bona-fide-agents)
- [TruckLeap — how a dispatcher gets paid (broker→carrier→dispatcher)](https://truckleap.com/blog/how-does-a-truck-dispatcher-get-paid)
- [LearnDispatch — dispatchers & factoring companies](https://www.learndispatch.com/truck-dispatchers-and-factoring-companies/)
- [Apex — what is a Notice of Assignment](https://www.apexcapitalcorp.com/blog/what-is-a-notice-of-assignment/)
- [Payoneer — SWIFT vs ACH transfers](https://www.payoneer.com/resources/business/payoneer-swift-ach-transfers/)
- [Mercury — prohibited countries](https://support.mercury.com/hc/en-us/articles/28771710754580-Prohibited-countries)
- Repo: `docs/research/independent-dispatcher-payment-model.md`, `docs/research/dispatch-compliance-operating-guide.md`, `docs/banking/US-BANK-ACCOUNT-PLAN.md`

---

# ADDENDUM (20 Aug 2026) — "direct payment" broker status khatam nahin karta

Sawal: *broker LoadBoot par ho ya shipper ho, ya DAT se load le kar carrier ko assign karein — har haal
mein broker seedha carrier ko pay karega na?*

**Payment ka jawab: HAAN.** Teenon soorton mein broker of record seedha carrier ke bank (ya factor ko
NOA ke tehat) pay karta hai. LoadBoot ka account kabhi beech mein nahin aata. Yeh bilkul durust hai.

**Lekin yeh kaafi nahin.** FMCSA 88 FR 39368 ke apne alfaz:

> "Handling money exchanged between shippers and motor carriers is **one factor** that strongly suggests
> the need for broker authority, **but it is not an essential requirement** for one to be considered a
> broker."

Yani "hum paisa nahin chhoote" se aap broker banne se **nahin** bachte. Asal test alag hai.

## Teen soorat-e-haal alag alag hain

| Soorat | Carrier ko pay kaun karta hai | LoadBoot ki legal position |
|---|---|---|
| **Broker LoadBoot par hai**, load post karta hai, carrier khud accept karta hai | Broker → carrier/factor ✅ | ✅ Load-board carve-out lagta hai |
| **Shipper direct** LoadBoot par | Shipper → carrier ✅ | ⚠️ **Broker authority chahiye** |
| **External (DAT) broker** ka load, LoadBoot carrier ko **assign** karta hai | DAT broker → carrier/factor ✅ | ⚠️ "Assign" hi tripwire hai |

### 1. Broker LoadBoot par — ✅ theek
FMCSA:
> "Merely making information about potential shippers publicly available, **regardless of whether a fee
> is charged**, does not require an entity to obtain broker authority **as long as the entity making the
> leads available is not otherwise involved in any transaction** between the shipper and a motor carrier."

Achi khabar: **5% fee lene se yeh carve-out nahin tootta.** Shartein:
- Carrier **khud** accept kare — LoadBoot chune nahin.
- Rate confirmation broker → carrier ho; LoadBoot us par party na ho.
- LoadBoot broker se **koi** compensation na le (sirf carrier se dispatch fee).

### 2. Shipper direct — ⚠️ yahan broker authority chahiye
FMCSA saaf kehta hai ke agar dispatch service
> "interacts with or negotiates any shipment of freight **directly with the shipper**, or a
> representative of the shipper"

to **broker authority zaroori hai**. Direct payment se koi farq nahin parta.

➡️ Faisla: shipper-direct loads tab tak band rakhein jab tak MC broker authority + **$75,000 BMC-84 bond**
na ho — ya shipper ko kisi licensed broker ke zariye laayein.
(Broker authority lena mumkin hai: foreign ownership allowed, BOC-3 process agent chahiye. Agar
marketplace model asal plan hai to yeh khareedna hi sasta rasta hai — legal risk se sasta.)

### 3. DAT / external broker ka load — ⚠️ lafz "assign" hi masla hai
FMCSA ki tareef:
> "Allocating traffic" = **"any exercise of discretion on an agent's part when assigning a load to a
> motor carrier."**

- ❌ **Ghair-compliant:** DAT se load lein, phir apne carrier network mein se chunein ke kaun lega.
- ✅ **Compliant:** wo load **ek mutayyan carrier client** ke liye dhoondi jaye (written dispatch
  agreement + limited POA), rate con broker → wohi carrier, LoadBoot party nahin, fee carrier se.

## 🚩 Production mein abhi jo mojood hai (yehi asal risk hai — payment nahin)

| RPC | Kya karta hai | Masla |
|---|---|---|
| `cc_assign_load(p_load, p_carrier)` | Staff ek carrier chun kar load assign karta hai. Notification: **"🚚 Dispatch assigned you a load"** | Textbook "discretion when assigning a load to a motor carrier" |
| `cc_match_carriers_for_load(p_load)` | Ek load ke liye **kai carriers** ko score/rank karta hai | Discretion ka tool |
| `cc_offer_send(p_load, p_carriers[], …)` | Staff chunta hai kin carriers ko offer jaye | Recipient list chunna = selection |

**Ahem farq:** ek hi carrier ke **apne trucks** ke darmiyan load assign karna (`assign-optimizer.js`,
`carrier_fleet_plan`) bilkul theek hai — wahan aap us carrier ke dispatcher hain. **Mukhtalif carriers**
ke darmiyan chunna — yehi broker banata hai.

## Product mein kya karna hai
1. `cc_assign_load` sirf tab chale jab carrier ne pehle **khud accept** kiya ho (ya load usi carrier ka ho).
   Warna "assign" ki jagah "offer" ho.
2. Network par jane wala load = **first-accept-wins**, timestamped record ke saath.
3. `cc_offer_send` ki recipient list **objective/automatic** ho (compliance + equipment + lane + radius),
   staff ki pasand nahin. Ya sab eligible carriers ko broadcast.
4. **Shipper-direct posting band** jab tak broker authority na ho.
5. Har load par **broker-of-record** record; rate con par LoadBoot ka naam nahin.
6. Notification ka text badlein — "Dispatch assigned you a load" ki jagah "New load offer — accept karein".

> Aap ka apna research doc pehle hi kehta hai: *"get a transportation attorney to bless the agent-posting
> flow before scaling."* Ab jab paisa chalne wala hai, wo review ka waqt aa gaya hai.

## Addendum sources
- [FMCSA 88 FR 39368 — Definitions of Broker and Bona Fide Agents](https://www.federalregister.gov/documents/2023/06/16/2023-13080/definitions-of-broker-and-bona-fide-agents) (load-board carve-out, "allocating traffic", money-handling, shipper-contact test)
- [49 U.S.C. 13102 — definitions](https://uscode.house.gov/view.xhtml?req=granuleid%3AUSC-prelim-title49-section13102&num=0&edition=prelim)
