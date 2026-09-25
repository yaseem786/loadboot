-- bl_lc_0399 — teach the live chat every question it actually failed on
--
-- SOURCE: not a guess. Every visitor message on production that was immediately followed by
-- an escalation ("let me get a real person", "I have already given you that answer once",
-- "our team isn't at the desk"), swept across the whole message history. Grouped into the 17
-- rows below. Each answer is written from what LoadBoot actually does — no invented numbers,
-- and where we genuinely do not publish a figure the answer says so instead of making one up.
--
-- WHY THIS IS THE RIGHT LEVER: lc_brain_dispatch passes the KB to Gemini twice — once as the
-- exact-phrase `fallback` (lc_bot_answer_l2, threshold 2.0) and once as `facts`, which the
-- lc-brain prompt labels "RETRIEVED SNIPPETS FROM OUR OWN KNOWLEDGE BASE (highest authority —
-- prefer these wordings)". So a KB row is not a canned reply competing with the model; it is
-- what the model is told to answer FROM. A missing row is why "what about the factory fee?"
-- came back as a 5%-pricing answer: nothing matched, so the model had nothing to anchor on.
--
-- PRIORITY: lc_bot_answer_l2 orders by score, then `priority DESC` — a HIGHER number wins a
-- tie. Existing rows top out at 105, so these are 106+ and take precedence where they overlap.
--
-- Idempotent: keyed on the first pattern of each row, so re-running changes nothing.

insert into app_private.lc_kb (patterns, answer, priority, lang)
select v.patterns, v.answer, v.priority, 'en'
from (values

-- 1. How to apply as a dispatcher (7 separate visitors asked this and got escalated)
(array['apply as a dispatcher','apply for dispatching job','apply for dispatcher','dispatcher job','are you hiring dispatchers','do you employ dispatchers','salary based dispatcher role','salaried dispatcher role','want to work as a dispatcher','looking for a dispatcher job','how do i apply for a job','apply for a job'],
'Yes — we hire dispatchers, and remote is normal for us. 🧑‍✈️

To apply: send your CV to <b>hello@loadboot.com</b> with <b>"Dispatcher application"</b> in the subject line. Open roles are at https://loadboot.com/careers.html

In the same email, tell us three things — these decide the shortlist far more than the CV does:
<b>1.</b> How you find and book loads today. A load board counts — yours, an employer''s or a carrier''s, it does not have to be in your name. So do Facebook and WhatsApp freight groups, brokers you already deal with, direct shippers, and broker email blasts.
<b>2.</b> Where exactly — the board, group or brokers, and your login or handle there.
<b>3.</b> Two loads you sourced and booked yourself: lane, broker, month, rate.

If you have never sourced and booked a load yourself, say so straight — it saves us both the time.', 118),

-- 2. How long after applying (asked 3 different ways, all escalated)
(array['how long after i apply','when do i get a response','response after application','screening process','how long is the screening','when will i hear back','applied yesterday','application response','next step after applying','how long does it take to hear back'],
'We review applications ourselves and reply with an approval or a rejection <b>within 1–3 days</b> of receiving them. 📩

If it has been longer than that, reply here or to hello@loadboot.com with the email address you applied from and we will find it.

We will not promise you an exact date or a fixed interview slot — we do not run it that way, and we would rather tell you that than invent a timeline.', 117),

-- 3. Rejected, now has what was missing (a real carrier-side case, 22 Sep)
(array['apply again','can i reapply','how to apply again','was not selected','i was rejected','i got rejected','turned down','now i have a subscription','now i have a load board'],
'Yes — you can reapply, and there is no penalty for having been turned down once. 🤝

One thing worth correcting, because it is the most common reason: we are not really asking whether you own a DAT or Truckstop login. We are asking <b>how you find and book loads yourself</b>. A board in your own name counts. An employer''s or a carrier''s login counts, as long as you can log in today and book. So do Facebook and WhatsApp freight groups, brokers you already deal with, direct shippers, and broker email blasts.

The only answer that does not work is never having sourced and booked a load yourself.

Reapply by emailing <b>hello@loadboot.com</b>, subject <b>"Dispatcher application"</b>, and include what changed since last time plus two loads you sourced and booked yourself (lane, broker, month, rate).', 119),

-- 4. No experience / course not finished
(array['i have no experience','no experience','still learning','took a dispatch course','dispatch course','i am a fresher','beginner dispatcher','just finished a course'],
'Straight answer, because it saves you time. 🙏

For our salaried dispatcher roles we need someone who has already <b>sourced and booked real loads</b> — not necessarily on their own board, and not necessarily for a big fleet, but actually done it. A course on its own is not enough for us, and I would rather say that than string you along.

Two honest routes if that is where you are:
• Get a few real loads under your belt — even one carrier, even through a broker you know or a freight group — then come back to us with the details.
• Or join as a <b>Referral Partner</b> now and earn 1% of every delivered load you bring in: https://loadboot.com/create-agent-account.html

Either way, hello@loadboot.com reaches us.', 116),

-- 5. When is a human actually at the desk
(array['when is mike available','what time is mike available','what time are you available','when are you online','what are your office hours','working hours','when does your team work','what time do you open'],
'Our team works <b>US business hours, Central Time</b>, and the chat is watched during that window. ⏰

Outside it the chat still reaches us — everything you type here is saved word for word and emailed to the team, and we reply here and at your email address.

If it is urgent, the fastest route is the phone line on https://loadboot.com/contact.html — that is answered 24/7. I will not promise you a person is sitting here right now if they are not.', 115),

-- 6. Loads outside the US (a broker asked for London and got nothing)
(array['load for london','load to london','international load','international freight','load to canada','load to mexico','overseas load','outside usa','outside the us','do you ship internationally','load for uk','europe load'],
'Honest answer: <b>LoadBoot is domestic US freight only.</b> 🇺🇸

We do not cover international or overseas freight, so if you need something moved to or from another country, we are not the right people and I will not pretend otherwise.

Two things worth checking though:
• Many US cities share a name with a foreign one — London KY, London OH, Ontario CA. If that is what you meant, tell me the pickup city and state and we can absolutely help.
• Cross-border Canada and Mexico freight is not something we run today either.

Posting loads on LoadBoot is free and there is no monthly fee: https://loadboot.com/create-broker-account.html', 114),

-- 7. Local / regional / OTR
(array['local and regional routes','do you dispatch local','regional routes','local loads','short haul','do you do regional','otr or local','long haul or local'],
'Yes — all three. 🚚 We dispatch <b>OTR, regional and local</b>, and you tell us which one you want rather than us assigning it.

You set it on your carrier profile (haul type + the states you run), and the load matching respects it — we will not push you a 1,400-mile run when you asked to stay inside a 250-mile box.

More detail: https://loadboot.com/us-truck-dispatcher.html', 113),

-- 8. How fast will my posted load get covered
(array['how long to find a driver','how fast will my load be covered','when will someone take my load','how quickly do you cover loads','how long until a carrier takes it','how fast do you cover a load'],
'I am not going to quote you a coverage time I cannot stand behind — it depends on the lane, the rate and the equipment. ⏱

What I can tell you is what happens the moment you post:
• It goes to verified carriers only — authority and insurance are checked before anyone can book.
• You see who booked it, and GPS tracking with geofenced timestamps runs for the whole trip.
• No ghost trucks and no re-posting your load to fish for rates.

Post one free and watch it live: https://loadboot.com/create-broker-account.html', 112),

-- 9. Can I get a load tomorrow / right away
(array['can i get a load tomorrow','get a load tomorrow','loads right away','how soon can i start hauling','when will i get my first load','can i start today','how fast can i get a load'],
'Depends on two things, and I would rather be straight with you than sell you a date. 🚚

<b>1. Your file.</b> Nothing moves until MC/DOT authority, insurance and your W-9 are verified — usually about a day once the documents are in.
<b>2. How old your authority is.</b> This is the one nobody tells new carriers: a lot of brokers and their insurers will not touch an authority younger than <b>180 days</b>. It is not our rule and we cannot waive it, but it is real, and it is why a brand-new MC can sit quiet at first.

If your authority is seasoned and your documents are clean, we can work with you quickly. If it is new, we will tell you exactly where you stand instead of letting you wait and wonder.', 111),

-- 10. MC number has 8 digits (a real carrier hit this on the form)
(array['mc number is 8 digits','my mc number has 8 numbers','8 digit mc','mc number is longer','mc number not accepted','mc number invalid','my mc has more numbers','mc number too long'],
'You are right and the form is wrong to argue with you. 📋

Newer FMCSA docket numbers <b>are</b> longer than the classic 6–7 digits — 8-digit MC numbers are real and belong to recently issued authorities. Enter your number exactly as it appears on your authority letter, with no MC prefix and no spaces.

If the form still refuses it, do not retype it into something shorter — send a photo of your authority letter to <b>hello@loadboot.com</b> and we will verify you by hand against FMCSA and get your file moving. Flagging the validation so it stops happening.', 120),

-- 11. Signed up already — what now
(array['i have created my profile','i signed up already','i made an account','i registered','what happens next','i created my account','already made a profile'],
'Good — the account is the easy half. ✅ Here is what actually stands between you and loads:

<b>1. Documents.</b> MC/DOT authority, a COI naming LoadBoot as certificate holder, and your W-9. Upload them on the Documents page in your portal.
<b>2. Verification.</b> We check them against FMCSA — usually about a day. You will see each document go approved or rejected <b>with the reason</b>, so nothing is a black box.
<b>3. Your preferences.</b> Equipment, truck count, haul type and where the truck sits. This is what the matching actually reads — a thin profile means thin loads.

Carrier portal: https://loadboot.com/app/carrier/ — and if you are signed in here, ask me "where do I stand" and I will read your real file back to you.', 110),

-- 12. Where are the portals / login
(array['where is the portal','cant find the portal','where do i log in','where is the login','how do i log in','where are the portals','find the portal'],
'All of it hangs off one page: <b>https://loadboot.com/login.html</b> 🔑

Direct doors if you know which one you are:
• Carrier portal — https://loadboot.com/app/carrier/
• Broker / shipper portal — https://loadboot.com/app/partner/
• Referral Partner (agent) portal — https://loadboot.com/app/agent/

On a phone you can install LoadBoot to your home screen from the browser menu, or get the Android app: https://play.google.com/store/apps/details?id=com.loadboot.app', 109),

-- 13. The three numbers people mix up: 5% vs 1% vs dispatcher pay
(array['is it only 5','only 5 percent','my salary will be 2','what is the 1 percent','difference between 5 and 1 percent','how much do you take','what percent do you take','what is your cut','how much commission'],
'Three different numbers get mixed up here, so let me separate them properly. 🧾

<b>5% — what a carrier pays.</b> Flat dispatch fee, charged only after a load is delivered <b>and</b> you have been paid. No monthly fee, no contract. The broker pays you (or your factoring company) directly, bank to bank — we never hold your money, and we invoice our 5% separately afterwards.

<b>1% — what a Referral Partner earns.</b> Paid out of our fee, not added on top. Your people never pay a cent extra: https://loadboot.com/create-agent-account.html

<b>A salaried dispatcher</b> is an employed role with a wage, not a percentage. Details are on https://loadboot.com/careers.html and we will not quote you a figure in chat that we cannot stand behind.

Brokers and shippers post loads completely free. Full pricing: https://loadboot.com/pricing.html', 108),

-- 14. What does the platform actually do (asked twice, escalated twice)
(array['what does your platform have','what features do you have','what do you offer','what can your platform do','what does loadboot do','what is loadboot','tell me about your platform'],
'In four lines, no pitch. 🧩

<b>Carriers</b> get a real dispatch service — we find and negotiate loads, handle broker setup and paperwork, and charge a flat 5% only on loads delivered and paid.
<b>Brokers and shippers</b> post free, to verified carriers only — authority and insurance checked before anyone books.
<b>Everyone</b> gets live GPS with geofenced timestamps, clean documents end to end (BOL → POD), and detention, TONU, layover and lumper handled by written policy rather than by argument.
<b>Referral Partners</b> earn 1% of every delivered load they bring in, paid from our fee.

Full tour: https://loadboot.com/features.html', 107),

-- 15. I already emailed / sent my CV
(array['i sent an email','i already emailed you','i emailed you','sent my cv','sent my resume','i sent my application','already sent it'],
'Thanks — it will be in <b>hello@loadboot.com</b> and a real person reads that inbox. 📬

So you are not waiting blind:
• Applications get an approval or a rejection <b>within 1–3 days</b>.
• Carrier and broker questions are answered the same working day in US business hours.

If it has been longer, tell me the email address you sent it from and roughly when, and I will make sure it is found rather than asking you to send it again.', 106),

-- 16. Carrier wants a dispatcher, authority already active
(array['need a dispatcher','i need dispatching','looking for a dispatcher','dispatch my truck','my mc and insurance are active','i need someone to find me loads','find loads for my truck'],
'That is exactly what we do. 🚚 If your MC and insurance are already active you are ahead of most people who walk in here.

The fast lane:
<b>1.</b> Free carrier account — https://loadboot.com/create-carrier-account.html
<b>2.</b> Upload authority, COI (LoadBoot as certificate holder) and W-9 — verification is about a day.
<b>3.</b> Tell us equipment, truck count, haul type (OTR / regional / local) and where the truck sits.

Then a dedicated dispatcher works your truck: loads found and negotiated, booked <b>under your own authority</b>, flat 5% only once the load is delivered and you have been paid.

One honest caveat: brokers commonly avoid authorities younger than 180 days. If yours is new we will tell you straight rather than let you sit waiting.', 121),

-- 17. How big is the network (never invent a number)
(array['how many carriers do you have','how many carriers are active','how many trucks do you have','how big is your network','how many active carriers','network size'],
'I am not going to quote you a carrier count — we do not publish live network numbers, and a figure I cannot stand behind is worth nothing to you. 🙏

What I can stand behind is what every carrier on it has passed: FMCSA authority checked, insurance checked with LoadBoot named on the certificate, W-9 on file, and re-checked afterwards rather than once at signup. Loads are real, tracked by GPS with geofenced timestamps, and never re-posted to fish for rates.

If you are sizing us up before committing, ask for a person — hello@loadboot.com — and you will get a straight conversation instead of a marketing number.', 105)

) as v(patterns, answer, priority)
where not exists (select 1 from app_private.lc_kb k where k.patterns @> array[v.patterns[1]] and k.lang='en');

-- Typo / phrasing variants the live transcripts actually contained. People do not type
-- clean English into a chat box: "londan", "mile" for Mike, "i send an email" for "sent".
-- Tested with lc_bot_answer_l2 at the real 2.0 exact threshold, not by eye.
update app_private.lc_kb set patterns = patterns || array['i send an email','i send you an email','send my cv','send you my cv','i send my cv']
 where patterns @> array['i sent an email'] and lang='en' and not (patterns @> array['i send an email']);

update app_private.lc_kb set patterns = patterns || array['load for londan','londan','load for london uk','load to england']
 where patterns @> array['load for london'] and lang='en' and not (patterns @> array['load for londan']);

update app_private.lc_kb set patterns = patterns || array['what time mile is available','when is mile available','what time mike']
 where patterns @> array['when is mike available'] and lang='en' and not (patterns @> array['what time mile is available']);

update app_private.lc_kb set patterns = patterns || array['get the all portals','cant find where is located','where is it located on the website','all portals']
 where patterns @> array['where is the portal'] and lang='en' and not (patterns @> array['all portals']);
