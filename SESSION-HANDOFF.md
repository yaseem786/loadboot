# LoadBoot — Session Handoff (2026-08-21)
Ye document pichle session ka mukammal haal hai. Naya session isse parh kar wahin se kaam jari rakhe.
Language: user Roman Urdu mein baat karta hai; carriers se English. Titles/commits English.

## 1. Infra & ground rules
- Supabase PROD `rwscphuhpjoudvljvmdk` · STAGING `snslhvmkjusozgjelghi` — har migration DONO par (parity verified via logic-md5).
- Repo: `C:\Users\HP\Documents\GitHub\loadboot` (device bridge se commit; git device par NAHI chalana).
- Har edited JS file par esbuild verify: `npx esbuild <f> --bundle --format=esm --outfile=/dev/null --external:../shared/* --external:./* --external:/*` (node --check nakafi hai).
- Migrations naming: `bl_<area>_NNNN` — aakhri: `bl_tp_0257`. Agla number 0258.
- `create or replace` PUBLIC grants preserve karta hai → hamesha `revoke ... from public, anon` + assertion block.
- Return type badalna ho to function DROP karke recreate (cc_pocket_trucks aise hi hua).
- execute_sql multi-statement mein sirf AAKHRI statement ka result aata hai.
- Impersonation: `set_config('request.jwt.claims', json_build_object('sub',<uid>,'role','authenticated')::text, true)` + `set_config('role','authenticated', true)`; baad mein role reset warna app_private reads fail.
- Custom SQLSTATEs: LB001-003 VIN/COI, LB010-013 W-9, LB014/015 MC/DOT format, LB016 evidence-required, LB020 reopen expired.
- SECURITY RULES (user-approved boundaries): passwords kabhi enter nahi karna (kisi bhi site par); private storage bucket direct nahi parh sakte (user PDFs chat mein deta hai); DAT/Truckstop carrier login kabhi use nahi karna (AUP violation).
- Admin user (staff impersonation ke liye): `b7b28e16-608a-4ff7-9197-f763b80857e8` (20190myaseen@gmail.com).

## 2. MUNSTER LOGISTICS LLC — pehla ACTIVE carrier (sab se ahem)
- org `589ed78b-f4ea-4430-9259-3c9b72ea6fa5` · user `cf18b1fa-7a86-4b5c-89ba-5806bdf4acee` · Justin Male · justin@munsterlogistics.net · WhatsApp +1 513-307-0487
- MC-84057665 (hamari file mein pehle GHALAT 8987865 tha — Justin ne pakra, SAFER se verify karke theek kiya) · USDOT 7555217 · New Richmond OH.
- Status: FULLY APPROVED + ACTIVATED (cc_decide_onboarding 21 Aug; profiles.status=active; broker_visible=true). Compliance 4/4 valid:
  - Authority: SAFER snapshot approved (evidence-grade WEAK note — asal FMCSA certificate abhi bhi maangna hai).
  - COI: Progressive policy 877188958, exp 2027-07-22. Holder LoadBoot LLC sahi. Scheduled-autos-only: F-250 `1FT8W2BT3REE14250` + Big Tex trailer `16V3F3821TA471001` (dono VIN check-digit verified). coi_coverage=scheduled set.
  - W-9: in-app form, Line1 Justin Timothy Male / Line2 LLC / sole-prop, TIN ****6509. (Pehla reject hamare purane form ki wajah se tha — form ab theek hai.)
  - NOA: Truckstop Factoring (Internet Truckstop Payments LLC; Denim=Truckstop acquisition, EK company — release letter ka sawal khatam). Remit-to: BofA, ACH 071000039, acct ...0797, FactoringAR@truckstop.com. noa_status=verified. NOA par MC line KHALI hai — agle renewal par add karwana (blocking nahi).
- Dispatch prefs (Justin ne khud 21 Aug ko update kiye): floor $1.50/mi (target $2+), deadhead 200mi, lanes KHULI (clear kar di), round_trip prefer, weekends OFF, home weekly, load_size both, likes drop&hook/fast loading, dislikes long detention/overnight, weekly_operating_cost $2,860 PAY SAMET → breakeven ~$572/din + fuel (~$0.28/mi F-250 towing).
- PENDING Justin se: Big Tex ki deck length + max payload (WhatsApp poocha hua, jawab nahi aya). Uske jawab par: fleet_trucks row bharna (abhi ~sab null), 123LB posting/searches ki 36ft/9000 update.
- Hamare board par uski truck_posting `ddee61f5-...` active (maine $1.50/200mi/28-Aug-tak sync ki, auto_request=true).
- DAT/Truckstop: uske dono active hain (self-declared). FAISLA: seat abhi NAHI maangni — 2-3 delivered loads ke baad. Coordination sawal WhatsApp mein bheja hua hai (kaun se plans, double-post na ho).

## 3. Monday-first plan (24 Aug) — pehla load
Race 4 channels: 123Loadboard (live) · broker-direct (Justin ka verified packet ready) · FB hotshot groups (join karna baqi) · DAT (sales process shuru karna baqi).
HAR LOAD PAR 3-GATE (kabhi skip nahi):
1) `fmcsa-verify` edge function se broker authority (POST https://rwscphuhpjoudvljvmdk.supabase.co/functions/v1/fmcsa-verify {"mc":..} ya {"dot":..})
2) 123LB credit score / days-to-pay (35+ din ya D grade = pass)
3) Booking se PEHLE Truckstop factor se broker credit-approval.
Rate con HAMESHA "Munster Logistics LLC, MC-84057665" ke naam — LoadBoot nahi. Go/no-go math: rpm >= 1.50 AND (linehaul - 0.28*miles) / truck-days >= $572. Target $2.00+, khulein $2.20-2.30. Jumu'a sirf ~400mi. Calls Retell se (AI sirf intake/qualify kare, rate commit KABHI nahi; 10-min callback promise).
Monday candidates jo dikhe the: Johnston SC->Grabill IN $2,070/$2.96mi (Beemac) · Wheeling IL->Attica IN $3.57/mi · Mason MI->Roanoke IN $3.92/mi.

## 4. 123Loadboard (account owner-side "Nora", Premium Plus)
- Trial 10 din — DIN 8 (~29 Aug) par cancel/downgrade faisla warna $79/mo charge. VPN lazmi (US region, hamesha wohi); Claude Chrome extension se automation chalti hai (site permission granted).
- 5 saved searches, sab: F+SD only, max 9,000 lbs, max 36 ft, dates Aug 24+25, alerts ON/unlimited/instant:
  MUNSTER OUT (45157 r200 -> Anywhere, trip 0-1000) · BACK-ATL · BACK-NSH · BACK-CHI · BACK-IND (sab city r200 -> 45157 r200).
- Truck post #6978096: Flatbed (Munster Logistics - Unit 1), 45157 r200 -> Anywhere, Aug 24+25, 36ft, 11,000 lbs, $2/mi, note mein MC/DOT+insurance. ROZ subah repost + dates roz aage sarkana (searches bhi).
- Sliders drag se ghalat aate hain — chhote increments mein drag karo, URL params weight nahi uthate.
- "Verify DOT#" banner ignore (hum dispatcher hain). Real-time truck post mobile-only; Scheduled use karo.

## 5. Baqi carriers ka status
- MARSHALL PATTERSON (Patterson Freight, MC-62927634, USDOT-9313547, pattmk1979@gmail.com): authority+agreement valid. COI Monday aayegi (agent redo — LoadBoot holder, F-250... nahi, box truck 26ft liftgate; lanes OR/ID/N-CA/NV). W-9: portal form se karna hai (email attach fail hota raha; purana unsigned+dono TIN). Bank: direct deposit page par naam "null null" — BofA letter ya signed page chahiye; "direct deposit aj bhejta hon" kaha tha. Uska rejected docs ka poora saga file par hai.
- E&T TRUCKING: authority valid; COI rejected (holder DAT Freight & Analytics), W-9 rejected, bank rejected. Wapsi ka intezar.
- JMS EXPRESS + TOP KNOTCH + PRIME FREIGHT: COI (aur Prime ka W-9) rejected, reminders active (naya state-aware system).
- WARREN'S COURIER (Jason Warren): 4/5, sirf authority missing. Deck height 37in saved.
- ACT company: USDOT 8463052 SAFER mein MAUJOOD NAHI — unverified flag.
- TAMIKA (Quick There Corp, MC-52600, USDOT 3055626, Memphis, quickthere2k17@gmail.com, +1 786-438-9168): call lead, account nahi bana — 2 cargo vans, $1.50/mi floor. Signup link bhejna jab reply aaye.
- Hector Marroquin duplicate accounts (hectorandres91@ vs hectotandres91@ — "Rachel_0307" naam ke do org) — resolve karna baqi.
- TRUCKING INC (test, jeffersonwholesaleinc@outlook.com): brand-new-signup state par RESET, user khud walkthrough karega. is_demo NAHI lagana.
- Demo-flagged (automation skip): Test Account, Test Account 2, Demo Account, Test Carrier email, ruksandra101 (spurious), LoadBoot Demo Carrier. "Loadboot" (preetirooprai111@) asli user hai — demo NAHI.

## 6. Aaj ke system-level fixes (sab prod+staging live)
- bl_trust_0249: fake 1-star rating khatam — rating ab party_ratings se, <3 ratings = "New" state (rating_state field); perf default 0.85 hata, score_max 75 bina history. UI 4 jagah "New" dikhata hai (carrier account-view, trust card, partner queue+partners).
- bl_ob_0250: `app_private.carrier_onboarding_state(org)` — single source of truth (not_started/needs_action/awaiting_review/ready_not_activated/active/declined + missing/pending/rejected lists). Staff RPC: cc_carrier_onboarding_state.
- bl_ob_0251+0254: reminder cron state-aware — pending=hamari queue (chase nahi, 24h baad reassurance); ready_not_activated -> STAFF alert; nudges carrier ki aakhri harkat se (account age se nahi); lifetime cap 3 chases (rejected par cap nahi); is_demo skip.
- bl_ob_0252+0253: document-decision email EK jagah (compliance_decision_notify) — requirement ka naam, progress bar, "kya baqi", idempotent per doc/day. admin_review_document ab "booking unlocked" ka jhoot nahi bolta — asli unlock email cc_decide_onboarding se.
- bl_fleet_0255/0256/0256b: fleet_trucks + trailer_type/len/vin/tarps/chains; form mein open-deck trailer section + posting-readiness line; cc_pocket_trucks ab POORA record wapas deta hai (pehle 16 cols — edit par fields ghayab dikhte the).
- bl_tp_0257: Post-a-Truck matcher weekend_ok=false par weekend-pickup load AUTO-REQUEST nahi karta (notify karta hai "your call").
- fmcsa-verify EDGE FN v29: brokerOnly detection (L&I authority read); MC-only lookup ka fail-open band (docket alt-DOT resolve). TQL test: DOT 2223295 + MC 322572 dono BLOCKED; Munster pass. CLIENT gate (lbFmcsaScreen in carrier/app.js) repo mein commit hai LEKIN SITE DEPLOY NAHI HUI — loadboot.com purana bundle serve kar raha hai. Broker test numbers: TQL USDOT 2223295/MC 322572; CH Robinson 2211804/131029.
- Pichle din ke (context): account self-close+30-din reopen (bl_acc_0243-0245, carrier reopen-banner UI baqi), staff upload for emailed docs (staffUpload.js), Amazon-grade doc history (carrier360 current/superseded), coiCoverage card, W-9 form rebuild, live-chat email notify, MC 5-8 digit fix.

## 7. Khule kaam (priority order)
1. Monday pehla load (section 3) — searches/posting dates roz sarkana.
2. Justin trailer specs -> fleet row + 123LB update.
3. DAT dispatcher access: demo form (cloud.comms.dat.com/custom-demo) LoadBoot LLC + "registered dispatch service with signed carrier agreements" paragraph; phir Truckstop sales (888) 364-1189. Password/carrier-login kabhi nahi.
4. Meow bank application pending (US business card — 123LB billing US/CA only; Pakistani personal card issue; Mercury/Wise/Relay Pakistan-prohibited, Payoneer account NAHI hai).
5. Marshall: Monday COI + portal W-9 + bank letter.
6. Site deploy (owner push kare) — broker gate + saare JS fixes tabhi live honge.
7. FB hotshot groups join (Retell/LoadBoot number, personal PK number kahin nahi).
8. Retell credit top-up + auto-recharge (broker calls ka number hai).
9. LB-DSA full text check: rate-con signing authority clause hai ya nahi (agar nahi -> chhota authorization e-sign).
10. Munster ko asal FMCSA certificate ke liye poochna (evidence upgrade).
11. 123LB day-8 (~29 Aug): Premium Plus rakhna/girana.
12. Hector duplicates; staging bl_w9 parity check; dispatcher_carrier master agreement counsel-pending (rate-con/POA clauses skeleton hi hain).

## 8. Communication style (user ki pasand)
- WhatsApp/emails carriers ko: professional, chhote, "hum galat the" wali tone NAHI — tricky-but-true framing; blame apne software par nahi daalna.
- Har outbound draft pehle user ko dikhana, wo khud bhejta hai. Reject notes mein exact fix + holder block etc. likhna.
- User se AskUserQuestion sirf asal faislon par; kaam khud aage barhana.
