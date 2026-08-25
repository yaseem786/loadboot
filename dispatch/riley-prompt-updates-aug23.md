# Riley — teen prompt edits (23 Aug 2026)

Main ye khud paste nahi kar saka: Retell ka Agent Handbook editor (ProseMirror) browser automation se text accept nahi karta, aur us tab par screenshots bhi CDP error de rahe the. **Maine confirm kiya ke koi tabdeeli nahi hui — prompt bilkul waisa hi hai jaisa tha, kuch saaf karne ki zarurat nahi.**

Neeche teen edits hain. Har ek ke sath ye likha hai ke kahan jana hai aur Publish karna hai ya nahi.

⚠️ **Sab se ahem farq yaad rakho:**
- **Riley Broker Outbound** → "Latest **Published**" par bandha hai. Edit ke baad **Publish dabana ZAROORI hai**, warna kuch nahi badlega.
- **Riley Inbound** → "Latest **Created**" par bandha hai. Draft hi live hai. **Save karte hi foran live ho jata hai, Publish ki zarurat nahi.**

---

## EDIT 1 — Riley Broker Outbound: do carriers + Warren ka loading sawaal + voicemail

**Kyun:** Outbound prompt mein sirf Munster ka flatbed likha hai. Ab Warren bhi live hai. Agar Riley Warren ke load par call kar de to wo broker ko ghalat truck describe karegi — 30 ft flatbed, 9,000 lbs — jo bilkul ulta hai. Aur voicemail ka koi block hai hi nahi, is liye machine par wo bhatakti hai.

**Kahan:** Retell → Riley Broker Outbound → Agent Handbook → **poore text ke bilkul AAKHIR mein** (aakhri line "Keep the call short, warm and professional…" ke baad) ye chipka do:

```
TWO CARRIERS - THIS SECTION OVERRIDES THE OPENING PARAGRAPH
We dispatch for two carriers now. The BRIEFING tells you which one this call is for. If the briefing does not name a carrier, it is Munster and everything above applies unchanged.

If the briefing names WARREN or Warren's Courier Agency, ignore every Munster truck detail above and use these instead:
- Warren's Courier Agency, MC 99849375, USDOT 5677034, based in Hinesville, Georgia.
- Sixteen foot box truck. Cargo space is 192 by 83 by 72 inches, no wheel wells, so the full 83 inches of width is usable.
- Max payload 4,200 pounds. Anything heavier we cannot take.
- The truck is NOT dock height and has NO liftgate. The deck sits at 37 inches.
- A pallet jack rides in the box.
- One million auto liability, one hundred thousand cargo. Certificate of insurance available on request.
- Home base Hinesville, Georgia. Will run as far as Texas when a backhaul pairs.

WARREN'S LOADING QUESTION - ASK IT EVERY TIME, EARLY
On any Warren load, before you get anywhere near rate, find out how the freight gets on and off. Ask it plainly: "How is it loaded and unloaded on each end?"
We can only take it if it is one of these three: a forklift on both ends, floor loaded or hand loaded freight, or a dock where they confirm an adjustable leveler that reaches down to thirty seven inches.
If they say liftgate required, residential, final mile, inside delivery, ground level, or a fixed height dock, tell them right then that our truck is not dock height and has no liftgate so it will not work, and ask what else they have moving out of that area.
Do not save this question for the end of the call. A load we cannot load is not a load.

VOICEMAIL
If you reach a voicemail, an answering machine, or any recorded greeting, do not try to have a conversation with it. Wait for the beep, leave one short message, and hang up.
Say this, using the carrier name and the pickup city from the briefing:
"Hi, this is Riley calling for [carrier name] about the load you have posted out of [pickup city]. We have a truck in that area and we are interested. Please call me back at four six nine, two five three, seven five seven five. That is four six nine, two five three, seven five seven five. Thank you."
Say the callback number twice, slowly, one digit at a time.
Do not leave a rate, an MC number, or any load negotiation on a voicemail. Do not leave a second message on a number where you have already left one.
```

**Phir upar right corner mein `Publish` dabao.** Publish ke baghair ye bilkul kaam nahi karega.

---

## EDIT 2 — Riley Inbound: Warren ko capacity block mein daalo

**Kyun:** Inbound ka `CURRENT CAPACITY - KNOW THIS COLD` block sirf Munster ka truck janta hai. Agar koi broker Warren ke box truck ke bare mein call kare to Riley ke paas jawab hi nahi.

**Kahan:** Retell → Riley Inbound → Agent Handbook → `CURRENT CAPACITY - KNOW THIS COLD` block ke bilkul neeche (aur `IF A BROKER CALLS BACK ABOUT A LOAD` se pehle) ye daal do:

```
SECOND TRUCK - WARREN'S COURIER AGENCY
We now have a second carrier on the books. If a caller asks about a box truck, a straight truck, a sprinter, small freight, or anything under about four thousand pounds, this is the one to offer:
- Warren's Courier Agency, MC 99849375, USDOT 5677034, out of Hinesville, Georgia.
- Sixteen foot box truck. Cargo space 192 by 83 by 72 inches, no wheel wells, so the full 83 inches of width is usable.
- Max payload four thousand two hundred pounds. That is a hard limit, exactly like Munster's nine thousand. Do not stretch it for anyone.
- NOT dock height and NO liftgate. The deck sits at thirty seven inches. There is a pallet jack in the box.
- Rate floor two dollars ten cents a mile. Will run up to a thousand miles when a backhaul pairs.

If a caller offers freight for this truck, you must ask how it is loaded and unloaded on each end before anything else. We can only take a forklift on both ends, floor loaded or hand loaded freight, or a dock with a confirmed adjustable leveler that reaches thirty seven inches. If they say liftgate, residential, final mile, inside delivery, ground level, or a fixed height dock, tell them plainly that this truck is not dock height and has no liftgate, so that particular load will not work, then ask what else they have.

Two trucks, two very different limits. Munster is the thirty foot flatbed at nine thousand pounds. Warren is the sixteen foot box at four thousand two hundred pounds. Never mix up their numbers. If you are not certain which truck a caller means, ask.
```

**Inbound par Publish mat dhoondo — save karte hi ye live ho jata hai.**

---

## EDIT 3 — Riley Inbound: teen sawaal ek saath poochhne wala masla

**Kyun:** Ye meri apni ghalti thi. 22 Aug ko maine block mein likha tha *"ask three things"* — us lafz ne Riley ko list banane par ukssaya, aur live test mein usne teenon sawaal ek hi saans mein daag diye. Prompt ka apna style "one thought per sentence" hai, ye us ke khilaf jata hai.

**Kahan:** Riley Inbound ke prompt mein `IF A BROKER CALLS BACK ABOUT A LOAD` block ke andar. Wo jagah dhoondo jahan "three things" ya "ask three" likha hai, aur us jumle ko is se badal do:

```
Ask ONE question, wait for their answer, then ask the next. Never stack them.
First: is the load still available. Wait for the answer.
Then: what can they pay on it. Wait for the answer.
Then: what do they need from us to get set up in their system. Wait for the answer.

Before the call ends you MUST have their direct callback number and their email address. Ask for the number, repeat it back digit by digit. Ask for the email, then read it back letter by letter and get them to confirm it. Do not let the call end without both - last time we got only a name and it cost us the follow-up.

One more thing on pronunciation: Stow rhymes with "go", not with "store".
```

---

## Baaki jo abhi khula hai

- **Warren ki activation** — wo abhi `ready_not_activated` par hai: 5 mein se 5 documents verified, mandatory_ok true, magar onboarding ka final faisla nahi hua. `broker_visible` maine true kar diya hai is liye load offers already ja sakte hain. Approve karna aap ka kaam hai: **Command Center → /app/command-center/#onboarding → Warren → Approve**. Main ye SQL se nahi kar sakta — `cc_decide_onboarding` ko `compliance.approve` permission chahiye jo sirf aap ke logged-in session mein hoti hai. Aur approve karte hi Warren ko "Your account is approved" wala email chala jayega, is liye faisla aap ka hi hona chahiye.
- **Warren ka FMCSA certificate** — abhi uska authority doc MOTUS ke screenshot par approved hai, evidence weak. Usse printed/PDF certificate maangna hai. Iske liye Monday 2:00 PM UTC wala scheduled task ab draft tayyar karke dega.
- **Inbound webhook** — number page par abhi bhi khali slot hai. Jab tak wo nahi lagta, live loads badalne par ye capacity block haath se edit karna parega.
