# LoadBoot — Operator Run-Sheet (desk se, Pakistan se, khud chalao)

**Maqsad:** poora cycle — post load → book → trip → arrive/depart → evidence → claim → payout —
apne laptop par khud test/operate karo. Kisi warehouse par jaana zaroori NAHI.
GPS sirf convenience hai; **manual "Arrived"/"Departed" buttons hamesha kaam karte hain.**

> Test hamesha STAGING par (project: snslhvmkjusozgjelghi). Prod par kabhi test mat karo.

---

## Setup (ek dafa)
1. Do browser tabs kholo:
   - **Broker:** `localhost:8080/app/partner/`  (ya loadboot.com/app/partner/)
   - **Carrier:** `localhost:8080/app/carrier/`
2. Dono par login (ek broker account, ek verified carrier account).
3. Mobile view chahiye to: Chrome → More tools → Developer tools → Ctrl+Shift+M.

---

## Har baar ka loop (10 steps)

**BROKER tab:**
1. **Post a load** → lane, dates, equipment, commodity (autocomplete se pick), rate.
2. Requirements step → accessorial rates pehle se standard (detention $60/hr, layover $250, TONU $250,
   lumper policy, driver assist $75) → green "Standard marketplace terms" par **tick** → **Submit load.**

**CARRIER tab:**
3. **Available loads** → wo load **Book** karo → trip ban gaya (status: *Booked — ready to start*).
4. Trip kholo → **"Arrived"** tap (pickup) → detention clock chalu.
5. **Upload evidence** (jo driver se chahiye): gate photo / lumper **receipt** / signed BOL.
   (Test ke liye koi bhi sample image upload kar do.)
6. **"Departed"** tap → system khud detention minutes = (waqt − free time) nikaal kar line bana deta hai.
7. (Optional) **"Report issue → accessorial"** → lumper / driver assist / layover / TONU manually add,
   agar dock par extra service aaya jo load mein nahi tha.
8. Delivery par phir **Arrived → Departed**, phir **POD upload** → status *Delivered*.

**CLAIM (khud banti hai):**
9. POD ke saath **invoice = linehaul + saare accessorials** auto ban kar broker ko claim jaati hai.

**BROKER / CC tab:**
10. Broker **claim approve** (ek tap) → **settlement carrier ko pay** karta hai. Cycle mukammal.

---

## Yaad rakhne wali 5 baatein
- **Move karne ki zaroorat nahi** — sab kuch screen par buttons se hota hai.
- **Manual Arrived/Departed** hamesha chalta hai; GPS optional verification hai.
- **Evidence = claim.** Bina receipt/photo ke lumper/detention weak hoti hai — upload zaroori.
- **Claim khud file hoti hai** delivery+POD par — aapko yaad rakhne ki zaroorat nahi.
- Kuch atke to: build re-run `python build_site.py`, phir browser refresh
  (PWA cache: DevTools → Application → Clear site data).

---

## Agar koi button na dikhe / kaam na kare
- Ye batao: "carrier trip par Arrived/Departed/POD button nahi dikh raha" — main us screen ko
  wire/fix kar dunga. (Backend RPCs — tripArrive, tripDepart, carrierRequestAccessorial,
  pocketUploadPod — pehle se maujood hain; sirf UI button chahiye ho to laga denge.)
