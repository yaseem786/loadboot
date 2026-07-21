# Two messages + the answers to your commission questions

---

## PART 1 — Reply to Yuliia (confirm the call)

Time zones: Poland is UTC+2 in July, Pakistan UTC+5. **Poland 3:00 PM = Pakistan 6:00 PM.** Comfortable for both.

> Hi Yuliia,
>
> Thursday works — let's say **3:00 PM your time** (Poland). I'll send a Google Meet link the day before. Allow an hour; if we finish sooner, good.
>
> What I'll show you, screen shared:
>
> - The carrier portal a driver actually sees — documents, loads, tracking, settlements
> - The Command Center, where you'd work: every carrier's verification status and exactly which document each one is missing
> - The broker and shipper side, so you can see where freight enters the system
> - The earnings tracking, so you can see how a delivered load becomes a payment to you
>
> Come with hard questions. I'd rather you interrogate it now than find out in a month that it wasn't what you expected.
>
> One thing I want to be clear about before we speak, because it shapes how I'd want us to work together.
>
> I'm not looking for someone to process a task list. The Ukrainian and Polish-speaking segment of the US carrier market is something **nobody here can reach** — and if you take it on, it would be yours to run. How you approach those carriers, what you say, which ones are worth pursuing, what we should change about our onboarding because it isn't landing with them — those would be your calls, and I'd expect you to tell me when I'm getting something wrong.
>
> To be precise about what I mean, since I don't want to overpromise: this is a **partnership on the work, not a shareholding in the company**. You wouldn't own a piece of LoadBoot. What you'd own is a part of the operation, the decisions inside it, and the income that comes out of it — for as long as you're running it.
>
> That distinction matters to me because I've seen people promise "we're like a family" and mean "do as you're told". I'd rather tell you exactly what's on offer.
>
> See you Thursday.
>
> Best,
> Roman

---

## PART 2 — Reply to the cargo van enquiry

Your own FAQ already answers this honestly — reuse it. Don't overpromise on van freight; that's how you end up with an angry carrier in three weeks.

> Good afternoon,
>
> Yes, we work with cargo vans and sprinters — and I'd rather give you an honest picture than a sales pitch.
>
> Van freight is a **thinner market than box truck or flatbed**. There is real work in expedited, hot loads, final-mile and partial LTL, and vans do well on urgent freight where speed matters more than capacity. But there are fewer loads posted for vans overall, and rates swing more. Anyone promising you a van stays loaded every day is not being straight with you.
>
> What we would do is tell you honestly what your specific lanes pay before you commit to anything.
>
> Some questions so I can give you a real answer rather than a generic one:
>
> 1. What van are you running, and do you have a liftgate or ramp?
> 2. Where are you based, and how far out will you run?
> 3. Do you have your own MC authority, or are you leased on?
> 4. Is the van running now, or sitting?
>
> Our terms are simple: **flat 5% of linehaul, no contract, no forced dispatch.** You see every load before it's booked and you can turn any of it down.
>
> You can start onboarding at **loadboot.com/app/carrier/** — or answer the four questions above and I'll tell you first whether we can realistically keep you moving. I'd rather say no than take you on and waste your time.
>
> Best regards,
>
> Roman
> LoadBoot · hello@loadboot.com

---

## PART 3 — Your commission questions, answered from your own code

### "Doesn't the ongoing % make her a shareholder?"

**No — and the difference is not a technicality.**

| Shareholder | Commission earner |
|---|---|
| Owns part of the company | Owns nothing |
| Votes on decisions | No vote |
| Gets paid if you sell LoadBoot | Gets nothing if you sell |
| Cannot be removed | Contract terminates on notice |
| Paid whether or not they work | Paid only when a load delivers |

She never owns any part of LoadBoot. She earns a percentage of specific transactions, under a contract you can end.

### "Is this model common?"

Yes — it's the **standard freight agent model**. Freight agents in the US typically take a share of the margin on their accounts, ongoing, for as long as they service them. Insurance renewal commissions and SaaS referral programmes work the same way.

One important qualifier: in real freight agency, the residual is tied to the agent **continuing to service the account** — not to a one-time introduction. Keep it that way. If she stops working, the residual should stop too.

### "Is anything attached to it, or does it just run forever?"

Your system already has three protections built in. I checked the code:

1. **`referrer_pair_active`** — level-1 commission only accrues if the referrer has an active *pair* (a carrier **and** a broker/shipper). Stop being active, stop earning.
2. **`payable_at = now() + 15 days`** — a 15-day hold before anything becomes payable.
3. **Referrer `status = 'active'`** — set the referrer inactive and accrual stops entirely.

So it doesn't run unconditionally. Worth adding to the written agreement: a **clawback** if a carrier charges back, doesn't pay, or churns within 60 days.

### "How do we pay her $35 when we haven't been paid ourselves?"

Your platform already solves this and you should copy the same logic. Commission accrues against a **LoadBoot fee invoice** (`fin_invoices`) — money that already exists — and only becomes payable 15 days later.

Do the same with the $35: **accrue it on verification, pay it monthly in arrears alongside commissions, reverse it if that carrier hasn't run a load in 60 days.**

You promised "$35 when fully verified" and you should honour that — but *when it is paid out* is a schedule, not a change to the amount. Monthly in arrears is completely normal and nobody objects to it. Explain it on the call, don't send another message walking it back.

### "Where does the 1% of gross actually come from?"

From your own accrual function: `amount = fee × pct / 5`. Level 1 pct = 1, so she gets **20% of LoadBoot's fee**. The fee is 5% of linehaul. 20% × 5% = **1% of gross.** Your published figure is correct and the engine already computes it.

### Your SEO-inbound calling idea

**This is the best idea in your message** — better than the cold outreach plan.

Those leads already came to you. They're warm, they speak English, and they're sitting unanswered. Give her a script, let her call them, pay her on conversion. And it fits the same rule you want: nothing leaves your pocket until a carrier is verified and running.

It also solves your Slavic-market problem faster, because she'll hear real carrier objections in week one instead of week eight.

Start her here on day one. There are unanswered leads in the Forms inbox right now.

### "We must be safe in every respect"

Get a **written independent contractor agreement** before she starts. It should state plainly: independent contractor, not an employee; **no equity, no ownership, no partnership** in the legal sense; commission terms and clawback; either side can terminate with notice; what happens to residuals after termination; confidentiality.

**I'm not a lawyer, and this is cross-border — she's in Poland, you're in Pakistan, the business is US-facing.** Get a template reviewed by someone qualified before she signs. It is cheap now and expensive later. The specific thing to avoid is language that accidentally makes her look like an employee or a partner — "team member" and "partner" are fine in a WhatsApp message, but they must not appear in the contract.
