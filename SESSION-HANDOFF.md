# LoadBoot — Session Handoff (2026-08-22, Saturday)
Ye document **21 Aug aur 22 Aug dono sessions** ka mukammal haal hai. Naya session isse parh kar wahin se kaam jari rakhe.
Language: user Roman Urdu mein baat karta hai; carriers/brokers se English. Titles/commits English.

> **AGLE SESSION KA MAQSAD (user ne khud kaha):** LinkedIn aur Facebook par kaam — posts tayyar karna, hotshot/box-truck freight groups join karna, aur dekhna ke wahan se koi load milta hai ya nahi. Details section 11 mein.

---

## 1. Infra & ground rules

- Supabase **PROD `rwscphuhpjoudvljvmdk`** · **STAGING `snslhvmkjusozgjelghi`** — har migration DONO par (parity logic-md5 se verify).
- Repo: `C:\Users\HP\Documents\GitHub\loadboot` (device bridge se commit; git device par NAHI chalana).
- Migrations naming `bl_<area>_NNNN` — high-water mark **bl_exp_0269** (22 Aug, prod+staging).
- `create or replace` PUBLIC grants preserve karta hai → hamesha `revoke ... from public, anon` + assertion block.
- Return type badalna ho to function DROP karke recreate.
- execute_sql multi-statement mein sirf AAKHRI statement ka result aata hai.
- Prod par live test: `DO $$ ... raise exception 'RESULT: %', x; end $$;` — raise sab roll back kar deta hai, output phir bhi milta hai.
- Admin user: `b7b28e16-608a-4ff7-9197-f763b80857e8` (20190myaseen@gmail.com).
- **PARALLEL SESSIONS**: user 2-3 sessions saath chalata hai. Kaam shuru karne se pehle `list_migrations` (dono DB), `pg_get_functiondef` se check karo ke change pehle se to nahi, aur file edit se pehle re-stage karo (uploads mount stale copy deta hai). Kisi doosre session ka kaam kabhi revert mat karo.

### SECURITY RULES (user-approved, kabhi mat torna)
- **Passwords kabhi enter nahi karne** (kisi bhi site par).
- Private storage bucket direct nahi parh sakte — user PDFs chat mein deta hai.
- **DAT/Truckstop carrier login kabhi use nahi karna** (AUP violation).
- Test accounts kabhi delete nahi karne.
- **Har carrier-facing message sirf DRAFT** — user khud bhejta hai.
- Desktop Chrome ka WhatsApp Web **carrier-wala account NAHI hai** — carrier replies user se poochho, khud check mat karo.
- Kisi carrier ki taraf se account **nahi banana** aur agreement **sign nahi karna** (Highway wala faisla, section 6).

---

## 2. MUNSTER LOGISTICS LLC — pehla ACTIVE carrier (sab se ahem)

org `589ed78b-f4ea-4430-9259-3c9b72ea6fa5` · user `cf18b1fa-7a86-4b5c-89ba-5806bdf4acee`
**Justin Male · justin@munsterlogistics.net · WhatsApp +1 513-307-0487**
**MC-84057665 · USDOT 7555217 · New Richmond / Batavia, OH 45157**
Status: **FULLY APPROVED + ACTIVATED**, compliance 4/4 (authority SAFER-snapshot approved — asal FMCSA certificate abhi bhi maangna hai; COI Progressive 877188958 exp 2027-07-22; W-9 in-app; NOA Truckstop Factoring verified).

### TRUCK SPECS — CONFIRMED (Justin, 22 Aug) — ye final hain
truck row `4a2e54a1-d6b3-4b62-bcd2-e89bfffe6d99` (unit 1)

| | |
|---|---|
| Deck | **30 ft gooseneck flatbed (25+5)**, 102" wide, ~34" deck height |
| **Max payload** | **9,000 lbs** — is se upar sab kuch auto-reject |
| Securement | lumber tarp + flat tarp, Grade 80 chains + binders, straps, **mega ramps** |
| Truck | 2024 Ford F-250, VIN `1FT8W2BT3REE14250`, plate POJ7838, Class 3 |
| Trailer | VIN `16V3F3821TA471001` |
| Annual inspection | valid to 2027-08-13 |
| Radius | 200 mi deadhead · home weekly |

### SCHEDULE — CONFIRMED (Justin, 22 Aug 6:17am WhatsApp)
- **Monday 24 Aug, 8:00 AM start** — pakka.
- **Monday overnight bahar reh sakta hai.** Uske alfaz: *"If you can put me out Monday over night and find me a load home that would be the best case scenario."*
- Weekend (Sat/Sun) available hai **lekin raat ghar aana hai** → sirf same-day round trip.
- DB mein uski apni prefs: floor **$1.50/mi**, max weight 9,000, deadhead 200, avoid NY+CA, min notice 2h, **weekend_ok = true**, weekly cost $2,860 → breakeven ~**$572/din** + fuel ~$0.28/mi.

### 22 Aug ko ye theek kiya
- Justin ne truck **do baar post kiya tha** (22:41 par $1.20, 23:01 par $1.50) aur **dono postings active reh gayi thin** → matcher $1.20 wale loads bhej sakta tha. Purani (`63f66593-…`) ab `expired`, aur `fleet_trucks.min_rpm` = **1.50**.
- ⚠️ **PRODUCT BUG jo abhi baqi hai:** usi truck ko dobara post karne par purani posting supersede honi chahiye, stack nahi honi chahiye. Poore DB mein sirf Munster affected tha.
- ⚠️ Active posting `1707ae8d-…` ka `available_to` = **24 Aug** — Monday tak chalega, us ke baad khatam. Aage barhana hai.

### Justin se abhi bhi chahiye
- **Highway signup** (section 6) — sab se ahem.
- Asal FMCSA certificate (evidence upgrade).
- DAT/Truckstop coordination — uske dono active hain (self-declared); seat 2-3 delivered loads ke baad maangni hai.

---

## 3. WARREN'S COURIER AGENCY — ⚠️ AHEM NAYA MASLA

org `aa525e4c-cc06-45b0-9f7a-99681e163e56` · **Jason Warren · WhatsApp +1 254-226-7286**
State: **`ready_not_activated`** — 5/5 documents verified, sirf activation baqi.

**Truck (unit 0012):** 2016 Ford E-350, **16 ft box, 192" L × 83" W × 72" H, payload sirf 4,200 lbs**, no liftgate, not dock-high. Base **Hinesville GA 31313** (office Fayetteville NC — dono sahi hain, MCS-150 "theek" mat karna). min_rpm $2.10, radius 1000 mi.
Wo ise **sprinter van** ki tarah market karta hai, kyunke brokers "box truck" sun kar 24-26 ft samajh lete hain.

**22 Aug ko WhatsApp par:** *"Yes it's available on Monday. It will be in Hinesville GA"* — yani **Monday capacity mojood hai, Hinesville GA mein**.

### 🚨 JO 22 Aug ko FMCSA se nikla — pehle ye hal karo
Maine `fmcsa-verify` chalaya:

1. **Hamari file ka MC number GHALAT hai.** `MC 99849375` FMCSA mein **milta hi nahi**. Uske **DOT 5677034** se lookup karne par asal docket **MC-58740462** nikalta hai.
2. **Authority abhi active verify nahi hoti.** Census kehta hai `allowedToOperate: Y`, `registrationStatus: active`, registered **2026-07-14** (sirf 5 hafte purana) — lekin **L&I (Licensing & Insurance) mein koi docket record nahi** (`liDockets: null`, `authorityVerified: false`). Naye carrier ke liye iska matlab aksar ye hota hai ke **authority application pending hai**, number allot ho chuka hai magar authority abhi grant nahi hui.

**Is ka natija:** Warren ko abhi dispatch **nahi** kar sakte. Aur wajah "FMCSA feed lag" **nahi** hai (ye hamara pichla khayal ghalat tha) — wajah ye hai ke MC number ghalat hai aur authority L&I par active nahi dikh rahi. Brokers ke systems (Highway, RMIS) usay isi bina par reject kar denge.

**Karna kya hai:**
- Warren se poochho: uska asal MC number kya hai, aur kya authority **grant** ho chuki hai ya abhi **pending** hai? Uska FMCSA authority letter maango.
- Jab tak wo confirm na kare, `organizations.mc_number` **mat badlo** — ye carrier identity data hai. Confirm hone par 99849375 → 58740462 update karo.
- Scheduled re-check `trig_01ErKGwcsuoU1V3KDL1zJSba` (Mon 24 Aug 14:00 UTC) mojood hai — **uska prompt update karna hoga**, kyunke wo abhi bhi ghalat MC 99849375 check karta hai. DOT 5677034 se check karwao.
- Payment profile: factoring **Flat Rate Funding Group, LLC**, noa_status verified. **`remittance_email` jaan-boojh kar NULL hai** — NOA par koi email nahi tha. Pehli settlement se pehle Flat Rate (313-638-7500) se AR email confirm karna hai. `remittance_email_note` mein ye likha hai. **Yahan koi email andaze se mat daalna.**

---

## 4. Baqi carriers

- **MARSHALL PATTERSON** (Patterson Freight, MC-62927634, USDOT-9313547, pattmk1979@gmail.com): authority + agreement valid. **W-9 22 Aug ko approve ho gaya** (dono TIN boxes bhare the — SSN primary maana gaya kyunke Line 1 individual hai; review note mein likha hai taake dobara na banana pare). Baqi: **COI (ACORD 25) Monday** + bank letter / signed page. Box truck 26 ft liftgate; lanes OR/ID/N-CA/NV. Uska email draft `dispatch/` mein tayyar hai, user ne bhej diya.
- **E&T TRUCKING**: authority valid; COI (holder DAT ghalat), W-9, bank — sab rejected. Wapsi ka intezar.
- **JMS EXPRESS + TOP KNOTCH + PRIME FREIGHT**: COI (aur Prime ka W-9) rejected, reminders active.
- **ACT company**: USDOT 8463052 SAFER mein nahi — unverified flag.
- **TAMIKA** (Quick There Corp, MC-52600, USDOT 3055626, Memphis, quickthere2k17@gmail.com, +1 786-438-9168): 2 cargo vans, $1.50/mi floor. Account nahi bana.
- **Hector Marroquin** duplicate accounts (hectorandres91@ vs hectotandres91@) — resolve baqi.
- **TRUCKING INC** (test): brand-new-signup par reset, `is_demo` NAHI lagana.
- Demo-flagged (skip): Test Account, Test Account 2, Demo Account, Test Carrier email, ruksandra101, LoadBoot Demo Carrier. **"Loadboot" (preetirooprai111@) asli user hai — demo NAHI.**

---

## 5. 123Loadboard — ab poori tarah sahi specs par

Account "Nora Nevarez" / zarnabpayonllc@gmail.com / (469) 253-7575, **Premium Plus**.
Trial: **din 8 (~29 Aug) par cancel/downgrade ka faisla** warna $79/mo. VPN lazmi (hamesha wohi US region).

- **Truck post #6978096** — ab **30 ft / 9,000 lbs / $2.00 per mi**. Note: *"Dispatched by LoadBoot for Munster Logistics LLC - MC-84057665, USDOT 7555217. Fully insured: $1M auto liability, $100k cargo. Hotshot gooseneck: 30 ft deck, 102 in wide, 9,000 lbs max. Tarps, Grade 80 chains and binders, straps, mega ramps on board. Fast response."*
- **Paanchon saved searches ab `0 ft – 30 ft` aur `0 – 9,000 lbs`, alerts ON** (pehle 36 ft tha — is se aise loads match hote the jo truck utha hi nahi sakta):

| Search | Lane | id |
|---|---|---|
| MUNSTER OUT | 45157 r200 → Anywhere, trip 0-1000 mi | `1728cc30-e6b0-4966-b792-d8e8931ecbd6` |
| MUNSTER BACK-CHI | Chicago IL r200 → 45157 | `67822a4e-937c-4009-8b32-1e57145576dd` |
| MUNSTER BACK-IND | Indianapolis IN r200 → 45157 | `a45315ee-f6c8-469f-8f6b-08b6b44554a6` |
| MUNSTER BACK-NSH | Nashville TN r200 → 45157 | — |
| MUNSTER BACK-ATL | Atlanta GA r200 → 45157 | — |

**Saved search edit ka chalne wala tareeqa:** card ka ⋮ → *Edit search* → panel scroll → **More filters** expand → Length slider ko do chhote drags mein khisakao (1568px width par ~16px phir ~26px) → **Search** (yehi save karta hai). URL ke `S.l=` se verify karo.
**Browser gotcha:** `read_page` `Viewport: 0x0` de ya screenshot fail ho → tab hidden hai; naya tab banao (`tabs_create_mcp`) aur wahan navigate karo. Members API (`/api/loads/named-searches`) version header ke baghair reject karta hai — us par waqt zaya mat karo, UI use karo.

---

## 6. HIGHWAY — faisla aur wajah (ye ahem hai, dobara bahes na ho)

**Highway load board nahi, carrier identity verification hai.** Brokers ab email par carrier packet nahi lete; Highway se sabit karte hain ke jo banda email kar raha hai wo waqai wahi MC hai.

**Faisla 1 — carrier ka account carrier khud banaye. Hum uski jagah nahi banate.**
Highway government ID + face capture maangta hai aur FMCSA record ke against verify karta hai. Uski jagah signup karna theek wohi harkat hai jo ye system rokne ke liye bana hai — natija Munster ka MC flag hona ho sakta hai, aur phir har Highway-wala broker darwaza band kar dega. Hum guide karte hain, data tayyar karte hain; **carrier sign karta hai**. Ye user ki apni hifazat bhi hai (cargo claim / double-brokering ki zimmedari).
Justin ka signup message + uske exact figures: `dispatch/highway-setup-munster.md`. Link: `https://highway.com/onboarding/sign-up` (FWF ka direct: `highway.com/go/fwf`). Signup ke baad **LoadBoot ko authorized dispatch service** add karwana hai.

**Faisla 2 — Highway partnership abhi NAHI karni.** (22 Aug, tehqeeq ke baad)
Poori industry **broker-pays, broker-initiated** hai. Koi platform aisa nahi jahan dispatch company ek dafa onboard kare aur wo kai brokers tak khud pahunch jaye. Saboot (TMS vendors ki apni docs):
- Alvys: *"Highway remains the system of record for carrier creation — Alvys cannot push carrier records to Highway."*
- AscendTMS (RMIS): TMS sirf **invite** bhej sakta hai; *"the data flow is one-directional."*
- Parade: chahiye *"An API-enabled Highway subscription"* + *"Your Highway API key"* — jo **broker** deta hai.

Partner program se sirf **read-side** data milta hai (carrier verified hai ya nahi) — aur ye hamara masla nahi, hamare paas 3 carriers hain. Highway ka customer broker hai; hamare paas abhi ek bhi delivered load nahi, is liye lene ko kuch hai, dene ko kuch nahi.
**Dobara kab dekhna hai:** ~25-50 carriers par, jab "kaunsa carrier verified hai" waqai dard bane. Rasta: `highway.com/partners` → Technology Partner, aur baat sirf **verification status read access** par (onboarding push kisi ko nahi milta).
Precedent: **iDispatchHub** (bilkul hamara jaisa platform) Highway partner hai — usay bhi sirf read-side mila. **TrueNorth** (funded carrier-side company) ne API ke bajaye har broker ke liye **guide pages** banaye.

**Sureway/ATS bhi Highway se onboard karta hai** — ek hi profile dono ke liye chalti hai.

---

## 7. Retell voice — ab Command Center se chalta hai (22 Aug ka bara kaam)

**Agent:** `agent_da4095dcf04e45ce3231f6e18a` "Riley Broker Outbound", LLM `llm_1f0349f63932c359ad6db8b2d72c`, voice **Tamsin**, GPT-4.1.
Settings: responsiveness 0.85, interruption 0.4, ambient `call-center` 0.67, reminder 10s ×2, begin_message_delay 1000ms, DTMF on, `press_digit` IVR tool mojood.
Phone **+1 (469) 253-7575** — outbound → ye agent (`latest_published`); inbound → Riley Inbound `agent_e06a9454990e26dc6563df2994` (Supabase webhook wahin hai, **chhedna mat**).

### ⚠️ Prompt variables — ye 22 Aug ko theek kiya
`app_private.retell_dial()` Retell ko **sirf paanch** dynamic variables bhejta hai:
```
name · topic · role · context · source
```
Agent ka prompt pehle `{{broker_name}}`, `{{load_ref}}`, `{{origin}}` … use karta tha — **match nahi karte the**, is liye CC se schedule ki hui call khali context ke sath jati. Prompt ab `{{name}}`, `{{topic}}`, `{{role}}`, `{{context}}` par hai aur poori load-briefing `context` mein jati hai (4,000 char limit). Version **V4 "CC variables + Monday overnight" PUBLISHED**.

**Behtar hal (baad ke liye):** `lc_calls` mein `vars jsonb` column + `retell_dial` se pass — tab structured variables bhi chalen. Ye migration hai, prod+staging dono par.

### 🚨 WEBHOOK BUG — Monday se pehle theek karna LAZMI hai
22 Aug ko chaaron broker calls DB mein `no-answer / 0 sec` dikhin, magar **Retell ke apne call history mein teen calls waqai connect hui thin** (1:09, 1:39, 1:10). Wajah:

**"Riley Broker Outbound" agent ka `Agent Level Webhook URL` KHALI hai.**

Is liye Retell kabhi LoadBoot ko batata hi nahi ke call ka kya bana; `voice_run_scheduled()` 3 minute baad stale `dialing` row ko `no-answer` mark kar deta hai. Natija: **call ho jati hai, transcript hamesha ke liye zaya ho jata hai.**
(Riley **Inbound** agent par webhook laga hua hai — isi liye inbound calls ke summaries theek aate hain.)

**Fix:** agent ke Webhook Settings mein URL daalo. `public.retell_webhook(jsonb)` par `anon` ko EXECUTE hai aur wo single unnamed jsonb param leta hai, is liye PostgREST RPC endpoint chalega:
`https://rwscphuhpjoudvljvmdk.supabase.co/rest/v1/rpc/retell_webhook?apikey=<ANON_KEY>`
**Pehle Riley Inbound agent ka webhook URL kholo aur bilkul wohi copy karo** — wo chal raha hai, andaza lagane ki zarurat nahi. Phir agent Publish karo aur ek test call se tasdeeq karo ke `lc_calls` mein summary/transcript aaya.
⚠️ Dashboard ka Webhook Settings section click par band ho jata hai aur renderer freeze hota hai — sabar se, chhote steps mein.

**Retell dashboard ka masla:** editor bara text ek saath type karne par freeze ho jata hai aur prompt khali chhor deta hai. **Chhote hisson mein type karo aur har hisse ke baad screenshot se verify karo.** Cloud sandbox se `api.retellai.com` tak nahi pahunch sakte (403 CONNECT); browser page ke andar se fetch karna parta hai, aur API key capture karne ki koshish classifier block kar deta hai — **UI use karo**.

### Call pipeline (ye ab poora kaam karta hai)
```
public.cc_retell_callback(to, name, topic, role, context, when)
   → app_private.lc_calls row (status scheduled/requested)
   → app_private.voice_run_scheduled()   [pg_cron jobid 20, har 5 min]
   → app_private.retell_dial()  → Retell API
   → public.retell_webhook()   → summary / transcript / recording / duration
   → public.cc_lc_calls()      → CC "📞 Riley phone calls" (Live chat page)
```
`cc_lc_calls()` bina filter ke aakhri **50 rows** deta hai — nayi calls hamesha upar. Permission: `comm.view` / `support.view` / `dispatch.manage`.
**Retell ka Batch Call UI use MAT karo** — wo LoadBoot ko bypass karta hai aur CC mein kuch nahi aata.

### 22 Aug ki scheduled broker calls
| lc_calls id | Broker | Number | Maqsad |
|---|---|---|---|
| 176 | Tennessee Steel Haulers | (800) 776-4004 | E1687595 — **30 ft deck chalega?** + VA→OH Tuesday wapsi |
| 177 | Fifth Wheel Freight | (616) 965-7277 **ext 8550** | 752512 Mason MI + **Highway setup + packet email** |
| 178 | Joe Tex | (903) 537-7100 | 518161 + Nashville→OH Tuesday wapsi |
| 179 | Sureway / ATS | (320) 258-6548 | capacity correction + Highway invite |

Har briefing mein target rate **aur** walkaway hai, is hidayat ke sath ke walkaway kabhi zubaan par na aaye.

---

## 8. Brokers — verified contacts (22 Aug, FMCSA + unki apni sites se)

Gate 1 **sab PASS** — paanchon ka broker docket L&I par **ACTIVE**:

| Broker | Phone | Email | Onboarding | MC |
|---|---|---|---|---|
| **Fifth Wheel Freight** (B&L Systems LLC) | (616) 965-7277 **ext 8550** | koi carrier email publish nahi | **Highway** `highway.com/go/fwf` | 806984 |
| **Tennessee Steel Haulers** | (800) 776-4004 · (615) 271-2400 **ext 2013** | **CarrierManagement@tenh.com** · settlements TSHCarrier@tenh.com | ITS Onboarding | 143621 |
| **Joe Tex LLC** | (903) 537-7100 | **candace@joetexusa.com** (FMCSA) · joetex@joetexusa.com | — | 185106 |
| **Sureway (ATS)** | (877) 284-0861 · Josh Porwoll (320) 258-6548 | ⚠️ `sureway_support@sureway.com` **BOUNCE hua** (unki site par publish hone ke bawajood) · FMCSA-registered: **jasonne@ats-inc.com** | **Highway** | 260504 |
| **Clutch Transportation** | site (419) 903-0350 · posting (419) 513-8078 | **rtobias@clutchtransportation.net** (FMCSA) | — | 1474483 |

⚠️ `quotes@clutchtransportation.net` (load posting par tha) kahin publish nahi — call par confirm kiye baghair use mat karo.
⚠️ FMCSA-registered email aksar owner/admin ka hota hai, load desk ka nahi. Pehli baar theek hai; rate negotiation phone par.

**Brokers WhatsApp use nahi karte.** Paanchon mein se kisi ne SMS/WhatsApp publish nahi kiya — poori industry **phone + email + carrier portal** par hai, kyunke onboarding audit-able system mein chahiye hota hai. WhatsApp aata hai, magar ulta: load **tracking ping** ke tor par.

---

## 9. Load shortlist — Monday-overnight ke hisab se

Justin ke schedule ke baad tarteeb **badal gayi**. Chahiye: **OUT leg Monday 300-500 mi → Tuesday subah delivery → BACK leg ghar.**

| Verdict | Load | Kyun |
|---|---|---|
| **#1** | TSH · E1687595 · St Albans WV → Fredericksburg VA · Mon · 336 mi · **500 lbs** | shape bilkul sahi. Rukawat: unka note "40 ft hotshot" — 30 ft ka jawab chahiye. Market ~$1,459, ask $1,300-1,400, walkaway $1,100 |
| **#2** | Fifth Wheel · 752512 · Mason MI → Roanoke IN · Mon · 153 mi · 24 ft / 8,200 lbs · tarps | tarps hamare paas hain. Ghar se sirf 150 mi door khatam. Posted $600, ask $750, walkaway $650 |
| **#3** | Joe Tex · 518161 · Central City KY → Lancaster TN · Mon · 156 mi (+195 DH) · 16 ft / 7,000 lbs | rate nahi diya. Ask $800, walkaway $700. Nashville se Tuesday wapsi bhi poochhi hai |
| ↓ | Fifth Wheel · 752447 · South Point OH → Carthage MO · 738 mi · $1,000 | **neeche kar diya** — 3-4 din ka trip, "overnight" nahi |
| ✗ | Sureway Indy→Concord NC | 10,000 lbs > 9,000 |
| ✗ | Sureway Hebron KY→Nashwauk MN | 12,000 lbs |
| ✗ | Wheeling IL→Attica IN | Conestoga only |
| ✗ | Beemac Johnston SC→Grabill IN | listing blank thi — asal mein **45,000 lbs lumber, 48/53 ft** |
| ✗ | New Ross IN→Elk Grove IL | 31 ft **aur** 9,316 lbs |
| ✗ | Lebanon OH→Wheeling WV | 40 ft deck chahiye |
| ✗ | Florence KY→Grove City OH | 48 ft / 10,000 lbs |
| ✗ | Hamilton OH→London OH | weight blank + 48 ft SD |

**Sab se bara signal:** Fifth Wheel Freight ke chaar loads exactly Munster ke size mein the — ye sab se qeemti broker relationship hai.

### HAR LOAD PAR 3-GATE (kabhi skip nahi)
1. `fmcsa-verify` edge fn se broker authority — `POST https://rwscphuhpjoudvljvmdk.supabase.co/functions/v1/fmcsa-verify` body `{"mc":…}` ya `{"dot":…}`. **Broker-only entity par top-level `authority` "inactive" dikhta hai — wo carrier authority hai. Asal jawab `liDockets[].broker = "A"` hai.**
2. 123LB credit — 35+ din ya D grade = pass.
3. Booking se **pehle** Truckstop factor se broker credit-approval (FactoringAR@truckstop.com).

**Go/no-go:** `rpm >= 1.50 AND (linehaul − 0.28 × total miles) / truck-days >= $572`. Target $2.00+, khulein $2.20-2.30.
**Rate con hamesha "Munster Logistics LLC, MC-84057665" ke naam — LoadBoot nahi.**

---

## 10. Email / brand identity (22 Aug ka faisla)

- **From: `dispatch@loadboot.com`** (mailbox bana hua hai) — `hello@` NAHI, wo marketing inbox hai aur broker use general enquiry samajh kar dispatch flow se nikal deta hai.
- **Inbox display name: `LoadBoot Dispatch`** — company + kaam. Koi zaati naam nahi. PrivateEmail → Identities. **Bhejne se pehle khud ko test email bhejo** — mail client aksar server ki setting nazarandaz kar ke apna purana naam bhej deta hai.
- **CC par carrier** (justin@munsterlogistics.net). Wajah: broker **Munster** ko set up kar raha hai, LoadBoot ko nahi; kisi aur ke MC ke barey mein email double-brokering ka pehla shak paida karti hai. Aur uska email waise bhi FMCSA public record par hai, chhupane se kuch nahi bachta. (User chahe to darmiyani rasta: setup emails par CC, rate negotiation par nahi.)
- **Signature:** `dispatch/loadboot-signature.html` — logo seedha `loadboot.com/logo-full.png` se (wohi jo site header par hai). Brand kit v3 ke exact rang: navy `#10223B`, blue `#0883F7`, orange `#FC5305` (sirf tagline), slate `#64748b`. Tagline *"Keep Your Wheels Earning"* alag footer line mein — brand-kit ka canon rule hai ke lockup se attach na ho.
  ⚠️ Repo ka `email-logo-2x.png` **purana logo** hai (orange "Boot", "E" mark) — website ab v3 lockup use karti hai. Us purani file ko signature mein mat lagana.
  Numbers: dispatch (469) 253-7575 · WhatsApp **(928) 393-6198** (`wa.me/19283936198`).

---

## 11. 🎯 AGLE SESSION KA KAAM — LinkedIn + Facebook se load sourcing

**MAQSAD SAAF HAI: Justin Munster ke liye load dhoondna.** Social koi branding exercise nahi — ye load sourcing ka doosra/teesra channel hai, 123Loadboard ke saath saath.

### Assets — SAB PEHLE SE BANE HUE HAIN (sifar se shuru nahi karna)
| Asset | Note |
|---|---|
| **LinkedIn company page** (LoadBoot) | banner mojood: `linkedin-banner.png` |
| **LinkedIn — "Asim" wala account** | **~5,000 connections** — sab se qeemti asset, ehtiyat se use karo |
| **LinkedIn — Yaseen ka personal account** | repost-with-thoughts ke liye |
| **Facebook company page** | mojood |

### Kis channel se kya milta hai (ye farq zaroori hai)
- **Facebook groups = asal loads.** Hotshot / flatbed / box-truck freight groups mein brokers aur shippers seedha load post karte hain. Yahin se Munster ko load mil sakta hai.
- **LinkedIn = brokers aur shippers ka rishta**, seedhi load nahi. Yahan post ka lehja alag: "hamare paas ye verified capacity hai" — carriers ko bharti karne wala lehja nahi.
- **5,000-connection wala account ka asal faida:** freight brokers ko seedha, shakhsi message. Ek capacity post jo 5,000 industry logon tak jaye, wo kisi group post se zyada wazan rakhta hai. **Lekin spam mat karna** — wo account jal gaya to dobara nahi banta.

### Post mein truck ki asal specs jani chahiye
- **Munster:** 30 ft gooseneck flatbed (25+5), 102" wide, **max 9,000 lbs**, lumber + flat tarps, Grade 80 chains, straps, mega ramps. Base New Richmond OH 45157. Monday 8am start, overnight OK, 300-500 mi ka OUT leg + wapsi ka load.
- **Warren:** 16 ft box, 192×83×72 in, **4,200 lbs**, no liftgate, Hinesville GA. ⚠️ Authority clear hone tak post mat karna (section 3).

### Ehtiyat
- **LoadBoot/Retell ka number (469) 253-7575 use karna — personal Pakistani number kahin nahi.**
- FB freight groups mein **double-brokering aur fake load posting aam hai** — har lead par wohi **3-gate** lagana hai (section 9), koi riayat nahi. Jo banda group mein "load hai" kahe, wo broker ho ye zaroori nahi.
- Group ke rules parh lena — bohat se groups carrier/dispatcher posts ban karte hain.

### Content jo pehle se mojood hai
- Blog auto-writer scheduled task chal raha hai (`trig_01MaDpnsnsyTeaGCGj9mnwJh`, Mon/Wed/Fri 09:00 UTC) — `content-queue.md` se article banata hai. **Social posts inhi articles se nikaale ja sakte hain**, naya content likhne ki zarurat nahi.
- YouTube: video `zNJAyL6hLTo` par pinned comment (channel verification ke baad), "Allow embedding" tick, aur video 2 (TONU) baqi.

### Session shuru karte hi ye poochho
1. Kaun se FB freight groups mein pehle se membership hai?
2. "Asim" wala LinkedIn account kis maqsad ke liye use hota raha hai — us par pehle kya post hota tha? (Lehja usi se milna chahiye, warna 5,000 connections ke saamne ajeeb lagega.)
3. Aaj ka maqsad: sirf groups join karne hain, ya posts bhi live karni hain?

### DAT — ye bhi agle session mein
Account lena hai. **Dispatcher access ka rasta:** demo form `cloud.comms.dat.com/custom-demo` — LoadBoot LLC ke naam se, aur ye paragraph: *"registered dispatch service with signed carrier agreements"*. Phir Truckstop sales **(888) 364-1189**.
⚠️ **Kisi carrier ka DAT/Truckstop login KABHI use nahi karna — AUP violation hai.** Apni seat leni hai. Justin ke dono active hain (self-declared) magar seat 2-3 delivered loads ke baad maangni thi — DAT ka apna account us se alag cheez hai.
⚠️ Billing: 123LB US/CA cards hi lete hain; Meow bank application pending hai (section 13 #10). DAT ka bhi wahi masla aayega.

---

## 12. Scheduled tasks (Claude Code Remote — `list_triggers` se dekho)

| id | Kaam | Kab |
|---|---|---|
| `trig_01ErKGwcsuoU1V3KDL1zJSba` | **Warren FMCSA re-check** — ⚠️ prompt mein **ghalat MC 99849375** hai, DOT 5677034 par badlo | Mon 24 Aug 14:00 UTC |
| `trig_01QAUwiPTrJhWxE3ENLrf3Nc` | broker call results padhna (lc_calls 176-179) | 22 Aug 15:04 UTC |
| `trig_01MaDpnsnsyTeaGCGj9mnwJh` | blog article writer (Fable-first, Opus fallback) | Mon/Wed/Fri 09:00 UTC |
| `trig_01KBS3uZiPHZmsPXwywazvhT` | loadboot.com uptime monitor | hourly :19 |
| `trig_019Vcvfm1nyH3h4dmesi3aNo` | diesel prices refresh | Tue 16:00 UTC |
| `trig_01UKikvXfAmZpvJBWgBrsqCh` | daily setup check-in | 05:00 UTC |
| `trig_01QBtGRVENGjPsWMeFaFKNu5` | DMARC p=reject flip | 29 Aug |
| `trig_01LSFdP9rrXeiDc7GgRz3ULJ` · `trig_01J6g7VHsz1YasGA8xjhNwiy` · `trig_013jjKbDWBBMn7Wh6a65jofv` | WY annual report + RA renewal · Form 5472 (min $25k penalty) | 2027 |

**Scheduled tasks hamesha `mcp__claude-code-remote__*` se banao — kabhi `CronCreate` se nahi** (wo session ke sath khatam ho jata hai).

---

## 13. Khule kaam (priority)

1. **Monday pehla load** — TSH → Fifth Wheel → Joe Tex. Searches/posting ki dates roz aage sarkana.
2. **Justin ka Highway signup** — Monday ka asal risk load na milna nahi, load milne par setup na hona hai.
3. **Warren ka MC + authority** (section 3) — us se poochho, `trig_01ErKGwcsuoU1V3KDL1zJSba` ka prompt theek karo.
4. Munster ki truck posting ka `available_to` 24 Aug se aage barhao.
5. **Product bug:** dobara post karne par purani truck_posting supersede ho.
6. Marshall: COI (ACORD 25) + bank letter.
7. **🚨 Retell webhook URL — "Riley Broker Outbound" agent par KHALI hai** (section 7). Monday se pehle lazmi, warna calls hongi magar transcripts zaya ho jayenge.
8. `lc_calls.vars jsonb` + `retell_dial` — structured call variables (migration, dono DB).
8. **LinkedIn/Facebook se load sourcing + DAT account** — agle session ka asal kaam (section 11).
10. Meow bank application (US business card — 123LB billing US/CA only).
11. Site deploy (owner push kare) — broker gate `lbFmcsaScreen` repo mein hai magar **live nahi**.
12. Retell credit top-up + auto-recharge.
13. LB-DSA: rate-con signing authority clause hai ya nahi (na ho to chhota authorization e-sign).
14. 123LB day-8 (~29 Aug): Premium Plus rakhna ya girana.
15. Hector duplicates; staging bl_w9 parity; dispatcher_carrier master agreement counsel-pending.

---

## 14. Communication style (user ki pasand)

- Carriers/brokers ko: professional, chhote messages. **"Hum galat the" wali tone NAHI** — tricky-but-true framing. Blame apne software par mat daalo.
- Har outbound **draft** pehle user ko — wo khud bhejta hai.
- User Roman Urdu + English mix mein likhta hai; usi tarah jawab do.
- AskUserQuestion sirf asal faislon par; baqi kaam khud aage barhao.
- **Kabhi data mat ghar do.** Ek dafa maine Warren ke liye `remittance_email` khud bana kar daal diya tha — foran revert kiya. Jo maloom nahi wo NULL rakho aur note likh do.

---

## 15. `dispatch/` folder mein kya hai

| File | Kya |
|---|---|
| `munster-trip-sheet-aug24.xlsx` | 4 sheets — Plan (carrier profile + 3-gate + Justin ka schedule), Loads (live formulas, GO/NO check), Call Queue, Trip Pairings |
| `munster-messages-aug22.md` | Justin ka WhatsApp + broker contact table + email drafts |
| `highway-setup-munster.md` | Highway ka poora pack — Justin ka message, uske exact figures, dispatcher-role ki bahes |
| `broker-emails-final.md` | chaar final broker emails, bhejne ki tarteeb ke sath |
| `loadboot-signature.html` + `signature-install.md` | dispatch signature + lagane ka tareeqa + display name |
| `broker_calls.csv` | Retell batch-call file (ab zaroori nahi — CC wala rasta behtar hai) |
| `email-logo-v3-2x.png` | optimised email logo (360px) agar kabhi chhoti file chahiye ho |

Memory files bhi mojood hain: `MEMORY.md` (index), `loadboard_123lb.md`, `whatsapp_channel.md`, `retell_broker_agent.md`, `carrier_pwa_install.md`, `carrier_docs_2026-08-22.md`.
