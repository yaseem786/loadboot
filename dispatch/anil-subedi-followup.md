# Anil Subedi — inbound call 22 Aug, verification + follow-up draft

## Call ka record
`lc_calls id 180` · Sat 22 Aug 11:16 ET · 170 sec · sentiment Positive · inbound from **+1 412-892-6328**

Usne kaha: ek **Ford Transit 250 low roof van**, local + regional + OTR, lanes **East Coast → Midwest**,
DOT **8169975**, email "giro@gmail.com".

---

## FMCSA verification (DOT 8169975) — 22 Aug

| | |
|---|---|
| **Legal name** | **CLAIRTON SUPERMARKET LLC** |
| Address | 5072 Dolores Drive, Pittsburgh, PA 15227 |
| **Phone on FMCSA** | **412-892-6328** — bilkul wohi number jis se call aayi ✅ |
| **Email on FMCSA** | **ANILSUBEDI160@GMAIL.COM** |
| Docket (census) | MC63107760 · `mcActive: null` |
| **Authority verified** | **NAHI** — L&I par `no_authority_records` |
| Registered since | **2026-08-07** — sirf 2 hafte purana |
| Classification | AUTHORIZED FOR HIRE · operation class A |
| Power units | 2 · drivers 1 (interstate 1) |
| Safety rating | none · out of service: nahi |

---

## Teen cheezein jo Riley ne ghalat capture keen — ye ahem hain

1. **Email ghalat hai.** Riley ne `giro@gmail.com` likha. Transcript mein banda keh raha hai
   *"Aniro Subedi, giro@gmail.com"* — yani "Anil" ko "Aniro" suna gaya. FMCSA par uska apna
   registered email **anilsubedi160@gmail.com** hai, aur wo isi phone number se juda hua hai jis se
   call aayi. **`giro@gmail.com` par mat bhejna — wo kisi aur ka ho sakta hai.**

2. **Equipment ghalat classify hui.** Analysis mein `equipment_type: box_truck` likha hai. Usne
   **Ford Transit 250 low roof van** kaha — ye **cargo van** hai, box truck nahi. Farq bara hai:
   Transit 250 low roof ka payload ~3,000-3,500 lbs aur cargo space ~250 cu ft hai. Agar ye box
   truck ke tor par match hua to usay aise loads jayenge jo uski van utha hi nahi sakti.

3. **Field ka naam ghalat hai.** Analysis mein `mc_number: "8169975"` likha hai — magar usne wo
   **DOT** ke tor par diya tha (aur DOT hi hai). MC alag hai: census par MC63107760.

> Teenon ek hi wajah se hain — Riley ka post-call analysis schema. Ye baad mein theek karne wali
> cheez hai, abhi note kar li.

---

## ⚠️ Dispatch abhi nahi — Warren wala pattern dobara

`registered 2026-08-07` + L&I par koi authority record nahi = **authority ki application pending
hai, grant nahi hui**. Bilkul wohi surat jo Warren ki hai (handoff section 3).
Brokers ke systems (Highway, RMIS) usay isi bina par reject kar denge.

Aur ek sawal jo poochhna hai, ilzam lagaye baghair: legal name **"Clairton Supermarket LLC"** hai.
Clairton Pittsburgh ke paas ka asli qasba hai, is liye ye bilkul jaiz ho sakta hai — bohat se chhote
karobar apni gaariyon ke liye DOT le lete hain, ya purani LLC ko naye kaam ke liye use kar lete hain.
Magar carrier profile isi naam par banegi aur rate con isi naam par aayegi, is liye **confirm karna
zaroori hai** ke wo isi entity ke tor par chalana chahta hai ya koi nayi company bana raha hai.

---

## EMAIL DRAFT — bhejein `anilsubedi160@gmail.com` par

> **Subject:** LoadBoot — following up on your call

Hi Anil,

Thanks for calling us this morning. Following up as promised.

I looked up USDOT 8169975 and it comes back as Clairton Supermarket LLC in Pittsburgh, with the
same phone number you called from — so I'm confident I've got the right record, and I'm writing to
the email FMCSA has on file rather than the one that came through on the call, since our line
garbled it. If a different address is better for you, just tell me and I'll switch.

Three quick things so I can set you up properly:

1. **Is your operating authority granted yet, or still pending?** FMCSA shows the registration
   as active from 7 August, but there's no authority record on the Licensing and Insurance side
   yet. That usually means the application is still working through. If you have the authority
   letter, send it over — brokers ask for it, and having it on file up front saves you being
   turned down later.

2. **Which company name do you want to run under** — Clairton Supermarket LLC, or a separate
   trucking entity? Whatever's on the authority is what goes on the rate confirmation, so it's
   worth getting right before your first load.

3. **Confirm the van**, so we only send you freight it can actually take: Ford Transit 250 low
   roof — can you give me the cargo length, width, door height, and the payload off the door
   sticker? A Transit 250 low roof usually runs around 3,000 to 3,500 lbs payload, which puts you
   in cargo-van and expedited freight rather than box-truck freight. Worth being precise about it,
   because a load that's too heavy is a load you'd have to turn down at the dock.

You can start your account any time at loadboot.com — it takes about two minutes, and you can
upload your insurance certificate and W-9 there. Once the authority is confirmed we can start
looking at East Coast to Midwest runs for you.

Anything you'd rather go over on the phone, just call or text this number.

Best,
[NAME]
LoadBoot Dispatch
dispatch@loadboot.com · WhatsApp (928) 393-6198

---

## Agar text/WhatsApp behtar lage (uska number verified hai, email nahi)

> Hi Anil — LoadBoot here, following up on your call this morning. I've emailed you at
> anilsubedi160@gmail.com (the address FMCSA has on file — our line garbled the one you gave).
> Quick question in the meantime: has your operating authority been granted yet, or is the
> application still pending? Nothing moves until that's confirmed, so it's the first thing to sort.

---

## Bhejne se pehle
- [ ] Email `anilsubedi160@gmail.com` par ja rahi hai, `giro@gmail.com` par **nahi**
- [ ] Koi rate ya load ka waada nahi kiya gaya — authority pending hai
- [ ] Signature mein nayi tagline: **The Operating System for Trucking**
