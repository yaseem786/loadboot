# LoadBoot dispatch signature — lagane ka tareeqa

## Sab kuch bhara hua hai — bas paste karna hai

| | |
|---|---|
| Logo | `https://loadboot.com/logo-full.png` — wohi jo website ke header par hai (live hai, abhi kaam karta hai) |
| Dispatch | (469) 253-7575 |
| WhatsApp | (928) 393-6198 → `wa.me/19283936198` |
| Email | dispatch@loadboot.com |
| Web | loadboot.com |

**Brand kit v3 ke exact rang:**

| Rang | Hex | Kahan |
|---|---|---|
| Navy | `#10223B` | naam, phone number, "Dispatch Team" |
| Blue | `#0883F7` | left divider bar, loadboot.com link |
| Orange | `#FC5305` | sirf tagline "Keep Your Wheels Earning" |
| Slate | `#64748b` | chhote labels aur footer |

Ye wohi teen rang hain jo BRAND-KIT.md mein "owner-locked source of truth" likhe hain — logo ke pixels se liye gaye. Site ke purane tokens (#0F172A / #2563EB / #F97316) qareeb hain lekin bilkul same nahi; maine asal logo wale use kiye hain taake signature ka text logo ki image ke sath thik match kare.

---

## Kahan paste karna hai

**PrivateEmail / Roundcube (webmail):**
Settings → Identities → apni identity → **HTML signature** ka checkbox ON karo → source/code view (`<>` button) kholo → poori file ka content paste karo → Save.

**Outlook (desktop):** signature editor HTML paste theek se nahi karta. Behtar tareeqa: file ko browser mein kholo → poora signature select karo (Ctrl+A) → copy → Outlook ke signature box mein paste.

**Gmail:** Settings → See all settings → Signature → Create new → browser mein file kholo → select all → copy → Gmail ke box mein paste.

**Apple Mail:** Settings → Signatures → nayi banao → browser se copy kar ke paste karo.

---

## Kyun aise banaya hai

- **Sirf tables aur inline CSS.** Outlook `<div>` layouts aur external stylesheets tor deta hai — ye har client mein theek dikhega.
- **Logo seedha loadboot.com se aata hai** — `logo-full.png`, wohi file jo website ka header use karta hai. Alag copy nahi banayi, warna kal ko logo badla to signature purana reh jata. Agar kisi client ne images block ki hon to `alt="LoadBoot"` text dikh jayega, khali box nahi.
- **Koi shakhs ka naam nahi** — sirf "Dispatch Team", jaisa aap ne kaha. Iska ek amli faida bhi hai: broker kisi ek banday ko nahi, dispatch desk ko jawab deta hai, aur jab team barhegi to signature badalna nahi parega.
- **"Phones answered 7 days"** — brokers ke liye ye sab se qeemti jumla hai. Unka sab se bara dard yehi hai ke carrier phone nahi uthata.
- **"Rate confirmations to dispatch@loadboot.com"** — ye line rate con ko sahi inbox mein lati hai, kisi ke personal email mein nahi.

---

## Plain-text fallback (jahan HTML na chale)

```
LoadBoot — Dispatch Team
Dispatch   (469) 253-7575
WhatsApp   (928) 393-6198
Email      dispatch@loadboot.com
Web        loadboot.com

Keep Your Wheels Earning
Freight dispatch & carrier compliance
Rate confirmations to dispatch@loadboot.com · Phones answered 7 days
```

---

## Inbox ka display name

**`LoadBoot Dispatch`** — bas yehi.

Broker ki inbox mein sirf ye do cheezein nazar aati hain: display name aur subject. Wo aik second mein faisla karta hai ke kholna hai ya nahi.

| Kya | Kyun |
|---|---|
| ✅ **LoadBoot Dispatch** | Company + kaam. Broker ko foran pata chal jata hai ke ye kya email hai. Aur jab wo "dispatch" search karega, hum mil jayenge. |
| ❌ LoadBoot | Bohat aam. Marketing email lagta hai. |
| ❌ Yaseen / Mike | Aap ne khud kaha koi zaati naam nahi. Aur naya naam broker ke liye ajnabi hota hai — company naam zyada bharosa deta hai. |
| ❌ LoadBoot Dispatch Team | Lamba hai; mobile par kat jata hai. |
| ❌ LoadBoot LLC / LoadBoot Inc. | Legal naam email par thanda lagta hai. Wo contract mein chahiye, inbox mein nahi. |
| ❌ Dispatch | Company ka naam hi ghayab. Spam jaisa. |

**Set kahan karna hai:** PrivateEmail → Settings → **Identities** → dispatch@loadboot.com → **Display Name** = `LoadBoot Dispatch` → Save. Aur agar aap Outlook/Gmail se ye account chala rahe hain to wahan bhi wohi naam daalna hoga — warna client apna purana naam bhej dega.

> **Ek cheez zaroor test karna:** email bhejne se pehle apne aap ko ek test bhejo aur dekho ke bhejne wale ka naam `LoadBoot Dispatch` hi aa raha hai. Aksar mail client server ki setting ko nazarandaz kar ke apna naam bhej deta hai — aur pata tab chalta hai jab broker ko ja chuki hoti hai.

---

## Jo maine jaan-boojh kar NAHI daala

- **Munster ka MC/DOT** — signature har email par jata hai, aur LoadBoot carrier nahi hai. Kisi aur carrier ka MC apni signature mein rakhna galat-fehmi paida karta hai aur broker ke liye red flag hai. Carrier ki tafseel email ke matn mein jati hai, signature mein nahi.
- **Social media links** — brokers inhen kabhi click nahi karte, sirf signature bhaari karti hain.
- **"Confidentiality notice"** wali lambi legal footer — koi nahi parhta, aur chhoti company ko bara nahi, ajeeb dikhati hai.
