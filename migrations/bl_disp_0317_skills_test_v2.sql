-- bl_disp_0317 — Skills test v2 (bank, MCQ, domains, rubric anchors, gates) + the data the
-- Dispatcher 360 page needs (activity feed, richer board cards). 17 Sep 2026. Additive, reversible.
--
-- WHY: v1 served every candidate the same 9 free-text questions, scored by a number typed from a
-- free-text key. v2 draws one item per bank group so two candidates never see the same test,
-- auto-scores MCQ + numeric on submit, scores the written items on 0–5 behaviourally-anchored
-- levels with a tick-list of expected findings, reports per-domain sub-scores and four pass gates.
-- Old attempts (question_ids IS NULL) keep reading the v1 bank exactly as before.
--
-- Anon-executable SECURITY DEFINER surface in public must stay at 33 (prod) / 32 (staging) — verified after apply.
--
-- Applied to staging + prod on 17 Sep 2026 as four Supabase migrations with identical SQL:
--   bl_disp_0317_pre_kind_mcq (the kind check), bl_disp_0317a_… (schema + bank),
--   bl_disp_0317b_… (functions), bl_disp_0317c_board_own_board_fix (the own_board flag, section 9 below).

-- ───────────────────────────── 1. schema (additive)
alter table app_private.skills_test_questions
  add column if not exists bank_version int not null default 1,
  add column if not exists code text,
  add column if not exists bank_group text,
  add column if not exists domain text,
  add column if not exists context text,
  add column if not exists options jsonb,
  add column if not exists correct text,
  add column if not exists gate text,
  add column if not exists rubric jsonb,
  add column if not exists findings jsonb,
  add column if not exists suggested_minutes int;
create unique index if not exists skills_test_questions_code_ux on app_private.skills_test_questions(code);
alter table app_private.skills_test_questions drop constraint if exists skills_test_questions_kind_check;
alter table app_private.skills_test_questions add constraint skills_test_questions_kind_check check (kind = any (array['number'::text,'short'::text,'long'::text,'mcq'::text]));

alter table app_private.skills_test_attempts
  add column if not exists question_ids uuid[],
  add column if not exists bank_version int,
  add column if not exists domain_scores jsonb,
  add column if not exists gates jsonb;

alter table app_private.skills_test_answers
  add column if not exists findings jsonb,
  add column if not exists rubric_level int;

update app_private.skills_test_questions set bank_version = 1, domain = case section
  when 'Rate and math' then 'rate_math' when 'Paperwork and money' then 'paperwork'
  when 'Brokers and risk' then 'broker_fraud' when 'Market' then 'market' when 'Written task' then 'negotiation' else 'paperwork' end
 where bank_version = 1 and domain is null;

-- ───────────────────────────── 2. domain catalogue
create table if not exists app_private.skills_test_domains (
  k text primary key, label text not null, ord int not null, gate_min_pct numeric
);
insert into app_private.skills_test_domains(k,label,ord,gate_min_pct) values
 ('rate_math','Rate math & economics',1,null),
 ('broker_fraud','Broker vetting & fraud',2,null),
 ('compliance','HOS / weight / compliance',3,60),
 ('paperwork','Paperwork & money',4,null),
 ('negotiation','Negotiation (work sample)',5,null),
 ('market','Lane & market judgement',6,null),
 ('equipment','Equipment & reefer',7,null),
 ('driver','Driver & exceptions',8,null)
on conflict (k) do update set label = excluded.label, ord = excluded.ord, gate_min_pct = excluded.gate_min_pct;

-- ───────────────────────────── 3. bank v2
-- rubric: [{level, anchor}] · findings: [{k, text, gate}] · options: [{k, text}] · expect: {items:[{v,tol}]}
with q(code, bank_group, domain, seq, kind, max_points, suggested_minutes, prompt, context, options, correct, expect, gate, rubric, findings, answer_key) as (values
-- ── rate math (20)
('v2.rm1', 'rm1', 'rate_math', 10, 'number', 10, 4,
 $q$A broker offers $2,700 all-in for 1,150 loaded miles. The truck deadheads 120 miles to the pickup. It averages 6.5 mpg and diesel is $3.85 a gallon. Give (a) the all-in rate per mile counting every mile the truck moves, (b) the fuel cost for the whole trip, and (c) the net after fuel. Show the numbers you used.$q$,
 null, null, null, '{"items":[{"v":2.13,"tol":0.01},{"v":752.23,"tol":1.5},{"v":1947.77,"tol":2.5}]}'::jsonb, null, null, null,
 $q$All-in uses TOTAL miles: 2,700 ÷ 1,270 = $2.13/mi. Fuel: 1,270 ÷ 6.5 = 195.4 gal × $3.85 = $752.23. Net after fuel: $1,947.77. Using 1,150 (loaded only) for the all-in figure is the single most common dispatcher error.$q$),
('v2.rm2', 'rm2', 'rate_math', 11, 'long', 10, 8,
 $q$Two loads are on the board for a dry van sitting empty. Load A: 480 loaded miles, $1,250, 35 miles deadhead, one day, delivers into a market with a 4.2 load-to-truck ratio. Load B: 620 loaded miles, $1,500, 140 miles deadhead, a day and a half, delivers into a market with a 0.9 load-to-truck ratio. Fuel 6.5 mpg at $3.90. Which do you book, and why? Show the math.$q$,
 null, null, null, null, null,
 '[{"level":0,"anchor":"Picks B on gross alone, or no math"},{"level":1,"anchor":"Picks A but cannot say why in numbers"},{"level":2,"anchor":"Compares loaded RPM only"},{"level":3,"anchor":"Compares all-in RPM correctly"},{"level":4,"anchor":"All-in RPM + net per day"},{"level":5,"anchor":"Per-day math AND the reload-market (two-load) reasoning"}]'::jsonb,
 '[{"k":"allin","text":"Uses total miles for the all-in rate (A $2.43, B $1.97)"},{"k":"fuel","text":"Fuel cost per load (A ≈ $309, B ≈ $456)"},{"k":"perday","text":"Net per day (A ≈ $941, B ≈ $696)"},{"k":"reload","text":"Names the reload market — 0.9 ratio strands the truck"},{"k":"picksA","text":"Books A"}]'::jsonb,
 $q$A: 515 total mi → $2.43 all-in, fuel $309, net $941 in one day. B: 760 total mi → $1.97 all-in, fuel $456, net $1,044 over 1.5 days = $696/day, and it lands in a 0.9-ratio market where the next load is cheap. Book A. The larger gross on B is the trap.$q$),
-- ── broker vetting & fraud (15)
('v2.bf1a', 'bf1', 'broker_fraud', 20, 'mcq', 3, 1,
 $q$You are offered a Chicago → Atlanta dry van at $4,900 when the board average is $2,300. The rate confirmation comes from "Summit Freight Partners LLC" but the load was posted by "Summit Logistics Group Inc." The contact writes from summitfreight-partners.net; the company website is summitfreightpartners.com. Best action?$q$,
 null, '[{"k":"A","text":"Book it — it is the highest-paying load on the board"},{"k":"B","text":"Book it, but ask for a 50% advance"},{"k":"C","text":"Stop. Verify the MC on SAFER (AUTHORIZED, classification includes Broker, BMC-84 on file), call the SAFER-listed number — not the one in the e-mail — and decline if the posting and contracting entities do not reconcile"},{"k":"D","text":"Book it and have the driver confirm details with the shipper at pickup"}]'::jsonb,
 'C', null, null, null, null,
 $q$Four simultaneous double-broker tells: entity mismatch, look-alike domain, rate 100%+ over market, pressure. C.$q$),
('v2.bf1b', 'bf1', 'broker_fraud', 20, 'mcq', 3, 1,
 $q$A broker you have never worked with e-mails a rate confirmation for a load you did not call about, at $1,000 over market, from a Gmail address, and asks you to "sign in the next 20 minutes or it goes to the next carrier." What do you do?$q$,
 null, '[{"k":"A","text":"Sign — a rate that good will not last"},{"k":"B","text":"Look the MC up on SAFER, check the broker classification and bond, call the number SAFER lists, and only then decide"},{"k":"C","text":"Sign, but tell the driver to be careful at pickup"},{"k":"D","text":"Reply asking for a higher rate to test them"}]'::jsonb,
 'B', null, null, null, null,
 $q$Unsolicited, free-mail address, far over market, artificial urgency — every one is a fraud tell. Verify on SAFER and call the listed number. B.$q$),
('v2.bf2a', 'bf2', 'broker_fraud', 21, 'mcq', 3, 1,
 $q$A broker's credit report shows an average of 52 days to pay and an authority age of 61 days. How do you read that?$q$,
 null, '[{"k":"A","text":"Fine — Net 30 is standard in this business"},{"k":"B","text":"Fine if they offer quick-pay at 5%"},{"k":"C","text":"Red on both counts: 46+ days-to-pay signals payment risk, and under 90 days of authority means there is no history to rely on. Require quick-pay or pass"},{"k":"D","text":"Irrelevant — the $75,000 bond covers us either way"}]'::jsonb,
 'C', null, null, null, null,
 $q$The BMC-84 bond is $75,000 total across all claimants, not per carrier. Days-to-pay 46+ and authority under 90 days are both red. C.$q$),
('v2.bf2b', 'bf2', 'broker_fraud', 21, 'mcq', 3, 1,
 $q$Before booking with a broker for the first time, which single check matters most?$q$,
 null, '[{"k":"A","text":"Their website looks professional"},{"k":"B","text":"They answered the phone quickly"},{"k":"C","text":"Their MC is AUTHORIZED on SAFER with a Broker classification and an active BMC-84 bond, and their credit / days-to-pay is acceptable"},{"k":"D","text":"They have a DAT account"}]'::jsonb,
 'C', null, null, null, null,
 $q$Authority + bond on SAFER, then credit. C.$q$),
('v2.bf3', 'bf3', 'broker_fraud', 22, 'long', 9, 12,
 $q$Work sample — a broker sends you the rate confirmation below for a truck you dispatch. List everything that is wrong with it, and say exactly what you would do before you sign.$q$,
 $q$Broker: Apex Freight Solutions LLC — MC# 1567890, authority granted 41 days ago
Contact: mike.d@apexfreight-solutions.net · company website apexfreightsolutions.com
Posted on DAT by: Apex Logistics Group Inc.
Lane: Fresno, CA → Chicago, IL · Miles: 612 · Rate: $3,450 all-in (board post: $2,900)
Equipment: 53' reefer, set 34°F — "shipper will advise temperature at loading"
Pickup 06/12 FCFS 0600–1400 · Delivery 06/14 0800 appointment
Payment: Net 45 from clean POD · POD after 24 hrs: linehaul reduced 10%
Detention: "considered at broker's sole discretion" · TONU: not mentioned
Late delivery: $250/day deducted; carrier responsible for all consequential damages
"Carrier shall not contact shipper or receiver directly under any circumstances."$q$,
 null, null, null, 'fraud',
 '[{"level":0,"anchor":"Would sign as-is, or misses the entity mismatch"},{"level":1,"anchor":"One finding, or generic commentary"},{"level":2,"anchor":"2–3 findings"},{"level":3,"anchor":"4–5 findings, commercial only — fraud missed"},{"level":4,"anchor":"6–7 findings incl. one fraud indicator"},{"level":5,"anchor":"8+ findings incl. two fraud indicators AND verify-on-SAFER before signing"}]'::jsonb,
 '[{"k":"entity","text":"Entity mismatch — posted vs contracting company","gate":true},{"k":"domain","text":"Look-alike e-mail domain (.net vs .com)","gate":true},{"k":"phone","text":"Would call the SAFER-listed number, not the one in the e-mail"},{"k":"auth","text":"Authority under 90 days — no payment history"},{"k":"bait","text":"Rate far over the board post / market = bait"},{"k":"miles","text":"Mileage is wrong — Fresno→Chicago is ~2,100 mi, not 612"},{"k":"net45","text":"Net 45 payment terms"},{"k":"pod","text":"10% linehaul chargeback for a late POD"},{"k":"detention","text":"Detention at sole discretion — no rate, no free time, on an FCFS pickup"},{"k":"tonu","text":"No TONU clause"},{"k":"conseq","text":"All consequential damages — uninsurable exposure beyond Carmack"},{"k":"temp","text":"Reefer temperature contradiction (34°F vs shipper will advise)"},{"k":"contact","text":"No-contact clause blocks verification and detention evidence"}]'::jsonb,
 $q$Entity mismatch + look-alike domain + cell instead of SAFER number + 41-day authority + rate 19% over their own post + impossible mileage + Net 45 + POD chargeback + discretionary detention on FCFS + no TONU + consequential damages + temperature contradiction + no-contact clause. Before signing: both MCs on SAFER, broker classification, BMC-84, call the SAFER number.$q$),
-- ── compliance (15)
('v2.cp1a', 'cp1', 'compliance', 30, 'mcq', 3, 1,
 $q$A property-carrying driver has been off duty 10 consecutive hours, then comes on duty at 06:00. What is the latest clock time he may still be driving?$q$,
 null, '[{"k":"A","text":"17:00"},{"k":"B","text":"19:00"},{"k":"C","text":"20:00"},{"k":"D","text":"20:00 only if he takes no breaks"}]'::jsonb,
 'C', null, null, null, null,
 $q$The 14-hour window runs from coming on duty and is not extended by breaks or off-duty time. 06:00 + 14 = 20:00. Driving inside it is capped at 11 hours. C.$q$),
('v2.cp1b', 'cp1', 'compliance', 30, 'mcq', 3, 1,
 $q$A driver came on duty at 05:00 and has driven 7 hours by 13:30. He has not taken a break yet. What must happen before he drives again?$q$,
 null, '[{"k":"A","text":"Nothing — he has 4 hours of driving left"},{"k":"B","text":"A 30-minute break is required before he passes 8 cumulative hours of driving"},{"k":"C","text":"A 10-hour reset"},{"k":"D","text":"A 34-hour restart"}]'::jsonb,
 'B', null, null, null, null,
 $q$30 consecutive minutes off driving are required after 8 cumulative driving hours. B.$q$),
('v2.cp2a', 'cp2', 'compliance', 31, 'mcq', 3, 1,
 $q$Which pairing is a legal sleeper-berth split?$q$,
 null, '[{"k":"A","text":"6 hr berth + 4 hr off duty"},{"k":"B","text":"7 hr berth + 3 hr off duty"},{"k":"C","text":"5 hr berth + 5 hr berth"},{"k":"D","text":"8 hr berth + 1.5 hr off duty"}]'::jsonb,
 'B', null, null, null, null,
 $q$One period must be at least 7 consecutive hours in the berth, the other at least 2 hours, totalling at least 10. B.$q$),
('v2.cp2b', 'cp2', 'compliance', 31, 'mcq', 3, 1,
 $q$How many hours may a property-carrying driver be on duty in 8 consecutive days before a 34-hour restart is needed?$q$,
 null, '[{"k":"A","text":"60"},{"k":"B","text":"70"},{"k":"C","text":"80"},{"k":"D","text":"No limit if he sleeps in the truck"}]'::jsonb,
 'B', null, null, null, null,
 $q$70 hours in 8 days (60 in 7 for carriers that do not run every day). B.$q$),
('v2.cp3a', 'cp3', 'compliance', 32, 'mcq', 3, 1,
 $q$Which driver is exempt from using an ELD?$q$,
 null, '[{"k":"A","text":"A driver running 2,000 mi a week in a 2003 Freightliner"},{"k":"B","text":"A driver whose truck engine model year is pre-2000"},{"k":"C","text":"Any owner-operator with one truck"},{"k":"D","text":"Any driver who keeps neat paper logs"}]'::jsonb,
 'B', null, null, null, null,
 $q$The exemption keys on engine model year, not chassis year. Other exemptions: 8-days-in-30, 150 air-mile short haul, driveaway-towaway. B.$q$),
('v2.cp3b', 'cp3', 'compliance', 32, 'mcq', 3, 1,
 $q$Federal interstate limits for a standard 5-axle tractor-trailer are:$q$,
 null, '[{"k":"A","text":"80,000 lb gross · 20,000 lb single axle · 34,000 lb tandem"},{"k":"B","text":"90,000 lb gross · 22,000 lb single · 36,000 lb tandem"},{"k":"C","text":"80,000 lb gross with no axle limits"},{"k":"D","text":"75,000 lb gross · 18,000 lb single · 32,000 lb tandem"}]'::jsonb,
 'A', null, null, null, null,
 $q$80,000 / 20,000 / 34,000, subject to the bridge formula. A.$q$),
('v2.cp4', 'cp4', 'compliance', 33, 'number', 6, 4,
 $q$Tractor 18,000 lb, 53-foot reefer trailer 16,500 lb, reefer fuel 150 lb. A broker offers a load tendered at 46,200 lb. Give (a) the gross weight if the driver takes it and (b) the maximum payload this unit can legally haul on federal interstate limits.$q$,
 null, null, null, '{"items":[{"v":80850,"tol":10},{"v":45350,"tol":10}]}'::jsonb, null, null, null,
 $q$Tare 34,650. Gross 80,850 — 850 over the 80,000 limit, not legal. Max payload 80,000 − 34,650 = 45,350.$q$),
-- ── paperwork & money (15)
('v2.pw1', 'pw1', 'paperwork', 40, 'mcq', 3, 1,
 $q$A broker packet asks for proof of insurance. The minimum a small carrier is normally expected to carry to get set up is:$q$,
 null, '[{"k":"A","text":"$750K auto liability / $50K cargo"},{"k":"B","text":"$1,000,000 auto liability / $100,000 cargo, broker named as certificate holder"},{"k":"C","text":"$2M auto liability / $250K cargo"},{"k":"D","text":"General liability only"}]'::jsonb,
 'B', null, null, null, null,
 $q$$1M auto liability, $100K cargo. B.$q$),
('v2.pw2', 'pw2', 'paperwork', 41, 'number', 4, 3,
 $q$The rate confirmation says: detention after 2 free hours, $50 per hour, billed in whole hours (round down), maximum $300, must be noted on the BOL. The driver checked in at 07:12 and was loaded and out at 13:55. How much detention do you bill?$q$,
 null, null, null, '{"items":[{"v":200,"tol":0.5}]}'::jsonb, null, null, null,
 $q$6 h 43 min on site − 2 h free = 4 h 43 min → 4 whole hours × $50 = $200 (under the $300 cap).$q$),
('v2.pw3', 'pw3', 'paperwork', 42, 'short', 4, 3,
 $q$What is a TONU, when can you claim one, and what has to be in writing before the truck rolls?$q$,
 null, null, null, null, null,
 '[{"level":0,"anchor":"Does not know what it is"},{"level":1,"anchor":"Names it, cannot say when"},{"level":2,"anchor":"Knows it is for a cancelled load after dispatch"},{"level":3,"anchor":"Knows the trigger and that the amount must be on the rate con"},{"level":4,"anchor":"Trigger, amount in writing, typical range"},{"level":5,"anchor":"All of that plus the evidence you keep (dispatch time, arrival, cancellation message)"}]'::jsonb,
 '[{"k":"def","text":"Truck Ordered Not Used — load cancelled after the truck was dispatched / arrived"},{"k":"writing","text":"Amount and trigger written on the rate confirmation before dispatch"},{"k":"range","text":"Typical $150–350"},{"k":"evidence","text":"Keeps the dispatch time, arrival proof and the cancellation in writing"}]'::jsonb,
 $q$Truck Ordered Not Used: the load is cancelled after the truck is dispatched or arrives. Claimable only if the TONU amount and trigger are on the rate con before the truck rolls; keep dispatch time, arrival proof and the cancellation message.$q$),
('v2.pw4', 'pw4', 'paperwork', 43, 'short', 4, 3,
 $q$What does a factoring Notice of Assignment do, and what happens if the broker pays the carrier directly instead of the factoring company?$q$,
 null, null, null, null, null,
 '[{"level":0,"anchor":"Does not know"},{"level":1,"anchor":"Knows factoring exists"},{"level":2,"anchor":"Knows the NOA tells the broker who to pay"},{"level":3,"anchor":"Knows a direct payment still leaves the carrier owing the factor"},{"level":4,"anchor":"Knows it must be forwarded and that the factor can chase the broker for double payment"},{"level":5,"anchor":"All of that plus recourse vs non-recourse and the fee"}]'::jsonb,
 '[{"k":"noa","text":"NOA legally redirects payment to the factor"},{"k":"misdirect","text":"A direct payment must be forwarded — the carrier still owes the factor"},{"k":"double","text":"Broker may be liable to pay twice"},{"k":"recourse","text":"Recourse vs non-recourse / fee"}]'::jsonb,
 $q$The NOA legally redirects every payment on the assigned invoices to the factor. A direct payment does not discharge the debt: the carrier must forward it, and the broker can be liable to pay again.$q$),
-- ── negotiation (15)
('v2.ng1', 'ng1', 'negotiation', 50, 'long', 15, 12,
 $q$Write, in full, the e-mail you would send the broker. The board shows Dallas, TX → Denver, CO, 53' dry van, 42,000 lb, pickup tomorrow, posted at $1,700, 790 loaded miles. Your truck is empty in Waco, TX (95 miles away). The carrier's floor is $2.05 per all-in mile. Write it exactly as you would send it.$q$,
 null, null, null, null, null,
 '[{"level":0,"anchor":"Accepts the posted rate, or asks below the carrier floor"},{"level":1,"anchor":"Asks for more money with no number, or math wrong"},{"level":2,"anchor":"A number above floor but no justification"},{"level":3,"anchor":"Reasonable ask, math implicit, generic justification"},{"level":4,"anchor":"Correct all-in math, specific ask, one lever, clean tone"},{"level":5,"anchor":"Correct math, ask above floor with justification, ≥2 non-rate levers, credentials, clear close, zero errors"}]'::jsonb,
 '[{"k":"math","text":"885 total mi → posted $1,700 = $1.92 all-in, below the $2.05 floor ($1,815 minimum)"},{"k":"number","text":"A specific number in the first lines, framed as a requirement"},{"k":"justify","text":"Justifies with deadhead / cost, not preference"},{"k":"levers","text":"Names non-rate levers (detention in writing, TONU, quick-pay, flexible window)"},{"k":"creds","text":"MC, equipment, availability, packet ready"},{"k":"close","text":"Clear next step with a deadline"},{"k":"walkaway","text":"Professional walk-away that keeps the relationship"},{"k":"mechanics","text":"Subject line, ≤180 words, no typos, signature with phone + MC"}]'::jsonb,
 $q$885 total miles; $1,700 is $1.92 all-in — under the $2.05 floor, which needs $1,815 minimum. Ask $2,000–2,050, justify with deadhead and cost, name levers, credentials, clear close.$q$),
-- ── market (10)
('v2.mk1', 'mk1', 'market', 60, 'long', 10, 8,
 $q$A 53-foot dry van delivers in Joliet, IL at 11:00 on Friday. The driver wants to be home in Atlanta, GA by Monday morning and has 30 hours left on his 70. Describe how you get him there paid: what you look for, where, at what rate, and what you tell him if the right load is not on the board by 14:00.$q$,
 null, null, null, null, null,
 '[{"level":0,"anchor":"Deadhead him home or no plan"},{"level":1,"anchor":"Vague — search the board"},{"level":2,"anchor":"Looks for a Chicago→Southeast load, no rate or hours logic"},{"level":3,"anchor":"Right lane, realistic rate band, one fallback"},{"level":4,"anchor":"Lane, rate, HOS fit, partial / short-hop fallback"},{"level":5,"anchor":"All of that plus what he says to the driver and the broker, and when he stops searching"}]'::jsonb,
 '[{"k":"lane","text":"Chicago-area → GA / Southeast, posted from Friday afternoon"},{"k":"rate","text":"Realistic rate band for the lane and a floor"},{"k":"hos","text":"Fits 720 mi into 30 hours with the 14/11 rules"},{"k":"fallback","text":"Fallback — short hop toward TN / KY, or wait Saturday"},{"k":"comms","text":"Tells the driver the plan and the cut-off time"}]'::jsonb,
 $q$Chicago → Southeast is a strong outbound lane; look for Atlanta or a Southeast delivery Saturday/Monday at a rate above floor, check it fits 30 hours, name a fallback (short hop or wait), and tell the driver the plan and the cut-off.$q$),
-- ── equipment (5)
('v2.eq1a', 'eq1', 'equipment', 70, 'mcq', 3, 1,
 $q$A load of fresh strawberries, set point 34°F. The trailer has been sitting empty and warm. What do you instruct the driver?$q$,
 null, '[{"k":"A","text":"Cycle-sentry to save fuel; strawberries are hardy"},{"k":"B","text":"Pre-cool the trailer to 34°F before loading, run continuous, confirm the fresh-air vent, and get set point + mode + pulp temps written on the BOL"},{"k":"C","text":"Set to 28°F to build a safety margin"},{"k":"D","text":"Continuous mode, but the set point does not matter under 40°F"}]'::jsonb,
 'B', null, null, null, null,
 $q$A reefer maintains temperature, it does not blast-freeze warm product. Produce runs continuous. B.$q$),
('v2.eq1b', 'eq1', 'equipment', 70, 'mcq', 3, 1,
 $q$On a flatbed, the total working load limit of the tie-downs must be at least:$q$,
 null, '[{"k":"A","text":"25% of the cargo weight"},{"k":"B","text":"50% of the cargo weight"},{"k":"C","text":"100% of the cargo weight"},{"k":"D","text":"There is no federal minimum"}]'::jsonb,
 'B', null, null, null, null,
 $q$Aggregate WLL ≥ 50% of cargo weight (49 CFR 393.106). B.$q$),
('v2.eq2', 'eq2', 'equipment', 71, 'mcq', 2, 1,
 $q$A shipper has a 10-foot-tall machine. Which trailer lets it move without an over-height permit?$q$,
 null, '[{"k":"A","text":"Flatbed (deck ~60 in)"},{"k":"B","text":"Step deck (deck ~36–42 in)"},{"k":"C","text":"Dry van"},{"k":"D","text":"Any of them — 10 ft is fine"}]'::jsonb,
 'B', null, null, null, null,
 $q$Flatbed: 60 + 120 = 180 in = 15 ft, over the 13'6" limit. Step deck: ~40 + 120 = 160 in = 13'4". B.$q$),
-- ── driver & exceptions (5)
('v2.dr1', 'dr1', 'driver', 80, 'long', 5, 7,
 $q$It is 15:30. Your driver came on duty at 06:00 with 8.5 hours of driving logged, and is 210 miles from a receiver whose dock closes at 20:00 with a $300 reschedule fee. He has 11 hours left on his 70. The broker says "just make it happen." What do you do?$q$,
 null, null, null, null, 'hos',
 '[{"level":0,"anchor":"Runs over hours, personal conveyance to finish, or fixes the log"},{"level":1,"anchor":"Parks the truck, nothing else"},{"level":2,"anchor":"Parks the truck and calls the broker late"},{"level":3,"anchor":"Parks the truck, calls the broker now, no plan for the fee"},{"level":4,"anchor":"Correct clock, immediate broker call, handles the fee"},{"level":5,"anchor":"All of that plus the 70-hour look-ahead for tomorrow"}]'::jsonb,
 '[{"k":"clock","text":"Runs the clock correctly — 2.5 h of driving left, 210 mi needs ~4 h"},{"k":"legal","text":"Refuses to run illegal — no personal conveyance, no fixing the log","gate":true},{"k":"broker","text":"Calls the broker immediately, not at the last hour"},{"k":"fee","text":"Handles the $300 without conceding it"},{"k":"seventy","text":"Flags the 70-hour constraint on tomorrow / a 34 restart"}]'::jsonb,
 $q$Cannot be done legally: 2.5 h of driving left on the 11, 210 mi at 55 mph ≈ 3.8 h. Park on schedule, call the broker now, propose first thing tomorrow, push back on the fee, note the 70-hour constraint. Any answer that runs over hours is an automatic fail.$q$)
)
insert into app_private.skills_test_questions
  (code, bank_version, bank_group, domain, seq, section, kind, max_points, suggested_minutes, prompt, context, options, correct, expect, gate, rubric, findings, answer_key, active, hint)
select q.code, 2, q.bank_group, q.domain, q.seq, d.label, q.kind, q.max_points, q.suggested_minutes, q.prompt, q.context, q.options, q.correct, coalesce(q.expect,'{}'::jsonb), q.gate, q.rubric, q.findings, q.answer_key, true,
       case q.kind when 'number' then 'Show the numbers you used, not just the answer.' when 'mcq' then 'Pick one.' else null end
  from q join app_private.skills_test_domains d on d.k = q.domain
on conflict (code) do update set
  bank_group = excluded.bank_group, domain = excluded.domain, seq = excluded.seq, section = excluded.section, kind = excluded.kind,
  max_points = excluded.max_points, suggested_minutes = excluded.suggested_minutes, prompt = excluded.prompt, context = excluded.context,
  options = excluded.options, correct = excluded.correct, expect = excluded.expect, gate = excluded.gate, rubric = excluded.rubric,
  findings = excluded.findings, answer_key = excluded.answer_key, active = true, hint = excluded.hint;

-- v1 bank retires: still readable for the attempts that were served it, never served again
update app_private.skills_test_questions set active = false where bank_version = 1;

-- ───────────────────────────── 4. helpers
create or replace function app_private.disp_test_qs(p_attempt uuid)
returns table (q app_private.skills_test_questions, pos int)
language sql stable security definer set search_path to 'app_private','public' as $$
  select x.q, x.pos from (
    select q, ord as pos
      from app_private.skills_test_attempts a
      cross join unnest(a.question_ids) with ordinality u(qid, ord)
      join app_private.skills_test_questions q on q.id = u.qid
     where a.id = p_attempt and a.question_ids is not null
    union all
    select q, q.seq
      from app_private.skills_test_attempts a
      join app_private.skills_test_questions q on q.bank_version = 1
     where a.id = p_attempt and a.question_ids is null
  ) x order by x.pos;
$$;
revoke all on function app_private.disp_test_qs(uuid) from public, anon;

-- numeric auto-score: accepts {values:[..],tol} (v1) and {items:[{v,tol}]} (v2)
create or replace function app_private.disp_test_auto_points(p_answer text, p_expect jsonb, p_max integer)
returns numeric language plpgsql immutable as $$
declare items jsonb; got numeric[]; hits int := 0; n int := 0; it jsonb; v numeric; tol numeric; g numeric; ok boolean;
begin
  if p_expect is null then return null; end if;
  if p_expect ? 'items' then items := p_expect->'items';
  elsif p_expect ? 'values' then
    select jsonb_agg(jsonb_build_object('v', x, 'tol', coalesce((p_expect->>'tol')::numeric, 0.02))) into items from jsonb_array_elements_text(p_expect->'values') x;
  else return null; end if;
  if coalesce(p_answer,'') = '' then return 0; end if;
  select array_agg(replace(m[1], ',', '')::numeric) into got
    from regexp_matches(p_answer, '([0-9][0-9,]*\.?[0-9]*)', 'g') m;
  if got is null then return 0; end if;
  for it in select * from jsonb_array_elements(items) loop
    n := n + 1; v := (it->>'v')::numeric; tol := coalesce((it->>'tol')::numeric, 0.02); ok := false;
    foreach g in array got loop if abs(g - v) <= tol then ok := true; end if; end loop;
    if ok then hits := hits + 1; end if;
  end loop;
  return round(p_max::numeric * hits / greatest(n,1), 1);
end $$;

-- per-domain sub-scores + gates for an attempt (stored on the row by score/submit, read by review)
create or replace function app_private.disp_test_rollup(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path to 'app_private','public' as $$
declare v_dom jsonb; v_gates jsonb; v_total numeric; v_max numeric; v_comp numeric; v_comp_max numeric; v_status text;
        r record; v_hos jsonb; v_fraud jsonb;
begin
  select coalesce(sum(coalesce(ans.staff_points, ans.auto_points)), 0), coalesce(sum((x.q).max_points), 0)
    into v_total, v_max
    from app_private.disp_test_qs(p_attempt) x
    left join app_private.skills_test_answers ans on ans.attempt_id = p_attempt and ans.question_id = (x.q).id;

  select coalesce(jsonb_agg(jsonb_build_object('k', d.k, 'label', d.label, 'points', s.pts, 'max', s.mx, 'graded', s.graded, 'items', s.items) order by d.ord), '[]'::jsonb)
    into v_dom
    from (select (x.q).domain dom, sum(coalesce(ans.staff_points, ans.auto_points)) pts, sum((x.q).max_points) mx,
                 bool_and(ans.staff_points is not null or ans.auto_points is not null) graded, count(*) items
            from app_private.disp_test_qs(p_attempt) x
            left join app_private.skills_test_answers ans on ans.attempt_id = p_attempt and ans.question_id = (x.q).id
           group by (x.q).domain) s
    join app_private.skills_test_domains d on d.k = s.dom;

  select coalesce(sum(coalesce(ans.staff_points, ans.auto_points)),0), coalesce(sum((x.q).max_points),0) into v_comp, v_comp_max
    from app_private.disp_test_qs(p_attempt) x
    left join app_private.skills_test_answers ans on ans.attempt_id = p_attempt and ans.question_id = (x.q).id
   where (x.q).domain = 'compliance';

  -- gate items: hos (level 0 = illegal advice), fraud (finding 'entity' must be ticked)
  select jsonb_build_object('graded', ans.rubric_level is not null or ans.staff_points is not null, 'ok', coalesce(ans.rubric_level, 1) > 0, 'seq', x.pos)
    into v_hos
    from app_private.disp_test_qs(p_attempt) x left join app_private.skills_test_answers ans on ans.attempt_id = p_attempt and ans.question_id = (x.q).id
   where (x.q).gate = 'hos' limit 1;
  select jsonb_build_object('graded', ans.rubric_level is not null or ans.findings is not null, 'ok', coalesce(ans.findings, '[]'::jsonb) ? 'entity', 'seq', x.pos)
    into v_fraud
    from app_private.disp_test_qs(p_attempt) x left join app_private.skills_test_answers ans on ans.attempt_id = p_attempt and ans.question_id = (x.q).id
   where (x.q).gate = 'fraud' limit 1;

  v_gates := jsonb_build_array(
    jsonb_build_object('k','overall','label','Overall ≥ 70%','ok', case when v_max > 0 then v_total >= 0.7 * v_max end,
                       'detail', round(v_total,1) || ' / ' || v_max),
    jsonb_build_object('k','compliance','label','Compliance sub-score ≥ 60%','ok', case when v_comp_max > 0 then v_comp >= 0.6 * v_comp_max end,
                       'detail', round(v_comp,1) || ' / ' || v_comp_max || case when v_comp_max > 0 then ' = ' || round(100 * v_comp / v_comp_max) || '%' else '' end),
    jsonb_build_object('k','hos','label','No illegal-HOS advice','ok', case when v_hos is null then null when (v_hos->>'graded')::boolean then (v_hos->>'ok')::boolean end,
                       'detail', case when v_hos is null then 'no HOS scenario in this attempt' when (v_hos->>'graded')::boolean then 'Q' || (v_hos->>'seq') || case when (v_hos->>'ok')::boolean then ' — parked the truck' else ' — scored 0: advised running illegal' end else 'Q' || (v_hos->>'seq') || ' not graded yet' end),
    jsonb_build_object('k','fraud','label','Caught the double-broker set-up','ok', case when v_fraud is null then null when (v_fraud->>'graded')::boolean then (v_fraud->>'ok')::boolean end,
                       'detail', case when v_fraud is null then 'no rate-con sample in this attempt' when (v_fraud->>'graded')::boolean then 'Q' || (v_fraud->>'seq') || case when (v_fraud->>'ok')::boolean then ' — found the entity mismatch' else ' — missed the entity mismatch' end else 'Q' || (v_fraud->>'seq') || ' not graded yet' end));

  update app_private.skills_test_attempts set domain_scores = v_dom, gates = v_gates where id = p_attempt;
  return jsonb_build_object('total', v_total, 'max', v_max, 'domains', v_dom, 'gates', v_gates);
end $$;
revoke all on function app_private.disp_test_rollup(uuid) from public, anon;

-- ───────────────────────────── 5. candidate side
create or replace function public.dispatcher_test_start()
returns jsonb language plpgsql security definer set search_path to 'app_private','public' as $$
declare v_uid uuid := auth.uid(); a app_private.skills_test_attempts; v_ids uuid[]; v_max numeric;
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  a := app_private.disp_test_current(v_uid);
  if a.id is null then return jsonb_build_object('error','no test has been assigned to you'); end if;
  perform app_private.disp_test_expire(a.id);
  select * into a from app_private.skills_test_attempts where id = a.id;
  if a.status = 'in_progress' then return public.dispatcher_test_my(); end if;
  if a.status <> 'invited' then return jsonb_build_object('error','this test is ' || a.status); end if;
  -- bl_disp_0317: draw one item per bank group, ordered by domain then seq. Two candidates never get the same test.
  select array_agg(id order by ord, seq), sum(max_points) into v_ids, v_max
    from (select distinct on (q.bank_group) q.id, q.seq, q.max_points, d.ord
            from app_private.skills_test_questions q join app_private.skills_test_domains d on d.k = q.domain
           where q.active and q.bank_version = 2
           order by q.bank_group, random()) pick;
  update app_private.skills_test_attempts
     set status = 'in_progress', started_at = now(), ends_at = now() + make_interval(mins => a.minutes),
         question_ids = coalesce(v_ids, question_ids), bank_version = case when v_ids is not null then 2 else bank_version end,
         max_score = coalesce(v_max, max_score)
   where id = a.id and status = 'invited';
  return public.dispatcher_test_my();
end $$;

create or replace function public.dispatcher_test_my()
returns jsonb language plpgsql stable security definer set search_path to 'app_private','public' as $$
declare v_uid uuid := auth.uid(); a app_private.skills_test_attempts; v_live boolean;
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  a := app_private.disp_test_current(v_uid);
  if a.id is null then return jsonb_build_object('state','none'); end if;
  if (a.status = 'invited' and now() > a.start_by) or (a.status = 'in_progress' and now() > a.ends_at + interval '30 seconds') then
    a.status := 'expired';
  end if;
  v_live := a.status = 'in_progress';
  return jsonb_build_object(
    'state', a.status, 'attempt', a.id, 'attempt_no', a.attempt_no, 'minutes', a.minutes,
    'start_by', a.start_by, 'started_at', a.started_at, 'ends_at', a.ends_at, 'submitted_at', a.submitted_at,
    'result', case when a.passed_email_at is not null then a.decision::text end,
    'result_at', a.passed_email_at,
    'score', case when a.score_email_at is not null then a.staff_score end,
    'max_score', case when a.score_email_at is not null then a.max_score end,
    'remaining', case when v_live then greatest(0, floor(extract(epoch from (a.ends_at - now())))::int) else null end,
    'bank_version', coalesce(a.bank_version, 2),
    'question_count', case when a.question_ids is not null then coalesce(array_length(a.question_ids,1),0)
                           when a.status in ('invited','none') then (select count(distinct bank_group) from app_private.skills_test_questions where active and bank_version = 2)
                           else (select count(*) from app_private.skills_test_questions where bank_version = 1) end,
    'sections', case when a.question_ids is not null then
                  (select coalesce(jsonb_agg(jsonb_build_object('k', d.k, 'label', d.label, 'n', s.n) order by d.ord), '[]'::jsonb)
                     from (select (x.q).domain dom, count(*) n from app_private.disp_test_qs(a.id) x group by (x.q).domain) s join app_private.skills_test_domains d on d.k = s.dom)
                else (select coalesce(jsonb_agg(jsonb_build_object('k', d.k, 'label', d.label) order by d.ord), '[]'::jsonb) from app_private.skills_test_domains d) end,
    'questions', case when v_live then (
       select coalesce(jsonb_agg(jsonb_build_object(
         'id', (x.q).id, 'seq', x.pos, 'section', (x.q).section, 'domain', (x.q).domain, 'kind', (x.q).kind,
         'prompt', (x.q).prompt, 'hint', (x.q).hint, 'context', (x.q).context, 'options', (x.q).options,
         'max_points', (x.q).max_points, 'suggested_minutes', (x.q).suggested_minutes,
         'answer', (select ans.answer from app_private.skills_test_answers ans where ans.attempt_id = a.id and ans.question_id = (x.q).id)
       ) order by x.pos), '[]'::jsonb) from app_private.disp_test_qs(a.id) x)
       else '[]'::jsonb end);
end $$;

create or replace function public.dispatcher_test_save(p_question uuid, p_answer text, p_seconds integer default 0, p_paste integer default 0)
returns jsonb language plpgsql security definer set search_path to 'app_private','public' as $$
declare v_uid uuid := auth.uid(); a app_private.skills_test_attempts;
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  a := app_private.disp_test_current(v_uid);
  if a.id is null then return jsonb_build_object('error','no test'); end if;
  if a.status <> 'in_progress' then return jsonb_build_object('error','this test is ' || a.status, 'state', a.status); end if;
  if now() > a.ends_at + interval '30 seconds' then
    perform app_private.disp_test_expire(a.id);
    return jsonb_build_object('error','time is up', 'state','expired');
  end if;
  if not exists (select 1 from app_private.disp_test_qs(a.id) x where (x.q).id = p_question) then
    return jsonb_build_object('error','unknown question');
  end if;
  insert into app_private.skills_test_answers (attempt_id, question_id, answer, seconds, paste_count, updated_at)
  values (a.id, p_question, p_answer, greatest(coalesce(p_seconds,0),0), greatest(coalesce(p_paste,0),0), now())
  on conflict (attempt_id, question_id) do update
    set answer = excluded.answer,
        seconds = greatest(app_private.skills_test_answers.seconds, excluded.seconds),
        paste_count = greatest(app_private.skills_test_answers.paste_count, excluded.paste_count),
        updated_at = now();
  return jsonb_build_object('ok', true, 'remaining', greatest(0, floor(extract(epoch from (a.ends_at - now())))::int));
end $$;

create or replace function public.dispatcher_test_submit(p_integrity jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'app_private','public' as $$
declare v_uid uuid := auth.uid(); a app_private.skills_test_attempts; v_auto numeric; v_max numeric; v_name text; v_answered int; v_n int;
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  a := app_private.disp_test_current(v_uid);
  if a.id is null then return jsonb_build_object('error','no test'); end if;
  if a.status = 'submitted' or a.status = 'scored' then return jsonb_build_object('ok', true, 'state', a.status); end if;
  if a.status <> 'in_progress' then return jsonb_build_object('error','this test is ' || a.status, 'state', a.status); end if;

  -- auto-score: numeric (tolerance bands) and multiple choice (exact key)
  update app_private.skills_test_answers ans
     set auto_points = case (x.q).kind
                         when 'number' then app_private.disp_test_auto_points(ans.answer, (x.q).expect, (x.q).max_points)
                         when 'mcq' then case when upper(trim(coalesce(ans.answer,''))) = upper(trim((x.q).correct)) then (x.q).max_points else 0 end
                       end
    from app_private.disp_test_qs(a.id) x
   where ans.question_id = (x.q).id and ans.attempt_id = a.id and (x.q).kind in ('number','mcq');
  -- unanswered auto items score 0 so the domain rollup is honest
  insert into app_private.skills_test_answers (attempt_id, question_id, answer, seconds, paste_count, auto_points, updated_at)
  select a.id, (x.q).id, null, 0, 0, 0, now() from app_private.disp_test_qs(a.id) x
   where (x.q).kind in ('number','mcq') and not exists (select 1 from app_private.skills_test_answers s where s.attempt_id = a.id and s.question_id = (x.q).id);

  select coalesce(sum(ans.auto_points),0) into v_auto from app_private.skills_test_answers ans where ans.attempt_id = a.id;
  select coalesce(sum((x.q).max_points),0), count(*) into v_max, v_n from app_private.disp_test_qs(a.id) x;
  select count(*) into v_answered from app_private.skills_test_answers where attempt_id = a.id and coalesce(trim(answer),'') <> '';

  update app_private.skills_test_attempts
     set status = 'submitted', submitted_at = now(), auto_score = v_auto, max_score = v_max,
         integrity = coalesce(p_integrity,'{}'::jsonb) || jsonb_build_object('answered', v_answered,
                       'used_minutes', round((extract(epoch from (now() - started_at))/60.0)::numeric, 1))
   where id = a.id;
  perform app_private.disp_test_rollup(a.id);

  select coalesce(full_name,'A candidate') into v_name from app_private.dispatcher_profiles where user_id = v_uid;
  begin
    perform app_private.disp_notify(null, 'staff', 'dispatcher.skills_test.submitted',
      'Skills test submitted',
      v_name || ' finished the dispatcher skills test (' || v_answered || ' of ' || v_n || ' answered, auto-scored ' || v_auto || '/' || v_max || '). Open Dispatchers to grade it.',
      '/app/command-center/#/dispatcher?id=' || v_uid::text || '&tab=test', true);
  exception when others then null; end;
  return jsonb_build_object('ok', true, 'state','submitted');
end $$;

-- ───────────────────────────── 6. staff side
create or replace function public.cc_dispatcher_test_review(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path to 'app_private','public' as $$
declare a app_private.skills_test_attempts;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  a := app_private.disp_test_current(p_user);
  if a.id is null then return jsonb_build_object('state','none'); end if;
  return jsonb_build_object(
    'state', a.status, 'attempt', a.id, 'attempt_no', a.attempt_no, 'minutes', a.minutes,
    'invited_at', a.invited_at, 'start_by', a.start_by, 'started_at', a.started_at,
    'ends_at', a.ends_at, 'submitted_at', a.submitted_at,
    'auto_score', a.auto_score, 'staff_score', a.staff_score, 'max_score', a.max_score,
    'decision', a.decision, 'review_note', a.review_note, 'reviewed_at', a.reviewed_at,
    'passed_email_at', a.passed_email_at, 'score_email_at', a.score_email_at,
    'integrity', a.integrity, 'bank_version', coalesce(a.bank_version, case when a.question_ids is null then 1 else 2 end),
    'bank_size', (select count(*) from app_private.skills_test_questions where active and bank_version = 2),
    'domains', coalesce(a.domain_scores, '[]'::jsonb), 'gates', coalesce(a.gates, '[]'::jsonb),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('no', h.attempt_no, 'status', h.status, 'submitted_at', h.submitted_at,
                        'score', coalesce(h.staff_score, h.auto_score), 'decision', h.decision) order by h.attempt_no desc), '[]'::jsonb)
                  from app_private.skills_test_attempts h where h.user_id = p_user),
    'questions', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', (x.q).id, 'seq', x.pos, 'section', (x.q).section, 'domain', (x.q).domain, 'kind', (x.q).kind, 'prompt', (x.q).prompt,
        'context', (x.q).context, 'options', (x.q).options, 'correct', (x.q).correct, 'gate', (x.q).gate,
        'rubric', (x.q).rubric, 'findings', (x.q).findings, 'suggested_minutes', (x.q).suggested_minutes,
        'max_points', (x.q).max_points, 'answer_key', (x.q).answer_key,
        'answer', ans.answer, 'seconds', coalesce(ans.seconds,0), 'paste_count', coalesce(ans.paste_count,0),
        'auto_points', ans.auto_points, 'staff_points', ans.staff_points, 'staff_note', ans.staff_note,
        'ticked', ans.findings, 'level', ans.rubric_level
      ) order by x.pos), '[]'::jsonb)
      from app_private.disp_test_qs(a.id) x
      left join app_private.skills_test_answers ans on ans.question_id = (x.q).id and ans.attempt_id = a.id));
end $$;

-- p_scores: { "<question_id>": { points?, note?, level?, findings?: ["k",..] } }
-- level (0–5) on a rubric item sets points = round(level/5 × max, 1) unless points is given explicitly.
create or replace function public.cc_dispatcher_test_score(p_attempt uuid, p_scores jsonb, p_decision text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private','public' as $$
declare k text; v jsonb; v_user uuid; v_max int; v_pts numeric; v_lvl int; v_roll jsonb; v_total numeric; v_maxs numeric;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select user_id into v_user from app_private.skills_test_attempts where id = p_attempt;
  if v_user is null then return jsonb_build_object('error','no such attempt'); end if;
  if p_decision is not null and p_decision not in ('pass','fail') then return jsonb_build_object('error','decision must be pass or fail'); end if;

  for k, v in select * from jsonb_each(coalesce(p_scores,'{}'::jsonb)) loop
    select max_points into v_max from app_private.skills_test_questions where id = k::uuid;
    if v_max is null then continue; end if;
    v_lvl := nullif(v->>'level','')::int;
    v_pts := nullif(v->>'points','')::numeric;
    if v_pts is null and v_lvl is not null then v_pts := round(v_max * least(greatest(v_lvl,0),5) / 5.0, 1); end if;
    if v_pts is not null then v_pts := least(greatest(v_pts, 0), v_max); end if;
    insert into app_private.skills_test_answers (attempt_id, question_id, staff_points, staff_note, rubric_level, findings, updated_at)
    values (p_attempt, k::uuid, v_pts, nullif(v->>'note',''), v_lvl, case when v ? 'findings' then v->'findings' end, now())
    on conflict (attempt_id, question_id) do update
      set staff_points = coalesce(v_pts, app_private.skills_test_answers.staff_points),
          staff_note = coalesce(nullif(v->>'note',''), app_private.skills_test_answers.staff_note),
          rubric_level = coalesce(v_lvl, app_private.skills_test_answers.rubric_level),
          findings = case when v ? 'findings' then v->'findings' else app_private.skills_test_answers.findings end,
          updated_at = now();
  end loop;

  v_roll := app_private.disp_test_rollup(p_attempt);
  v_total := (v_roll->>'total')::numeric; v_maxs := (v_roll->>'max')::numeric;

  update app_private.skills_test_attempts
     set staff_score = v_total, max_score = v_maxs,
         decision = coalesce(p_decision, decision),
         review_note = coalesce(p_note, review_note),
         reviewed_by = auth.uid(), reviewed_at = now(),
         status = case when p_decision is not null then 'scored' else status end
   where id = p_attempt;

  if p_decision = 'pass' then
    begin
      update app_private.skills_test_attempts set passed_email_at = now() where id = p_attempt and passed_email_at is null;
      if found then perform app_private.disp_test_pass_email(p_attempt); end if;
    exception when others then null; end;
  end if;

  -- bl_disp_0314: the score goes out on save, once, only when every served question carries a mark
  if not exists (select 1 from app_private.disp_test_qs(p_attempt) x
                  where not exists (select 1 from app_private.skills_test_answers ans
                                     where ans.attempt_id = p_attempt and ans.question_id = (x.q).id
                                       and coalesce(ans.staff_points, ans.auto_points) is not null)) then
    begin
      update app_private.skills_test_attempts set score_email_at = now() where id = p_attempt and score_email_at is null;
      if found then perform app_private.disp_test_score_email(p_attempt); end if;
    exception when others then null; end;
  end if;

  perform app_private.disp_audit('dispatcher.test.score', 'dispatcher', v_user::text, null,
    'skills test scored ' || v_total || '/' || v_maxs || coalesce(' — ' || p_decision, ''), jsonb_build_object('attempt', p_attempt));
  return jsonb_build_object('ok', true, 'score', v_total, 'max', v_maxs, 'domains', v_roll->'domains', 'gates', v_roll->'gates');
end $$;

-- ───────────────────────────── 7. Dispatcher 360: activity feed
create or replace function public.cc_dispatcher_activity(p_user uuid, p_limit integer default 40)
returns jsonb language sql stable security definer set search_path to 'app_private','public' as $$
  select case when not app_private.disp_is_staff() then jsonb_build_object('error','not authorized') else
    coalesce((select jsonb_agg(to_jsonb(e) order by e.at desc) from (
      select * from (
        select b.created_at at, 'booking' kind, 'Booked ' || b.origin || ' → ' || b.destination || coalesce(' · $' || b.gross, '') txt,
               (select name from public.organizations where id = b.carrier_org_id) sub, b.id::text ref, 'load' ref_kind
          from app_private.dispatcher_bookings b where b.dispatcher_user_id = p_user
        union all
        select e.created_at, 'event', initcap(replace(e.kind,'_',' ')) || coalesce(' — ' || e.note, ''),
               (select b.origin || ' → ' || b.destination from app_private.dispatcher_bookings b where b.id = e.booking_id), e.booking_id::text, 'load'
          from app_private.dispatcher_booking_events e join app_private.dispatcher_bookings b on b.id = e.booking_id
         where b.dispatcher_user_id = p_user
        union all
        select m.created_at, 'message', left(m.body, 120), (select name from public.organizations where id = m.carrier_org_id) || ' · ' || m.sender_role, m.assignment_id::text, 'thread'
          from app_private.dispatcher_messages m join app_private.dispatcher_assignments a on a.id = m.assignment_id
         where a.dispatcher_user_id = p_user
        union all
        select a.assigned_at, 'assign', 'Assigned to ' || (select name from public.organizations where id = a.carrier_org_id), null, a.id::text, 'assignment'
          from app_private.dispatcher_assignments a where a.dispatcher_user_id = p_user
        union all
        select a.ended_at, 'assign', 'Assignment ended' || coalesce(' — ' || a.end_reason, ''), (select name from public.organizations where id = a.carrier_org_id), a.id::text, 'assignment'
          from app_private.dispatcher_assignments a where a.dispatcher_user_id = p_user and a.ended_at is not null
        union all
        select t.invited_at, 'test', 'Skills test sent' || case when t.attempt_no > 1 then ' · attempt ' || t.attempt_no else '' end, null, t.id::text, 'test' from app_private.skills_test_attempts t where t.user_id = p_user
        union all
        select t.submitted_at, 'test', 'Skills test submitted', coalesce((t.integrity->>'used_minutes') || ' of ' || t.minutes || ' min', null), t.id::text, 'test' from app_private.skills_test_attempts t where t.user_id = p_user and t.submitted_at is not null
        union all
        select t.reviewed_at, 'test', 'Test ' || coalesce(t.decision, 'scored') || ' · ' || coalesce(t.staff_score::text,'—') || ' / ' || coalesce(t.max_score::text,'—'), null, t.id::text, 'test' from app_private.skills_test_attempts t where t.user_id = p_user and t.reviewed_at is not null
        union all
        select t.passed_email_at, 'mail', 'Pass e-mail sent', null, t.id::text, 'test' from app_private.skills_test_attempts t where t.user_id = p_user and t.passed_email_at is not null
        union all
        select t.score_email_at, 'mail', 'Score e-mailed · ' || coalesce(t.staff_score::text,'—') || ' / ' || coalesce(t.max_score::text,'—'), null, t.id::text, 'test' from app_private.skills_test_attempts t where t.user_id = p_user and t.score_email_at is not null
        union all
        select p.created_at, 'apply', 'Applied', p.country, p.user_id::text, 'dispatcher' from app_private.dispatcher_profiles p where p.user_id = p_user
        union all
        select p.reviewed_at, 'status', 'Status → ' || p.status || coalesce(' — ' || p.review_note, ''), null, p.user_id::text, 'dispatcher' from app_private.dispatcher_profiles p where p.user_id = p_user and p.reviewed_at is not null
        union all
        select l.set_at, 'terms', 'Terms set · ' || coalesce(l.commission_pct::text,'—') || '% · ' || coalesce(l.trial_start::text,'?') || ' → ' || coalesce(l.trial_end::text,'?'), l.note, null, 'dispatcher' from app_private.dispatcher_terms_log l where l.dispatcher_user_id = p_user
        union all
        select c.approved_at, 'money', 'Commission approved · $' || c.amount, null, c.id::text, 'commission' from app_private.dispatcher_commission c where c.dispatcher_user_id = p_user and c.approved_at is not null
        union all
        select c.paid_at, 'money', 'Commission paid · $' || coalesce(c.paid_amount, c.amount), c.payout_ref, c.id::text, 'commission' from app_private.dispatcher_commission c where c.dispatcher_user_id = p_user and c.paid_at is not null
        union all
        select u.last_sign_in_at, 'signin', 'Last portal sign-in', null, null, null from auth.users u where u.id = p_user and u.last_sign_in_at is not null
      ) z where z.at is not null order by z.at desc limit greatest(coalesce(p_limit,40),1)) e), '[]'::jsonb) end;
$$;

-- richer board cards (city, trucks, test detail, last activity, owed)
create or replace function public.cc_dispatchers_board(p_per_stage integer default 12)
returns jsonb language sql stable security definer set search_path to 'app_private','public' as $$
  select case when not app_private.disp_is_staff() then jsonb_build_object('error','not authorized') else
    coalesce(jsonb_object_agg(s.status, s.cards), '{}'::jsonb) end
  from (
    select p.status,
           jsonb_agg(jsonb_build_object(
             'user_id', p.user_id, 'name', p.full_name, 'country', p.country, 'city', p.city, 'years_exp', p.years_exp,
             'applied_at', p.created_at, 'stage_since', coalesce(p.reviewed_at, p.created_at),
             'trial_start', p.trial_start, 'trial_end', p.trial_end, 'commission_pct', p.commission_pct,
             'has_id', coalesce(p.skills->>'id_doc','') <> '', 'has_cv', coalesce(p.skills->>'cv_doc','') <> '',
             'own_board', exists (select 1 from jsonb_array_elements_text(coalesce(p.skills->'own_board_access','[]'::jsonb)) v where v !~* '^no\b'),
             'us_overlap', coalesce(p.skills->>'us_hours_overlap','') in ('true','yes','1'),
             'equipment', coalesce(p.skills->'equipment','[]'::jsonb),
             'test', (select jsonb_build_object('status',t.status,'decision',t.decision,'score',t.staff_score,'auto',t.auto_score,'max',t.max_score,
                                                'told',t.passed_email_at is not null,'score_told',t.score_email_at is not null,
                                                'submitted_at',t.submitted_at,'start_by',t.start_by,'ends_at',t.ends_at,'attempt_no',t.attempt_no,
                                                'pastes',t.integrity->'pastes','blur',t.integrity->'blur')
                        from app_private.skills_test_attempts t where t.user_id=p.user_id order by t.created_at desc limit 1),
             'carriers', (select count(*) from app_private.dispatcher_assignments a where a.dispatcher_user_id=p.user_id and a.status='active'),
             'trucks', (select count(*) from app_private.dispatcher_assignments a join app_private.fleet_trucks t on t.carrier_id = a.carrier_org_id
                          where a.dispatcher_user_id=p.user_id and a.status='active' and coalesce(t.status,'active') not in ('inactive','retired')),
             'owed', (select coalesce(sum(amount),0) from app_private.dispatcher_commission c where c.dispatcher_user_id=p.user_id and c.status in ('draft','approved')),
             'last_booking_at', (select max(b.updated_at) from app_private.dispatcher_bookings b where b.dispatcher_user_id=p.user_id),
             'last_sign_in_at', (select u.last_sign_in_at from auth.users u where u.id=p.user_id)
           ) order by p.created_at desc) filter (where p.rn <= greatest(coalesce(p_per_stage,12),1)) cards
      from (select d.*, row_number() over (partition by d.status order by d.created_at desc) rn
              from app_private.dispatcher_profiles d) p
     group by p.status) s;
$$;

-- backfill sub-scores + gates for attempts that already exist (v1 bank, read through the same rollup)
select count(app_private.disp_test_rollup(id)) from app_private.skills_test_attempts where status in ('submitted','scored');

-- ───────────────────────────── 8. grants (authenticated only; anon never)
revoke all on function public.dispatcher_test_start() from public, anon;
revoke all on function public.dispatcher_test_my() from public, anon;
revoke all on function public.dispatcher_test_save(uuid, text, integer, integer) from public, anon;
revoke all on function public.dispatcher_test_submit(jsonb) from public, anon;
revoke all on function public.cc_dispatcher_test_review(uuid) from public, anon;
revoke all on function public.cc_dispatcher_test_score(uuid, jsonb, text, text) from public, anon;
revoke all on function public.cc_dispatcher_activity(uuid, integer) from public, anon;
revoke all on function public.cc_dispatchers_board(integer) from public, anon;
grant execute on function public.dispatcher_test_start() to authenticated, service_role;
grant execute on function public.dispatcher_test_my() to authenticated, service_role;
grant execute on function public.dispatcher_test_save(uuid, text, integer, integer) to authenticated, service_role;
grant execute on function public.dispatcher_test_submit(jsonb) to authenticated, service_role;
grant execute on function public.cc_dispatcher_test_review(uuid) to authenticated, service_role;
grant execute on function public.cc_dispatcher_test_score(uuid, jsonb, text, text) to authenticated, service_role;
grant execute on function public.cc_dispatcher_activity(uuid, integer) to authenticated, service_role;
grant execute on function public.cc_dispatchers_board(integer) to authenticated, service_role;

-- ───────────────────────────── 9. (0317c) own_board: the form stores "No own access" as an array element — an array-length test
-- read that as "has a board". The cc_dispatchers_board body above already carries the corrected expression.
