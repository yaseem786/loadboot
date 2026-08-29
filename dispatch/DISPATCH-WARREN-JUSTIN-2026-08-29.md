# Warren (Jacksonville → GA, Jumeraat tak) aur Justin (Somwar)
**Sat 29 Aug 2026.** Handoff (28 Aug) + production DB, dono milaye hue.
Jahan dono mein farq tha wahan **handoff ko sach maana** aur farq neeche likh diya.
Saare messages **draft** hain — bhejna tumhara kaam hai.

---

## Board ke bare mein saaf baat
`public.loads` mein jo `available` hai wo poora **demo seed** hai (Play listing wala), asli nahi.
Asli board 123LoadBoard hai — aur handoff ke mutabiq **SPA cold load par hydrate nahi hota**, saved
search DOM mein aati hi nahi. Yani main us se rows nikal nahi sakta. Tumhare tab mein ek click, ya rows
paste kar do — phir main hisab laga dunga.

**Go/no-go:** `(rate − 0.28 × kul miles) ÷ truck-days ≥ floor` · kul miles mein deadhead shamil ·
floor: **Justin $572 · Warren $780**

---

## 1. WARREN — 26 ft Hino

### Truck aur haalat
| | |
|---|---|
| Truck | 2026 HINO L6, 26 ft box, VIN 5PVNJ7DVXT5T51569 — Enterprise se **ek hafte** ke liye rented |
| Payload | **10,000 lb** |
| Interior | 94" chaura × 97" ooncha · **LENGTH ABHI TAK NAHI MILI — 3 baar poocha ja chuka. Broker ko koi number mat batao.** |
| Dock-high / liftgate | Dono **haan** · pallet jack haan, **magar aaj Sat 29 Aug nahi** |
| Drivers | Jason Warren (malik) + Anthony Robinson — dono policy par scheduled |
| Floor | **$780/din** (weekly $3,900 incl. pay) · min_rpm 2.10 · **max deadhead 100 mi** |
| Insurance | Progressive Southeastern **878041030**, 05 Aug 26 – 05 Aug 27. $1M auto liab, $100k cargo, $2,500 ded. |
| Cert holder | **EAN Services LLC (Enterprise)** — LoadBoot cert holder par **nahi** hai, maanga hua hai |
| Hired-auto | **Sirf Enterprise ke liye.** Ryder/Penske/U-Haul se rent kiya to cover NAHI. |
| Address | Policy par **Fayetteville NC 28306**, hamare paas **Hinesville GA** — farq confirm nahi hua |
| Rabta | **Sirf Jason ke zariye** (254-226-7286). Us ne saaf kaha. Anthony se seedhi baat nahi. |

> ⚠️ **DB mein do cheezein ghalat hain** — `fleet_trucks` unit 0026 ki spec note mein
> `cargo_len_in = 308` likha hai (wo **andaza** hai, "normal for a 26 ft box" se nikala hua) aur
> certificate holder **LoadBoot LLC** likha hai (asal mein **EAN Services**). Dono theek karne layak hain,
> warna agli session inhein sach samajh legi. Main ne DB par kuch likha nahi — ye prod hai, tumhara faisla.
> *(Maine kal apne pehle draft mein yahi do figures sach maan kar likh di thin — ab hata di hain.)*

### Trip plan (Warren ne pehle hi maan liya hai)
- **Aaj Sat 10:00 baje Jacksonville se truck lena hai, 11:00 tak ready.**
- Jacksonville se nikal kar, kaam karte hue **Savannah** wapas.
- **Jumeraat 3 Sep tak Georgia mein hona zaroori — Anthony ki shaadi Jumma 4 Sep ko hai.** Ye rental
  ki deadline nahi, truck poore hafte ke liye hai.
- **Sat aur Itwar khali hain** — board par kuch nahi.

### Ek hi candidate: Zeal Logistics
**Daytona Beach FL → Atlanta GA, Somwar 31 Aug**, 457 mi load, 3,000 lb, straight box, **rate post nahi kiya**.
Deadhead Jacksonville→Daytona ~86 mi (limit 100 ke andar, magar **bilkul kinare par** — pickup ZIP door
hua to limit toot jayegi, aur pickup ZIP abhi tak nahi mila).

Kul ~543 mi par hisab:

| Rate | 1 din mein | 2 din mein |
|---|---|---|
| $1,250 | **$1,098/din ✓** | $549/din ✗ |
| $960 | **$808/din ✓ (bilkul kinare)** | $404/din ✗ |

**Matlab: poora sauda ek-din execution par khara hai.** Do din laga to har rate fail hai.

- **Call: 1-800-355-9325.** Intake **bot** hai — seedha *"transfer me to a person"* bolo (pichli baar
  8 baar loop mein phansa). Un ka system Warren ka MC nahi dhoondh saka — **MC 99849375 / DOT 5677034** taiyar rakho.
- **$1,250–1,300 maango.**
- Opening: *"You had a load for us on the 24th — 23,000 lb, too heavy for the truck we had then.
  We've got a 26-footer now, 10,000 lb, liftgate and dock-high."*

### Search
`WARREN 26FT JAX` — 32202 · 100 mi · SB · 0–27 ft · 0–10,000 lb · Aug 29/30/31 · alert ON
→ **Sep 1 add karna hai** (Jumeraat tak wapas aana hai to Mangal ka pickup bhi chalta hai).
Delete karne layak purani alerts (sab 16 ft/4,000 lb ke liye thin): `WARREN OUT`, `BACK-CLT`, `BACK-CHS`,
`BACK-JAX`, `BACK-ATL`. **Alert cap 10 hai.**

### Jason ko message (draft)
> Morning Jason — Anthony picking the Hino up at ten, good. Three quick things so I can work Monday properly:
> 1) What's the interior **length** of the box? I've got the width and height but brokers ask length first,
>    and I won't quote a number I haven't got from you.
> 2) What ZIP is he actually sitting in Monday morning?
> 3) Is the pallet jack back in the box from Monday?
> Also — Enterprise is on the certificate as holder, not LoadBoot. Can you ask them to add
> LoadBoot LLC as certificate holder? Brokers ask for it during setup.
> — Mike, LoadBoot dispatch

---

## 2. JUSTIN — Munster hotshot, Somwar 31 Aug

### Truck aur haalat
| | |
|---|---|
| Deck | 30 ft gooseneck (25+5), 102" chaura, **34" deck height** |
| Payload | **9,000 lb — hard limit** · non-CDL |
| **Nahi hai** | **Winch nahi** · dock-high nahi · **hazmat nahi** (non-CDL, endorsement le hi nahi sakta) |
| Hai | Mega ramps, Grade 80 chains/binders, straps, lumber tarp, flat tarp |
| Home base | **New Richmond, OH** — wo khud "Batavia" kehta hai (12 mile door, ek hi county). **DB mein Batavia likha hai; farq us se confirm nahi hua.** |
| Floor | **$572/din** (weekly $2,860 incl. pay) · min_rpm 1.50 · max deadhead **200 mi** |
| Weekend | **weekend_ok = FALSE** · home_time weekly |
| Nahi chalata | New York, California |
| HOS | Aakhri message *"dead heading home, hos 2hrs"* — andaza Budh 26 Aug. **Somwar tak clock poora reset.** |

> ⚠️ **Authority sirf ~24 din purani.** Ryder ne 3 hafte par mana kiya, Sureway 180 din maangta hai,
> ~90 din aam hai. **Har broker se pehla sawal yahi poochho** — warna poori call zaya.
>
> ⚠️ **Tarp:** saath hai magar wo karna nahi chahta (WhatsApp 22 Aug). Aakhri chara, aur sirf tab jab
> rate saaf tor par extra kaam ka paisa de raha ho — commit karne se pehle us se poocho.

### Somwar ke liye dekhe hue loads
- **Logistic Dynamics — Elkhart IN → Brandon SD, $2,500, $1,126/din** — paisa sab se behtar, magar
  **deadhead 209 (limit 200)**, South Dakota 1,000 mile door, aur (800) 554-3734 par jawab nahi.
  Email `carrierdev@shipldi.com` par draft tayyar hai. **Load note mein "EXT3" = extension 3.**
- **Eagle Rock — Oakland City IN → Marshall MI, $800, $653/din** — Sanicher ka pickup hai, us ke liye
  nahi chalega, aur Michigan mein chhorta hai.
- **Eagle Rock — Maumee OH → Pittsburgh PA — mar chuka**, pickup kal tha.

### Eagle Rock — taluq banane layak (sab se behtar prospect)
Credit **99**, **23 din** payment, asli logon ke naam: **Steven Foxx (541) 930-8360 ext 1032**,
**Justine Stringer ext 1007**, dispatch@eaglerockfreight.com.
Un ka wo load cover ho gaya — **phir bhi call karo. Pehla sawal: authority age ka rule kya hai.**

### Search
`MUNSTER OUT` — New Richmond OH · 200 mi · F/RG/SD · 0–30 ft · 0–9,000 lb
→ **31 Aug add karna hai** (abhi 28/29 par ruki hui hai).
Stale: `MUNSTER BACK-IND`, `MUNSTER BACK-NSH` (24/25 Aug ki dates, aur Justin ab ghar par hai).

### Justin ko message (draft)
> Hey Justin — working Monday for you now.
> 1) What time Monday can you be under a load?
> 2) Staying inside your usual 200 miles, or want me looking wider for Monday?
> One more — are you New Richmond or Batavia for the board? I've got both written down and it changes
> what deadhead I'm quoting brokers.
> Keeping tarp loads off the list unless the rate clearly pays for it — I'll ask you first either way.
> — Mike, LoadBoot dispatch
