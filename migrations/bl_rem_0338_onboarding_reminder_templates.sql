-- bl_rem_0338_onboarding_reminder_templates
--
-- The four templates the funnel needed on top of the six fleet/availability ones,
-- so every stage a carrier can be stuck at now has a real email behind it.
--
-- Two of them carry tokens the send fills in per carrier:
--   {{MISSING_LIST}}  the actual documents outstanding or rejected, by name
--   {{DOC_PROGRESS}}  "3 of 5 verified"
-- delivery-worker does NO merge-field substitution, so this happens server-side in
-- reminder_dispatch at queue time (bl_rem_0339) and the plain-text half is rebuilt
-- from the substituted HTML. A template with a token that is never filled would ship
-- the raw {{...}} to a carrier, so the dispatch also strips any leftover token.

-- confirm_email -------------------------------------------------------------
insert into app_private.comm_templates (key, name, channel, channels, category, status, active, subject, preview_text, body, body_text, variables)
values (
  'carrier.reminder.confirm_email',
  'Carrier reminder - confirm your email',
  'email', '{email}', 'marketing', 'published', true,
  'Your LoadBoot account is not activated yet',
  'The confirmation link was never clicked, so you cannot sign in. One click fixes it.',
  '<div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#FC5305;font-weight:800;margin-bottom:8px">Not activated yet</div>
<h1 style="margin:0 0 16px;font-size:25px;line-height:1.28;color:#0f172a;font-weight:800">Your account exists. You can&rsquo;t sign in to it yet.</h1>

<p style="margin:0 0 14px">You created a LoadBoot carrier account, but the confirmation link in your inbox was never clicked &mdash; so the account is sitting there unactivated and you cannot sign in.</p>

<p style="margin:0 0 18px">This is <strong>one click</strong>, and everything else waits behind it.</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f7ff;border:1px solid #cfe4ff;border-radius:14px;margin:0 0 20px">
  <tr><td style="padding:18px 20px">
    <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#0883F7;font-weight:800;margin-bottom:10px">Two ways in</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#128231;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>Check your inbox and your spam folder</strong> for our confirmation email and tap the link. Search for &ldquo;LoadBoot&rdquo; &mdash; it is usually sitting under a promotions tab.</td></tr>
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#128273;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>Cannot find it?</strong> Open LoadBoot, tap <b>Forgot password</b> and enter this email address. The link we send activates your account on the spot &mdash; you do not need the original.</td></tr>
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#9201;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>Then verification takes about five minutes.</strong> After that brokers can send you loads and a dispatcher is assigned to you.</td></tr>
    </table>
  </td></tr>
</table>

<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 10px"><tr><td style="background:#FC5305;border-radius:999px">
  <a class="lb-btn" href="https://loadboot.com/app/carrier/" style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:800;color:#ffffff !important;text-decoration:none;border-radius:999px"><span style="color:#ffffff !important;text-decoration:none">Activate my account &rarr;</span></a>
</td></tr></table>
<p style="margin:0 0 22px;text-align:center;font-size:12.5px;color:#64748b">Signed up by mistake? Ignore this and the account stays dormant.</p>

<p style="margin:18px 0 0">If the link keeps failing, reply to this email or WhatsApp <a href="https://wa.me/19283936198" style="color:#0883F7;font-weight:700">+1 (928) 393-6198</a> and a person will activate it with you.<br><strong>The LoadBoot Dispatch Team</strong></p>',
  null, '{}'
)
on conflict (key) do update set
  name = excluded.name, channel = excluded.channel, channels = excluded.channels,
  category = excluded.category, status = excluded.status, active = excluded.active,
  subject = excluded.subject, preview_text = excluded.preview_text,
  body = excluded.body, updated_at = now();

-- docs_start -------------------------------------------------------------
insert into app_private.comm_templates (key, name, channel, channels, category, status, active, subject, preview_text, body, body_text, variables)
values (
  'carrier.reminder.docs_start',
  'Carrier reminder - start verification',
  'email', '{email}', 'marketing', 'published', true,
  'Brokers cannot see you until you are verified',
  'No documents uploaded yet. About five minutes, and a phone photo is enough.',
  '<div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#FC5305;font-weight:800;margin-bottom:8px">Verification not started</div>
<h1 style="margin:0 0 16px;font-size:25px;line-height:1.28;color:#0f172a;font-weight:800">Brokers can&rsquo;t see you until you&rsquo;re verified.</h1>

<p style="margin:0 0 14px">You are signed in, which is the hard part. But no verification documents have been uploaded yet, and a broker will not release a load to a carrier we have not checked. Right now your account is invisible to them.</p>

<p style="margin:0 0 18px">Here is what we still need:</p>

<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:14px 18px;margin:0 0 20px;font-weight:700;color:#9a3412;line-height:1.6">{{MISSING_LIST}}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f7ff;border:1px solid #cfe4ff;border-radius:14px;margin:0 0 20px">
  <tr><td style="padding:18px 20px">
    <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#0883F7;font-weight:800;margin-bottom:10px">What it actually takes</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#128248;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>A phone photo is fine.</strong> There is a scanner built into the app &mdash; point, shoot, it straightens and turns it into a PDF for you.</td></tr>
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#9201;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>About five minutes</strong> to upload, and we review the same working day. You get an email on each item as it clears.</td></tr>
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#128274;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>Your documents stay private.</strong> They are stored encrypted, and your dispatcher cannot open your bank details at all &mdash; only you and our finance team can.</td></tr>
    </table>
  </td></tr>
</table>

<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 10px"><tr><td style="background:#FC5305;border-radius:999px">
  <a class="lb-btn" href="https://loadboot.com/app/carrier/#documents" style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:800;color:#ffffff !important;text-decoration:none;border-radius:999px"><span style="color:#ffffff !important;text-decoration:none">Upload my documents &rarr;</span></a>
</td></tr></table>
<p style="margin:0 0 22px;text-align:center;font-size:12.5px;color:#64748b">Start with whichever one is closest to hand &mdash; they do not have to go up together.</p>

<p style="margin:18px 0 0">Not sure what a document is asking for? Reply here, or WhatsApp <a href="https://wa.me/19283936198" style="color:#0883F7;font-weight:700">+1 (928) 393-6198</a> and we will walk you through it.<br><strong>The LoadBoot Dispatch Team</strong></p>',
  null, '{}'
)
on conflict (key) do update set
  name = excluded.name, channel = excluded.channel, channels = excluded.channels,
  category = excluded.category, status = excluded.status, active = excluded.active,
  subject = excluded.subject, preview_text = excluded.preview_text,
  body = excluded.body, updated_at = now();

-- docs_finish -------------------------------------------------------------
insert into app_private.comm_templates (key, name, channel, channels, category, status, active, subject, preview_text, body, body_text, variables)
values (
  'carrier.reminder.docs_finish',
  'Carrier reminder - finish verification',
  'email', '{email}', 'marketing', 'published', true,
  'You are almost verified - here is what is left',
  'Partial verification counts as unverified, so the work you have done is not earning you anything yet.',
  '<div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#FC5305;font-weight:800;margin-bottom:8px">{{DOC_PROGRESS}}</div>
<h1 style="margin:0 0 16px;font-size:25px;line-height:1.28;color:#0f172a;font-weight:800">You&rsquo;re most of the way through verification.</h1>

<p style="margin:0 0 14px">Some of your documents are verified already &mdash; thank you, that is the slow part done. Verification only completes when the whole set is in, though, so your account is still not visible to brokers.</p>

<p style="margin:0 0 18px">Still outstanding:</p>

<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:14px 18px;margin:0 0 20px;font-weight:700;color:#9a3412;line-height:1.6">{{MISSING_LIST}}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f7ff;border:1px solid #cfe4ff;border-radius:14px;margin:0 0 20px">
  <tr><td style="padding:18px 20px">
    <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#0883F7;font-weight:800;margin-bottom:10px">Why the last one still matters</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#128683;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>Partial verification counts as unverified.</strong> A broker&rsquo;s system checks the whole packet, not most of it &mdash; so the work you have already done is not earning you anything yet.</td></tr>
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#128666;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>Your certificate of insurance also gates your fleet.</strong> Until it is verified, the Add Truck form will turn you away &mdash; so nothing downstream can start either.</td></tr>
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#9989;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>We review the same working day</strong> and email you on each item as it clears. There is nothing to chase afterwards.</td></tr>
    </table>
  </td></tr>
</table>

<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 10px"><tr><td style="background:#FC5305;border-radius:999px">
  <a class="lb-btn" href="https://loadboot.com/app/carrier/#documents" style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:800;color:#ffffff !important;text-decoration:none;border-radius:999px"><span style="color:#ffffff !important;text-decoration:none">Finish verification &rarr;</span></a>
</td></tr></table>
<p style="margin:0 0 22px;text-align:center;font-size:12.5px;color:#64748b">A clear phone photo is enough &mdash; the app&rsquo;s scanner turns it into a PDF for you.</p>

<p style="margin:18px 0 0">If one of these is hard to get hold of, tell us which &mdash; reply here or WhatsApp <a href="https://wa.me/19283936198" style="color:#0883F7;font-weight:700">+1 (928) 393-6198</a>. Sometimes there is another document we can accept instead.<br><strong>The LoadBoot Dispatch Team</strong></p>',
  null, '{}'
)
on conflict (key) do update set
  name = excluded.name, channel = excluded.channel, channels = excluded.channels,
  category = excluded.category, status = excluded.status, active = excluded.active,
  subject = excluded.subject, preview_text = excluded.preview_text,
  body = excluded.body, updated_at = now();

-- docs_fix -------------------------------------------------------------
insert into app_private.comm_templates (key, name, channel, channels, category, status, active, subject, preview_text, body, body_text, variables)
values (
  'carrier.reminder.docs_fix',
  'Carrier reminder - a document was rejected',
  'email', '{email}', 'marketing', 'published', true,
  'One document needs a correction',
  'You probably think this one is done. The reviewer left a note saying exactly what to change.',
  '<div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#FC5305;font-weight:800;margin-bottom:8px">Needs a correction</div>
<h1 style="margin:0 0 16px;font-size:25px;line-height:1.28;color:#0f172a;font-weight:800">One correction and you&rsquo;re through.</h1>

<p style="margin:0 0 14px">You uploaded everything &mdash; but our compliance team could not accept one of your documents, so verification has stopped short. This is worth knowing: <strong>you probably think this one is done.</strong></p>

<p style="margin:0 0 18px">What needs redoing:</p>

<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:14px 18px;margin:0 0 20px;font-weight:700;color:#991b1b;line-height:1.6">{{MISSING_LIST}}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f7ff;border:1px solid #cfe4ff;border-radius:14px;margin:0 0 20px">
  <tr><td style="padding:18px 20px">
    <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#0883F7;font-weight:800;margin-bottom:10px">You are not guessing</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#128221;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>The reviewer left a note on the item</strong> in your Documents page saying exactly what was wrong. Open it and read that first &mdash; it is usually one specific thing.</td></tr>
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#128269;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>The usual causes:</strong> an expired date, a cut-off corner, a page missing, or a name that does not match your authority exactly.</td></tr>
      <tr><td valign="top" style="width:26px;font-size:15px;padding:5px 0">&#8635;</td><td style="font-size:14px;line-height:1.6;padding:5px 0"><strong>Re-upload and it goes straight back into review.</strong> You do not have to re-send anything that was already accepted.</td></tr>
    </table>
  </td></tr>
</table>

<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 10px"><tr><td style="background:#FC5305;border-radius:999px">
  <a class="lb-btn" href="https://loadboot.com/app/carrier/#documents" style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:800;color:#ffffff !important;text-decoration:none;border-radius:999px"><span style="color:#ffffff !important;text-decoration:none">Read the note and fix it &rarr;</span></a>
</td></tr></table>
<p style="margin:0 0 22px;text-align:center;font-size:12.5px;color:#64748b">Everything else you sent is still accepted &mdash; only this item is blocking you.</p>

<p style="margin:18px 0 0">If you disagree with the review, say so &mdash; reply here or WhatsApp <a href="https://wa.me/19283936198" style="color:#0883F7;font-weight:700">+1 (928) 393-6198</a>. A person will look at it again.<br><strong>The LoadBoot Dispatch Team</strong></p>',
  null, '{}'
)
on conflict (key) do update set
  name = excluded.name, channel = excluded.channel, channels = excluded.channels,
  category = excluded.category, status = excluded.status, active = excluded.active,
  subject = excluded.subject, preview_text = excluded.preview_text,
  body = excluded.body, updated_at = now();

update app_private.comm_templates
   set body_text = app_private.html_to_text(body), updated_at = now()
 where key in ('carrier.reminder.confirm_email');

-- The two token-carrying templates get their text half built per carrier at queue
-- time, from the HTML the carrier actually receives. Storing one here would be a lie.
update app_private.comm_templates
   set body_text = null, updated_at = now()
 where key in ('carrier.reminder.docs_start','carrier.reminder.docs_finish','carrier.reminder.docs_fix');
