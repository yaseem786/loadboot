# LoadBoot Dispatch Service — Legal Compliance Operating Guide (cited)

**Purpose:** make LoadBoot's multi-carrier, salaried-dispatcher model as legally safe as
reasonably possible WITHOUT needing to retain an attorney right now. This is a grounded,
sourced operating standard — **not legal advice**. The controlling document is FMCSA's
final regulatory guidance **"Definitions of Broker and Bona Fide Agents," 88 FR 39368
(June 16, 2023)**, which interprets **49 CFR 371.2** and the statutes at **49 USC 13102**,
**14916**, **13906**. Guidance is advisory (no force of law); determinations are
"fact-specific / totality of circumstances." Research date: 2026-07-22.

---

## The one rule that governs everything: NO "allocation of traffic"

- A **bona fide agent** (needs NO broker authority) is defined at **49 CFR 371.2(b)** as a person
  "part of the normal organization of a motor carrier… pursuant to a preexisting agreement
  which provides for a continuing relationship, **precluding the exercise of discretion on the
  part of the agent in allocating traffic between the carrier and others.**"
- FMCSA defines **"allocating traffic" = "any exercise of discretion on an agent's part when
  assigning a load to a motor carrier."** (88 FR 39370–39371.)
- **Serving multiple carriers is NOT by itself brokering.** "Representing more than one motor
  carrier does not necessarily mean one is a broker." The trigger is the *act of choosing* which
  of several carriers gets a given load. (88 FR 39371; Scopelitis.)
- **Broker-required trigger:** "If a dispatch service arranges transportation on behalf of
  multiple motor carriers and engages in the allocation of traffic… it is not a bona fide agent
  and must obtain broker operating authority registration." (88 FR 39372.)

### How LoadBoot structurally avoids allocation (mandatory design rule)
FMCSA's two safe-harbor structures for multi-carrier agents (88 FR 39371):
1. **Non-overlapping geography** — each carrier's agreement covers distinct origin regions, so a
   sourced load "would necessarily be assigned to the relevant carrier." OR
2. **Non-overlapping equipment/commodity** — e.g., Carrier A reefer-only, Carrier B flatbed-only;
   hazmat vs non-hazmat — "the carriers are not willing or able to haul the same loads."

Plus the practitioner safeguard for the ambiguous "Factor 5": **document, per load, WHY only one
carrier was eligible** (equipment, lane, hazmat endorsement, HOS/availability). LoadBoot encodes
this as a required **per-carrier "scope basis"** on every assignment (see software guardrails).

**One dispatcher can legally serve 8–15 carriers** as long as every load is sourced FOR one
pre-identified carrier under that carrier's authority — never held out to a pool and then assigned.

---

## The "bona fide agent" test — keep every box checked

| Axis | Compliant (agent) | Broker (needs authority + $75k bond) |
|---|---|---|
| **Who pays the dispatcher** | the CARRIER pays (1099 or W-2) | shipper/broker pays, or a margin on freight |
| **Money custody** | never touches linehaul | handles/holds shipper↔carrier money |
| **Authority** | carrier holds MC/DOT; carrier "legally bound to transport" | dispatcher arranges as principal |
| **Discretion** | none — load pre-determined to one carrier | chooses among carriers (allocates) |
| **Freight source** | through a broker, for that carrier | solicits shippers directly / open carrier market |
| **Agreement** | preexisting, continuing, written agency contract | none / casual |

Sources: 49 CFR 371.2(a)/(b); 49 USC 13102(2); 88 FR 39370–39372; Overdrive, Benesch, Scopelitis.

---

## Money: never in the freight path (the heaviest single factor)

- FMCSA: "handling money exchanged between shippers and motor carriers… **strongly suggests** the
  need for broker authority" (one factor, not alone determinative). Being "involved in any part of
  the monetary transaction" is on the broker-required list. (88 FR 39370, 39372.)
- **Compliant flow:** broker pays the **carrier** (or the carrier's **factor**) directly; the
  dispatcher/LoadBoot **invoices the carrier separately for its own fee only.** Money never lands
  in LoadBoot's account first. (TruckLeap; FMCSA factor IV.E.)
- **Factoring + NOA (UCC 9-406):** a Notice of Assignment directs the broker to pay the carrier's
  **factor**; under UCC 9-406(a) the broker is discharged only by paying the assignee. This keeps
  the dispatcher entirely out of the money path. (Apex Capital; FreightWaves.)
- LoadBoot already operates this way: it does **not** hold freight money — it runs a ledger and
  **bills its own ~5% fee to the carrier**; factoring routes via NOA. This matches the compliant model.

---

## Load boards: book under the CARRIER's own authority

- **DAT:** "All load board users must have their own authority (MC/DOT). If you're an independent
  dispatcher, your carrier owns the DAT account and can purchase a **seat** for you." Dispatchers
  "don't sign up directly." (dat.com/solutions/dispatch-load-board.)
- **Truckstop:** loads shown "match your operating authority." (truckstop.com.)
- **LoadBoot rule:** primary demand = LoadBoot Carrier Network (per-carrier). For external boards,
  the dispatcher works **on the assigned carrier's own DAT/Truckstop seat**, booking under that
  carrier's MC. A dispatch-service board account is a controlled fallback only, strictly per-carrier.
  Never a dispatcher's personal account used across carriers.

---

## Dispatcher–carrier agreement — required clauses
(FMCSA's nine "no-authority" factors map onto these; PandaDoc/Benesch templates confirm wording.)

1. Written appointment of LoadBoot's dispatcher as the **carrier's licensed agent** (preexisting, continuing).
2. **Independent contractor**; dispatcher is a 1099 recipient of / paid by the carrier.
3. **Limited Power of Attorney** — only to transfer docs, accept loads for the carrier, invoice on its behalf.
4. **No authority to bind**; dispatcher bears no legal/financial responsibility in the shipper↔carrier deal.
5. **No money handling** — dispatcher is not an intermediary in any broker↔carrier payment.
6. **Paid by the carrier** per the contract (the ~5% fee), never by broker/shipper/factor.
7. **Per-carrier scope + disclosure** — arranges "for that motor carrier only," discloses agent status to brokers.
8. **No re-brokering / no re-assignment** of a booked load to another carrier.
9. **Carrier retains its authority and is solely liable** for the freight; holds dispatcher harmless.
10. **State-licensing compliance** where applicable.

LoadBoot already has a signed carrier-side **Dispatch Service Agreement** (migration bl_cc_0134
makes it mandatory); align its text to the 10 clauses above.

---

## RED FLAGS — any one leans "broker" (FMCSA's seven adverse factors)
1. Negotiating a shipment **directly with a shipper**.
2. **Taking money** from the broker/factor, or involvement in any part of the money transaction.
3. Arranging freight for a carrier with **no written contract**.
4. **Accepting a load without a truck**, then hunting a carrier.
5. **Allocating traffic** — a load two+ contracted carriers could haul, and choosing one.
6. Being a **named party** on the shipping contract.
7. **Soliciting the open carrier market** (posting a load to find any carrier).

Penalty exposure (49 USC 14916): up to **$10,000/violation** (inflation-adjusted) **plus unlimited
liability to injured parties**, applied **jointly & severally to the company AND its individual
officers, directors, and principals** — personal liability. Lawful brokering needs FMCSA
registration + **$75,000 BMC-84 bond** (49 CFR 387.307; 49 USC 13906).

---

## Software-enforceable compliance checklist (LoadBoot builds these in)
- [Required] Load booked under the **carrier's own authority**; rate con names the carrier, not LoadBoot.
- [Required] **Signed agent agreement on file** before any dispatching begins.
- [Required] Dispatcher **paid only by the carrier**; LoadBoot bills its fee to the carrier.
- [Required] **No money custody** — linehaul flows broker → carrier/factor.
- [Required] **Per-carrier sourcing** with a recorded **scope basis** (geography or equipment/commodity) + per-load eligibility reason.
- [Required] **No re-brokering / no re-assignment**.
- [Required] Dispatcher **goes through a broker**, never solicits shippers.
- [Required] Dispatcher **never a named party** on the shipping contract.
- [Required] **No "accept-then-find-a-truck"** behavior.
- [Best practice] Onboarding packet per carrier (MC authority, insurance cert, W-9, LPOA).
- [Best practice] Carrier-issued 1099 tracked; confidentiality/data-handling terms (offshore).

---

## ⚠️ Offshore-specific risk — READ THIS
- FMCSA's agent-vs-broker test **applies regardless of the dispatcher's location** — offshore
  dispatchers must meet the SAME factors (paid by carrier, no money, no allocation).
- **Pending legislation — H.R. 5688 ("Dalilah's Law")**, in committee as of mid-2026, would
  specifically **restrict foreign dispatchers**: bar dispatchers without a US license from
  coordinating loads for US carriers, require FMCSA registration for intermediaries, penalize
  carriers using unauthorized dispatchers, and require declaring who coordinates each load. **Not
  law yet**, but it is aimed directly at LoadBoot's offshore-dispatcher model — monitor it.
  (news.thetrucksavers.com; idispatchhub.com.)
- Industry reporting ties cheap offshore dispatch to double-brokering/fraud scrutiny and carrier
  data-security concerns. Mitigate with written confidentiality terms, identity verification, and a
  visible US presence/accountability.

**Bottom line:** LoadBoot's model is defensible IF it holds every guardrail above — especially
per-carrier scope (no allocation), zero money custody, carrier-authority bookings, and signed
agent agreements. The biggest live risks are (a) the "Factor 5" allocation ambiguity for
overlapping carriers → mitigated by recorded scope basis + per-load eligibility, and (b) pending
anti-offshore-dispatcher legislation → monitor H.R. 5688. When LoadBoot scales, have a
transportation attorney bless the multi-carrier scope structure.

### Primary sources
- FMCSA final guidance, 88 FR 39368 (2023-13080): https://www.federalregister.gov/documents/2023/06/16/2023-13080/definitions-of-broker-and-bona-fide-agents
- 49 CFR 371.2: https://www.ecfr.gov/current/title-49/section-371.2 · 49 USC 13102 / 14916 / 13906: https://www.law.cornell.edu/uscode/text/49/13102 · /14916 · /13906
- 49 CFR 387.307 ($75k bond): https://www.law.cornell.edu/cfr/text/49/387.307
- Scopelitis: https://scopelitis.com/law-alerts/fmcsa-announces-final-guidance-on-definition-of-broker-and-bona-fide-agent-as-well-as-on-role-of-dispatch-services/
- Benesch: https://www.beneschlaw.com/insight/lions-and-tigers-and-bears-oh-my-new-fmcsa-guidance-on-the-definition-of-dispatch-services-bona-fide-agents-and-brokers/
- DAT dispatch load board: https://www.dat.com/solutions/dispatch-load-board · Apex NOA/UCC 9-406: https://www.apexcapitalcorp.com/blog/what-is-a-notice-of-assignment/
- Overdrive final-guidance coverage: https://www.overdriveonline.com/regulations/article/15540708/fmcsas-final-guidance-on-broker-authority-for-dispatchers
