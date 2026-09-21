# dispatch@ — reply drafts for the 36 re-apply invitations (21 Sep 2026)

**Where these replies are.** They are NOT in the database. `app_private.mail_messages` only ingests
`loads@` — `supabase/functions/inbound-mail` routes on `rcpts.some(t => t.startsWith("loads@"))`, and
nothing forwards `dispatch@` to that webhook. So replies to the invitations sit in the Namecheap
PrivateEmail mailbox for `dispatch@loadboot.com` and have to be read there.

**To get them into the CC instead** (one-time, your side + a one-line code change): add `dispatch@` to
the inbound route that already points `loads@` at the `inbound-mail` function, and widen that one
`startsWith` test to accept `dispatch@` with `mailbox = 'dispatch@loadboot.com'`. Say the word and
the code half is a ten-minute change — but it also pulls carrier and broker mail sent to `dispatch@`
into the CC inbox, so it is your call, not mine.

**The rule these drafts apply** (21 Sep 2026): the load board does **not** have to be in the
applicant's name, and they do not need a board at all. The test is whether *they themselves* find and
book loads — any board login, Facebook/WhatsApp freight groups, brokers they already work with, or
direct shippers. Only "I have not sourced a load yet" is a fail.

> You send all of these yourself. Nothing here is sent from a session.

---

## A — "Thank you, I will apply again" (no question)

> Subject: Re: Your LoadBoot dispatcher application
>
> Hello {first name},
>
> Good — we will look out for it. When you reopen the form it comes back pre-filled, so you only
> need to update what has changed, and please make sure the points from our note are covered.
>
> One thing worth getting right: we are not asking whose name a load board is in. We want to see how
> *you* find and book loads — a board login of any kind, Facebook or WhatsApp freight groups, brokers
> you already work with, or direct shippers all count. Name the routes you actually use, where
> exactly, and two loads you booked yourself: the lane, the broker, the month and the rate.
>
> LoadBoot Dispatch — Recruiting

## B — "I do have access / here is how I find loads" (answers the gap by e-mail)

> Hello {first name},
>
> Thank you — that is exactly what we needed to know. Please put it in the application itself rather
> than in e-mail, so it is on the record the reviewer reads: the routes you use, where exactly
> (the board and login, the group, or the brokers by name), and two loads you booked yourself with
> the lane, the broker, the month and the rate.
>
> Your form is {open now / open on <date>} and reopens pre-filled.
>
> LoadBoot Dispatch — Recruiting

## C — "Why was I turned down?" / "What exactly was missing?"

> Hello {first name},
>
> The points are in the note we sent, and they are the same ones the new application asks you to
> cover: {list the coded points}. Nothing else was held against you, and nothing on your account has
> been deleted.
>
> To be clear about the one that is most often misread: we do not require a load board in your own
> name. We require that you find and book loads yourself, by whatever route — a board login of any
> kind, freight groups, your own brokers, or direct shippers.
>
> LoadBoot Dispatch — Recruiting

## D — "I will buy a subscription before the trial starts"

> Hello {first name},
>
> A subscription is not what we are asking for — you do not need to buy anything. What we need to see
> is that you have already found and booked loads yourself, by whatever route you use today: a board
> login (yours, an employer's or a carrier's), Facebook or WhatsApp freight groups, brokers you
> already work with, or direct shippers.
>
> If you have done that, tell us in the application which routes you used and give us two loads —
> lane, broker, month, rate. If you have not booked a load yet, apply again once you have; the
> account stays open.
>
> LoadBoot Dispatch — Recruiting

## E — "What is the salary / how many carriers / what are the hours?"

> Hello {first name},
>
> We go through pay, carrier load and hours with candidates who reach the trial stage, so the fastest
> route to those answers is a complete application. In outline: dispatchers are paid per truck they
> keep loaded, not per carrier, and we need 40+ hours a week with overlap with US business hours.
>
> LoadBoot Dispatch — Recruiting

## F — Auto-replies, out-of-office, bounces

No reply. A hard bounce means the address is dead — that applicant cannot be reached by e-mail at
all, so do not spend a second invitation on them.

---

## Two people deliberately left out of the 36

`Asim Latif` and `Abdul Rafeh` still have `reapply_invite_at = null`. Abdul Rafeh was a real trial
dispatcher and is owed a decision written by hand, not the generic invitation. Nothing has been sent
to either of them.
