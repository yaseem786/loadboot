# Kya hua, aur ab kya karna hai

## Jo hua

Aap ne dono baar patch **file** repo mein commit ki, patch **apply** nahi ki.

`789c18e "privacy policy"` mein sirf ye do files hain:
```
Claude outputs/privacy-flagship-and-doc-trust.patch
Claude outputs/privacy-page-PREVIEW.html
```

Ek `.patch` file code badalne ki *hidayaat* hoti hai — recipe, khana nahi. Usay repo mein
rakhne se code waisa hi rehta hai, is liye site bhi waisi hi rahi. Ye aap ki ghalti nahi,
meri thi: maine patch diya jab aap GitHub web se kaam kar rahe hain.

Kuch kharab nahi hua. Database wale saare fixes pehle se live hain.

## Ab kya karein — patch nahi, seedhi files

`loadboot-UPLOAD-THESE-FILES.zip` mein **14 files** hain, bilkul usi folder structure mein
jo repo mein hai. Bas inhein repo par chadha dena hai.

### GitHub web se (sab se aasan)

1. `loadboot-UPLOAD-THESE-FILES.zip` ko computer par **extract** karein
2. GitHub par apna repo kholein → **Add file → Upload files**
3. Extract ki hui folder ke **andar** jayein, aur **saara content** (build_site.py,
   privacy_module.py, terms_module.py, `app` folder, `migrations` folder) select kar ke
   upload box mein **drag** kar dein — poori folder nahi, uska andar ka saaman
4. Neeche commit message likhein, phir **Commit changes**
5. Merge / push jaise hamesha karte hain

GitHub jo files pehle se maujood hain unhein khud replace kar dega, aur nayi add kar dega.

### Ya, agar computer par repo folder khula ho

Extract ki hui files ko seedha `C:\Users\HP\Documents\GitHub\loadboot` mein paste kar dein
aur "replace" par haan kar dein. Phir normal commit + push.

## Maine khud test kiya

GitHub ke live `origin/main` ka saaf copy nikala, ye 14 files us par rakhi, aur build chalaya:

- `python3 build_site.py` → **kaamyab**, poori 126 pages bani
- privacy.html aur terms.html dono FAQ schema ke sath bane
- saari JS files `node --check` pass
- baqi pages (index, brokers, otr-dispatch) waise ke waise

## Ye 14 files kya hain

**Nayi (3)** — `privacy_module.py`, `terms_module.py`, `app/shared/ui/docTrust.js`

**Badli hui (7)** — `build_site.py` (dono naye pages wire karta hai), `app/carrier/app.js` +
`app/partner/app.js` (document trust badges), `app/shared/api.js` +
`app/command-center/views/audiences.js` + `command-center.css` + `cc-dark.css`
(campaign manager ke fixes — 22007 wala error aur chip ka invisible button)

**Migrations (4)** — record ke liye. Ye prod par pehle se lag chuki hain, dobara chalane ki
zaroorat nahi.

## Aur ye kar lein — repo saaf ho jayega

Ye files ab bekaar hain, hata dein:
```
Claude outputs/cc-campaign-fixes-frontend.patch
Claude outputs/privacy-flagship-and-doc-trust.patch
Claude outputs/privacy-page-PREVIEW.html
Claude outputs/EMAIL-PREVIEW-as-carriers-will-see-it.html
```
Aur repo root par ek purani `privacy.html` para hai (2024 wali). Wo serve nahi hoti —
`netlify.toml` sirf `site/` publish karta hai — magar confusing hai, hata dena behtar hai.

## Deploy ke baad ye teen cheezein check karein

1. `loadboot.com/privacy.html` — hero par "LoadBoot Privacy Policy" likha ho, tab ka title
   "Privacy Policy & Data Practices"
2. `loadboot.com/terms.html` — 19 numbered clauses, har ek ke sath hara "In plain English" note
3. Carrier portal → Documents → dropdown se "Bank verification" chunein → hara padlock badge
   aana chahiye jo kehta hai ke dispatcher ise kabhi nahi khol sakta
