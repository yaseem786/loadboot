# LoadBoot Market Rates & Analytics — DAT-style system (PLAN, not yet built)
Requested: broker ko DAT RateView jaisa freight-rates system; audience-specific rates
(shipper/broker/carrier apne apne), post-load suggester mein lane rate, alag "Market Rates" tab,
weekly refresh. Ye plan hai — implement karne ka faisla Yaseen ka.

## 1. DAT kya dikhata hai (target)
- Lane rate lookup: origin→destination + equipment → avg / low / high $per-mile + flat rate,
  15/30/90-day windows
- BUY vs SELL: broker-to-carrier (spot/buy) alag, shipper-to-broker (sell) alag — margin visible
- Trendlines (rate graphs), market demand (load-to-truck ratio), hot/cold lanes

## 2. Data architecture — 3 layers (accuracy ki sachai ke saath)
L1 — OWN MARKETPLACE (sab se sachi, khud-updating): accepted offers + bookings se real
     lane/equipment rates. Roz refresh (cc_market_rpm pattern ko lane-level tak barhana).
     Accuracy: platform ke andar EXACT; shuru mein thin — lane-level ke liye n≥5 bookings chahiye.
L2 — PUBLISHED BENCHMARKS (weekly): national + regional averages public sources se
     (DAT trendlines public page, FreightWaves, industry blogs). Nayi table
     app_private.rate_benchmarks(region_o, region_d, equipment, audience, rpm_avg, rpm_low,
     rpm_high, window_days, source, as_of). Weekly update — Yaseen ke kehne par ya weekly task.
     Accuracy: national ±3–5%; regional ±8–12%; LANE-level publicly available NAHIN hota —
     regional adjustment se approximate hoga aur card par confidence label dikhaya jayega.
L3 — DAT RATEVIEW API (paid, jab volume justify kare): tab system 1:1 DAT-accurate ho jayega.
     Yehi akela tareeqa hai "bilkul DAT jaisa" accuracy ka; L1+L2 tab tak imandar approximation.

## 3. Margin model — har audience apna rate (server-enforced)
- CARRIER/driver: carrier spot rate (jo truck ko milta hai) — buy side sirf
- BROKER: dono — BUY (carrier rate) + SELL guidance (carrier +12–18% brokerage margin)
- SHIPPER: sirf SELL rate (shipper-to-broker) — carrier buy rate kabhi nahin dikhta
- Enforcement RPC mein: cc_lane_rate(o_state, d_state, equipment) role dekh kar
  (my_carrier_org / my_partner_org('broker'/'shipper')) sirf apni audience ke fields lautata hai.

## 4. Blending logic (ek RPC, imandar confidence)
cc_lane_rate: lane-level own data (n≥5) > regional own data > L2 regional > L2 national.
Output: rpm_avg/low/high + flat for given miles + trend (4wk %) + sample n + confidence
HIGH (own lane data) / MEDIUM (regional) / LOW (national fallback) — label hamesha visible.

## 5. UI
a) Post-load estimator upgrade: "MN→NC · Flatbed · avg $2.61/mi (low 2.30 / high 2.95) ·
   flat ~$3,050 · ▲ +3% 4wk · confidence MEDIUM" + Use buttons (low/avg/high)
b) Naya tab "📊 Market Rates" (pehle broker portal; phir carrier + shipper, har ek apni audience):
   lane search (state→state + equipment) → DAT-style rate card + 12-week trend graph +
   demand indicator (hamare board ka loads-posted vs active-carriers ratio) + national snapshot
   tiles + hot lanes list (platform volume se)
c) History table (weekly snapshots) trend graphs ke liye

## 6. Cadence
- L1: automatic (har booking)
- L2: weekly — Yaseen ping kare ya (agar approve ho) weekly scheduled task; floors quarterly manual
- CC override hamesha: rate_standards / rate_benchmarks keys

## 7. Phases + effort
- Phase 1 (ek session): rate_benchmarks table + audience-aware cc_lane_rate + broker Market
  Rates tab + estimator lane upgrade + pehla benchmark fill (research se)
- Phase 2: carrier/shipper views, trend graphs, demand indicator, weekly history
- Phase 3: DAT RateView API (paid) — exact DAT parity

## 8. Seedha jawab: kar sakti hoon? Kitna accurate?
Haan — Phase 1–2 poora ban sakta hai. Accuracy: national/regional numbers bharose-laayak
(±3–12%), lane-level shuru mein approximation (confidence label ke saath); asli DAT-level
lane accuracy sirf L3 (paid API) ya apna volume barhne par. System jhoot nahin bolega —
har number ke saath source aur confidence dikhayega.

## 9. DAT RateView ke muqable accuracy (% mein, imandar)
- National averages: ~90–95% (public sources DAT se 2–7 din peechhe, ±3–5%)
- Regional averages: ~75–85% (approximation)
- Lane-level: shuru mein ~50–70% (regional se derive); har booking ke saath barhta hai —
  jis lane par apni 5+ bookings, wahan ~95%+ (asal transactions se). DAT API laga do to 100%.
- Product value overall: launch par DAT RateView ka ~70–80% tajurba, confidence labels ke saath.

## 10. Public SEO version (marketing site) — lead generation. POSSIBLE ✔
Proven play (DAT/Truckstop/FreightWaves yehi karte hain). Hamara build_site.py pehle se
50+ SEO pages + sitemap banata hai — perfect fit.
- Pages (programmatic SEO): /freight-rates.html hub; per-equipment (dry-van-rates-per-mile,
  reefer-rates-per-mile, flatbed-rates-per-mile); per-state (freight-rates-in-texas);
  top 50–100 lanes (freight-rates-texas-to-california). Long-tail: "flatbed rate per mile 2026".
- Content per page: current avg/low/high (weekly rate_benchmarks se build time par inject),
  chhota trend, 300–500 words explainer, FAQ + Dataset JSON-LD schema, internal links,
  "updated <date>" freshness signal.
- LEAD GATE: public ko sirf BLENDED national/regional number (buy/sell split kabhi public
  nahin — broker margin protect). CTA: "Unlock lane-level buy/sell rates — free LoadBoot
  account" → signup = lead. Rate calculator widget bhi lead magnet.
- Rules: apna + public-source data hi (DAT scrape TOS violation — kabhi nahin); source +
  disclaimer har page par. Weekly rebuild jab benchmarks update hon.
