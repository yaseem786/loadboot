# Banking Plan v2 — Payoneer ke baad
_20 Aug 2026 — Payoneer permanently band nikla, is liye poora plan badla._

---

## ⛔ Payoneer khatam — aur is par koshish na karein

Email (19 Aug 2022): *"We have closed your Payoneer account… We will **not be able to reactivate your
Payoneer account for any reason**."*

Payoneer terminated user ko dobara account nahin deta — na individual, na company. Aap ka passport/ID
unke system mein hai; company account ka UBO bhi aap hi hain, to link foran ban jayega.

**Yeh koshishein hargiz na karein:**
- Naya account apne naam par
- Kisi rishtedar/dost ke naam par account ("bas withdrawal ke liye")
- VPN / anti-detect browser se doosri identity

Yeh sirf T&C violation nahin — kisi financial institution ki termination ko chakma dena hai. Natija
hamesha aik hi hota hai: account band, **aur paisa 90–180 din ke liye phans jata hai**. Us waqt aap ke
carriers ka paisa us mein hoga. Risk lene layak cheez nahin.

**Aik jaiz koshish (tawaqqu kam rakhein):** Payoneer support ko saaf likh dein —
> "My personal account was closed in August 2022. I now operate a US-registered company, LoadBoot LLC.
> Am I eligible to apply for a company account, or does the previous closure permanently exclude me?"

Jawab "no" hi hoga, magar likhit "no" hona behtar hai — phir yeh baab band. Is par plan mat banayein.

---

## ✅ Ek ghalti jo main ne pehle ki thi — aur woh aap ke haq mein hai

Main ne pehle kaha tha "Wise band hai." **Woh sirf Wise ke PERSONAL account ke liye sach hai.**
Pakistan mein rehne wala shakhs apne naam par Wise se USD receive nahin kar sakta.

**Lekin Wise BUSINESS alag cheez hai — wahan jo mulk maayne rakhta hai wo _business_ ka hai, aap ka
nahin.** LoadBoot LLC ek US company hai. Wise ki koi published unsupported-countries list nahin hai;
Pakistani founders accept hote hain, bas KYC sakht hota hai.

➡️ **Wise Business ab pehla option hai.**

---

## Naya stack

| Layer | Kya | Halat |
|---|---|---|
| **1. Primary** | **Wise Business** — LoadBoot LLC ke naam par | USD account details (routing + account no.), **ACH receiving free**, one-time ~$31 activation, wire ~$6.11. Yehi wo cheez hai jo carriers ko chahiye. |
| **2. Backup (parallel)** | **Airwallex** | 2026 mein non-resident LLC owners ke liye "noticeably more flexible" bataya jata hai. Free hai — saath hi apply kar dein. |
| **3. Long-term** | **ITIN → US visit → Wells Fargo** | Yehi Stripe ACH-debit, QuickBooks Payments (QBO production keys already live) aur check deposit kholta hai. Aaj hi shuru karein. |
| ❌ | Mercury, Relay | Pakistan inki **apni published prohibited list** par hai. |

> ⚠️ **Vendor blogs par yaqeen na karein.** Kuch Pakistani "LLC setup" companies aaj bhi bechti hain ke
> "Mercury/Relay Pakistani founders ko approve kar rahe hain." Mercury ka **apna** support page Pakistan
> ko 47 prohibited countries mein ginwata hai. Un ka page unke marketing se zyada mo'tabar hai.
> Paise de kar aisi application dena = reject + record.

---

## 🚪 Asal darwaza: address — yeh teenon ko block karta hai

`30 N Gould St, **Ste N**, Sheridan WY` — yeh Registered Agents Inc ka shared-floor address hai jis par
hazaaron LLCs registered hain. 2026 mein yeh **automated rejection trigger** hai; Sheridan ke high-volume
addresses ka naam le kar likha jata hai. Wise bhi RA address accept nahin karta.

**Pehle yeh theek karein, warna teenon jagah reject hoga:**
1. Apne registered agent se **unique suite/mailbox number** maangein (shared floor nahin) — sasta aur foran.
2. Behtar: asli virtual office / coworking jo **signed lease ya mail agreement** de (Regus type)
   — mailbox-only services se behtar.
3. Sab se behtar: kisi asli US-based person ka address jo LoadBoot mein waqai role rakhta ho.
4. WY ka RA address sirf **state registration** ke liye rakhein, banking forms par nahin.

---

## 📋 Wise Business — documents

| # | Document | Notes |
|---|---|---|
| 1 | **Wyoming Articles/Certificate of Organization** | Stamped copy |
| 2 | **EIN proof** | CP 575 ✅ (147C ya IRS-stamped SS-4 bhi chalte hain) |
| 3 | **Operating Agreement** | Single-member |
| 4 | **Passport** | Valid |
| 5 | **Personal address proof** | Utility bill / bank statement, 3 mahine se purana nahin |
| 6 | **Business address proof** | Naye address ka lease / mail agreement |
| 7 | Selfie / video KYC | Live |

---

## ✍️ Application answer sheet

| Field | Kya likhna hai |
|---|---|
| Account type | **Business** |
| Business country of registration | **United States** |
| Business type | **LLC** |
| Legal name | **`LoadBoot LLC`** — Articles se hu-ba-hu |
| Registration number | Wyoming **filing ID** (⚠️ EIN nahin) |
| Tax ID (EIN) | CP 575 wala |
| Business address | **naya asli address** (RA wala nahin) |
| Website | `https://loadboot.com` ✅ aap ki sab se bari taqat |
| Email | **`@loadboot.com`** domain email — gmail nahin |
| Industry | **Transportation & Logistics → freight dispatch / logistics services** |
| ❌ Kabhi nahin | Financial services · Payments · Money transfer · Escrow · Marketplace |
| Kaun pay karega | "US-registered motor carriers (small trucking companies)" |
| Kis mulk se paisa aayega | United States |
| Expected monthly volume | **haqeeqi chhota** ($1,000–$5,000/mo). Barha kar likhna extra scrutiny khinchta hai |
| Owner / UBO | Aap, 100%, Pakistan residential address |

### Business description — copy karein
> LoadBoot LLC provides truck dispatch and back-office software services to US motor carriers. Carriers
> pay LoadBoot a service fee for load sourcing, paperwork, and compliance support. **LoadBoot does not
> handle freight payments — brokers pay carriers directly, or the carrier's factoring company under a
> notice of assignment.** LoadBoot only receives its own service fee.

Aakhri jumla jaan-boojh kar hai: reviewer ka pehla sawal yehi hota hai ke kya aap doosron ka paisa
handle karte hain (kyunke woh unlicensed money transmission hoti hai). Pehle hi jawab de dena application
mazboot karta hai.

---

## 🚫 Rejection ki 5 bari wajuhat (2026 ke Pakistani applicants par darj)
1. **Flagged RA address** (Sheridan shared floor) — upar wala step
2. **Website adhoora ya placeholder text** — loadboot.com par har page live hona chahiye
3. **Business description alag alag jagah alag** — Wise, Airwallex, EIN, website: aik hi jumla
4. **Documents mein naam ka farq** — "LoadBoot LLC" vs "Loadboot L.L.C."
5. **Client/transaction evidence na hona** — 1–2 signed dispatch agreements ya invoices tayyar rakhein
6. Aur: **VPN / anti-detect browser se apply karna** — aam Pakistani connection, aam Chrome

---

## Tarteeb
| # | Kaam | Kab |
|---|---|---|
| 1 | Payoneer ko aik saaf email (record ke liye), phir bhool jayein | Aaj |
| 2 | **Naya US business address** hasil karein | Yeh sab se pehla blocker |
| 3 | Operating Agreement + `@loadboot.com` email + US phone | Is hafte |
| 4 | **Wise Business** apply | Address milte hi |
| 5 | **Airwallex** parallel apply | Usi din |
| 6 | **ITIN (W-7 via CAA)** shuru | Ab — 2–3 mahine lagte hain |
| 7 | CPA (foreign-owned LLC / Form 5472) | Sept tak |
| 8 | `payment_config` ka Payoneer wala text hatayein | Bank milte hi |

---

## Sources
- [Wise Business for a US LLC — non-resident guide](https://bizstartz.com/wise-business-account-for-us-llc/) — LLC + EIN required; no published unsupported-country list; Pakistan accepted with enhanced KYC; USD routing/account details ~$31 one-time, ACH receiving free
- [StartGlobal — Wise in Pakistan with a US LLC](https://startglobal.co/us/international/pakistan/wise/) — personal Pakistan accounts can't get USD details, the US LLC changes eligibility
- [Xpezia — best bank account for US LLC non-residents](https://www.xpezia.com.pk/guides/banking/best-bank-account-for-us-llc-non-residents/) — Airwallex flexibility, Sheridan shared-address auto-rejection, top rejection reasons ⚠️ vendor source; its Mercury/Relay claims contradict Mercury's own page
- [Mercury — prohibited countries](https://support.mercury.com/hc/en-us/articles/28771710754580-Prohibited-countries) — Pakistan listed
- [LLC University — non-resident LLC bank accounts](https://www.llcuniversity.com/foreigners/open-us-bank-account-llc-non-resident/) — Wise/Mercury no longer accept registered-agent addresses

---

# ADDENDUM — ITIN: free hai, lekin shayad abhi mil hi na sake

## Kitna kharch?
**IRS ek rupya nahin leta. Form W-7 bilkul free hai.** Kharch sirf tareeqe ka hota hai:

| Tareeqa | Kharch | Trade-off |
|---|---|---|
| **Khud mail karein** (Austin, TX) | **$0** + certification fee + courier (~$25–75) | Overseas se **9–11 hafte**; rejection risk zyada |
| **IRS Taxpayer Assistance Center** | **$0** | US mein hona zaroori hai |
| **Certifying Acceptance Agent (CAA)** | **$150–300** (Pakistan mein bhi CAAs hain) | Passport bhejna nahin parta, documents usi din wapas, rejection kam |

**Passport ka masla — aur uska free hal:** IRS asal passport maangta hai, **ya** aisi copy jise
**issuing agency ne certify kiya ho** (Pakistan ka DGIP / passport office, official stamped seal ke
saath) — **ya US embassy/consulate se certified**. Yani asal passport 2–3 mahine ke liye bhejne ki
zaroorat **nahin**. Yehi asal "free" rasta hai.

## ⚠️ Lekin pehle yeh — sirf bank account ke liye ITIN nahin milta

IRS ka saaf mauqif: **bank account kholna ITIN ki valid wajah nahin hai.** Form W-7 ke saath aam tor par
**US tax return (Form 1040-NR)** lagana parta hai, ya paanch mein se koi Exception poori karni hoti hai
(passive income + withholding, wages/scholarship, mortgage interest, US property ki farokht, ya foreign
corporation ka representative). In mein se koi bhi filhal aap par lagoo nahin lagti.

Yani sawal yeh ban jata hai: **kya aap par US tax return file karne ki zimmedari banti hai?**

- Agar saara kaam **Pakistan se** hota hai aur US mein koi kaam karne wala nahin → aam tor par income
  US-source nahi manee jati → **koi 1040-NR nahin → ITIN ki koi valid wajah nahin → W-7 reject.**
- Agar LoadBoot ke **US mein maujood dispatchers/agents** aap ki taraf se kaam karte hain → yeh
  "US trade or business" ban jata hai → **effectively connected income** → 1040-NR **lazmi** →
  ITIN reason (b) mil jata hai ✅ — **magar sath hi US tax bhi banta hai.**

LoadBoot ka dispatcher/agent model dekhte hue yeh koi farzi sawal nahin. Yeh **CPA ka faisla** hai,
mera nahin — aur is mein asal paisa laga hua hai.

## Is liye tarteeb badalti hai
> Main ne pehle kaha tha "ITIN aaj hi shuru kar dein." Yeh durust nahin tha — pehle yeh tay hona chahiye
> ke aap **eligible** bhi hain ya nahin, warna W-7 reject ho kar 3 mahine zaya honge.

1. **Address theek karein** → Wise Business + Airwallex apply. **In ke liye ITIN darkar hi nahin** —
   non-resident LLC accounts bina SSN/ITIN khulte hain.
2. **CPA se baat karein** (foreign-owned single-member LLC ka tajurba rakhta ho). Do sawal:
   - Kya LoadBoot "engaged in a US trade or business" hai? ECI banti hai?
   - Form 5472 + pro-forma 1120 (15 April, **$25,000/saal penalty**) — yeh waise bhi lazmi hai, aur
     is ke liye **aap ka ITIN darkar nahin**, sirf LLC ka EIN chahiye.
3. **ITIN sirf tab** jab CPA kahe ke filing obligation banti hai. Us waqt CAA ka $150–300 dena
   free wale raste se behtar hai — passport ghar par rehta hai aur rejection ka risk kam.

ITIN asal mein kis kaam aata hai: US branch mein ja kar account kholna (wo aam tor par maangte hain),
aur Stripe / QuickBooks Payments jaise processors. **Wise aur Airwallex ke liye zaroorat nahin.**

## Addendum sources
- [IRS — How do I apply for an ITIN](https://www.irs.gov/individuals/how-do-i-apply-for-an-itin) — teen tareeqe, TAC "free", 7 hafte (9–11 overseas)
- [IRS — Obtaining an ITIN from abroad](https://www.irs.gov/individuals/international-taxpayers/obtaining-an-itin-from-abroad) — issuing agency ki certified copy qabool
- [IRS — Instructions for Form W-7](https://www.irs.gov/instructions/iw7) — reasons a–h, paanch Exceptions, "bank account alone is not valid", embassy/consulate certification
- [Greenback — ITIN cost](https://www.greenbacktaxservices.com/knowledge-center/itin-cost/) — IRS fee $0; CAA $150–300

---

# ADDENDUM 2 — Wise vs Airwallex: fee ka hisaab (20 Aug 2026)

Sawal: *"Wise par fee lagti hai, to Airwallex chalein?"*
Jawab: **ulta hai.** Airwallex "free" dikhta hai magar LoadBoot jaise naye account par **mehanga** parta hai.

| | **Wise Business** | **Airwallex** |
|---|---|---|
| Setup | **$31 — aik dafa** (account details activate karne par) | $0 |
| **Monthly** | **$0** | **$29/mah** — sirf tab maaf jab **$10,000 balance** ya **$5,000/mah deposits** hon |
| ACH receive (US carriers) | **Free** | $0 (local rails) |
| Incoming USD wire | $6.11 | account par depend |
| FX → PKR | ~0.4–1% | 0.5% (major) / 1% |

## Pehle saal ka asal kharch
- **Wise:** `$31` — bas.
- **Airwallex:** LoadBoot ka abhi revenue taqreeban zero hai (prod mein 1 invoice, 0 settlements).
  Na $10,000 balance hoga, na $5,000/mah deposits → **$29 × 12 = $348**.

Airwallex tab free hota hai jab $5,000/mah aap ke account mein aayein. 5% dispatch fee par iska matlab
hai **$100,000/mah ka linehaul** book hona. Wahan tak pohanchne mein waqt hai.

➡️ **Wise pehle. Airwallex sirf backup — tab kholein jab Wise reject kare.** Application dono ki free
hai; Wise ka $31 bhi tab hi katta hai jab account approve ho kar details activate hon. Yani apply karne
ka koi kharch nahin.

## Do baatein jo fee se zyada ahem hain
1. **$31 par faisla na karein.** Asal kharch reject hona hai (mahine zaya) aur ghalat provider par
   $348/saal. Address theek karna in dono se zyada faida deta hai.
2. **⚠️ Na Wise FDIC-insured hai, na Airwallex.** Paisa safeguarded partner accounts mein hota hai, bank
   deposit nahin. Carrier fees jama na karein — har hafte nikaal lein. Jab asli US bank khul jaye,
   balance wahan rakhein.

## Addendum 2 sources
- [Wise — fees for getting paid (US business)](https://wise.com/us/pricing/business/receive) — $31 one-time, ACH receive free, wire $6.11, no monthly
- [Airwallex non-resident founder review](https://jurisdb.org/bank/airwallex) — $0 setup, **$29/month unless $10k balance or $5k monthly deposits**, FX 0.5–1%, Wyoming LLC eligible

---

# ADDENDUM 3 — "$31 bhi na lagay" + Stripe + Payoneer ka sawal (20 Aug 2026)

## 1. Kya koi bilkul free option hai? — Dhoonda, nahin mila

| Option | Setup | Monthly | Pakistan owner | Faisla |
|---|---|---|---|---|
| **Mercury** | $0 | $0 | ❌ **prohibited list par** | Band |
| **Relay** | $0 | $0 | ❌ prohibited | Band |
| **Brex** | $0 | $0 | — | ❌ **Shart: ya VC/angel investment li ho, ya $500,000+ saalana revenue.** Sath hi "US operations + US physical address", aur virtual address ho to beneficial owner ka **US mein physical presence** verify hona chahiye. LoadBoot par koi shart poori nahin hoti |
| **Airwallex** | $0 | **$29/mah** jab tak $10k balance ya $5k/mah deposits na hon | ❓ | Pehle saal **$348** |
| **Wise Business** | **$31 aik dafa** | **$0** | ✅ accept, KYC sakht | ✅ **sab se sasta jo waqai mumkin hai** |

**Nateeja: $31 hi sab se saste raste ki qeemat hai.** Jo option "free" hain, woh ya Pakistan ko block
karte hain ya funding/revenue maangte hain. Aur $31 **aik dafa** hai — Airwallex se pehle saal hi
**11 guna sasta**.

Aur soch lein: yeh $31 aik load ki dispatch fee ka choutha hissa hai. Is ke peeche hafte lagana
$31 bachane se zyada mehanga hai.

## 2. Stripe — achhi khabar hai

- ✅ **Stripe ko SSN/ITIN nahin chahiye.** US LLC ke liye woh **EIN** ko tax ID mana leta hai, aur aap ki
  shanakht **passport** se hoti hai. *"Your nationality does not block Stripe — your business entity does."*
- ✅ **Pakistan ke founders US LLC ke zariye Stripe le sakte hain** (Stripe Pakistan ki local businesses
  ko support nahin karta, magar US LLC wala rasta chalta hai).
- ✅ **Stripe aam tor par Wise ke USD account details payout ke liye qabool karta hai.** Kabhi kabhi
  setup ke waqt flag kar deta hai — us soorat mein doosra account chahiye hota hai.
- ❌ **Payoneer Stripe payout ke liye reliable nahin** — yeh pehle bhi likha tha, ab bhi wahi.

### Stripe ke liye 3 zaroori baatein
1. ⚠️ **EIN milne ke 48–72 ghante ke andar Stripe par apply na karein.** EIN aaj hi aaya hai — IRS ka
   record propagate hone se pehle apply karna real-time verification fail karata hai. Yeh non-residents
   ki #1 rejection wajah hai.
2. **Payout bank ka naam bilkul `LoadBoot LLC` ho** — Certificate of Formation se hu-ba-hu. Naam ka
   zara sa farq bhi reject karata hai.
3. **Website par pricing, Terms aur Privacy Policy live hon**, koi placeholder text na ho.
   loadboot.com is maamle mein aap ki taqat hai — bas check kar lein.

**Tarteeb:** address → Wise Business → (Wise approve hote hi) Stripe.

## 3. "Personal Payoneer band hai — business account khol kar link kar ke band kar dete hain?"

Aap ne theek samjha. Do baatein alag rakh kar:

**Jo yaqeeni hai:** aap ke apne email mein likha hai — *"We will not be able to reactivate your Payoneer
account for any reason."* Aur company account ka **Ultimate Beneficial Owner aap hi hain**, to KYC ke
waqt wahi passport dobara jata hai. Link ban'na tay hai.

**Jo main sabit nahin kar saka:** Payoneer ke apne Terms/FAQ safhaat machine se parhne se rok diye gaye
hain (robots.txt), is liye main unka lafz-ba-lafz hawala nahin de saka. Baqi tamam reporting yehi kehti
hai ke woh ID/passport/device se link kar ke naya account band kar dete hain.

**Faisla asal mein risk ka hai, umeed ka nahin.** Agar account beech operation mein band hua, paisa
**90–180 din** ke liye rok liya jata hai — aur us waqt us mein carriers ki fees hongi. Yeh risk $31
bachane ke liye lene layak nahin.

**Jaiz rasta (agar phir bhi try karna ho):** Payoneer support ko likh kar **pehle** poochein, aur
**likhit "yes" milne se pehle us par koi plan na banayein.** Kabhi bhi "khol kar dekhte hain" wala
tareeqa na apnayein.

## Addendum 3 sources
- [Brex — account requirements](https://www.brex.com/support/brex-account-requirements) — equity investment ya $500k+ revenue; US operations + US physical address; virtual address par UBO ka US physical presence
- [Brex — submitting an application](https://www.brex.com/support/submitting-an-application) — sirf US-registered companies
- [Rocket Wave — Stripe for non-US residents (2026)](https://rocketwave.co/stripe-setup-non-us-resident-us-llc/) — SSN nahin chahiye, EIN kaafi; Pakistan founders US LLC ke zariye; 48–72h wala gotcha; 5 rejection wajuhat
- [Invoiceforllc — Wise Business for US LLCs](https://invoiceforllc.com/blog/wise-business-us-llc-pros-cons) — Stripe aam tor par Wise USD details qabool karta hai, kabhi flag; $31 one-time; FDIC nahin
- [Wise — receiving fees](https://wise.com/us/pricing/business/receive) · [Airwallex review](https://jurisdb.org/bank/airwallex) · [Mercury — prohibited countries](https://support.mercury.com/hc/en-us/articles/28771710754580-Prohibited-countries)
