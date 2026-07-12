# Portal Test Checklist — Marketplace v3 (owner testing)
Tarika: har test karo → box mein x likho `[x]` → agar TOOTA to neeche "BUGS" section
mein number ke saath likho kya hua + screenshot le lo. Claude fix karega.

⚠️ Test SIRF localhost par (staging DB). Live loadboot.com par test data mat banao.
Pehle: `python build_site.py` (staging key ke saath) + server chalu + Ctrl+Shift+R.

## A. Carrier portal (localhost:8080/app/carrier/)
- [ ] 1. Login `carrier-owner@lb.test` — dashboard khule, koi error na aaye
- [ ] 2. Marketplace/Loads board khulе — loads dikhein, har card par rate + pickup info ho
- [ ] 3. Ek load "Accept/Book" karo — trip banna chahiye, status "Booked — ready to start"
- [ ] 4. Trip kholo → map dikhe (light style default), truck marker + route line ho
- [ ] 5. Map par 🧪 SIMULATION button dabao (sirf localhost par dikhta hai) —
      truck khud pickup tak jaye → auto check-in ho → "detention clock" chale →
      auto depart → delivery check-in. Poora cycle bina error ke chale
- [ ] 6. Turn-by-turn card dikhe (arrow + "Turn left..." text) aur 🔊 voice toggle kaam kare
- [ ] 7. Delivery ke baad POD/paperwork upload manga jaye (paperwork enforcement)
- [ ] 8. Trip complete par RATING poochha jaye (carrier→broker rating)
- [ ] 9. Finance/#finance tab — trip ka P&L dikhe (revenue, fuel, detention line items)
- [ ] 10. Account → Documents — koi document "View" karo, preview khule

## B. Partner/Broker portal (localhost:8080/app/partner/)
- [ ] 11. Broker login — dashboard khule
- [ ] 12. Naya load post karo — rate suggestion dikhe, post hone ke baad board par aaye
- [ ] 13. Jo load carrier ne book kiya — uska tracking/status broker ko dikhe
- [ ] 14. Delivered load par broker→carrier rating poochha jaye

## C. Command Center (localhost:8083/app/command-center/)
- [ ] 15. Login `dispatcher@lb.test` — console khule
- [ ] 16. Ops Radar — active trips dikhein, booked trip ka status sahi ho
- [ ] 17. Carriers → kisi carrier ka 360 kholo — health score card + FMCSA verify button
- [ ] 18. Radar page NEECHE broker-loads table → "Docs" button — checklist submissions khulen

## D. Live site (sirf dekhna, data nahi banana)
- [ ] 19. loadboot.com — splash screen ab NAHI aani chahiye (page seedha khule)
- [ ] 20. loadboot.com/cost-per-mile-calculator.html — slider/inputs mein number badlo,
      results foran update hon

## BUGS (jo toota yahan likho)
| # | Test no. | Kya hua (screenshot bhi le lo) |
|---|----------|--------------------------------|
|   |          |                                |

## E. Payment rails (NAYA — staging par test karo)
- [ ] 21. Broker: Claims → kisi claim ki Evidence kholo — "📎 Paper proof" mein ab
      har document ke saath "View ↗" ho (khulna chahiye, pehle sirf naam tha)
- [ ] 22. Carrier: trip kholo, pickup/delivery zone ke ANDAR (ya sim mein dock par) —
      neeche 3 naye buttons dikhein: 📷 Dock photo · 📝 Signed BOL/POD · 🧾 Lumper receipt;
      koi photo attach karo, "✓ Proof attached" flash aaye
- [ ] 23. Broker: approved claim par "💸 Pay this claim" dabao — carrier ke bank details +
      how-to-pay + memo reference dikhein; receipt/screenshot attach karke
      "I have paid — submit receipt" — status "Payment sent — awaiting carrier ✓" ho jaye
- [ ] 24. Carrier: Finance → "💸 Payments in flight" card mein wahi claim
      "📥 on the way · expected by <date>" dikhe + "✓ I received it" button; dabao —
      broker side ab "✓ Paid — carrier confirmed received" dikhaye
- [ ] 25. Carrier: Finance → Invoices mein kisi DUE (sent) invoice par "💳 Pay now" —
      LoadBoot payment instructions dikhein; receipt attach + submit —
      "⏳ LoadBoot verifying" ho jaye
- [ ] 26. CC (dispatcher): Ops Radar upar "💳 Fee receipts to verify" card —
      🧾 Receipt khul jaye + "✓ Money received" dabao — carrier ki invoice PAID ho jaye
- [ ] 27. Broker: delivered load ki Live tracking kholo — "💰 Pay freight to carrier" button
      steps ke neeche dikhe (same bank-details + receipt flow)
- [ ] 28. Broker: Dashboard + Invoices tab — "💰 Payables — money you owe carriers" card:
      har delivered load (freight) + har approved claim khud DUE ban kar aaye,
      "due since <date> (Xd)" ke saath; har item par wahi pay procedure (bank → receipt)
- [ ] 29. Carrier: Finance → "💸 Your money — owed & in flight" — jo abhi broker ne
      bheja hi nahi wo "⏰ awaiting broker payment" dikhe (total owed upar), bheja hua
      "on the way", confirm kiya hua ✓ — teeno states ek jagah
- [ ] 30. Claim amounts REAL hain (ab $0 nahi): sim trip chalao → detention claim ki
      amount = minutes × $60/hr, saath 🧮 calc line ("0h 3m past free time × $60/hr");
      broker ke claim card par bhi amount + calc dikhe, "How to pay" mein bhi wahi amount
- [ ] 31. Carrier: File-a-claim dropdown mein ab 7 kinds (detention/layover/TONU/lumper/
      driver assist/extra stop/other); lumper ya other chuno to "Receipt total $" box aaye —
      baghair amount ke file na ho; TONU/driver assist file karo to amount khud rate card se aaye
- [ ] 32. Detention FAIRNESS: sim trip chalao — 10 min ke andar nikal jao to claim BANE HI NA
      (exit grace); 45+ min ruko to 30-min block mein bill ho ("30-min blocks, 10 min exit
      grace deducted" calc mein likha ho). Chhoti $1–3 claims ab kabhi nahi banni chahiye
- [ ] 33. Broker Claims par ab "✕ Reject" hai (Dispute nahi) — reject karo to carrier ko
      "✕ Broker rejected" + support-escalate ka rasta dikhe
- [ ] 34. Carrier: Finance → owed item 3+ din purana ho to "⚠ Dispute non-payment" button —
      dabao to broker ko urgent notice + LoadBoot support ko report jaye
      (dispute ab PAYMENT stage ka hathiyar hai, claim-review ka nahi)

## F. Multi-stop loads — Stage 1 (posting + routing)
- [ ] 35. Broker: Post load → step 1 (addresses) — "➕ Extra stops" section: address type karo,
      suggestion pick karo → ✓ pin lage, MILES foran barh jayein (asli detour route se)
- [ ] 36. Delivery ETA/HOS box mein "(route includes N extra stops + 2h dock each)" aaye
      aur suggested delivery date aage ho jaye
- [ ] 37. Load post karo → book karo carrier se → carrier ke Dispatch pack mein
      "➡ Extra stop 1/2" full addresses ke saath dikhein
- [ ] 38. Rate card step par extra-stop $50/stop auto-on ho (kyunke stops add kiye)

## G. Multi-stop — Stage 2 (trip engine)
- [ ] 39. Broker: post par har extra stop ka KIND (📦 Extra pickup / 📤 Extra delivery) +
      PURPOSE likho ("drop 6 pallets at Ace") — carrier ke Dispatch pack mein dono dikhein
- [ ] 40. Multi-stop trip book karke map kholo — purple S1/S2 markers + circles dikhein;
      pickup depart ke baad agla target STOP ho (delivery nahi) — "To stop 1/2" chip
- [ ] 41. Stop ke 800m mein auto check-in ("Checked in at stop 1/2 — its own detention
      clock"), zone se nikalne par auto depart + agla leg; stop par 30+ min ruko to us
      stop ki detention claim alag bane + stop_off $50 khud file ho
- [ ] 42. Broker: Live tracking mein "🟣 Multi-stop: A → 📤 S1 city (purpose) → B" line
NOTE: 🧪 SIM mode abhi seedha pickup→delivery chalta hai (stops skip) — real GPS ya
mobile se test karo, ya batao to sim ko bhi multi-stop bana dun.
- [ ] 43. Extra stops ka SCHEDULE: Schedule step par har stop ka apna block — FCFS window
      ya Appointment + date/time; baghair bhare aage na barhe (validation)
- [ ] 44. Docs section mein har extra stop ka PU/delivery number + appt confirmation # ke
      fields; bhar kar post karo — carrier ke Dispatch pack mein stop ke saath number +
      schedule dikhe; trip map par stop leg ke waqt "Appt time" chip stop ka time dikhaye
