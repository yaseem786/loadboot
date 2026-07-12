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
