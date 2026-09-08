-- bl_rem_0331_carrier_reminder_templates
--
-- The six email templates that the send looks up as
--     'carrier.reminder.' || <decision-tree key>
-- A key with no row here is SKIPPED rather than sent wrong, so this migration is
-- what actually switches the reminder engine on. Requires bl_rem_0331a.
--
-- Bodies are HTML *fragments*. delivery-worker wraps them in the LoadBoot email
-- shell (logo, footer, unsubscribe) - do NOT add a header or footer here.
--
-- category = 'marketing' on purpose: the send honours comm_preferences.marketing_email,
-- so these obey the marketing opt-out and the suppression list.
--
-- Idempotent: re-running updates the bodies in place.

-- truck_add -------------------------------------------------------------
insert into app_private.comm_templates (key, name, channel, channels, category, status, active, subject, preview_text, body, body_text, variables)
values (
  'carrier.reminder.truck_add',
  'Carrier reminder - add your first truck',
  'email', '{email}', 'marketing', 'published', true,
  'Your account is ready - your truck is not in it yet',
  'One form, about two minutes. Until a truck is on file there is nothing a dispatcher can sell.',
  '<div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#FC5305;font-weight:800;margin-bottom:8px">One step left</div>
<h1 style="margin:0 0 16px;font-size:25px;line-height:1.28;color:#0f172a;font-weight:800">Your account is ready. Your truck isn&rsquo;t in it yet.</h1>

<p style="margin:0 0 14px">You signed up, you got through verification &mdash; and then the part that actually gets you loads never happened. There is no truck in your Fleet tab, so there is nothing for a dispatcher to sell.</p>

<p style="margin:0 0 18px">It is <strong>one form, about two minutes</strong>, and you only need the unit number to start. Everything else can follow.</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f7ff;border:1px solid #cfe4ff;border-radius:14px;margin:0 0 20px">
  <tr><td style="padding:18px 20px">
    <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#0883F7;font-weight:800;margin-bottom:10px">Why the details matter</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#128666;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>Payload and dimensions</strong> decide which loads we can even offer you. A truck with no capacity on file gets skipped by every filter a broker runs.</td></tr>
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#128273;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>The VIN</strong> is checked live against U.S. DOT and against your certificate of insurance while you type &mdash; so you find out about a mismatch now, not when a load is on the line.</td></tr>
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#128176;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>Liftgate, pallet jack, dock height, TWIC</strong> &mdash; every box you tick is a load somebody without it cannot take.</td></tr>
    </table>
  </td></tr>
</table>

<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 10px"><tr><td style="background:#FC5305;border-radius:999px">
  <a class="lb-btn" href="https://loadboot.com/app/carrier/#fleet/add-truck" style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:800;color:#ffffff !important;text-decoration:none;border-radius:999px"><span style="color:#ffffff !important;text-decoration:none">Add my truck &rarr;</span></a>
</td></tr></table>
<p style="margin:0 0 22px;text-align:center;font-size:12.5px;color:#64748b">Half-finished forms are saved on your phone now &mdash; stop any time and pick up where you left off.</p>

<p style="margin:0 0 8px">Once the truck is in, you can post where it is and your dedicated dispatcher starts sourcing. Until then we are holding a seat for a truck we cannot see.</p>

<p style="margin:18px 0 0">Stuck on any field? Reply to this email, or WhatsApp us on <a href="https://wa.me/19283936198" style="color:#0883F7;font-weight:700">+1 (928) 393-6198</a> and we will fill it in with you.<br><strong>The LoadBoot Dispatch Team</strong></p>',
  null, '{}'
)
on conflict (key) do update set
  name = excluded.name, channel = excluded.channel, channels = excluded.channels,
  category = excluded.category, status = excluded.status, active = excluded.active,
  subject = excluded.subject, preview_text = excluded.preview_text,
  body = excluded.body, updated_at = now();

-- truck_continue -------------------------------------------------------------
insert into app_private.comm_templates (key, name, channel, channels, category, status, active, subject, preview_text, body, body_text, variables)
values (
  'carrier.reminder.truck_continue',
  'Carrier reminder - finish adding your truck',
  'email', '{email}', 'marketing', 'published', true,
  'You started adding your truck - it is still saved',
  'Your draft is still on your device. Open the form and it comes back where you left it.',
  '<div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#FC5305;font-weight:800;margin-bottom:8px">Half done</div>
<h1 style="margin:0 0 16px;font-size:25px;line-height:1.28;color:#0f172a;font-weight:800">You started adding your truck. It is still sitting there.</h1>

<p style="margin:0 0 14px">You opened the Add&nbsp;Truck form and got part of the way through, then something came up &mdash; a call, a gate, a dispatcher. It happens. What you typed is <strong>still saved on your device</strong>, so nothing you did is lost.</p>

<p style="margin:0 0 18px">Open the form again and it comes back exactly where you left it. Most people finish in <strong>under a minute</strong> from here.</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f7ff;border:1px solid #cfe4ff;border-radius:14px;margin:0 0 20px">
  <tr><td style="padding:18px 20px">
    <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#0883F7;font-weight:800;margin-bottom:10px">What is still missing costs you loads</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#128666;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>Payload and dimensions.</strong> Until they are on file, every broker filter that asks &ldquo;can it carry this?&rdquo; skips your truck silently.</td></tr>
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#128273;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>The VIN.</strong> We check it against U.S. DOT and your certificate of insurance as you type, so a mismatch surfaces now instead of on a live load.</td></tr>
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#9989;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>An incomplete truck cannot be posted.</strong> That is the only reason your availability is not live yet.</td></tr>
    </table>
  </td></tr>
</table>

<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 10px"><tr><td style="background:#FC5305;border-radius:999px">
  <a class="lb-btn" href="https://loadboot.com/app/carrier/#fleet/add-truck" style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:800;color:#ffffff !important;text-decoration:none;border-radius:999px"><span style="color:#ffffff !important;text-decoration:none">Finish adding my truck &rarr;</span></a>
</td></tr></table>
<p style="margin:0 0 22px;text-align:center;font-size:12.5px;color:#64748b">Your draft is kept for 7 days. After that the form starts clean.</p>

<p style="margin:18px 0 0">If one field is holding you up, reply to this email or WhatsApp us on <a href="https://wa.me/19283936198" style="color:#0883F7;font-weight:700">+1 (928) 393-6198</a> and we will fill it in with you on the call.<br><strong>The LoadBoot Dispatch Team</strong></p>',
  null, '{}'
)
on conflict (key) do update set
  name = excluded.name, channel = excluded.channel, channels = excluded.channels,
  category = excluded.category, status = excluded.status, active = excluded.active,
  subject = excluded.subject, preview_text = excluded.preview_text,
  body = excluded.body, updated_at = now();

-- driver_add -------------------------------------------------------------
insert into app_private.comm_templates (key, name, channel, channels, category, status, active, subject, preview_text, body, body_text, variables)
values (
  'carrier.reminder.driver_add',
  'Carrier reminder - add a driver',
  'email', '{email}', 'marketing', 'published', true,
  'Your truck is in. Now it needs a driver on file',
  'Under a minute. A load cannot be dispatched to a truck with nobody assigned.',
  '<div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#FC5305;font-weight:800;margin-bottom:8px">One step left</div>
<h1 style="margin:0 0 16px;font-size:25px;line-height:1.28;color:#0f172a;font-weight:800">Your truck is in. Now it needs a driver on file.</h1>

<p style="margin:0 0 14px">You have a truck in your Fleet tab &mdash; good. But a load cannot be dispatched to a truck with nobody assigned to it, so your availability still cannot be posted.</p>

<p style="margin:0 0 18px">Adding a driver takes <strong>under a minute</strong>. The name is the only thing we truly need to start.</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f7ff;border:1px solid #cfe4ff;border-radius:14px;margin:0 0 20px">
  <tr><td style="padding:18px 20px">
    <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#0883F7;font-weight:800;margin-bottom:10px">What the extra fields buy you</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#128197;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>License and medical expiry</strong> &mdash; we watch both and warn you <em>before</em> they lapse. A CDL that expires mid-week is a truck sitting still, and brokers check.</td></tr>
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#9201;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>The driver&rsquo;s name</strong> is what your hours-of-service clock is matched on if you ever connect an ELD &mdash; get it in now and that just works later.</td></tr>
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#128222;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>Phone</strong> means your dispatcher reaches the person actually driving instead of relaying through you at 5am.</td></tr>
    </table>
  </td></tr>
</table>

<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 10px"><tr><td style="background:#FC5305;border-radius:999px">
  <a class="lb-btn" href="https://loadboot.com/app/carrier/#fleet/add-driver" style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:800;color:#ffffff !important;text-decoration:none;border-radius:999px"><span style="color:#ffffff !important;text-decoration:none">Add my driver &rarr;</span></a>
</td></tr></table>
<p style="margin:0 0 22px;text-align:center;font-size:12.5px;color:#64748b">Driving it yourself? Add yourself &mdash; owner-operators are the most common case.</p>

<p style="margin:18px 0 0">Any questions, reply here or WhatsApp <a href="https://wa.me/19283936198" style="color:#0883F7;font-weight:700">+1 (928) 393-6198</a>.<br><strong>The LoadBoot Dispatch Team</strong></p>',
  null, '{}'
)
on conflict (key) do update set
  name = excluded.name, channel = excluded.channel, channels = excluded.channels,
  category = excluded.category, status = excluded.status, active = excluded.active,
  subject = excluded.subject, preview_text = excluded.preview_text,
  body = excluded.body, updated_at = now();

-- avail_start -------------------------------------------------------------
insert into app_private.comm_templates (key, name, channel, channels, category, status, active, subject, preview_text, body, body_text, variables)
values (
  'carrier.reminder.avail_start',
  'Carrier reminder - post your first availability',
  'email', '{email}', 'marketing', 'published', true,
  'Your fleet is set up - nobody knows where your truck is',
  'Thirty seconds: city, dates, equipment. Then a real dispatcher starts sourcing.',
  '<div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#FC5305;font-weight:800;margin-bottom:8px">Ready to run</div>
<h1 style="margin:0 0 16px;font-size:25px;line-height:1.28;color:#0f172a;font-weight:800">Your fleet is set up. Nobody knows where your truck is.</h1>

<p style="margin:0 0 14px">Truck on file, driver on file &mdash; the hard part is behind you. The one thing still missing is the simplest: <strong>where the truck is and when it is free</strong>. Without that your dedicated dispatcher has nothing to work from.</p>

<p style="margin:0 0 18px">Your first post takes about <strong>thirty seconds</strong>. City, dates, equipment. That is it.</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f7ff;border:1px solid #cfe4ff;border-radius:14px;margin:0 0 20px">
  <tr><td style="padding:18px 20px">
    <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#0883F7;font-weight:800;margin-bottom:10px">What happens the moment you post</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#128269;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>A real dispatcher starts sourcing</strong> against your exact position and equipment &mdash; not a queue, a person assigned to you.</td></tr>
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#128205;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>Add the ZIP</strong> and your deadhead miles are calculated exactly, which is what decides whether a load is worth it.</td></tr>
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#9201;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>Add your drive hours left</strong> and we stop offering you runs you legally cannot finish today.</td></tr>
    </table>
  </td></tr>
</table>

<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 10px"><tr><td style="background:#FC5305;border-radius:999px">
  <a class="lb-btn" href="https://loadboot.com/app/carrier/#loads" style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:800;color:#ffffff !important;text-decoration:none;border-radius:999px"><span style="color:#ffffff !important;text-decoration:none">Post my availability &rarr;</span></a>
</td></tr></table>
<p style="margin:0 0 22px;text-align:center;font-size:12.5px;color:#64748b">A post stays live for 24 hours, then asks you to confirm. No surprise expiries.</p>

<p style="margin:0 0 8px">Being honest about the trade: this is a daily habit, not a one-off. Thirty seconds with your first coffee is what separates a dispatcher hunting freight for you from a dispatcher guessing where you are.</p>

<p style="margin:18px 0 0">Want us to walk you through the first one? Reply here, or WhatsApp <a href="https://wa.me/19283936198" style="color:#0883F7;font-weight:700">+1 (928) 393-6198</a>.<br><strong>The LoadBoot Dispatch Team</strong></p>',
  null, '{}'
)
on conflict (key) do update set
  name = excluded.name, channel = excluded.channel, channels = excluded.channels,
  category = excluded.category, status = excluded.status, active = excluded.active,
  subject = excluded.subject, preview_text = excluded.preview_text,
  body = excluded.body, updated_at = now();

-- avail_continue -------------------------------------------------------------
insert into app_private.comm_templates (key, name, channel, channels, category, status, active, subject, preview_text, body, body_text, variables)
values (
  'carrier.reminder.avail_continue',
  'Carrier reminder - finish your availability post',
  'email', '{email}', 'marketing', 'published', true,
  'You started posting your truck and stopped short',
  'What you typed is still saved. Two taps from live on the board.',
  '<div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#FC5305;font-weight:800;margin-bottom:8px">Almost posted</div>
<h1 style="margin:0 0 16px;font-size:25px;line-height:1.28;color:#0f172a;font-weight:800">You started posting your truck and stopped short.</h1>

<p style="margin:0 0 14px">You opened the availability form, filled part of it in, and closed it before it went live. Your truck is <strong>not on the board</strong>, so no dispatcher is working it right now.</p>

<p style="margin:0 0 18px">The good news: <strong>what you typed is still saved</strong>. Open the form and it comes straight back &mdash; usually two taps from done.</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f7ff;border:1px solid #cfe4ff;border-radius:14px;margin:0 0 20px">
  <tr><td style="padding:18px 20px">
    <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#0883F7;font-weight:800;margin-bottom:10px">If something stopped you</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#128205;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>Not sure where you will be?</strong> Post where you are now. You can update the city any time &mdash; an approximate post beats no post.</td></tr>
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#9201;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>Unsure about drive hours left?</strong> It is optional. Leave it blank rather than abandoning the form &mdash; but filling it in stops us offering runs you cannot legally finish.</td></tr>
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#128274;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>Changed your mind?</strong> Mark it &ldquo;Not available&rdquo;. That is a real answer and it stops us calling about freight you cannot take.</td></tr>
    </table>
  </td></tr>
</table>

<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 10px"><tr><td style="background:#FC5305;border-radius:999px">
  <a class="lb-btn" href="https://loadboot.com/app/carrier/#loads" style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:800;color:#ffffff !important;text-decoration:none;border-radius:999px"><span style="color:#ffffff !important;text-decoration:none">Finish my post &rarr;</span></a>
</td></tr></table>
<p style="margin:0 0 22px;text-align:center;font-size:12.5px;color:#64748b">Your draft is kept for an hour on the availability form, so sooner is better.</p>

<p style="margin:18px 0 0">If a field is in the way, tell us which one &mdash; reply here or WhatsApp <a href="https://wa.me/19283936198" style="color:#0883F7;font-weight:700">+1 (928) 393-6198</a>.<br><strong>The LoadBoot Dispatch Team</strong></p>',
  null, '{}'
)
on conflict (key) do update set
  name = excluded.name, channel = excluded.channel, channels = excluded.channels,
  category = excluded.category, status = excluded.status, active = excluded.active,
  subject = excluded.subject, preview_text = excluded.preview_text,
  body = excluded.body, updated_at = now();

-- avail_confirm -------------------------------------------------------------
insert into app_private.comm_templates (key, name, channel, channels, category, status, active, subject, preview_text, body, body_text, variables)
values (
  'carrier.reminder.avail_confirm',
  'Carrier reminder - confirm today availability',
  'email', '{email}', 'marketing', 'published', true,
  'Your truck came off the board this morning',
  'Availability expires 24 hours after you last confirm it. If nothing changed it is one tap.',
  '<div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#FC5305;font-weight:800;margin-bottom:8px">Your post expired</div>
<h1 style="margin:0 0 16px;font-size:25px;line-height:1.28;color:#0f172a;font-weight:800">Your truck came off the board this morning.</h1>

<p style="margin:0 0 14px">Availability posts expire 24 hours after you last confirm them. Yours has passed that mark, so your dedicated dispatcher has stopped sourcing for this truck &mdash; not as a penalty, but because we will not sell a truck we are no longer sure is free.</p>

<p style="margin:0 0 18px">If nothing has changed, it is <strong>one tap</strong>.</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f7ff;border:1px solid #cfe4ff;border-radius:14px;margin:0 0 20px">
  <tr><td style="padding:18px 20px">
    <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#0883F7;font-weight:800;margin-bottom:10px">Three ways this goes</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#10003;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>Still in the same spot?</strong> Tap &ldquo;Still available today&rdquo; and you are back on the board in seconds.</td></tr>
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#128205;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>Truck moved?</strong> Update the city &mdash; add the ZIP and your deadhead miles become exact instead of approximate.</td></tr>
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#128274;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>Done for the week?</strong> Mark it &ldquo;Not available&rdquo;. That is a real answer too, and it stops us calling you about freight you cannot take.</td></tr>
    </table>
  </td></tr>
</table>

<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 10px"><tr><td style="background:#FC5305;border-radius:999px">
  <a class="lb-btn" href="https://loadboot.com/app/carrier/#loads" style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:800;color:#ffffff !important;text-decoration:none;border-radius:999px"><span style="color:#ffffff !important;text-decoration:none">Confirm my truck &rarr;</span></a>
</td></tr></table>
<p style="margin:0 0 22px;text-align:center;font-size:12.5px;color:#64748b">While you are there, add your drive hours left &mdash; it is the first thing a dispatcher checks before offering a long run.</p>

<p style="margin:0 0 8px">The carriers who get the most out of LoadBoot do this with their first coffee. It is thirty seconds, and it is the difference between a dispatcher hunting for you and a dispatcher guessing.</p>

<p style="margin:18px 0 0">Reply here if something is in the way.<br><strong>The LoadBoot Dispatch Team</strong></p>',
  null, '{}'
)
on conflict (key) do update set
  name = excluded.name, channel = excluded.channel, channels = excluded.channels,
  category = excluded.category, status = excluded.status, active = excluded.active,
  subject = excluded.subject, preview_text = excluded.preview_text,
  body = excluded.body, updated_at = now();

-- derive every plain-text alternative from the HTML we just stored
update app_private.comm_templates
   set body_text = app_private.html_to_text(body), updated_at = now()
 where key like 'carrier.reminder.%';
