# Agent Portal — Deep Audit (29 Aug 2026)
**Scope:** agent/referral program sirf — network-marketing engine, attribution, payouts.
**Dispatcher portal ko haath nahi lagaya** (bl_disp_*, dispatcher-workspace.js, dispatchers.js — sab untouched).
Har figure production se verify hua. `referral_commissions` par ab tak **0 rows** thin — engine
kabhi kisi asli load par chala hi nahi, is liye fixes ne koi historical data nahi chhera.

---

## Engine ka naqsha (jaisa mila)
- `referrers` (66 rows: 11 affiliate/active, 52 affiliate/pending, 5 carrier, 1 partner) —
  `parent_referrer` = upline (agent-to-agent recruiting, 5 levels tak)
- `referral_edges` (child_org → referrer) = kis ne kaunsi org layi (PK child_org — ek org ka ek hi referrer, "link hi record hai" rule DB-enforced ✓)
- `referral_levels`: L1 1% · L2 0.50% · L3 0.25% · L4 0.15% · L5 0.10% — **gross ke percent**
- Paisa banta hai `fin_invoices` (status sent/paid) se; 15-din clearing (`payable_at`); phir payable → payout request → CC approve
- Cron har 30 min (`lb-referral-accrue`) + trigger `fin_invoices` par

## 🔴 Bug 1 — wada gross ka, hisaab fee ka (bl_agent_0306, FIXED)
Har agent-facing document — AGENT-PROGRAM.md, agents.html, upline email ("0.50% of gross") —
**gross ka percent** promise karta hai. Engine `round(fee * pct / 5.0, 2)` laga raha tha —
jo sirf tab sahi hai jab fee theek 5% of gross ho. `fin_invoices` mein `gross` aur `fee_pct`
dono maujood hain; koi bhi discounted/flat-fee invoice poori chain ko chupke se ghalat paisa deta.
**Ab:** `amount = round(gross × pct/100, 2)` (gross NOT NULL hai, fallback sirf hifazati).

## 🔴 Bug 2 — beech ka ek pending banda POORI upline rok deta tha (FIXED)
`while ... v_ref.status='active'` pehle inactive node par **poora walk band** kar deta tha.
52 pending referrers hain — jiska bhi recruit abhi pending hai, uske UPAR ke saare active
agents ka override ZAYA. Ab walk inactive node ko **skip karke aage barhta hai** (wo apna
level consume karta hai, kisi ka percentage nahi badalta); pending node khud activate hote
hi rescan se apni rows le leta hai. **Kisi ki mehnat zaya nahi.**

## 🔴 Bug 3 — pair rule: kahin zyada sakht, kahin ghayab (FIXED)
- Agent-loads path par pair-check **insert par** tha → bina pair ke agent ko kuch DIKHTA hi nahi tha (motivation zero).
- Core paths par pair-check **tha hi nahi** → single-sided chain PAID ho jati — published terms ke khilaf.
**Ab:** har kamai foran **accrued** ban kar ledger mein dikhti hai (network-marketing loop:
agent apna paisa clearing mein dekhta hai), aur pair rule sirf **payable-promotion** ko rokta
hai — aur sirf approved agent-profile walon ke liye. Aam affiliates par koi asar nahi.

## 🔴 Bug 4 — void invoice ka paisa payable rehta tha (FIXED)
Invoice sent/paid se hat jaye to commissions jyon ki tyon rehti thin. Ab unpaid rows apne
invoice ke saath `void` hoti hain aur invoice wapas aaye to `accrued` par revive. `paid` rows
kabhi nahi chherti — paid paise ka clawback insani faisla hai.

## 🟡 Real-time (FIXED)
Trigger sirf `referral_accrue_core` chalata tha — agent-sourced-loads ka paisa 30-min cron
ka intezaar karta tha. Ab trigger `referral_accrue_all()` chalata hai: **invoice girte hi
har path ki commission ledger mein.** Cron ab sirf date-based promotion + safety net hai.

## ✅ Staging proof (rolled-back txn, kuch save nahi hua)
Chain A(active) → P(active) → G(pending) → GG(active), carrier org A ki edge, invoice gross $2,400:
- Rows: **A L1 $24.00 · P L2 $12.00 · GG L4 $3.60** — G skip, GG ko paisa mila (purana engine GG ko $0 deta)
- Invoice void → teenon rows `void`; wapas sent → `accrued` ✓
- A ko approved agent profile de kar clearing past ki: **A accrued par ruka (pair nahi), P/GG payable** ✓
- Rows invoice-INSERT par trigger se khud banin — **real-time proof** ✓
Prod par bhi apply + verify (`gross_base=true`, `trigger_realtime=true`, live run ok).

## Jo THEEK mila (chherne ki zarurat nahi)
- Duplicate-pay impossible: unique `(invoice_id, referrer_id)` + on-conflict ✓
- Ek org ka ek referrer (edges PK) — "baad mein claim nahi hota" DB-enforced ✓
- Self-referral block `agent_claim_upline` mein ✓ · payout center sirf `payable` sum karta hai,
  $100 min, ek waqt mein ek request ✓ · pending agent ki mehnat activation par rescan se backfill ✓

## ✅ bl_agent_0307 — pair-hold ab NAZAR aata hai (29 Aug, staging+prod)
Hold to 0306 ne bana diya tha; 0307 usay dikhata hai — warna clearing date guzar jati aur
agent ko lagta product toota hai. `agent_chain_status` ab `pair_missing` + `held_on_pair`
deta hai; Payouts tab par 🔗 reason: *"$X is earned and safe, but held — bring <missing
side> and it releases. Nothing you earned is ever lost."* Pair modal (app.js) mein amber
box: `$X already earned — waiting on your pair`, exact missing side ke saath. Staging
proof: carrier-only approved agent, $2,400 invoice → held=$24.00, missing=demand ✓.

## ✅ "Deliver par 1%" — wording pehle se sach nikli
`auto_invoice_on_delivery` invoice delivery par hi banata hai, aur `cc_create_invoice_core`
non-delivered trip par mana kar deta hai — to chain hai: deliver → invoice → (0306 trigger)
→ commission USI waqt. Koi tabdeeli nahi chahiye thi.

## 🟡 Khula (business faisle — engine nahi)
2. **52 pending agents** CC approval queue mein baithe hain — unka intro/nudge Yaseen ke haath mein.
2. Level percentages (1/0.5/0.25/0.15/0.1 = total 2% max) business ka faisla hai — engine ab
   jo bhi `referral_levels` mein ho wahi sach-much gross par dega.
