-- bl_mail_0185 — every outgoing email now offers a phone call.
-- Applied to production 2026-08-01 (this file is the repo record of that change).
--
-- The gap: a recipient who wanted to talk to a human had no way to do it from an email.
-- Now a band sits above the footer of every outreach email carrying the 24/7 number as a
-- tel: link and a button to loadboot.com/contact.html#call, where they can have Riley
-- call them immediately or book a specific date and time. The same band was added to the
-- delivery-worker shell (see supabase/functions/delivery-worker/index.ts, deployed v8),
-- which covers all 47 transactional and marketing templates in one place.
--
-- Agents, dispatchers and referral partners are excluded — those relationships are handled
-- in writing on purpose, and a phone CTA there would only create work nobody wants.
--
-- The number is never typed into a template. support_phone() reads
-- app_private.retell_config, so the day the line changes, every email follows on its own.
-- support_phone() is service_role only — the delivery worker needs it, the public does not,
-- so the anon SECURITY DEFINER count is unchanged.

create or replace function public.support_phone()
 returns text
 language sql
 stable
 security definer
 set search_path to 'app_private, public'
as $function$ select app_private.lc_phone_display(); $function$;

revoke all on function public.support_phone() from public, anon, authenticated;
grant execute on function public.support_phone() to service_role;

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
  return '<tr><td style="padding:4px 30px 16px"><div style="border:1px solid #cfe3ff;background:#f0f7ff;border-radius:12px;padding:15px 17px">'
    || '<div style="font-size:11px;font-weight:800;letter-spacing:.12em;color:#0883F7;text-transform:uppercase">Rather just talk to someone?</div>'
    || '<div style="color:#0f172a;font-size:14.5px;line-height:1.65;margin:7px 0 12px">Call us 24/7 on <a href="tel:' || v_tel || '" style="color:#0883F7;font-weight:800;text-decoration:none">' || v_num || '</a> &mdash; answered on the first ring. Or pick a time that suits you and <b>we call you</b>.</div>'
    || '<a href="https://loadboot.com/contact.html#call?utm_source=email&utm_medium=outreach&utm_campaign=' || coalesce(p->>'camp','call') || '" style="display:inline-block;background:#10223B;color:#fff;padding:11px 20px;border-radius:10px;text-decoration:none;font-weight:800;font-size:13.5px">&#128222; Call me instead &rarr;</a>'
    || '<span style="color:#64748b;font-size:11.5px;margin-left:12px">Right now, or at a date &amp; time you choose</span>'
    || '</div></td></tr>';
end $function$;

-- Splice the band into the outreach shell, just above the loads band. Done as an in-place
-- rewrite rather than a full redefinition so this migration never drifts from whatever
-- version of outreach_render is live (bl_out_0181 rewrote it last).
do $do$
declare src text;
begin
  src := pg_get_functiondef('app_private.outreach_render(jsonb)'::regprocedure);
  if position('outreach_call_band' in src) = 0 then
    src := replace(src, '|| public.outreach_render_band(p)',
                        '|| app_private.outreach_call_band(p) || public.outreach_render_band(p)');
    execute src;
  end if;
end $do$;

-- outreach_render only ever receives templates.parts, so the audience has to travel inside
-- it for the exclusion above to work on any future agent/referral template.
update app_private.outreach_templates
set parts = parts || jsonb_build_object('audience', audience)
where parts is not null;
