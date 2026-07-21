# Yuliia — call confirmation + both programmes side by side

---

## READ FIRST: the trap in steering her to the agent programme

You want her on the agent programme. For your cash position that's the right instinct — **it costs you nothing until money is already in.** But there is a condition in the code she would hit immediately, and if you don't tell her, it will blow up in month two.

From `referrer_pair_active()`:

> Level-1 commission accrues only if the referrer has **a carrier AND a broker/shipper** (or posts loads themselves).

**You are recruiting her to bring Ukrainian and Polish-speaking carriers.** If she brings twenty carriers and no broker, the agent programme pays her **zero**. Not less — zero.

So you have three choices, and you must pick one before Thursday:

1. **Tell her the pair requirement plainly** and make bringing one broker/shipper an explicit first milestone. (Recommended — honest, and it's genuinely achievable: one Slavic-owned brokerage unlocks everything.)
2. **Waive the pair rule for her** — needs a code change to `referrer_pair_active`.
3. **Don't push agent; leave her on the specialist track.**

Sending her to the agent programme without mentioning the pair rule is the single worst thing you could do here. She'd work for two months, earn nothing, and every honest thing you've built with her so far would be gone.

---

## The economics — which one actually protects you

| | Agent programme | Onboarding Specialist |
|---|---|---|
| Ongoing | 1% of gross, forever | 0.5% of gross |
| Per verified carrier | — | $35 |
| First month guarantee | — | $200 |
| **Cash out before revenue arrives** | **None** | **$200 + $35 × carriers** |
| When it's paid | Accrues on your fee invoice, payable 15 days later | You'd have to fund it |
| Condition | Needs a carrier + a broker/shipper | None |

**The agent programme cannot cause you a loss.** Commission accrues against `fin_invoices` — money that already exists — and pays 15 days after. Nothing leaves before something arrives.

The specialist track can cost you real cash before any revenue: $200 plus $35 per verified carrier, potentially before a single load delivers.

That is a legitimate, honest reason to prefer the agent programme — and it's a reason you can say out loud to her.

## Loss protection — apply to whichever she picks

1. **Never pay before you've been invoiced.** Mirror the existing 15-day `payable_at` logic on everything, including the $35.
2. **Clawback** if a carrier charges back, doesn't pay, or churns within 60 days.
3. **$200 guarantee is one month only** — conditional, non-repeating, and only on the specialist track.
4. **Inbound-lead conversions pay only after that carrier's first delivered load**, never on signup.

---

## The message

> Hi Yuliia,
>
> **Thursday at 3:00 PM your time** works — I'll send a Meet link the day before. Allow an hour.
>
> Before we speak, I want to put a second option in front of you, because I think it may suit you better than the one I described and it wouldn't be fair to only show you the one that's easier for me to explain.
>
> **We have a public agent programme:** [loadboot.com/agents.html](https://loadboot.com/agents.html)
>
> Have a look before the call. The short version: you get one referral link, and you earn **1% of the gross value of every delivered load** your referred clients run — carrier, broker or shipper, the system detects which automatically. It's recurring for as long as they keep hauling, and there are override levels if you ever bring in other agents.
>
> **That's double the ongoing rate I quoted you.** I'd rather show you that myself than have you find it on the website afterwards and wonder why I didn't mention it.
>
> So there are two ways you could work with us:
>
> **Option A — Agent programme.** 1% of gross, recurring, no ceiling. Public terms, you can read them yourself. Higher upside.
>
> **Option B — Onboarding Specialist**, what I described before. $35 per verified carrier, 0.5% ongoing, and the $200 guarantee for your first month. Lower ceiling, but there's a floor under you while you're learning.
>
> **One condition on Option A that I want you to hear from me, not discover later.** The agent programme is built around bringing *both sides* of the market — it pays at the top level once you have a carrier **and** a broker or shipper. If you brought only carriers and no broker, it wouldn't pay out. That's a real limitation and you should weigh it.
>
> In practice I don't think it's a large obstacle: there are Slavic-owned freight brokerages in the US as well as owner-operators, and one of those would unlock the whole thing. But I'm not going to pretend the condition isn't there.
>
> Option B has no such condition, which is exactly the trade-off: more certainty, less upside.
>
> **A third piece, which can sit alongside either.** We get carriers coming in through our website every week — real enquiries, in English, that nobody has called back. If you wanted, part of your work could be calling those and converting them, with a separate arrangement on the ones you close. That's the fastest way for you to learn how these conversations actually go, and it doesn't depend on you building a network first.
>
> Read the agent page, think about which structure fits you, and bring your questions on Thursday. You don't have to decide before we speak — and if you want to start on one and move to the other later, that's fine too.
>
> Best,
> Roman

---

## On the call

- **Show the screen first, talk terms second.** The platform is your strongest argument; the numbers mean nothing until she's seen what's real.
- **If she asks which you'd recommend, be straight:** the agent programme costs you nothing upfront, which is why you like it — and it has the higher ceiling for her. Both things are true. Say both.
- **Have one Slavic-owned brokerage in mind** as a concrete first target for her pair. Turning the pair requirement from an obstacle into a named first task is what will make her say yes.
