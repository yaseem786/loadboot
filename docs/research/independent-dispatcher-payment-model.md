# Independent Dispatcher / Agent Model + Carrier Payment (Factored vs Not) — Research for LoadBoot

Deep-research report (US, current as of July 2026). Sources cited inline. Use this to design
(a) what an agent-posted load must carry, and (b) how carrier payment clears in each case.

---

## TL;DR — Roman Urdu (LoadBoot design ke liye faisle)

1. **Dispatcher ≠ Broker.** Dispatcher/agent **carrier ke liye** kaam karta hai, aur **carrier hi usy pay karta hai** (5–10% ya flat). Usy broker authority/MC/$75k bond ki **zaroorat nahi** — **jab tak** wo (a) kai carriers ke beech load "allocate" na kare, (b) shipper/broker se pay na le, aur (c) freight ke paise ke beech mein na aaye.
2. **Sabse aham risk — "allocating traffic":** FMCSA ka headline example — ek independent dispatch service jo **do alag carriers ke beech load allocate** karti hai (yani decide karti hai kaunsa carrier load le), wo **BROKER hai** aur usy authority + $75k bond chahiye. To agar LoadBoot ka **agent** load post kare aur khud decide kare kaunsa carrier le → **broker ban jayega**. **Hal:** load **verified broker** se source ho (wohi asal broker/allocator + payer hai), carrier **khud accept kare (first-accept-wins)** — agent decide na kare. (Legal counsel se confirm karao.)
3. **LoadBoot broker nahi (aur nahi banna chahiye).** Kyunki wo **paise nahi rakhta/route nahi karta** (bank-to-bank broker↔carrier/factor), wo **DAT/Truckstop jaisa info-marketplace** hai = broker **nahi**. Jis lamhe LoadBoot freight ka paisa apne account se route kare ya carriers allocate kare → **broker ban jayega**. **Freight ka paisa kabhi LoadBoot ke account se na guzre — sirf 5% fee.**
4. **Carrier ko pay karne wala = rate confirmation par likha BROKER of record.** Wo broker carrier ko pay karne ka **akela zimmedaar** hai — chahe shipper ne broker ko na diya ho. Is liye **us broker ka verified hona ZAROORI hai** (active authority + $75k bond + insurance + credit/days-to-pay). Yehi carrier ka tahaffuz hai.
5. **Agent paying party nahi, koi financial liability nahi.** Agent ki 1% **LoadBoot deta hai** (apni 5% mein se), freight par extra nahi. Yani **"agent se payment kaise lenge" → agent se lete NAHI, agent ko DETE hain.**

---

## (a) What an agent-posted load MUST carry — the "Load Source"

Every agent-posted load must be **sourced from a LoadBoot-VERIFIED broker or shipper** (the real paying party). The agent **selects that verified broker/shipper as the LOAD SOURCE** — never free-texts an unverified outside entity.

The broker behind the load must have on file (this is exactly why the broker checklist exists):
- **Active FMCSA broker authority** — status ACTIVE (not revoked/pending/inactive). Verify on FMCSA L&I/SAFER. **Key on USDOT number going forward** — FMCSA is phasing out MC numbers (target ~Oct 2025, timing has slipped historically). [FMCSA broker registration](https://www.fmcsa.dot.gov/registration/broker-registration) · [FreightWaves MC→USDOT](https://www.freightwaves.com/news/what-it-means-for-the-industry-as-fmcsa-eliminates-mc-numbers-in-2025)
- **$75,000 BMC-84 surety bond (or BMC-85 trust) active** — this is the fund the carrier claims against if unpaid (49 U.S.C. 13904). [FMCSA](https://www.fmcsa.dot.gov/registration/broker-registration) · [SuretyBonds](https://www.suretybonds.com/license-permit/freight-broker-bond)
- **Insurance** — contingent cargo / broker liability (E&O), carrier's COI naming the broker.
- **Signed Broker-Carrier Agreement** — governs payment, indemnity, and a **no-re-brokering clause**. [Freight360 sample](https://www.freight360.net/wp-content/uploads/2023/10/Sample_Broker-Carrier_Agreement.pdf)
- **Credit / average days-to-pay** — Ansonia score 87+ = lowest risk; industry avg ~28–33 days; >35 days = yellow flag. [DAT/Ansonia](https://one.support.dat.com/9-resources-52e74931/credit-score-ansonia-faqs-a60b3742) · [altLINE](https://altline.sobanco.com/checking-freight-broker-credit-score/)
- **Trade / customer references.**

The per-load **Rate Confirmation must name the TRUE broker of record** (that verified broker), their MC/USDOT, agreed rate, pickup/delivery windows, accessorials — it is the carrier's binding pay agreement. Carriers should verify the broker on the official FMCSA record, not the number printed on the rate con. [OTR Solutions](https://otrsolutions.com/blog/preventing-double-brokering-and-trucking-fraud)

**Anti-double-brokering (build into posting):** the agent cannot re-broker or reassign the load; the carrier that shows up must match; payment must come from the named broker; personal/free-email domains, a rate-con from a different entity than who posted, mismatched MC/USDOT, or a rate far above market are red flags. [Truckstop fraud](https://truckstop.com/blog/freight-fraud/) · [OTR](https://otrsolutions.com/blog/preventing-double-brokering-and-trucking-fraud) · [Denim](https://www.denim.com/blog/unmasking-double-brokers-tips-to-protect-your-brokerage)

**Fraud scale (why this matters):** ~$725M freight-fraud losses across US/Canada in 2025 (+~60% YoY); double-brokering is the most-reported type. TIA reported a 65% surge in fraud reports Sep 2024–Feb 2025. [Authenticate/FMCSA 2025](https://authenticate.com/resources/blog/fmcsa-rules-2025/) · [TIA](https://news.tianet.org/leading-the-charge-against-freight-fraud/)

---

## (b) How carrier payment CLEARS — factored vs non-factored

### Non-factored (direct pay)
1. Carrier delivers → submits **invoice + signed POD/BOL** (and accessorial docs) to the broker.
2. **Broker pays the carrier's OWN bank** (ACH), **net-15/30/45** per the rate con, bank-to-bank. The clock starts on receipt of a complete invoice+POD, not the delivery date. [OTrucking terms](https://otrucking.com/resources/guides/broker-payment-terms/) · [Truckstop billing](https://truckstop.com/blog/freight-billing-process-for-brokers/)
3. Carrier's pay details come from the **carrier packet**: W-9, bank/ACH (voided check or bank letter), remittance email. [TrueNorth](https://www.truenorth.com/articles/new-carriers/carrier-packets)
4. **Quick-pay option** = the **broker** pays faster (1–7 days) for a **1.5–5% fee** (distinct from factoring). [OTrucking](https://otrucking.com/resources/guides/broker-payment-terms/) · [RTS](https://www.rtsinc.com/articles/factoring-and-quick-pay-get-you-paid-faster)
5. If the broker never pays → **claim against the broker's $75k BMC-84 bond**. [FMCSA](https://www.fmcsa.dot.gov/brokers-freight-forwarders)
6. **LoadBoot** runs the ledger (DUE on delivery → PAY-BY deadline → receipt upload → confirm-received). It does **not** hold or move the money.

### Factored (carrier uses a factoring company)
1. Carrier factors the invoice → factor **advances 80–95%** within 24–48h, then collects from the broker. Fee ~1–5%; reserve (~5–20%) released after the broker pays, minus fee. [FreightWaves factoring](https://www.freightwaves.com/checkpoint/freight-factoring/) · [Apex NOA](https://www.apexcapitalcorp.com/blog/what-is-a-notice-of-assignment/)
2. Factor issues a **Notice of Assignment (NOA)** to the broker. **Under UCC §9-406, once the broker RECEIVES the NOA, they MUST pay the FACTOR, not the carrier** — paying the carrier after an NOA does **not** discharge the debt (broker can **pay twice**). Anti-assignment clauses are ineffective (§9-406(d)). [Miller Nash on §9-406](https://www.millernash.com/firm-news/news/its-not-nice-to-pay-an-invoice-twice-payment-demands-during-covid-19-by-assignees-of-accounts-under-ucc-section-9-406) · [Triumph](https://triumph.io/blog/broker/what-every-freight-broker-should-know-about-factoring/)
3. Broker pays the **factor's remit-to** (factor name, bank/ACH, remittance email). Broker may demand reasonable proof of assignment (§9-406(c)); a UCC-1 alone isn't enough. **LoadBoot already surfaces the factor's remit-to to the broker** (via `cc_factoring_verify` / `pay_instructions`). [Miller Nash](https://www.millernash.com/firm-news/news/its-not-nice-to-pay-an-invoice-twice-payment-demands-during-covid-19-by-assignees-of-accounts-under-ucc-section-9-406)
4. **Recourse vs non-recourse:** non-recourse usually covers **only broker insolvency**, NOT dispute-based non-payment (claims/shortages stay the carrier's). [FreightWaves recourse](https://www.freightwaves.com/checkpoint/recourse-vs-non-recourse-factoring/)
5. **Leaving/switching a factor:** the factor issues a **Release Letter** → payments revert to the carrier's own bank (or the new factor). Broker keeps paying the old factor until the release arrives. **LoadBoot handles this** (`noa_status='released'` → routing flips back). [Apex](https://www.apexcapitalcorp.com/blog/what-is-a-notice-of-assignment/) · [altLINE release](https://altline.sobanco.com/letter-of-release/)

### LoadBoot's own money (the 5% and the agent's 1%)
- **LoadBoot's 5% dispatch fee = collected from the CARRIER** — this is a *dispatcher's fee paid by the carrier*, which is the compliant structure (dispatcher is paid by the carrier, never by the broker/shipper). [OTrucking dispatcher pay](https://otrucking.com/resources/guides/how-much-do-dispatchers-charge/) · [TruckLeap](https://truckleap.com/blog/how-does-a-truck-dispatcher-get-paid)
- **Agent's 1% = paid BY LoadBoot out of its own 5%** — NOT added to the freight, NOT collected from the agent. This is the compliant referral/affiliate model ("commission paid out of the platform's revenue, not by inflating the freight rate"). [FreightWaves — TIA/OOIDA to FMCSA](https://www.freightwaves.com/news/fmcsa-commenters-debate-whether-load-boards-should-register-as-brokers)
- Fee-collection mechanics for a carrier-paid dispatch fee: direct weekly billing to the carrier, authorized ACH auto-deduct (capped, revocable), or factoring-partner itemized deduction at funding. **Red flag / never do:** route freight money through the dispatcher/platform account before the carrier gets it. [TruckLeap](https://truckleap.com/blog/how-does-a-truck-dispatcher-get-paid)

---

## Compliance guardrails LoadBoot must encode (from FMCSA 88 FR 39368)

FMCSA final guidance (June 16, 2023) — the controlling authority: [Federal Register 2023-13080](https://www.federalregister.gov/documents/2023/06/16/2023-13080/definitions-of-broker-and-bona-fide-agents) · [Benesch summary](https://www.beneschlaw.com/insight/lions-and-tigers-and-bears-oh-my-new-fmcsa-guidance-on-the-definition-of-dispatch-services-bona-fide-agents-and-brokers/) · [Overdrive](https://www.overdriveonline.com/regulations/article/15540708/fmcsas-final-guidance-on-broker-authority-for-dispatchers)

1. **Don't allocate traffic.** An agent who represents multiple carriers and picks which one gets a load is "allocating" = a broker. → Use **first-accept-wins** (carrier self-selects); the *verified broker* behind the load is the one who contracted/allocated the freight.
2. **Keep freight money off LoadBoot's books.** Any custody/escrow of freight funds = "handling money exchanged between shippers and carriers," which strongly suggests broker status. Only the 5% service fee hits LoadBoot.
3. **The agent must not take the freight or re-broker it,** and must not be "involved in the monetary transaction between broker and carrier." Enforcing this is *simultaneously* the compliance shield and the anti-double-brokering control.
4. **Every posted load's broker of record must be a verified, bonded, insured LoadBoot broker/shipper** (the payer). That is the carrier's protection.
5. **Referral commissions come out of LoadBoot's fee,** never added to the freight rate.
6. **Penalties are personal:** 49 U.S.C. §14916 unauthorized-brokering penalties can reach officers/principals — so the conservative design above is important. [Benesch](https://www.beneschlaw.com/insight/lions-and-tigers-and-bears-oh-my-new-fmcsa-guidance-on-the-definition-of-dispatch-services-bona-fide-agents-and-brokers/)

> **Disputed/evolving (flag):** the load-board-vs-broker line is FMCSA *guidance*, not a binding rule; safety groups dispute it and a future rulemaking (plus broker-transparency litigation) could move it. Treat the design as conservative and **get a transportation attorney to confirm the agent-posting flow** before scaling. [FreightWaves](https://www.freightwaves.com/news/fmcsa-commenters-debate-whether-load-boards-should-register-as-brokers)

---

## What this means for the LoadBoot build (concrete)

- **Agent Post-a-Load → add a required "Load Source" step:** agent must **select a LoadBoot-verified broker/shipper** (usually one they referred) as the paying party. No free-text external brokers. The rate confirmation carries that broker as broker-of-record.
- **Carrier-facing:** the carrier sees the **verified broker** behind the load (authority/bond/insurance status), plus the pay terms — that's what makes it safe, not LoadBoot's name.
- **Posting = first-accept-wins** (already the model) so the agent isn't "allocating."
- **Payment routing (already partly built):** factored → broker pays factor (NOA remit-to); not factored → broker pays carrier's own bank; LoadBoot only runs the ledger + collects 5% from the carrier + pays the agent 1%.
- **Agent has no broker authority/bond requirement** — correct, because the *verified broker* behind each load is the licensed, bonded party.

---

# PART 2 — The legally-correct structure for an agent's EXTERNALLY-sourced load (deep-dive)

**Question answered:** an independent dispatcher (agent) sources a load from an external broker who is NOT on LoadBoot; only the agent is in contact with that broker. How is this built legally, and how does broker↔carrier payment (direct or factor) work?

## The exact tripwire (verified, primary FMCSA source)
FMCSA final guidance **88 FR 39368 (June 16, 2023)** states a dispatch service that **"solicits a shipment without a carrier in mind and then finds a carrier to transport the shipment" is acting as a BROKER** and needs authority + a $75,000 bond. "Allocating traffic" = "any exercise of discretion when assigning a load to a motor carrier." [Federal Register 2023-13080](https://www.federalregister.gov/documents/2023/06/16/2023-13080/definitions-of-broker-and-bona-fide-agents) · [Scopelitis](https://scopelitis.com/law-alerts/fmcsa-announces-final-guidance-on-definition-of-broker-and-bona-fide-agent-as-well-as-on-role-of-dispatch-services/)

➡️ **So: an agent who takes an external broker's load and "posts it to the open LoadBoot carrier network for any carrier to accept" is soliciting the open carrier market = brokering (needs authority + $75k bond).** That is the risky model — and it is exactly the "first-accept-wins, any carrier" flow.

## The ONLY compliant non-broker path (bona fide agent of a SPECIFIC carrier)
To bring an external broker's load onto LoadBoot **without** anyone becoming a broker, the agent must act as the **dispatcher of a specific, already-identified carrier** (their client) — NOT shop the load to the open market. Verified requirements: [Benesch](https://www.beneschlaw.com/insight/lions-and-tigers-and-bears-oh-my-new-fmcsa-guidance-on-the-definition-of-dispatch-services-bona-fide-agents-and-brokers/) · [TruckLeap](https://truckleap.com/blog/how-does-a-truck-dispatcher-get-paid) · [DispatchRepublic](https://dispatchrepublic.com/the-role-of-a-dispatcher-in-managing-carrier-setup-and-broker-compliance/)

1. **Written dispatch-service agreement + limited power of attorney** — the carrier appoints the agent as its attorney-in-fact/agent to negotiate and sign rate cons on the carrier's behalf. (FMCSA's #1 bona-fide-agent factor.)
2. **The agent finds the external broker's load FOR that carrier** — the load is *assigned/tendered to the agent's own carrier client*, not broadcast to whatever carrier bids. No "discretion in choosing among carriers" = no allocation = no brokering.
3. **The CARRIER is set up in the broker's system** (carrier packet: the *carrier's* MC authority, COI, W-9). The **rate confirmation is broker → that carrier**, broker-of-record = the external broker; the agent is **not a named party** on it (the agent may sign only as the carrier's disclosed agent).
4. **The broker pays the CARRIER directly** — carrier's own bank (net 30–45) or the carrier's **factor via NOA**. The agent **never touches the money**. The agent's fee is billed to and paid by the **carrier** separately (or deducted by the carrier's factor as an itemized third-party line the carrier authorized).
5. **Disclosure:** the agent discloses it is "a dispatch service operating under an agreement with a specific motor carrier, and the shipment is arranged for that carrier only."

**Money-handling is the single strongest broker red flag** — being "involved in any part of the monetary transaction" or "taking a spread/compensation from the broker or factor" pushes you into broker status. Keep freight money entirely off LoadBoot's and the agent's books. [CarrierAssure/FMCSA](https://www.carrierassure.com/blog/fmcsa-guidelines-to-differentiate-dispatchers-from-brokers)

## What this means for LoadBoot's "Post a Load" (important design change)
- **Risky (avoid):** agent posts an external-broker load to the OPEN LoadBoot carrier network, any carrier accepts (first-accept-wins). This = soliciting the open market for that external load = **brokering** for the agent (and edges LoadBoot toward broker status too).
- **Compliant (build this):** the agent's posted load is **assigned/tendered to the agent's OWN carrier client(s)** — the carrier(s) the agent dispatches under a written agreement. LoadBoot is then the **operating system for that carrier** (verify the external broker, track delivery/POD, run the settlement ledger), not an open load-matching broker for external freight.
- If LoadBoot genuinely wants the **open-marketplace** model for external-broker loads, then **LoadBoot (or the agent) must obtain broker authority + a $75k BMC-84 bond** and operate co-brokerage under disclosed written agreements — a fundamentally different, heavier legal posture. [Benesch co-broker rules](https://www.beneschlaw.com/insight/transportation-brokering-double-brokering-co-brokering-interchange-and-interlining-legal-rules-in-the-era-of-fraud/)

## Verifying the external broker (no LoadBoot account needed)
The agent (who IS in contact with the broker) submits the broker's **MC/USDOT + the rate confirmation**. LoadBoot then:
- Checks the broker on the **public FMCSA record (SAFER/L&I):** authority ACTIVE + **$75k BMC-84 bond on file** + insurance. [usdotwatch](https://usdotwatch.com/mc-number-lookup) · [awcollects on bond claims](https://awcollects.com/how-to-file-on-a-brokers-bond/)
- Layers **broker credit / days-to-pay** (Carrier411 / Highway / DAT-Ansonia) — FMCSA status alone doesn't show if/when a broker pays. [OTrucking tools](https://otrucking.com/resources/guides/best-broker-credit-check-tools/)
- **Surfaces this to the carrier BEFORE booking** so the carrier knows the real paying party and can decline if authority/bond/credit is bad. Rate-con entity must **match SAFER**; mismatch = top double-brokering red flag. [OTR Solutions](https://otrsolutions.com/blog/preventing-double-brokering-and-trucking-fraud)

## Payment mechanics recap for this scenario
- **Direct (no factor):** external broker → carrier's own bank (ACH), net-30/45 per the broker↔carrier rate con; carrier claims the broker's $75k bond if unpaid. LoadBoot = ledger + delivery/POD proof + collects 5% from the carrier + pays agent 1%.
- **Factor:** external broker → the carrier's factor (NOA remit-to, UCC §9-406); LoadBoot surfaces the factor remit-to. Same LoadBoot fee/agent-commission handling.
- **LoadBoot never holds freight funds** — only its own 5% service fee touches LoadBoot; agent's 1% is paid out of that 5%.

## Enforcement / risk notes (2026)
- Unauthorized brokering (49 U.S.C. §14916): civil penalties + private suits; liability can reach **principals personally**. [Benesch](https://www.beneschlaw.com/insight/lions-and-tigers-and-bears-oh-my-new-fmcsa-guidance-on-the-definition-of-dispatch-services-bona-fide-agents-and-brokers/)
- From **Jan 2026**, a broker whose bond drops below $75k even one day faces **immediate authority suspension** — so re-checking the external broker's bond at post time matters. (Industry source — verify against primary FMCSA text.) [iDispatchHub](https://idispatchhub.com/how-fmcsas-new-broker-rule-puts-brokers-and-dispatchers-on-notice/)
- FMCSA's guidance is **interpretive, not binding law**, and this exact flow is fact-specific and thinly litigated — **get a transportation attorney (e.g., Scopelitis/Benesch-type) to bless the agent-posting flow before scaling.**

## Bottom line
An independent dispatcher can legally bring an external broker's load onto LoadBoot **only if the agent is dispatching for a specific carrier client** (bona fide agent), the load is **tendered to that carrier** (not shopped to the open market), the **rate con is broker→that carrier**, the **broker pays that carrier/its factor directly**, and **neither the agent nor LoadBoot touches the freight money**. LoadBoot verifies the external broker off the public FMCSA record + credit and shows the carrier. Anything that has the agent/LoadBoot picking among carriers on the open market for an external load, or handling the freight money, requires broker authority + a $75k bond.
