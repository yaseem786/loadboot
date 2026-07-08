# LoadBoot — Portal Audit Register
> Har page ka faisla yahan darj hota hai. Faislay: **K** = Keep (theek hai) · **M** = Merge (kisi aur mein milao)
> · **H** = Hide (nav se hatao — DELETE kabhi nahi, wapas laya ja sake) · **F** = Fix (adhura/tuta hua) · **P** = Premium pass (design uplift)
> Tareeqa: ek waqt mein EK portal. Har page pe 5 sawal: (1) kaam karta hai? (2) kisi aur page se takrata hai?
> (3) user isay asal mein istemal karega? (4) adhura kya hai? (5) design brand-level hai?

## Tarteeb (isi order mein chalna)
1. **Carrier portal** — paisa yahan se aata hai, kaam sab se taza yahan hua hai. Funnel A→Z pakka karo.
2. **Command Center** — 70+ views hain, sab se bara "merge" ka kaam yahan hai.
3. **Broker (partner)** — carrier ke naye features ka doosra sira (direct offers ka UI yahan chahiye).
4. **Shipper (partner)** — chhota hai, broker ke baad jaldi niptega.
5. **Developer portal + public website** — aakhir mein polish.
6. **Cross-cutting** — emails, notifications, permissions, staging→prod parity, commit/deploy.

---
## 1. CARRIER PORTAL (app/carrier)
| Page/Tab | Halat | Faisla | Note |
|---|---|---|---|
| Dashboard | onboarding-first hero ✓ | K/P | post-approval dashboard ka "day 2" view check karo |
| Ratings (Account Health) | v2.2 engine ✓ | K | reviews/trust profile cards ki tarteeb dekh lo |
| Load Board (Requests + Available) | naya ✓ | K | offer countdown, protections card — broker-side se end-to-end test |
| My Loads (premium card + Live map v7) | naya ✓ | K | FCFS card, Pay claims, sim — final pass ho chuka |
| My Profile (FMCSA 7-tab) | ✓ | K/P | avatar/hero image broker-view mein kaisa dikhta hai |
| Fleet | purana | F/P | expiry alerts hain; design Midnight pass baqi? |
| Documents | onboarding se wired ✓ | K | post-approval "replace expiring doc" flow test |
| Finance | purana | F | settlement/fee invoices vs naye accessorials ka mel |
| Account (7 tabs) | organized ✓ | K | — |
| Onboarding wizard | mukammal ✓ | K | — |
| OPEN: offers-inbox alag screen? | — | M | Requests tab hi kaafi — alag screen na banao |

## 2. COMMAND CENTER (app/command-center/views — 70+ files)
### Merge clusters (har cluster = 1 hub, tabs ke saath)
| Naya Hub | In views ko milao | Markaz |
|---|---|---|
| **Carrier Ops** | carriers, carrier360, carrierScorecards, accountHealth, verificationCenter, compliance, documents, podReview, safetyDesk, fleetExpiry | carrier360 |
| **Dispatch** | loads, loadIntake, dispatch, trips, bookingRequests, matchCenter, smartMatch, loadPilot, opsMap, controlTower, radar, deliveryHealth | dispatch board |
| **Exceptions & Pay** | exceptions + exceptionCenter (duplicate!), Pay claims queue | exceptionCenter |
| **Partners** | partners, partnerIntake, brokerSla, crm, contactsDirectory, referrals | partners |
| **Finance** | finance, financeAnalytics | finance |
| **Analytics** | analytics, analyticsWeb, bi, reports, googleData, marketingIntel | ek analytics hub |
| **Marketing** | campaigns, campaignManager, emailBuilder, templates, audiences, announcements, seo, content, brandKit | campaignManager |
| **Comms** | chat, comms, notifications, support, CC Mailbox (backend ready) | comms |
| **Automation** | automation, automationsAdmin, workflowBuilder, webhooks, integrations, formBuilder, forms, aiCopilot | automation |
| **Admin** | management, staffRoles, permissionEditor, settings, flags, systemHealth, systemModules, audit, pluginMarketplace | settings |
- Qadam: pehle sirf **NAV ki tarteeb** badlo (groups), code baad mein milao. flattenNav search sab dhoond leta hai — koi cheez kho nahi sakti.
- exceptions.js vs exceptionCenter.js → purana **H** karo foran.

## 3. BROKER PORTAL (app/partner)
| Cheez | Faisla | Note |
|---|---|---|
| Load post (public) | F | pickup/delivery coords + times + accessorial rate card lazmi fields |
| **Direct-to-carrier post (offer bhejna)** | F (banana hai) | backend cc_offer_send ready — broker UI nahi hai |
| Carrier profile dekhna (trust, health tier) | F | carrier ki taraf ka aaina |
| Live trip status + accessorial claims ka nazara | F | approved claims invoice se pehle nazar aayen |
| Broker health (already in engine) | K | — |

## 4. SHIPPER PORTAL
| Cheez | Faisla | Note |
|---|---|---|
| Shipment request flow | K/F | facility notes/dock hours ki health deduction se linked |
| Tracking view | F | wahi live map read-only embed ho sakta hai |

## 5. DEVELOPER + WEBSITE
- Developer portal: Light Exec theme ✓ — API docs pages ka content audit.
- Website: policies pages (detention/TONU/layover) ko naye engine ke numbers se sync karo.

## 6. CROSS-CUTTING (kisi portal ka nahi, sab ka hai)
- [ ] COMMIT + prod deploy plan (main → loadboot.com)
- [ ] Supabase Auth confirm-signup template paste (dono projects) — OWNER
- [ ] dispatch@ mailbox delivery verify — OWNER
- [ ] Phase 3: CC 360 health breakdown + tier-drop notification (Task #11)
- [ ] dispatch_agreement mandatory karne ka faisla
- [ ] FMCSA re-check cron (post-approval authority drift)
- [ ] ACH consent UI (cx1 backend ready)
- [ ] Native app wrapper (background GPS + sticky notification)
- [ ] TomTom traffic (map incidents)
- [ ] In-app chat reply-time metric; in-app calling (Twilio)
