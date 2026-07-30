# Upload runbook — video 1, in YouTube's own order

Everything below is paste-ready. Work top to bottom; do not skip step 0.

---

## Step 0 — push the site first (2 min)

In `C:\Users\HP\Documents\GitHub\loadboot`, one line at a time:

```
git add .
git commit -m "YouTube launch: detention explainer + on-site player with chapters, captions and VideoObject schema; four-audience SEO links; docs/youtube packs; tools/video render pipeline"
git push
```

Wait ~2 minutes for Netlify, then open **https://loadboot.com/detention-pay-policy.html** and confirm you
see the section **"Detention pay that actually gets paid"** with a play button. If it is not there, stop
and fix that before uploading — the video's description points at this page.

---

## Step 1 — files you need on your desktop

| File | Purpose |
|---|---|
| `loadboot-detention-explainer-v3-FINAL.mp4` | the upload itself (1080p, 5:19) |
| `loadboot-detention-thumbnail.jpg` | custom thumbnail |
| `loadboot-detention-FINAL.srt` | captions — upload this, do not rely on auto-captions |

All three were sent to you in chat. If the thumbnail button is greyed out, your channel is not phone-verified:
Studio → Settings → Channel → Feature eligibility → verify. Do that first.

---

## Step 2 — Studio → Create → Upload videos

Drag the MP4 in. While it processes, fill the wizard.

### Screen 1 · Details

**Title** (copy exactly — 51 characters, will not truncate on mobile):

```
Detention Pay: The 5 Rules That Get It Paid
```

**Description** — paste this whole block:

```
Detention costs US trucking $15.1 billion a year, and fewer than half of the detention that actually gets billed is ever paid. Not because drivers didn't wait — because they couldn't prove it.

This is the five-rule system that gets it paid, with the real numbers behind each one.

00:00  Why 17% of truckers never get paid
00:13  $15.1B a year — the real scale
00:43  It isn't only money — the safety cost
01:03  You are not the exception
01:23  The part nobody says out loud
01:48  The five rules
01:57  Rule 1 — get it in writing before you book
02:34  Rule 2 — the clock starts at your on-time arrival
02:57  Rule 3 — notify before free time ends
03:19  Rule 4 — five pieces of evidence
03:35  Rule 5 — invoice immediately, with the load
03:59  What a corporate channel won't tell you
04:33  How LoadBoot builds the five rules into the load
04:59  What it costs

THE EVIDENCE CHECKLIST (screenshot this)
1. GPS-stamped arrive and depart
2. Gate photo with a visible timestamp
3. BOL with in/out times, initialled by the facility
4. The gate ticket or receipt
5. A screenshot of the notice you sent BEFORE free time ended

SOURCES
• American Transportation Research Institute (ATRI) — detention cost, dwell time and speeding findings
• DOT Office of Inspector General — crash-risk increase per 15 minutes of additional dwell
• DAT — share of billed detention that is actually paid
• OOIDA member survey — owner-operator wait times and unpaid detention

WHAT LOADBOOT DOES
Every load posts with the detention terms already in writing — $60/hr after 2 hours free. Your arrival is GPS-stamped at the gate. You get an alert 30 minutes before free time ends, and one tap sends the broker a timestamped notice. The claim then builds itself with the evidence attached and lands on your invoice. 100% of every accessorial passes through to you; LoadBoot takes 5% of the linehaul and nothing else.

WHICHEVER SIDE OF THE LOAD YOU'RE ON
Carriers & owner-operators → https://loadboot.com/carriers.html
Running a new authority → https://loadboot.com/new-authority-dispatch.html
Dispatchers, and what dispatch should cost → https://loadboot.com/how-much-does-a-truck-dispatcher-cost.html
Dispatcher vs freight broker, explained → https://loadboot.com/truck-dispatcher-vs-freight-broker.html
Brokers — cover loads with vetted carriers → https://loadboot.com/brokers.html
Shippers — what dock dwell is costing you → https://loadboot.com/shipper-solutions.html

The full detention standard we hold ourselves to → https://loadboot.com/detention-pay-policy.html
Free verified accounts, flat 5% dispatch, $0 monthly → https://loadboot.com

Next in this series: TONU — getting paid when the load cancels.

This is operational guidance, not legal advice. The rate confirmation for each load is the controlling document.
```

**Thumbnail** → upload `loadboot-detention-thumbnail.jpg`

**Playlists** → skip for now (create them once you have 3+ videos)

**Audience** → **No, it's not made for kids**. Do not set an age restriction.

**Show more** (expand it):
- **Tags** — paste:
  ```
  detention pay, truck detention pay, detention pay trucking, how to get paid detention, detention claim, owner operator, trucking business, new authority, rate confirmation, accessorial pay, truck dispatcher, how much does a truck dispatcher cost, truck dispatcher vs freight broker, truck dispatch service, freight dispatcher, freight broker, load board, TONU, layover pay, lumper fees
  ```
- **Language** → English (United States) · **Caption certification** → None
- **Category** → **Autos & Vehicles**
- **Comments** → Allow all comments, sort by newest first
- **Allow embedding** → **must be ticked.** This is the one that breaks your website player if it is off.

### Screen 2 · Video elements
- **Add subtitles** → upload `loadboot-detention-FINAL.srt` → English (United States)
- End screen / cards → skip (nothing to link to yet)

### Screen 3 · Checks
Wait for copyright checks to pass. The music is synthesised from scratch and the voice is TTS, so
there is nothing to claim — but let it finish.

### Screen 4 · Visibility
**Publish** → Public. Or **Schedule** for a weekday at 9am ET, which is when US drivers are on their
phones at a dock.

---

## Step 3 — immediately after publishing (5 min, do not skip)

**1. Pin this comment** on your own video:

```
The one that costs people the most money is Rule 3 — a message at hour 1:45 is evidence, a message at hour 5 is a complaint. Brokers need a record made WHILE it was happening.

What's the longest you've ever been held at a dock, and did you get paid for it?
```

**2. Set the channel trailer.** Studio → Customisation → Layout → *Video spotlight* → Channel trailer →
this video. It is what every non-subscriber sees first.

**3. Verify embedding is on.** Content → this video → Details → SHOW MORE → confirm **Allow embedding**
is ticked.

---

## Step 4 — wire the ID back into the site (5 min)

Copy the video ID from the URL — in `https://www.youtube.com/watch?v=ABC123xyz` the ID is `ABC123xyz`.

Open `build_site.py`, find `LB_VIDEOS`, and change:

```python
   yt='',
```
to
```python
   yt='ABC123xyz',
```

Then:
```
git add build_site.py
git commit -m "detention explainer: point the on-site player at the YouTube embed"
git push
```

This is what makes the page eligible for Google's video-rich result — the schema gains `embedUrl`, and
the player switches to the privacy-mode YouTube embed. Skipping this step wastes most of the SEO value.

---

## Step 5 — social, same day

From `VIDEO-1-DISTRIBUTION.md`:
- **+2 hrs** Facebook page — the 4:5 cut, video link in the **first comment**, not the caption
- **+4 hrs** LinkedIn — the 4:5 cut, shipper/broker framing (section 3)
- **Day 3** Facebook groups + LinkedIn — the dispatcher post (section 3b)

Then answer every comment for 48 hours. That is the cheapest ranking signal available and it is the one
almost everyone skips.
