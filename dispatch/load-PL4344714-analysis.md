# Load PL4344714 — Stow OH → Tipp City OH — analysis (22 Aug 2026)

**Source:** https://123lb.com/7vWPJ · 123Loadboard shared link
**Broker:** Logistic Dynamics, LLC · Amherst NY (Buffalo) · dispatch **(904) 240-4761**

## The load
| | |
|---|---|
| Lane | **Stow, OH → Tipp City, OH** |
| Distance | 199 mi posted (Rate Check: 205.68 mi) |
| Pickup | **08/24 Monday** |
| Equipment | Flatbed **(Tarps)** |
| Size | **LTL — partial** |
| Length | **5 ft** |
| Weight | **3,300 lbs** |
| Posted rate | **$450.00** |
| Ref | PL4344714 |

## 3-GATE

**Gate 1 — broker authority: ✅ PASS**
`fmcsa-verify` on DOT 2231470 → LOGISTIC DYNAMICS LLC, **MC-471231**, 1140 Wehrle Dr, Amherst NY 14221.
`liDockets[].broker = "A"` · `brokerOnly: true` · `authorityVerified: true` · registered **2011-11-19** ·
not out of service.
> Note the trap the handoff warns about: top-level `carrierAuthority: false` — that is CARRIER
> authority and is meaningless here. The real answer is `liDockets[].broker = "A"`.

**Gate 2 — credit: ✅ PASS**
TransCredit **94 / 32 days** · eCapital **B / 33 days** (31 days over last 60 and 90).
Threshold was 35+ days or grade D = fail. Comfortably clear.

**Gate 3 — factoring credit approval: ⬜ NOT DONE**
Truckstop `FactoringAR@truckstop.com` must approve the broker **before** booking.

## Equipment fit: ✅ easy
5 ft and 3,300 lbs against a 30 ft deck and 9,000 lbs max. Tarps required — Munster carries a
lumber tarp and a flat tarp. This is exactly the freight the truck was posted for.

## Geography: the problem, and the upside
- Deadhead New Richmond OH 45157 → Stow OH (near Akron): **~235 mi** — over Justin's 200 mi radius
- Linehaul Stow → Tipp City (near Dayton): **199 mi**
- Tipp City → home: **~85 mi**
- **Total ~520 mi**

**Upside:** delivery is 85 mi from home, so Justin sleeps at home Monday night. No overnight needed.

## GO / NO-GO

At posted $450:
```
fuel      = 0.28 × 520      = $146
net       = 450 − 146       = $304
truck-days                  = 1
$304/day  vs breakeven $572 = FAIL by $268
```

Breakeven linehaul:
```
572 + 146 = $718
```

**Decision: NO at $450. Negotiate.**
- **Ask $850** · **walkaway $725** (never voiced)
- Justification that holds up: 123LB Rate Check puts this lane at **$4.84/mi = $962.38**.
  The post is at **less than half market**. $850 is still **$112 under market**, and we deadhead
  235 mi to reach it.

## The better play — pairing
Logistic Dynamics is a large brokerage. Ask whether they have anything Monday morning **out of
Cincinnati/Dayton heading north toward Akron or Cleveland**. If yes:
- Leg 1 Cincinnati → Akron area, **paid** instead of deadhead
- Leg 2 Stow → Tipp City
- Home Monday night, 85 mi from Tipp City

That turns a losing load into a strong first day, and makes us flexible on the $450.

## Call
`lc_calls 187` — Sat 22 Aug 13:32 ET, Riley outbound to (904) 240-4761.
Briefing covers: availability, $850 ask with the Rate Check justification, the pairing question,
and their carrier-setup process (Highway / RMIS / own packet) + packet email.
No rate commitment on the call — "dispatcher will confirm within the hour."

## Note on Saturday calling — correction to an earlier assumption
Earlier this session the conclusion was "broker calls fail on Saturday" after lc_calls 176–179 all
returned no-answer. That holds for **small broker load desks**. It does **not** automatically hold
for a national brokerage that publishes a dispatch line and has a Monday-pickup load posted — those
often carry weekend coverage. Judge by the size of the brokerage and whether the load is imminent,
not by the day alone.
