# LoadBoot LLC — US Bank Account Plan (20 Aug 2026)

**Situation:** EIN mil gaya. Entity = LoadBoot LLC, Wyoming (30 N Gould St, Ste N, Sheridan, WY 82801 —
yeh Registered Agent ka address hai). Owner Pakistan mein reside karta hai. SSN/ITIN nahin, sirf EIN.

---

## 1. Pehle yeh samajh lein — kaun se options band hain

Yeh koi "documents theek karo to ho jayega" wali baat nahin hai. Yeh **residence-based policy** hai:

| Provider | Status | Wajah |
|---|---|---|
| **Mercury** | ❌ BAND | Pakistan Mercury ki official *prohibited countries* list par hai (47 mulk). Aur Mercury registered-agent address bhi accept nahin karta. |
| **Relay** | ❌ BAND | Pakistan restricted. Relay citizenship *ya* residency dono par apply karta hai — Mercury se bhi sakht. |
| **Wise Business** | ❌ (practically) | Pakistan se Wise sirf **outbound send** ke liye chalta hai. USD receiving details / ACH routing number nahin milta — jo asal cheez chahiye. |
| **Lili / Novo / Found / Bluevine** | ❌ | Sab ko US resident + SSN chahiye. |
| **Airwallex** | ⚠️ Shayad | Pakistan onboarding-eligible list par nahin hai, lekin explicitly prohibited bhi nahin. Free hai — try kar sakte hain, lekin ispe plan mat banayein. |
| **Payoneer** | ✅ CHALTA HAI | Pakistan mein officially available, company account bhi. **Aaj ka realistic option yehi hai.** |
| **Traditional US bank (Wells Fargo / Chase / BoA)** | ✅ magar in-person | Branch jana parega. Sab se durable option — lekin US trip chahiye. |

> ⚠️ Mercury/Relay par application **mat** dalein. Reject hone ke baad wo record rehta hai, aur baad mein
> jab structure theek ho jaye to dobara apply karna mushkil ho jata hai.

---

## 2. Do cheezein jo kisi bhi bank se pehle theek karni hain

### (a) Registered Agent address chhorna parega
`30 N Gould St, Ste N, Sheridan WY` — yeh Registered Agents Inc ka mass-registration address hai.
Har compliance team ke database mein red-flagged hai (hazaaron shell LLCs isi address par hain).
Mercury to explicitly likhta hai: *"registered agent addresses, P.O. boxes, and UPS Store addresses are not accepted."*

Behtar se behtar tarteeb:
1. Kisi asli US-based person ka address jo LoadBoot mein waqai role rakhta ho (manager/ops).
2. Asli coworking / virtual office jo **signed lease ya mail agreement** deta ho (Regus, Alliance, iPostal se behtar Regus type).
3. RA address = sirf state registration ke liye rakhein, banking ke liye nahin.

### (b) US phone number
Google Voice / Telnyx / OpenPhone. Kuch platforms bina US number ke aage nahin jane dete.
LoadBoot ka already support number hai to wohi use karein — consistency achi lagti hai.

---

## 3. Aaj se shuru karne wala rasta — Payoneer (Track A)

**Time: 3–7 din. Cost: free.**

Documents jo chahiye honge (sab PDF, LLC ke exact legal naam ke saath — *LoadBoot LLC*):
- [ ] Wyoming **Articles of Organization** (state se stamped copy)
- [ ] **EIN letter** — CP 575 (jo abhi aya hai) ya 147C. Isay safe rakhein, IRS dobara CP 575 issue nahin karta.
- [ ] **Operating Agreement** (single-member) — agar nahin hai to bana lein, banks maangte hain
- [ ] Passport (valid, expiry 6 mahine se zyada door)
- [ ] Pakistan ka **proof of address** — utility bill ya bank statement, 3 mahine se purana na ho, naam passport se match kare
- [ ] Selfie / video verification
- [ ] Business description + website (loadboot.com — yeh aapki sab se bari taqat hai, real operating business hai)

Steps:
1. Payoneer par **Company / Business** account banayein (personal nahin), country of registration = United States.
2. Business type = *Logistics / Freight dispatch services* (⚠️ "payments", "money transfer", "financial services" **mat** likhein — instant reject/close hota hai).
3. USD Receiving Account activate karein (routing + account number milta hai).
4. PKR withdrawal HBL ke through link kar lein.

**Payoneer ki hadd (yeh pehle se jaan lein):**
- Yeh asli bank account nahin — "receiving account" hai.
- **Checks deposit nahin ho sakte.** US freight brokers aaj bhi bohat check bhejte hain. Yeh bara masla hai.
- Stripe payout destination ke tor par reliable nahin.
- Carriers ko ACH se pay karna properly nahin hota.

Isi liye Payoneer = **pul**, manzil nahin.

---

## 4. Asli manzil — proper US bank (Track B, parallel chalayein)

Do legitimate raste hain. Dono mein waqt lagta hai, isi liye Track A ke saath saath shuru karein.

### Rasta B1 — ITIN + US visit
1. **Form W-7** se ITIN apply karein (LLC ke Form 5472/1120 filing requirement ITIN ki valid wajah banti hai).
   Certified Acceptance Agent (CAA) ke zariye karein — passport courier karne ki zaroorat nahin parti.
   Time: 7–11 hafte.
2. B1/B2 visa par US visit, aur branch mein ja kar account. **Wells Fargo** non-residents ke liye sab se
   friendly mana jata hai; Chase possible hai lekin fees/balance zyada.
3. Sath le kar jayein: Articles, EIN letter, Operating Agreement, passport, ITIN, US address proof.

### Rasta B2 — asli US-based partner/manager
Agar LoadBoot mein koi US-based person waqai operations chalata hai (ya chalayega), to usay
LLC ka **manager / officer** banayein aur usi ke naam par account khulwayein — uska SSN + asli US address.

⚠️ Shart: yeh **sach** hona chahiye. Beneficial ownership form par jhoot bolna federal offence hai
(31 U.S.C. §5324 / bank fraud) aur account permanently freeze ho kar paisa phans jata hai.
Agar aap 25%+ owner hain aur Pakistan mein hain, to wo disclose karna hi parega — aur phir Mercury/Relay
waise bhi mana kar dain ge. Isliye B2 sirf tab hai jab woh person waqai partner ho.

---

## 5. ⚠️ Structural masla — LoadBoot ka paisa kaise behta hai

Yeh technical se bara masla hai. Repo mein settlement/5% fee/payment rails engine mojood hai
(`loadboot-payment-rails`, claims/freight/5% fee). Iska matlab: broker ka paisa LoadBoot ke account
mein aa kar phir carrier ko jata hai.

**Koi bhi fintech is pattern par account band kar deta hai.** Third party ka paisa hold kar ke aage
bhejna = money transmission jaisa dikhta hai, aur uske liye state MTL licenses chahiye hoti hain.
Pakistan-resident owner + freight + pass-through payments = compliance team ke liye worst combination.

**Safe model (aur yeh dispatch industry ka standard bhi hai):**
- Broker → **carrier ko seedha** pay kare (ya carrier ke factoring company ko).
- LoadBoot sirf **apni dispatch fee** ka invoice bheje carrier ko.
- Aap ke account mein sirf aapki apni earning aaye.

Isse: bank account low-risk ho jata hai, Payoneer bhi kaam kar jata hai, aur
`docs/research/dispatch-compliance-operating-guide.md` wale compliance model se bhi match karta hai.

Agar pass-through zaroori hai, to phir Stripe Connect / Increase / Column jaisa
**licensed payments partner** chahiye — normal bank account se yeh kaam nahin hoga.

---

## 6. Jo cheezein miss nahin karni (foreign-owned LLC ki compliance)

- [ ] **Form 5472 + pro-forma Form 1120** — har saal 15 April tak, **zero income ho tab bhi**.
      Miss karne par penalty **$25,000** per year. Yeh sab se bara silent trap hai.
- [ ] **Wyoming annual report** — 1 aur registered agent fee.
- [ ] FinCEN BOI reporting ka status 2025 mein badla tha (US-formed companies ko exempt kiya gaya) —
      CPA se **current** status confirm karwa lein, is par khud faisla na karein.
- [ ] Pakistan side: FBR ke Wealth Statement mein foreign asset (LLC) declare karna zaroori hai.
- [ ] EIN letter ki PDF + scan 2 jagah backup — dobara nahin milti.

---

## 7. Tarteeb wari action list

| # | Kaam | Kab |
|---|---|---|
| 1 | EIN letter ka naam/address LLC documents se match karke verify karein | Aaj |
| 2 | Operating Agreement bana lein (agar nahin hai) | Is hafte |
| 3 | Ek asli US business address arrange karein (RA address chhorein) | Is hafte |
| 4 | US phone number | Is hafte |
| 5 | Payoneer business account apply — logistics/dispatch category | Address milne ke baad |
| 6 | Money-flow model decide: pass-through band, sirf dispatch fee | Is hafte (code decision) |
| 7 | ITIN (W-7 via CAA) apply | Ab shuru karein — 2-3 mahine lagte hain |
| 8 | CPA hire karein jo foreign-owned LLC (5472) handle karta ho | Sept tak |
| 9 | US visit + Wells Fargo account | ITIN aane ke baad |

---

## Sources
- Mercury — [Prohibited countries](https://support.mercury.com/hc/en-us/articles/28771710754580-Prohibited-countries) · [Eligibility & requirements](https://support.mercury.com/hc/en-us/articles/28770467511060-Eligibility-and-requirements-for-opening-a-Mercury-account)
- LLC University — [Non-US residents open LLC bank account (2026)](https://www.llcuniversity.com/foreigners/open-us-bank-account-llc-non-resident/)
- StartFleet — [US business bank account for non-residents (2026)](https://startfleet.io/guide/us-business-bank-account-for-non-us-resident-guide)
- GlobalSolo — [US banking for Pakistani LLC owners](https://www.globalsolo.global/blog/us-bank-account-pakistani-founder-restricted-jurisdiction-2026)
- BitDegree — [Is Wise available in Pakistan](https://www.bitdegree.org/money-transfer/tutorials/is-wise-available-in-pakistan)

*Nota: banking eligibility lists bina announcement ke badalti hain. Apply karne se pehle har provider ka apna eligibility page dobara check karein.*
