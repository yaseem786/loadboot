# LoadBoot — Dispatch-Service Operating Model (salaried dispatchers) + economics

> This supersedes the earlier "pure self-dispatch software (no dispatcher)" note. Owner's actual
> model = **LoadBoot IS a dispatch service** (its marketing already says "a dedicated dispatcher
> who works your lanes, flat 5%"). This doc details how that works operationally, economically,
> and legally — with salaried (offshore) dispatchers. Get a transportation attorney to confirm
> the multi-carrier structure before scaling.

## The model in one line
**LoadBoot = a dispatch SERVICE + marketplace + software.** LoadBoot's own **salaried dispatchers**
hunt loads FOR each carrier client (on LoadBoot's board + external load boards), negotiate rates,
and handle paperwork — for a **flat 5%** billed to the carrier. LoadBoot is **not a broker** and
**never touches freight money** (the broker pays the carrier / its factor directly).

## Roles
- **Carrier** — holds its own MC/DOT authority. Picks **managed dispatch** (a dedicated dispatcher) or self-serve. Pays LoadBoot **5%** of gross on delivered loads.
- **Dispatcher** — LoadBoot's **salaried team member** (typically remote/offshore, e.g. hired via Facebook/LinkedIn, **paid a monthly salary**). Is assigned specific carriers and **finds loads FOR those carriers** — never "posts" or "offers" freight, never picks a load and shops it to the open carrier market.
- **Broker / Shipper** — the freight owner. Posts their own loads (on LoadBoot or DAT/Truckstop). Is the **broker of record** and pays the carrier. Must be verified.
- **Agent (referral)** — brings carriers/brokers/shippers, earns **1% + downline** out of LoadBoot's 5%. Separate from the salaried dispatcher.

## How a dispatcher hunts loads (Q: "load-board subscription se load hunt kar sakte?")
Yes. A dispatch service finds loads for its carriers on load boards:
- **Cleanest per DAT:** the **carrier owns its DAT/Truckstop account and adds a "dispatcher seat"** for LoadBoot's dispatcher — load boards require the user to have authority, so it runs under the carrier's authority. [DAT dispatch load board](https://www.dat.com/solutions/dispatch-load-board)
- LoadBoot's dispatchers ALSO hunt **LoadBoot's own board** (loads posted by verified brokers/shippers).
- The dispatcher books the load with the **real broker** (rate con = broker → carrier). The broker is broker-of-record and pays the carrier.

## Trucks per dispatcher + scaling (Q: "jitni marzi fleet aaye, manage kar lenge ya hire karein?")
- Industry norm: **one dispatcher handles ~8–15 trucks well** (10–30 at scale with software, some up to 50 for simple lanes). [ProfitableVenture](https://www.profitableventure.com/how-many-truck-per-dispatcher/) · [TruckDispatcherTraining](https://truckdispatchertraining.com/how-many-trucks-can-a-dispatcher-handle/)
- **Scaling = linear:** ~1 new dispatcher per ~10–15 new trucks. As carriers/fleets onboard, hire more dispatchers. Not "manage all with existing staff."

## Hiring + pay (Q: "salary base pe hire, mahiney ke aakhir salary")
- Hire dispatchers **remote/offshore** (Facebook/LinkedIn), **paid a fixed monthly salary** (foreign contractors — no US labor-law issue). Offshore dispatchers cost a fraction of US ($44–55k/yr US remote vs a small monthly salary offshore). [ZipRecruiter remote](https://www.ziprecruiter.com/Salaries/Work-From-Home-Truck-Dispatcher-Salary) · [CreaThink offshore dispatch](https://creathink-solutions.com/articles/why-philippines-top-outsourcing-hub-2026/)
- When a **verified carrier selects "managed dispatch"** at onboarding → assign a dispatcher from the pool (hire more when the pool fills up).

## The money flow (clean, compliant)
1. **Freight $:** broker → carrier's bank (or the carrier's factor via NOA). **LoadBoot never touches this.**
2. **LoadBoot's 5%:** billed to the carrier on delivered loads (a dispatch fee, invoiced to the carrier) → LoadBoot's revenue.
3. **Dispatcher salary:** LoadBoot → dispatcher, **monthly**, out of LoadBoot's revenue.
4. **Agent 1% + downline:** out of LoadBoot's 5%, only on referred carriers.

## Economics (illustrative — real business)
Assume a dispatcher runs **10 trucks**, each grossing ~**$30k/month**:
- LoadBoot revenue = 10 × 5% × $30k = **~$15,000 / month per dispatcher pod**.
- Costs: dispatcher **monthly salary** (offshore, modest) + load-board seat(s) **$300–800/mo** + LoadBoot software/ops + (if referred) agent 1%.
- **Net margin per pod is strong** — this is exactly why offshore truck-dispatch services (many run from Pakistan/India/Philippines for US carriers) are a profitable, established business. Independent dispatchers themselves run at **6–7% commission** on $8–12k/week trucks with only load-board + software overhead. [CreaThink](https://creathink-solutions.com/articles/why-philippines-top-outsourcing-hub-2026/)
- More trucks × 5% − (salaries + tools) = LoadBoot profit. The 5% comfortably covers a salaried dispatcher **because one dispatcher earns 5% across many trucks**, while the salary is a fixed monthly cost.

## Legal guardrails (MUST — attorney to confirm)
1. **Avoid "allocating traffic."** FMCSA: a dispatcher serving **multiple carriers** who **exercises discretion in assigning a load** = a **broker** (needs authority + $75k bond). Stay a bona-fide agent by: each carrier under a **written dispatch agreement**; the dispatcher **sources loads FOR one specific carrier's truck** (its location/lane), never "here's a load — which of my carriers gets it"; non-overlapping markets help. **This is why LoadBoot must NOT let anyone post freight to the open network and pick carriers** — the dispatcher works FOR a carrier and hunts loads for it. (This is exactly why the agent "post a load to the open network" flow was removed — correct call.)
2. **Never handle freight money.** LoadBoot bills only its 5% to the carrier; the broker pays the carrier/factor directly. Any escrow of freight funds = broker status.
3. **Broker of record + verify.** Every load the dispatcher books comes from a **real licensed broker** (broker-of-record, verified: active authority + $75k bond + insurance + credit). LoadBoot surfaces this; the carrier is protected by that broker's bond.
4. **Load-board terms:** use the **carrier's own DAT/Truckstop account + dispatcher seat** (cleanest), or a dispatch-service account per DAT's terms.
5. **Contractor classification:** offshore dispatchers = foreign contractors, monthly salary — fine; keep written contracts.

## What this means for the LoadBoot BUILD + marketing
- **Marketing stays** — "a dedicated dispatcher, flat 5%, we work your lanes" is TRUE under this model (LoadBoot's dispatchers do it). No rewrite needed. ✅
- **The agent-portal change was correct** — agents don't post/offer freight (that's the brokering risk). Agents = referral (1%). The **dispatchers** (salaried team) do the actual dispatching by **hunting loads for carriers**, not posting freight. ✅
- **To build (new, safe):**
  1. **Managed-dispatch onboarding option** for carriers (self-serve vs dedicated dispatcher) + the **Dispatch Service Agreement** e-sign (attorney text).
  2. **Dispatcher accounts + carrier↔dispatcher assignment** (a dispatcher's console showing their assigned carriers' trucks, loads to hunt, trips).
  3. **Dispatcher pool / capacity** view for ops (assign carriers, hire when full).
  4. **Payroll ledger** for dispatcher monthly salaries (internal), separate from the 5% carrier billing and the agent 1%.
  5. Keep **no freight-money custody** everywhere.
- **Optional:** connect dispatchers to external load boards (carrier's DAT seat) inside the dispatcher console.
