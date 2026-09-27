-- bl_comm_0464 — ONE number. "Call or WhatsApp · +1 (815) 365-1168" everywhere.
--
-- WHY (owner, 26 Sep 2026). Since bl_voice_0458 the WhatsApp line +1 (815) 365-1168 is ALSO the phone line:
-- Telnyx forwards it to Riley, so a call and a WhatsApp message reach the same desk on the same number. Two
-- numbers were still being shown side by side — the Retell/"Riley" caller id +1 (469) 253-7575 as "call us" and
-- 815 as "WhatsApp us" — and carriers were confused about which one to use. From now on every surface shows one
-- sign, the same wording, the same icons:
--
--     📞💬 Call or WhatsApp · +1 (815) 365-1168
--
-- WHAT CHANGES
--   1. app_private.contact_channel row: phone = 815 (was 469), channel = 'both'. The CC switch keeps its three
--      states; nothing else in the table changes.
--   2. public.lb_contact_channel() (anon, read by the site build, the runtime switch, delivery-worker, waSupport.js)
--      gains `same` (true when the phone and WhatsApp digits are the same line) and `one` — the sign as data:
--      { display, tel, url, label, text }. Consumers that do not know `same` keep working: 'both' with equal
--      numbers still renders, just twice.
--   3. app_private.contact_inline / contact_sig ({{contact_inline}} / {{contact_sig}} in every SQL-built email):
--      when `same`, ONE line — "call or WhatsApp us on <tel> · Open WhatsApp" — instead of "WhatsApp us on X or
--      call us on X".
--   4. app_private.lc_phone_display() — the number the live-chat bot, lc_do_handoff, outreach_call_band and
--      public.support_phone() quote — now returns the contact-channel phone when the channel is phone/both, and only
--      falls back to retell_config.from_number (Riley's caller id) when the channel is whatsapp-only. The caller id
--      itself (retell_config.from_number) is NOT touched: Riley still dials out as 469 until the 815 line is
--      imported into Retell over SIP (see docs/voice-agent/RILEY-0458.md, known gaps).
--
-- NOT touched on purpose: public.sms_consent_set_self ("Text START to +1 469-253-7575") — SMS START/STOP must name
-- the SMS number (CLAUDE.md §7 exception).
--
-- Anon-executable SECURITY DEFINER surface: unchanged (36 prod / 35 staging). lb_contact_channel already sits on
-- the baseline list and `create or replace` keeps its ACL; the DO block at the end asserts it.
--
-- Rollback: update contact_channel set channel='whatsapp', phone_tel='+14692537575', phone_display='+1 (469) 253-7575',
-- phone_label='Call us 24/7' where id=1;  then re-run bl_wa_0391 §2 for the renderers and restore lc_phone_display
-- from bl_lc_* (the from_number formula is kept verbatim in the fallback branch below).

-- ---------------------------------------------------------------- 1. the row
update app_private.contact_channel
   set channel        = 'both',
       phone_tel      = '+18153651168',
       phone_display  = '+1 (815) 365-1168',
       phone_label    = 'Call or WhatsApp',
       whatsapp_label = 'Call or WhatsApp',
       note           = 'bl_comm_0464 (26 Sep 2026): one number — the 815 line takes calls (→ Riley) and WhatsApp',
       updated_at     = now()
 where id = 1;

-- ---------------------------------------------------------------- 2. the public read
create or replace function public.lb_contact_channel() returns jsonb
language sql stable security definer set search_path = app_private, public as $$
  select jsonb_build_object(
    'channel',   c.channel,
    'phone',     jsonb_build_object('display', c.phone_display, 'tel', c.phone_tel, 'label', c.phone_label),
    'whatsapp',  jsonb_build_object('display', c.whatsapp_display, 'number', c.whatsapp_number,
                                    'username', c.whatsapp_username, 'label', c.whatsapp_label,
                                    'url', 'https://wa.me/' || c.whatsapp_number),
    'same',      s.same,
    'one',       case when s.same then jsonb_build_object(
                   'display', c.phone_display, 'tel', c.phone_tel,
                   'url',     'https://wa.me/' || c.whatsapp_number,
                   'label',   'Call or WhatsApp',
                   'text',    'Call or WhatsApp · ' || c.phone_display)
                 else null end,
    'updated_at', c.updated_at)
  from app_private.contact_channel c
  cross join lateral (select c.channel = 'both'
                             and regexp_replace(coalesce(c.phone_tel,''), '[^0-9]', '', 'g')
                               = regexp_replace(coalesce(c.whatsapp_number,''), '[^0-9]', '', 'g') as same) s
  where c.id = 1;
$$;

-- ---------------------------------------------------------------- 3. the email renderers
create or replace function app_private.contact_inline(p_text boolean default false) returns text
language plpgsql stable set search_path = app_private, public as $$
declare c app_private.contact_channel; wa text; ph text; same boolean;
begin
  select * into c from app_private.contact_channel where id = 1;
  if c.id is null then return ''; end if;
  same := c.channel = 'both'
      and regexp_replace(coalesce(c.phone_tel,''), '[^0-9]', '', 'g') = regexp_replace(coalesce(c.whatsapp_number,''), '[^0-9]', '', 'g');
  if p_text then
    if same then
      return 'call or WhatsApp us on ' || coalesce(c.phone_display,'') || ' (WhatsApp: https://wa.me/' || coalesce(c.whatsapp_number,'') || ')';
    end if;
    wa := 'WhatsApp us on ' || coalesce(c.whatsapp_display,'') || ' (https://wa.me/' || coalesce(c.whatsapp_number,'') || ')';
    ph := 'call us on ' || coalesce(c.phone_display,'');
  else
    if same then
      return 'call or WhatsApp us on <a href="tel:' || coalesce(c.phone_tel,'')
          || '" style="color:#0883F7;font-weight:700;white-space:nowrap">&#128222;&#128172; ' || coalesce(c.phone_display,'') || '</a>'
          || ' <span style="color:#94a3b8">&middot;</span> <a href="https://wa.me/' || coalesce(c.whatsapp_number,'')
          || '" style="color:#16a34a;font-weight:700;white-space:nowrap">Open WhatsApp &rarr;</a>';
    end if;
    wa := 'WhatsApp us on <a href="https://wa.me/' || coalesce(c.whatsapp_number,'')
          || '" style="color:#0883F7;font-weight:700">' || coalesce(c.whatsapp_display,'') || '</a>';
    ph := 'call us on <a href="tel:' || coalesce(c.phone_tel,'')
          || '" style="color:#0883F7;font-weight:700">' || coalesce(c.phone_display,'') || '</a>';
  end if;
  return case c.channel when 'whatsapp' then wa when 'phone' then ph else wa || ' or ' || ph end;
end $$;

create or replace function app_private.contact_sig(p_text boolean default false) returns text
language plpgsql stable set search_path = app_private, public as $$
declare c app_private.contact_channel; wa text; ph text; same boolean;
begin
  select * into c from app_private.contact_channel where id = 1;
  if c.id is null then return ''; end if;
  same := c.channel = 'both'
      and regexp_replace(coalesce(c.phone_tel,''), '[^0-9]', '', 'g') = regexp_replace(coalesce(c.whatsapp_number,''), '[^0-9]', '', 'g');
  if p_text then
    if same then
      return 'Call or WhatsApp: ' || coalesce(c.phone_display,'') || ' (https://wa.me/' || coalesce(c.whatsapp_number,'') || ')';
    end if;
    wa := 'WhatsApp: ' || coalesce(c.whatsapp_display,'') || ' (https://wa.me/' || coalesce(c.whatsapp_number,'') || ')';
    ph := 'Call: ' || coalesce(c.phone_display,'');
    return case c.channel when 'whatsapp' then wa when 'phone' then ph else wa || E'\n    ' || ph end;
  end if;
  if same then
    return 'Call or WhatsApp: <a href="tel:' || coalesce(c.phone_tel,'')
        || '" style="color:#0883F7;text-decoration:none;white-space:nowrap"><span style="color:#0883F7!important">&#128222;&#128172; '
        || coalesce(c.phone_display,'') || '</span></a>'
        || ' <span style="color:#94a3b8">&middot;</span> <a href="https://wa.me/' || coalesce(c.whatsapp_number,'')
        || '" style="color:#16a34a;text-decoration:none;white-space:nowrap"><span style="color:#16a34a!important">Open WhatsApp &rarr;</span></a>';
  end if;
  wa := 'WhatsApp: <a href="https://wa.me/' || coalesce(c.whatsapp_number,'')
        || '" style="color:#0883F7;text-decoration:none"><span style="color:#0883F7!important">'
        || coalesce(c.whatsapp_display,'') || '</span></a>';
  ph := 'Call: <a href="tel:' || coalesce(c.phone_tel,'')
        || '" style="color:#0883F7;text-decoration:none"><span style="color:#0883F7!important">'
        || coalesce(c.phone_display,'') || '</span></a>';
  return case c.channel when 'whatsapp' then wa when 'phone' then ph else wa || '<br>' || E'\n    ' || ph end;
end $$;

-- ---------------------------------------------------------------- 4. the number the bot and support_phone() quote
create or replace function app_private.lc_phone_display() returns text
language sql stable security definer set search_path = app_private, public as $$
  select coalesce(
    (select nullif(btrim(c.phone_display), '') from app_private.contact_channel c
      where c.id = 1 and c.channel in ('phone','both')),
    (select case when f ~ '^\+1[0-9]{10}$'
                 then '+1 (' || substr(f,3,3) || ') ' || substr(f,6,3) || '-' || substr(f,9,4)
                 else coalesce(f,'') end
       from (select from_number as f from app_private.retell_config where id = 1) t));
$$;

-- ---------------------------------------------------------------- 5. prove it
do $$
declare j jsonb; a text; b text; c text; d text;
begin
  j := public.lb_contact_channel();
  if coalesce((j->>'same')::boolean, false) is not true then
    raise exception 'bl_comm_0464: lb_contact_channel().same is not true — row: %', j;
  end if;
  a := app_private.contact_inline(false); b := app_private.contact_inline(true);
  c := app_private.contact_sig(false);    d := app_private.contact_sig(true);
  if a !~ '365-1168' or b !~ '365-1168' or c !~ '365-1168' or d !~ '365-1168'
     or a ~ '253-?7575' or b ~ '253-?7575' or c ~ '253-?7575' or d ~ '253-?7575' then
    raise exception 'bl_comm_0464: a renderer still shows the wrong number: % | % | % | %', a, b, c, d;
  end if;
  if app_private.lc_phone_display() !~ '365-1168' then
    raise exception 'bl_comm_0464: lc_phone_display() = %', app_private.lc_phone_display();
  end if;
  if not has_function_privilege('anon', 'public.lb_contact_channel()', 'execute') then
    raise exception 'bl_comm_0464: lb_contact_channel lost its anon grant';
  end if;
  -- public.support_phone() exists on prod only; lc_phone_display() is what it wraps.
  raise notice 'bl_comm_0464 OK — one: % | inline(text): % | sig(text): % | lc_phone_display(): %',
    j->'one'->>'text', b, d, app_private.lc_phone_display();
end $$;
