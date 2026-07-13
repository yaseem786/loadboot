# LoadBoot Agent Portal — Deep Spec (v3 blueprint)
Agent = alag persona, alag product. Carrier shell ka reuse sirf plumbing hai; tajurba apna.

## 1. ACCESS MATRIX — agent ko kya milta hai, kya NAHI
MILTA HAI: apna dashboard (chain, matches, earnings), referral link, chain ke loads ka
READ-ONLY live status (lane, rate, POSTED/BOOKED/DELIVERED — broker ke docs/rate-con NAHI),
invite tools, notifications, payout requests, support chat.
NAHI MILTA: load post/edit (sirf "suggest to broker"), kisi org ka data/documents,
carrier board booking, payments/banking kisi aur ki, PII (sirf org NAAM dikhta hai).
Usool: agent CONNECTOR hai, operator nahi — fraud surface zero rakho.

## 2. ONBOARDING — kya collect karna hai (3 screens, 5 minute)
S1 Identity: poora naam, mobile (OTP verify jab Twilio aaye; tab tak sirf format check),
  city/state, timezone. Optional: agency name, website/LinkedIn.
S2 Experience & network: kitne saal dispatch/freight mein; kis se rishtay hain
  (brokers/carriers/shippers — multi-select + count estimate); kaunsi lanes/equipment
  ka network hai (matching engine ke liye seed data).
S3 Payout & legal: payout method (Payoneer email ya US bank ACH: routing+account),
  W-9 (US persons) ya W-8BEN (non-US) upload/typed — 1099 compliance ke liye lazmi
  from $600/yr; phir AGREEMENTS (Section 3) e-sign (checkbox + typed name + timestamp
  + IP — wahi pattern jo carrier dispatch-agreement ka hai).
Submit → status = UNDER REVIEW → CC queue.

## 3. AGREEMENTS — kin terms/policies par agree karna LAZMI hai (owner ka sawal)
Ek hi e-sign packet "LoadBoot Agent Agreement" jisme ye sections hon:
a) INDEPENDENT CONTRACTOR: agent mulazim nahi; apne taxes ka khud zimmedar (1099).
b) COMMISSION TERMS: 1% of gross sirf GPS-verified DELIVERED loads par; pair-activation
   shart; 15-din clearing; monthly payout min $100; LoadBoot fee se nikalta hai;
   cancelled/disputed/clawed-back loads par kuch nahi; program rates 30-din notice se
   badal sakte hain (accrued amounts protected).
c) ANTI-FRAUD: self-referral, fake orgs, incentive-splitting, ya circumvention = foran
   termination + accrued forfeiture; LoadBoot audit kar sakta hai.
d) NON-CIRCUMVENTION: chain ke clients ko LoadBoot se bahar le jane ki koshish nahi.
e) NO AUTHORITY TO BIND: agent LoadBoot ki taraf se rate/wada nahi kar sakta; khud ko
   LoadBoot ka EMPLOYEE ya BROKER nahi kehlayega (sirf "independent LoadBoot agent").
f) MARKETING RULES: spam nahi (CAN-SPAM/TCPA), sirf sachi claims, brand assets guidelines.
g) CONFIDENTIALITY & DATA: chain ka data sirf apne kaam ke liye; PII scrape/resale ban.
h) PLATFORM POLICIES incorporate by reference: Terms of Service, Privacy Policy,
   Referral Program Terms. (Carrier policies — detention/TONU etc. — agent par lagu NAHI.)
i) TERMINATION: either side 15-din notice; fraud par foran; payable balance clean exit par ada.
UI: har section ka 1-line summary + expand; ek master checkbox + typed-name sign.

## 4. VERIFICATION + CC APPROVAL — kaise approve hoga
- signup par referrers.status = 'pending' (accrual engine pehle hi sirf 'active' par
  paisa deta hai — gate READY hai), code reserve ho jata hai lekin EARN nahi karta;
  link share kar sakta hai (joins record honge, commissions pending-hold).
- CC → naya "Agents" queue (Radar card + apna page): profile summary, W-9 present?,
  agreement signed?, phone verified?, network answers, RED FLAGS (email domain = kisi
  existing org ka? same IP multi-accounts? disposable email).
- Staff action: APPROVE (status→active; welcome email "you're live"; pending
  commissions release) / REJECT reason ke saath / REQUEST MORE INFO (status→info_needed,
  agent ko notification + email).
- Auto-checks jo CC card par dikhein: email verified ✓, phone ✓, W-9 ✓, agreement ✓.

## 5. DASHBOARD MODULES (apna design — dark premium, apni nav)
Nav: Dashboard · My Chain · Matches · Earnings · Payouts · Resources · Support.
- Dashboard: KPI tiles, pair banner, next-best-action card ("aaj ye 1 kaam karo"),
  activity feed. (v2 built ✓)
- My Chain: referred orgs, har ek ki health/activity, "nudge" (pre-written follow-up
  copy), aur PROSPECTS list (agent apne targets likh sake: naam+side+status —
  mini-CRM, sirf uske liye).
- MATCHES (owner ka deep point — engine ka dil):
  * Agent ka carrier join hua → uske equipment/lanes (carrier profile + capacity data
    + past trips se infer) ke mutabiq: (1) CHAIN ke brokers ke open loads pehle,
    (2) phir poore board ke loads. "🔥 3 loads fit Ironhide (Reefer, TX→Southeast)".
  * Agent ka broker join hua → uske open loads ke liye: (1) chain ke carriers fit,
    (2) board ke top verified carriers. "Apex ka Dallas→Atlanta dry van — Ironhide fit".
  * DOUBLE-CHAIN CLOSE button: ek tap se dono taraf notification + email
    ("Your agent suggests: ...") — booking phir normal marketplace flow se.
  * Har match par WHY (equipment ✓, lane ✓, rate vs market ✓) — koi black box nahi.
- Earnings: ledger per load (accrued/payable/paid), month chart, projections.
- Payouts: request + history (built ✓) + W-9 status.
- Resources: invite templates (✓), pitch decks, FAQ, agreement copy.

## 6. NOTIFICATIONS/EMAILS (built ✓ 0074 + additions)
join/posted/booked(double-chain)/delivered ✓ · approval decision · pair-pending nag
(3-din idempotent) · weekly digest (chain activity + earnings) · match alerts
("naya load aap ke carrier ke lanes mein").

## 7. BUILD STATUS
DONE: /app/agent/ entry+guard, agent signup (no org, referrer auto), engine (pair rule,
broker-side accrual, feed, notifications), dashboard v2, agents.html + careers + docs.
PHASE A (agla block): agent_profiles table + onboarding wizard (S1–S3 + agreement e-sign)
+ referrers.status pending→CC approve queue (cc_agents_queue/cc_agent_decide) + Radar card.
PHASE B: Matches engine (agent_matches RPC + UI + double-chain close).
PHASE C: mini-CRM prospects, weekly digest cron, agent chat, apni nav/shell polish.
