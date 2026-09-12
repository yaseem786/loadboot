# LoadBoot — Mobile Responsive Audit (12 Sep 2026)

**Scope:** `site/` ki sari 122 marketing HTML pages (built output jo Netlify publish karta hai).
**Method:** Har page headless Chromium (Playwright) mein 4 viewports pe load kiya — 320 (iPhone SE), 360 (Android), 390 (iPhone 14/15), 768 (iPad portrait) — plus header ke liye 881–1366. Har page pe automated checks: viewport meta, horizontal overflow/clipping, tap-target size (min 40–44px), text < 12px, form input font < 16px (iOS zoom), un-wrapped tables, sticky chrome height, nav/menu behaviour, JS errors. Home + key pages visually bhi dekhe.

**Overall verdict:** Base responsive kaam theek hai — har page pe viewport meta hai, 320px tak koi page horizontally scroll nahi karta, inputs 16px hain (iOS zoom nahi hota), koi JS error nahi. Lekin niche 4 **critical**, 6 **high**, aur kuch **medium/low** issues hain jo ek professional reviewer foran pakray ga.

---

## 🔴 CRITICAL (pehle fix karo)

### C1. Tablet-landscape / small-laptop header TOOT jata hai (881px – ~1050px)
Nav breakpoint sirf `max-width:880px` hai. 881–1050px (iPad landscape 1024, chhote laptops, split-screen) pe desktop nav dikhta hai lekin jagah nahi hoti:
- Logo aur "Features" link ke darmiyan gap **0px** (chipke hue).
- "Log in" (75px tall) aur "Get Started" (83px tall) buttons **2 lines mein wrap** ho jate hain.
- "Contact" link **Log in button ke niche chhup** jata hai (screenshot pe overlap confirm).
- 1100px pe bhi gap sirf 7px.

**Fix:** hamburger breakpoint 880 → **1120px** karo (`@media(max-width:880px)` header rules ko `max-width:1120px` pe), ya nav font/padding 881–1120 ke liye chhota karo aur `.nav-actions .btn{white-space:nowrap}`.

### C2. Tables mobile pe CUT ho jati hain (13 pages) — `body{overflow-x:hidden}` galti chhupa raha hai
`body{overflow-x:hidden}` ki wajah se page scroll nahi karta, lekin table ka content screen ke bahar chala jata hai aur user usay **kabhi dekh hi nahi sakta** (e.g. 360px screen pe table 503px wide — 3rd column "Who it belongs to" / rates ka data ghayab).
- `table.eqr-t` — box-truck, conestoga, dry-van, flatbed, hotshot, power-only, reefer, step-deck **-freight-rates.html** (8 pages; per-page 3 tables: Lane/Distance/Carrier gets, Component/Per mile/Who it belongs)
- `table.ind-t` — agriculture, building-materials, food-and-beverage, manufacturing, metals-and-steel, retail-and-ecommerce **-freight-shipping.html** (6 pages; Profile/What it is/Usual equipment)

Note: `table.mr-t` (weekly market reports) already `.mr-scroll` wrapper mein hai — wo theek hai; wahi pattern yahan chahiye.

**Fix (generator mein):** in tables ko `<div class="tbl-scroll">` mein wrap karo:
```css
.tbl-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 -18px;padding:0 18px}
.tbl-scroll table{min-width:520px}
```
Ya 640px se niche table ko card/stack layout mein badal do (`display:block` rows + `td::before{content:attr(data-label)}`).

### C3. `api.html` — `<code>` blocks 586px wide, screen se bahar (URL cut)
`POST https://rwscphuhpjoudvljvmdk.supabase.co/...` lines clip ho rahi hain. Developer page hai — endpoint URL adhoora dikhna unprofessional hai.
**Fix:** `.prose pre,.prose code{white-space:pre-wrap;word-break:break-all;overflow-x:auto;max-width:100%}`

### C4. Hamburger button bahut chhota — 26×29px (sari 121 pages)
Mobile ka sab se important control hai; Apple/Google minimum 44×44 (WCAG 24×24 bhi barely). Motay anguthay se miss hota hai.
**Fix:** `.menu-btn{width:44px;height:44px;display:grid;place-items:center;margin-right:-8px}`

---

## 🟠 HIGH

### H1. Top bar links tap ke liye chhote (sari pages)
- "or we call you →" **21px** tall, "24/7 +1 (469) 253-7575" **30px**. Dono call-to-action hain — phone pe ye sab se zyada tap hone wale links hain.
**Fix:** `.topbar a{display:inline-flex;align-items:center;min-height:40px;padding:0 6px}` aur 520px se niche topbar ko sirf phone number + call-back (ek line, 2 chips) bana do.

### H2. Footer links 24px tall — 40+ links tightly packed (sari pages)
`.links5 a` 24px height, gap 22px. 6 columns → mobile pe 2 columns, ~45 links. Galat link tap hona aasan hai.
**Fix:** `@media(max-width:640px){.links5 a{display:block;padding:8px 0;min-height:40px}}`; aur footer columns ko `<details>` accordions mein daal do (mobile pe 3 screen lamba footer chhota ho jaye ga).

### H3. Home page 34,000px lamba (≈44 phone screens); carriers.html 19,000px
Mobile user ko footer tak pahunchne mein ~45 swipes. Beech mein pura Load Score calculator form, freight rates widget, agent program, FAQ, blog cards sab embedded hain.
**Fix (content decision):** Home pe sections 23 → 10–12 rakho; calculator, market rates, agent program ko ek card + link banao (poora tool apni page pe hai). "Coast to coast" dark section mobile pe ~800px khali dark space + chhota truck hai — mobile pe height 260px max karo.

### H4. Hero CTA overload (home)
Hero mein: Get a Quote + Get Started, phir full-width "Get Started →", "Post freight — broker/shipper", "How it works →" — aur niche sticky bar mein phir Get a Quote + Get Started. Ek screen pe 6 CTAs = decision fatigue.
**Fix:** Hero mein 1 primary + 1 secondary; baqi hatao (sticky bar already duplicate cover karta hai).

### H5. H1 headings 320–360px pe bahut bari / 5–6 lines (28 pages)
Examples: `features.html` 43px, `book-truck-loads` / `load-board` 40.8px, `gps-tracking` / `fleet-management` / `factoring-noa` / `payments-settlements` 40px, create-*-account pages 37.6px × 5 lines, `agents.html` 6 lines. 320px pe ek H1 poori screen kha jata hai.
**Fix:** `@media(max-width:480px){h1{font-size:clamp(26px,7.5vw,32px)!important;line-height:1.15}}` aur lambe H1 copy ko chhota karo (em-dash ke baad wala hissa subtitle mein le jao).

### H6. Text < 12px (49 pages, 86 distinct styles)
- Rates tables `th` **11px** (mr-t, eqr-t) — 8 rates pages + 6 weekly reports
- Accessorial policy pages (`detention/layover/lumper/tonu/fcfs/driver-assist/emergency`) — `.accx-stat span` **10.2px**, `.accx-cmp th` 10.6px, calculator labels 10.9px
- `features.html` — 53 instances (`.ftx-chip` 11.2px)
- `.eqr-c .who` 10.9px, `.mr-kicker` 11.7px, badges 11.8px
Mobile pe minimum body/label 12px, table header 12–13px.
**Fix:** `@media(max-width:640px){th,.accx-stat span,.ftx-chip,.who,.mr-kicker,.eqr-badge{font-size:12px}}` (ya in classes ki base size `.68rem` → `.78rem`).

---

## 🟡 MEDIUM

- **M1. Blog cards 320px pe overflow (`blog.html`)** — `.blogcard` 320px fixed → 18px se shuru ho ke 338px pe khatam (right side 18px cut). Fix: `.bloggrid{grid-template-columns:1fr}.blogcard{width:auto;min-width:0}` under 480px.
- **M2. `how-it-works.html`** — `.hw2-band a` "Start now — pick your role →" 320px pe 358px tak jata hai (right edge se 2px bahar). Fix: `.hw2-band a{max-width:100%;white-space:normal}`.
- **M3. `referral.html`** — `.wrap` ki padding 0 hai; text screen edge se sirf **7px** door. Fix: is page pe `.wrap{padding:0 18px}` restore karo (baqi pages 18px pe hain — consistent).
- **M4. Sticky chrome bahut zyada** — topbar ~40px + header 75px + bottom `.mcta` 76px. iPhone SE (568px) pe sirf ~55% screen content ke liye. Fix: scroll-down pe header hide (`translateY(-100%)`) ya bottom bar ko sirf hero ke baad dikhao, topbar non-sticky rakho (already lagta hai non-sticky — confirm).
- **M5. Mobile menu** — 35 links, 1418px lamba (2× screen); koi "close ✕" button nahi (hamburger hi toggle hai, `aria-expanded` nahi). Menu items min 24px (Features/Solutions headings 24px). Fix: headings ko accordion `<details>` banao, ✕ button + `aria-expanded` add karo, items `min-height:44px`.
- **M6. Breadcrumbs 15–16px tall** (`nav.crumbs a`, `nav.accx-crumbs a`) — blog articles (17) + policy pages (7). Fix: `padding:8px 4px;display:inline-block`.
- **M7. Chip/pill links 38px** — `.mr-hubs a`, `.eqr-other a`, `.ind-other a` (rates/industry hub chips, ~25 pages) — 44px karo (`padding:11px 14px`).
- **M8. "Ask AI" chips 28px tall** (footer, sari pages) — `min-height:40px`.
- **M9. `faq.html`** — `.fq-a a` inline links 18px tall inside answers (18 instances) — `padding:6px 0;display:inline-block`. `.call-strip a` (phone) 24px on create-*-account pages.
- **M10. Home "Built for every kind of carrier" chip row** (Growing Fleets / New-Autho…) horizontally scroll hota hai lekin **cut-off ka koi visual hint nahi** (fade/arrow). Fix: right-side gradient fade ya wrap karo.
- **M11. Hero pill "Carriers · Brokers · Shippers — one platform" 2 lines mein wrap** hota hai (pill ka shape kharab). Fix: 400px se niche text chhota "Carriers · Brokers · Shippers" ya `white-space:nowrap;font-size:.72rem`.

## 🟢 LOW / hygiene

- **L1. 261 `<img>` bina `width/height`** (har page pe 2 — logo/footer logo etc.) → CLS (Core Web Vitals). Generator mein `width`/`height` attributes add karo.
- **L2. `.reveal` animation JS pe depend karti hai** — agar `app.js` late load/fail ho (slow 3G, ad-blocker, old browser) to sections **opacity:0 pe atak jate hain** (blank page). Fix: `<html class="no-js">` + `.no-js .reveal{opacity:1;transform:none}` aur JS mein `document.documentElement.classList.remove('no-js')`; ya `@supports not (selector(:is(a)))` fallback.
- **L3. Breakpoint spread** — 880/820/760/700/640/600/520 sab mix hain (9× 880, 4× 640, 2× 520…). Ek scale rakho: 480 / 768 / 1120.
- **L4. Labels 23px** (form labels — tap target nahi, ignore) — koi action nahi.
- **L5. 404.html** — header/footer nahi (deliberate lagta hai; theek).

---

## Kya THEEK hai (confirm kiya)
- Viewport meta har page pe `width=device-width,initial-scale=1` ✔
- 320/360/390/768 pe **kisi page pe horizontal scroll nahi** ✔ (lekin C2 dekho — overflow hidden se chhupa hua hai)
- Form inputs 16px+ (iOS auto-zoom nahi) ✔
- Side gutters consistent 18px (320/360) ✔ (siwaye referral.html)
- Koi JS/page error nahi ✔
- Sticky bottom CTA ke liye footer padding hai (content chhupta nahi) ✔
- Weekly market-report tables already scroll wrapper mein ✔
- Buttons `.btn` mobile pe full-width + 44px+ ✔

## Suggested order
1. C1 header breakpoint (10 min, sari pages)  2. C2 table wrap (generator, 14 pages)  3. C4 + H1 + H2 + M5–M9 tap targets (ek CSS block)  4. C3 api code  5. H5 H1 sizes  6. H6 small text  7. H3/H4 home length + CTA (content decision — Yaseen)  8. L1/L2.

Sab fixes CSS-only / generator-level hain — carrier app (`app/`) ko touch karne ki zarurat nahi. Feature branch pe karo, `python build_site.py` → localhost:8080 → Ctrl+Shift+M se 320/360/1024 check karo, phir merge.

---

## ✅ APPLIED — 12 Sep 2026 (build_site.py, uncommitted)
`build_site.py` mein additive changes (rollback = `MOBILE_FIX_CSS` block + uses hata do):
1. `MOBILE_FIX_CSS` (RESP_CSS ke baad, styles.css ke end mein append) — C1 header breakpoint 1120, C2 tables self-scroll, C3 code wrap, C4 menu-btn 44×44, H1/H2/M5–M9 tap targets, H5 H1 sizes, H6 12px floor, M1–M4, coast-to-coast height, hero 3rd+ CTA hidden ≤640, `.reveal` no-JS fallback.
2. `toggleMenu()` ab `aria-expanded` + "Close menu" label set karta hai; `.menu-btn` par `aria-expanded="false"` default.
3. `<html class="no-js">` + inline script jo class hataata hai → JS na chale to `.reveal` sections visible rehte hain.

Verified (patched styles.css, 122 pages, Playwright): clipped pages 15→0, cut tables 13→0, tap-target hits 7548→650 (baqi labels/logo — non-issues), <12px text 584→150, 1024px header clean, JS errors 0.

**Nahi kiya (content/generator decisions — Yaseen):** home page length (34K px), `<img width/height>` (L1), breakpoint consolidation (L3).

**Deploy:** feature branch → `python build_site.py` (BUILD OK) → localhost:8080 par 320/360/1024 check → merge main → PWA users SW cache clear.

### SEO check (12 Sep, round 2) — ⚠️ CORRECTED 12 Sep (round 3)

**Is section ka pehla version GALAT tha.** Usme 3 cheezein "ho gayi" likhi thi jo `build_site.py`
mein maujood hi nahi thi. Source se dobara verify kar ke ab wo teenon **sach mein apply** kar di
gayi hain. Neeche jo likha hai wo file se verify-shuda hai.

Rule (waise hi): koi content / URL / heading / canonical / schema change nahi — sirf CSS +
image attributes.

| # | Pehle claim kiya gaya tha | Round 2 ke waqt asli halat | Ab (round 3) |
|---|---|---|---|
| 1 | Hero ke 3rd+ buttons "hide nahi hote, underlined links bante hain" | `MOBILE_FIX_CSS` mein abhi bhi `.hero-btns .btn:nth-child(n+3){display:none}` tha — "How it works →" mobile pe **poori tarah hidden** | `display:none` **hataya** — 3rd+ CTA ab compact underlined text link hai (visible + crawlable). Color chhera nahi (`.hero .btn-ghost` already `#cbd5e1` dark hero pe). |
| 2 | Header logo ko `width="165" height="36" fetchpriority="high"` diya gaya | File mein sirf `height="36"` tha, na `width`, na `fetchpriority`. Footer logo pe bhi `width` nahi. (Yeh L1 hai, jo isi doc ke APPLIED section mein "Nahi kiya" likha hai — doc apne aap se muta'aariz tha.) | **Apply kiya.** Intrinsic size file se nikali: `logo-full.png` / `logo-full-dark.png` dono **2925×640** hain → header `width="165" height="36" fetchpriority="high" decoding="async"`, footer `width="146" height="32"`, blog-card overlay logo `width="69" height="15"`. |
| 3 | Mobile pe section padding 66→48, hero 74→56 (home −517px) | Code mein abhi bhi `section{padding:66px 0}` aur `.hero{padding:74px 0 78px}` tha — koi kami nahi hui thi | **Apply kiya** — `MOBILE_FIX_CSS` mein additive `@media(max-width:640px){section{padding:48px 0}.hero{padding:56px 0 60px}.sec-head{margin-bottom:26px}}`. Content/text/links kuch nahi hataya. |

**Note (3 pe):** jin sections ka padding inline `style="padding:74px 0"` se aata hai (e.g. carrier-network
band, kuch dark CTA bands) un pe ye rule apply nahi hota — inline style CSS ko beat karta hai. Un ko
chhota karna alag (generator) change hai; abhi jaan-boojh ke nahi kiya.

**Jo round 2 mein sach tha (verify shuda):**
- `<meta charset>` — dhyan rahe: `<head>` ka pehla element ab **charset nahi**, `no-js` wala chhota
  inline `<script>` hai, uske baad `<meta charset>`. Dono ~70 bytes ke andar hain (spec ka 1024-byte
  window safe hai, browsers theek parse karte hain), lekin agar bilkul canonical order chahiye to
  script ko charset ke **baad** move karna 1-line change hai (lines 622 / 8501 / 8838).
- `.reveal` no-JS fallback, `aria-expanded`, aur baqi MOBILE_FIX_CSS block sab file mein maujood hain ✔

### ✅ APPLIED — round 3 (12 Sep, build_site.py, uncommitted)
1. `MOBILE_FIX_CSS` → H4 block se `display:none` nikala, uski jagah underlined-link styling.
2. `MOBILE_FIX_CSS` → naya `@media(max-width:640px)` block: `section` 48px, `.hero` 56px, `.sec-head` 26px.
3. Teen `<img>` logo tags ko `width`/`height` (+ header pe `fetchpriority="high"`) diya.

Validate: `python -m py_compile build_site.py` ✔ · `MOBILE_FIX_CSS` tinycss2 se parse — 0 errors,
braces balanced ✔ · minifier (`_mincss`) ke baad bhi `nth-child(n+3)` intact ✔

**Abhi bhi baqi (Yaseen ka content decision):** home page ki asli length (sections 23 → 10–12),
L3 breakpoint consolidation (480/768/1120).

**Deploy (chalana baqi hai — is session mein device shell available nahi tha):**
```
git checkout -b fix/mobile-audit-2026-09-12
python build_site.py                 # "BUILD OK" dekho
python -m http.server 8080 --directory C:\Users\HP\Documents\GitHub\loadboot\site
# localhost:8080 → Ctrl+Shift+M → 320 / 360 / 1024 check
git add build_site.py docs/MOBILE-AUDIT-2026-09-12.md && git commit -m "mobile audit fixes (C1-C4, H1-H6, M1-M10, L1/L2) + SEO-safe hero CTA"
git checkout main && git merge fix/mobile-audit-2026-09-12
# deploy ke baad: PWA users SW cache clear karein
```

**Check karne wali 3 cheezein localhost pe:**
- 360px: hero mein "How it works →" **dikhna chahiye** (underlined link ki tarah), hidden nahi.
- 1024px: header pe hamburger, buttons wrap nahi.
- 360px: rates/industry table apne andar swipe ho — data cut na ho.
