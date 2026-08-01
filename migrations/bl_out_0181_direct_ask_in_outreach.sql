-- bl_out_0181 — give outreach emails a direct, tiny ask.
-- Applied to production 2026-08-01 (this file is the repo record of that change).
-- ~700 outreach emails had produced zero replies. Diagnosis: every email's only CTA was
-- "read an article" — there was nothing small to say yes to. This adds an optional 'ask'
-- part: a highlighted box with a one-line direct request, rendered above the article
-- button when a template defines it. Backward compatible — templates without 'ask'
-- render exactly as before.
--   * broker day 1: add loads@loadboot.com to your daily load blast list (free posting)
--   * carrier day 1: reply with equipment + 2-3 preferred lanes (no signup needed)

create or replace function app_private.outreach_render(p jsonb)
returns text language plpgsql
as $function$
declare h text; t jsonb; i jsonb; askbox text := '';
begin
  if coalesce(p->>'ask','') <> '' then
    askbox := '<tr><td style="padding:4px 30px 14px"><div style="background:#f0fdf4;border-left:4px solid #16a34a;border-radius:10px;padding:14px 16px;color:#14532d;font-size:14.5px;line-height:1.65"><b>THE 20-SECOND VERSION &rarr;</b> '||(p->>'ask')||'</div></td></tr>';
  end if;
  h := '<div style="margin:0;padding:0;background:#eef2f7;font-family:''Segoe UI'',Inter,Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:28px 0"><tr><td align="center"><table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 20px 50px -30px rgba(2,12,30,.35)">'
    || '<tr><td style="height:4px;background:linear-gradient(90deg,#FC5305,#0883F7);font-size:0;line-height:0">&nbsp;</td></tr>'
    || '<tr><td style="background:linear-gradient(120deg,#10223B,#0d2a4d);padding:20px 30px 0"><img src="https://loadboot.com/logo-full-dark.png" alt="LoadBoot" height="26" style="display:block"></td></tr>'
    || '<tr><td style="background:linear-gradient(120deg,#10223B,#0d2a4d);padding:16px 30px 26px"><div style="font-size:11px;font-weight:800;letter-spacing:.14em;color:#7cc0ff;text-transform:uppercase">'||(p->>'k')||'</div>'
    || '<div style="font-size:27px;line-height:1.2;font-weight:800;color:#fff;margin:8px 0 6px">'||(p->>'h')||'</div>'
    || '<div style="color:#b9c6da;font-size:14px">'||(p->>'s')||'</div></td></tr>'
    || '<tr><td style="padding:22px 30px 4px"><table width="100%" cellpadding="0" cellspacing="0"><tr>';
  for t in select * from jsonb_array_elements(p->'tiles') loop
    h := h || '<td width="33%" style="padding:4px"><div style="background:#f0f7ff;border:1px solid #cfe3ff;border-radius:12px;padding:14px 6px;text-align:center"><div style="font-size:21px;font-weight:800;color:#0883F7">'||(t->>0)||'</div><div style="font-size:11px;color:#64748b;font-weight:700;margin-top:3px">'||(t->>1)||'</div></div></td>';
  end loop;
  h := h || '</tr></table></td></tr>'
    || '<tr><td style="padding:14px 30px 0"><div style="background:#fef2f2;border-left:4px solid #dc2626;border-radius:10px;padding:14px 16px;color:#7f1d1d;font-size:14.5px;line-height:1.6"><b>THE PROBLEM &rarr;</b> '||(p->>'red')||'</div></td></tr>'
    || askbox
    || '<tr><td style="padding:16px 30px 14px"><div style="font-size:12px;font-weight:800;letter-spacing:.1em;color:#94a3b8;text-transform:uppercase;margin-bottom:4px">Inside the guide</div>';
  for i in select * from jsonb_array_elements(p->'tea') loop
    h := h || '<div style="padding:9px 0;border-bottom:1px solid #f1f5f9;color:#0f172a;font-size:14.5px"><b style="color:#16a34a">&#10003;</b> '||(i#>>'{}')||'</div>';
  end loop;
  h := h || '<div style="padding:9px 0;color:#94a3b8;font-size:14.5px">&#128274; + more &mdash; in the full guide</div></td></tr>'
    || '<tr><td align="center" style="padding:6px 30px 8px"><a href="https://loadboot.com/'||(p->>'url')||'?utm_source=email&utm_medium=outreach&utm_campaign='||(p->>'camp')||'" style="display:block;background:#FC5305;color:#fff;padding:16px 10px;border-radius:12px;text-decoration:none;font-weight:800;font-size:16px;text-align:center">'||(p->>'cta')||'</a><div style="color:#94a3b8;font-size:12px;margin-top:8px">Free &middot; no login &middot; 4-minute read</div></td></tr>'
    || public.outreach_render_band(p) || '<tr><td style="height:4px;background:linear-gradient(90deg,#0883F7,#FC5305);font-size:0;line-height:0">&nbsp;</td></tr>'
    || '<tr><td style="background:#10223B;padding:24px 30px 8px"><table width="100%" cellpadding="0" cellspacing="0"><tr><td><img src="https://loadboot.com/logo-full-dark.png" alt="LoadBoot" height="24" style="display:block"></td><td align="right"><a href="https://loadboot.com/apps.html" style="border:1px solid rgba(255,255,255,.35);color:#fff;font-size:12.5px;font-weight:800;padding:9px 16px;border-radius:999px;text-decoration:none">&#9660; Get the app</a></td></tr></table>'
    || '<div style="font-size:11px;font-weight:800;letter-spacing:.16em;color:#7f92b3;text-transform:uppercase;margin-top:12px">The Operating System for Trucking</div></td></tr>'
    || '<tr><td style="background:#10223B;padding:0 30px 18px"><table width="100%" cellpadding="0" cellspacing="0"><tr>'
    || '<td valign="top" width="33%"><div style="font-size:10.5px;font-weight:800;letter-spacing:.16em;color:#7f92b3;text-transform:uppercase;margin:14px 0 4px">Company</div><a href="https://loadboot.com/about.html" style="color:#e2e8f0;text-decoration:none;font-weight:600;font-size:13px;line-height:2.1;display:block">About us</a><a href="https://loadboot.com/how-it-works.html" style="color:#e2e8f0;text-decoration:none;font-weight:600;font-size:13px;line-height:2.1;display:block">How it works</a><a href="https://loadboot.com/blog.html" style="color:#e2e8f0;text-decoration:none;font-weight:600;font-size:13px;line-height:2.1;display:block">Blog</a></td>'
    || '<td valign="top" width="34%"><div style="font-size:10.5px;font-weight:800;letter-spacing:.16em;color:#7f92b3;text-transform:uppercase;margin:14px 0 4px">Products</div><a href="https://loadboot.com/services.html" style="color:#e2e8f0;text-decoration:none;font-weight:600;font-size:13px;line-height:2.1;display:block">Dispatch services</a><a href="https://loadboot.com/market-rates.html" style="color:#e2e8f0;text-decoration:none;font-weight:600;font-size:13px;line-height:2.1;display:block">Market rates</a><a href="https://loadboot.com/load-board.html" style="color:#e2e8f0;text-decoration:none;font-weight:600;font-size:13px;line-height:2.1;display:block">Live load board</a></td>'
    || '<td valign="top" width="33%"><div style="font-size:10.5px;font-weight:800;letter-spacing:.16em;color:#7f92b3;text-transform:uppercase;margin:14px 0 4px">Sign in</div><a href="https://loadboot.com/app/carrier/" style="color:#7cc0ff;text-decoration:none;font-weight:700;font-size:13px;line-height:2.1;display:block">Carrier portal</a><a href="https://loadboot.com/app/partner/" style="color:#7cc0ff;text-decoration:none;font-weight:700;font-size:13px;line-height:2.1;display:block">Broker &amp; shipper portal</a><a href="https://loadboot.com/app/agent/" style="color:#7cc0ff;text-decoration:none;font-weight:700;font-size:13px;line-height:2.1;display:block">Dispatcher portal</a></td>'
    || '</tr></table></td></tr>'
    || '<tr><td style="background:#0b1830;padding:14px 30px 18px;color:#64748b;font-size:11px;line-height:1.7">LoadBoot &middot; Serving carriers, brokers &amp; shippers in all 48 states &middot; <a href="https://loadboot.com" style="color:#7cc0ff;text-decoration:none">loadboot.com</a><br>Your company appears on the public FMCSA register. <a href="{UNSUB}" style="color:#7cc0ff;text-decoration:none">Unsubscribe with one click</a> &mdash; no questions asked.</td></tr>'
    || '</table></td></tr></table></div>';
  return h;
end $function$;

-- Day-1 broker: the ask = add loads@loadboot.com to your daily blast.
update app_private.outreach_templates
set parts = parts || jsonb_build_object('ask',
  'Want to try us with zero effort? Just add <a href="mailto:loads@loadboot.com" style="color:#14532d;font-weight:800">loads@loadboot.com</a> to your daily load blast list. Your loads go in front of FMCSA-verified carriers <b>free</b> &mdash; no subscription, no per-post fee, your contact info stays on every load.')
where audience='broker' and day=1;

-- Day-1 carrier: the ask = reply with equipment + lanes.
update app_private.outreach_templates
set parts = parts || jsonb_build_object('ask',
  'Reply to this email with your <b>equipment type and 2&ndash;3 preferred lanes</b> and we&rsquo;ll send you matching loads as they come in. No signup needed to look.')
where audience='carrier' and day=1;
