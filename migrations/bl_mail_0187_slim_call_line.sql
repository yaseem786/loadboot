-- bl_mail_0187 — the call CTA was a full card competing with the article button.
-- Applied to production 2026-08-01 (this file is the repo record of that change).
--
-- bl_mail_0185 shipped the call option as a bordered box with its own heading, paragraph
-- and a large dark button. On a phone the caption wrapped badly and the block visually
-- outweighed the actual call to action above it. Calling is a fallback, not the point of
-- the email, so it is now a single quiet line above the footer: the number as a tappable
-- tel: link, and a link to book a call. Same two doors, a tenth of the weight.
--
-- The delivery-worker shell got the identical treatment in v9
-- (see supabase/functions/delivery-worker/index.ts).

create or replace function app_private.outreach_call_band(p jsonb)
 returns text
 language plpgsql
 stable
as $function$
declare v_num text; v_tel text;
begin
  if coalesce(p->>'audience','') in ('agent','dispatcher','referral') then return ''; end if;
  select from_number into v_tel from app_private.retell_config where id = 1;
  v_num := app_private.lc_phone_display();
  if coalesce(v_num,'') = '' then return ''; end if;
  return '<tr><td style="padding:2px 30px 12px">'
    || '<div style="border-top:1px solid #e8eef6;padding-top:12px;font-size:13px;line-height:1.7;color:#64748b">'
    || '&#128222; Rather just talk? Call us 24/7 on <a href="tel:' || v_tel || '" style="color:#0883F7;font-weight:800;text-decoration:none;white-space:nowrap">' || v_num || '</a>'
    || ' &nbsp;&middot;&nbsp; or <a href="https://loadboot.com/contact.html#call?utm_source=email&utm_medium=outreach&utm_campaign=' || coalesce(p->>'camp','call') || '" style="color:#0883F7;font-weight:700;text-decoration:none">have us call you &rarr;</a>'
    || '</div></td></tr>';
end $function$;
