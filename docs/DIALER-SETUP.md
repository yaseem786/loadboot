# LoadBoot Dispatcher Dialer — setup & go-live (bl_dial_0351)

Status 19 Sep 2026: code + STAGING database + STAGING edge functions ready. Telnyx-side wiring and secrets
are the owner's steps below. PRODUCTION is untouched until the staging test call passes.

## Kya bana hai
- **Dispatcher portal**: floating phone dock (dark premium). Keypad + paste, live broker match, click-to-call
  (har `tel:` link), incoming call screen, mute / hold / DTMF, live call notes, after-call outcome + note +
  callback reminder + "save to broker book", Recent (search, redial, recording play), Callbacks (missed /
  voicemail / scheduled). Mobile = bottom sheet. Ek browser mein sirf ek tab phone register karta hai.
- **Command Center → Team → Phones & live calls** (`#/phones`): live wallboard (kaun, kis se, kitni der),
  har dispatcher ka number + online state + aaj ka scorecard, call log with filters + recordings, Phone settings.
- **Server**: `dialer_*` RPCs, `cc_dialer_*` staff RPCs, `dialer_hook_event` (webhook brain), toll-fraud guard
  (premium + Caribbean block, international off), hourly call cap, stale-call sweep, full audit.
- **Edge functions**: `telnyx-token` (WebRTC login token), `telnyx-hook` (Ed25519-verified webhooks),
  `telnyx-recording` (recording proxy — browser ko Telnyx URL/key kabhi nahi milti).
- **Site headers**: `microphone=(self)` + CSP `wss://rtc.telnyx.com` (build_site.py).

- **Carrier + driver calls (bl_dial_0351a)**: assigned carrier ka owner number aur us ke drivers bhi click-to-call hain (Trucks tab, availability, trip panel). Inbound par bhi naam dikhta hai ("Dan · driver, <carrier>"). Har call row mein `contact_kind` = broker / carrier / driver aur `carrier_org_id`. Sirf ACTIVE assignment wale carriers match hote hain.
- **Preview**: `previews/dialer-preview.html`.
- **Git**: Claude ke VM se git commit nahi hota (lock file delete nahi kar sakta) — commit/push owner GitHub Desktop se kare.

## Mobile / background gaps (bl_dial_0351b)
Browser softphone ki fitri limit: phone lock ya tab background mein ho to browser ring nahi karta. Is ke 4 ilaaj lage hain:
1. **Forward to mobile** — CC → Phones → Assign/Change number → "Forward unanswered calls to the dispatcher's mobile".
   Order: browser (agar online) → dispatcher ka mobile (lock screen par bhi ring) → Riley / voicemail. Forwarded call bhi
   log + record hoti hai; miss ho to callback task banta hai. Non-US number = Telnyx international rate + outbound voice
   profile mein us country ko allow karna zaroori (rate Telnyx pricing page se confirm karein — yahan likha nahi).
2. **Push alerts** — dock → settings → "Turn on call alerts on this device". Incoming aur missed call par notification
   (existing VAPID secrets + cc_push_targets; `telnyx-hook` v2 bhejta hai). iOS App Store shell (APNs) abhi is raste se nahi.
2b. **Wait for the portal (bl_dial_0351c)** — portal band + forward number NAHI: caller ko 35 sec tak ring sunai deti rehti hai, push jata
   hai; dispatcher notification par tap kare → portal khule → phone register hote hi (`telnyx-token {claim:true}`) wahi call us ke browser
   mein ring karti hai (20 sec). 35 sec mein koi na aaye → Riley / voicemail + callback task. Forward number set ho to ye wait nahi hota (mobile foran ring).
3. **Wake lock** — call ke dauran mobile screen sone nahi deta (warna audio kat jata hai).
4. **Auto-reconnect** — tab wapas saamne aate hi phone dobara register + data refresh.
- iOS build: `tools/ios/scripts/apply-ios-config.sh` mein `NSMicrophoneUsageDescription` add (is ke baghair iOS app mein mic nahi khulta).
- Jo ab bhi mumkin NAHI: browser/PWA ke andar lock-screen par full-screen "native call" ring. Us ke liye native app + CallKit/ConnectionService chahiye (alag project). Forward-to-mobile isi ka practical hal hai.

- **Unanswered chain (bl_dial_0351d)**: browser 25s → dispatcher mobile 25s (agar forward number set) → Riley 20s (agar fallback number set) → voicemail (greeting → beep → 120s) → Callbacks tab. Riley uthaye to call `forwarded` mark hoti hai. Voicemail dispatcher ko dock → Callbacks tab mein Play button ke saath milta hai.
- **Dispatcher apna forward number khud set karta hai (bl_dial_0351e)**: dock → settings → "Ring my mobile". Sirf US/Canada (+1) — international rate ka masla nahi. Khali = off → chain mobile step foran skip karti hai (koi wait nahi).

## Call flow
- **Outbound**: dock → `dialer_call_start` (row + checks) → Telnyx WebRTC call, caller ID = dispatcher ka number,
  `client_state` = call id → webhooks `call.initiated / answered / hangup` row update karte hain → recording start.
  Browser bhi state mirror karta hai, to webhook late ho tab bhi record sach rehta hai.
- **Inbound**: broker dispatcher ke number par call kare → Voice-API app webhook → row banti hai + broker match →
  `transfer` to `sip:<dispatcher credential>@sip.telnyx.com` → browser ring. Answer na ho / offline →
  fallback number (Riley) ya voicemail (greeting → beep → 120s) → dispatcher ke liye callback task.

## Owner steps — Telnyx portal (ek dafa)
1. **API key**: Account → API Keys → Create. Sirf Supabase secret mein paste karein (step 5). Chat mein nahi.
2. **Public key**: Account → API Keys → Public Key copy karein (webhook signature verify).
3. **Outbound Voice Profile**: Voice → Outbound Voice Profiles → Create "LoadBoot Dispatch". Allowed destinations:
   sirf **US + Canada**. Daily spend limit lagayein (e.g. $20) — toll-fraud ka doosra taala.
4. **WebRTC credential connection**: Voice → SIP Connections → Create → type **Credentials**, name "LoadBoot WebRTC".
   - Outbound voice profile = "LoadBoot Dispatch"
   - Webhook URL = `https://<project>.supabase.co/functions/v1/telnyx-hook` (API v2)
   - Is connection ki **id** copy karein → CC → Phone settings → "Telnyx WebRTC connection id".
5. **Voice-API application** (inbound numbers ke liye): Voice → Programmable Voice → Create app "LoadBoot Inbound".
   - Webhook URL = wahi `…/functions/v1/telnyx-hook`, API v2, outbound profile = "LoadBoot Dispatch".
6. **Numbers**: Numbers → Buy → US local (e.g. Dallas 469). Har number ko **"LoadBoot Inbound" app** par assign karein
   (connection/app field). Phir CC → Phones → dispatcher → "Assign number".
7. Har number ke liye CNAM / caller-ID name "LOADBOOT" set karein (Numbers → number → Caller ID), warna spam label ka chance.

## Owner steps — Supabase (staging pehle, phir production)
Project → Edge Functions → Secrets:
- `TELNYX_API_KEY` = step 1
- `TELNYX_PUBLIC_KEY` = step 2 (base64 string)
Production par: migrations `bl_dial_0351` → `0351a` → `0351b` → `0351c` → `0351d` → `0351e` → `0351f` → `0351g` (isi order mein) apply + teenon functions deploy (`telnyx-hook` verify_jwt = **false**, baqi true).

## Staging test (go-live se pehle)
1. CC (staging) → Phones → settings: connection id daalein, dialer ON, number assign.
2. Dispatcher login → dock "Ready" dikhe → apne mobile par call → mute/hold/DTMF → end → outcome save.
3. Mobile se dispatcher ke number par call → browser ring → answer. Dobara call, answer na karein → voicemail → Callbacks tab.
4. CC wallboard par dono calls live dikhni chahiye; call log mein recording Play.
5. `select event_type, verified, result from app_private.dialer_webhook_log order by at desc limit 20;`

## Abhi tak live-test NAHI hua (sach)
Telnyx ke saath end-to-end call kisi ne abhi nahi ki — keys ke baghair mumkin nahi. Database flow staging par
rollback-test se pass hai (outbound, inbound→transfer, no-answer→voicemail→callback, duplicate webhook, blocked numbers).
Pehli real call par yeh 3 cheezein confirm karni hain: (a) credential-connection webhooks `client_state` wapas bhejte hain,
(b) `record_start` WebRTC leg par chalta hai, (c) `sip:<gencred…>@sip.telnyx.com` transfer browser ko ring karta hai.
Jo na chale uska fix `dialer_hook_event` / `telnyx-hook` mein chhota hoga — UI aur tables nahi badlenge.

## Legal
Recording: kuch US states all-party consent maangti hain. Default = beep ON. Lawyer se confirm karein; main lawyer nahi hoon.
