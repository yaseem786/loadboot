-- bl_wa_0391 — one contact setting drives every surface.
--
-- THE PROBLEM bl_wa_0390 exposed: the contact switch (app_private.contact_channel, added 7 Sep) only ever
-- drove the marketing site. Every e-mail template carried the number HARD-CODED in its own HTML, so changing
-- how LoadBoot is reached meant editing 16 template rows by hand — which is exactly what 0390 had to do.
--
-- THE FIX: templates stop naming a number. They drop in a token, and the token is filled AT SEND TIME from
-- contact_channel. Change the setting once and the reminders, the outreach drip, the signature and the website
-- all follow. Adding a third state, 'both', is what makes the switch worth having: most carriers want WhatsApp,
-- some still want a phone, and a real business shows both.
--
-- TOKENS (either brace style works — the transactional templates use {{...}}, the outreach engine already uses
-- {...} for {NAME}/{STATE}/{UNSUB}, so both are accepted rather than forcing one convention on the other)
--   {{contact_inline}}  a sentence fragment:  WhatsApp us on <link> · call us on <link> · or both
--   {{contact_sig}}     the signature lines:  WhatsApp: <link>  /  Call: <link>
--   {{whatsapp_url}} {{whatsapp_display}} {{phone_tel}} {{phone_display}}   the raw values
--
-- Rollback: the tokens are inert text if these functions are dropped — restore the previous template rows
-- from bl_wa_0390 and the e-mails read exactly as they did.

-- ---------------------------------------------------------------- 1. the third state
alter table app_private.contact_channel drop constraint if exists contact_channel_channel_check;
alter table app_private.contact_channel add  constraint contact_channel_channel_check
  check (channel in ('phone','whatsapp','both'));

-- ---------------------------------------------------------------- 2. renderers
create or replace function app_private.contact_inline(p_text boolean default false) returns text
language plpgsql stable set search_path = app_private, public as $$
declare c app_private.contact_channel; wa text; ph text;
begin
  select * into c from app_private.contact_channel where id = 1;
  if c.id is null then return ''; end if;
  if p_text then
    wa := 'WhatsApp us on ' || coalesce(c.whatsapp_display,'') || ' (https://wa.me/' || coalesce(c.whatsapp_number,'') || ')';
    ph := 'call us on ' || coalesce(c.phone_display,'');
  else
    wa := 'WhatsApp us on <a href="https://wa.me/' || coalesce(c.whatsapp_number,'')
          || '" style="color:#0883F7;font-weight:700">' || coalesce(c.whatsapp_display,'') || '</a>';
    ph := 'call us on <a href="tel:' || coalesce(c.phone_tel,'')
          || '" style="color:#0883F7;font-weight:700">' || coalesce(c.phone_display,'') || '</a>';
  end if;
  return case c.channel when 'whatsapp' then wa when 'phone' then ph else wa || ' or ' || ph end;
end $$;

create or replace function app_private.contact_sig(p_text boolean default false) returns text
language plpgsql stable set search_path = app_private, public as $$
declare c app_private.contact_channel; wa text; ph text;
begin
  select * into c from app_private.contact_channel where id = 1;
  if c.id is null then return ''; end if;
  if p_text then
    wa := 'WhatsApp: ' || coalesce(c.whatsapp_display,'') || ' (https://wa.me/' || coalesce(c.whatsapp_number,'') || ')';
    ph := 'Call: ' || coalesce(c.phone_display,'');
    return case c.channel when 'whatsapp' then wa when 'phone' then ph else wa || E'\n    ' || ph end;
  end if;
  wa := 'WhatsApp: <a href="https://wa.me/' || coalesce(c.whatsapp_number,'')
        || '" style="color:#0883F7;text-decoration:none"><span style="color:#0883F7!important">'
        || coalesce(c.whatsapp_display,'') || '</span></a>';
  ph := 'Call: <a href="tel:' || coalesce(c.phone_tel,'')
        || '" style="color:#0883F7;text-decoration:none"><span style="color:#0883F7!important">'
        || coalesce(c.phone_display,'') || '</span></a>';
  return case c.channel when 'whatsapp' then wa when 'phone' then ph else wa || '<br>' || E'\n    ' || ph end;
end $$;

-- one expander, used by every send path. A body with no '{' is returned untouched.
create or replace function app_private.contact_expand(p_body text, p_text boolean default false) returns text
language plpgsql stable set search_path = app_private, public as $$
declare s text := coalesce(p_body,''); c app_private.contact_channel;
begin
  if s = '' or position('{' in s) = 0 then return s; end if;
  select * into c from app_private.contact_channel where id = 1;
  if c.id is null then return s; end if;
  s := replace(s, '{{contact_inline}}',   app_private.contact_inline(p_text));
  s := replace(s, '{CONTACT_INLINE}',     app_private.contact_inline(p_text));
  s := replace(s, '{{contact_sig}}',      app_private.contact_sig(p_text));
  s := replace(s, '{CONTACT_SIG}',        app_private.contact_sig(p_text));
  s := replace(s, '{{whatsapp_url}}',     'https://wa.me/' || coalesce(c.whatsapp_number,''));
  s := replace(s, '{{whatsapp_display}}', coalesce(c.whatsapp_display,''));
  s := replace(s, '{{phone_tel}}',        coalesce(c.phone_tel,''));
  s := replace(s, '{{phone_display}}',    coalesce(c.phone_display,''));
  return s;
end $$;

-- ---------------------------------------------------------------- 3. every transactional e-mail
create or replace function app_private.sys_email(p_to text, p_template text, p_subject text, p_html text,
  p_text text default null, p_idem text default null) returns void
language plpgsql as $$
begin
  if p_to is null or p_to !~ '^[^@]+@[^@]+\.[^@]+$' then return; end if;
  if exists (select 1 from app_private.suppressions where channel='email' and lower(btrim(address))=lower(btrim(p_to))
    and (reason IS DISTINCT FROM 'unsubscribed' or coalesce(p_template ~* '^outreach[._-]',false))) then return; end if;
  insert into app_private.message_deliveries(source,channel,provider,recipient_email,idempotency_key,status,scheduled_at,template_key,meta)
  values ('transactional','email','resend',lower(p_to),
    coalesce(p_idem, 'sys:'||p_template||':'||lower(p_to)||':'||extract(epoch from now())::bigint::text),
    'queued', now(), p_template,
    jsonb_build_object('subject', app_private.contact_expand(p_subject, true),
                       'body_html', app_private.contact_expand(p_html, false),
                       'body_text', app_private.contact_expand(coalesce(p_text,p_subject), true),
                       'category','transactional'))
  on conflict (idempotency_key) do nothing;
end $$;

-- ---------------------------------------------------------------- 4. the outreach drip (patched in place)
-- The two environments carry different builds of this function (production ends with `o_html := v_html;`,
-- staging with `o_html := v_html || v_px;` from the mail-open pixel), so the expansion is woven into the
-- OUTPUT assignments by pattern rather than matched against one exact line.
do $$
declare s text; s2 text; oid_ regprocedure;
begin
  oid_ := to_regprocedure('app_private.outreach_prepare(app_private.outreach_contacts, app_private.outreach_templates)');
  if oid_ is null then return; end if;          -- the outreach engine is not installed here
  s := pg_get_functiondef(oid_);
  if position('contact_expand' in s) > 0 then return; end if;   -- already woven in
  s2 := replace(s,
    'o_text := app_private.outreach_html_to_text(v_html);',
    'o_text := app_private.outreach_html_to_text(app_private.contact_expand(v_html, false));');
  s2 := regexp_replace(s2, 'o_html := v_html([^;]*);', 'o_html := app_private.contact_expand(v_html, false)\1;');
  if s2 = s then raise exception 'bl_wa_0391: outreach_prepare has neither expected assignment - not patched'; end if;
  execute s2;
end $$;

-- ---------------------------------------------------------------- 5. the switch accepts the third state
create or replace function public.cc_set_contact_channel(p_channel text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); v_from text;
begin
  if v_uid is null or not public.has_global_permission('settings.manage') then
    return jsonb_build_object('ok', false, 'error','forbidden','code','LB403');
  end if;
  if p_channel is null or p_channel not in ('phone','whatsapp','both') then
    return jsonb_build_object('ok', false, 'error','channel must be phone, whatsapp or both','code','LB400');
  end if;
  select channel into v_from from app_private.contact_channel where id = 1;
  update app_private.contact_channel
     set channel = p_channel, note = p_note, updated_at = now(), updated_by = v_uid
   where id = 1;
  insert into app_private.contact_channel_log(changed_by, from_channel, to_channel, note)
  values (v_uid, v_from, p_channel, p_note);
  return jsonb_build_object('ok', true, 'from', v_from, 'to', p_channel);
end $$;

-- ---------------------------------------------------------------- 6. templates stop naming a number
-- longest form first, so "WhatsApp us on <a ...>" is not left with a dangling "us on".
update app_private.comm_templates set
  body = replace(replace(body,
    'WhatsApp us on <a href="https://wa.me/18153651168" style="color:#0883F7;font-weight:700">+1 (815) 365-1168</a>',
    '{{contact_inline}}'),
    'WhatsApp <a href="https://wa.me/18153651168" style="color:#0883F7;font-weight:700">+1 (815) 365-1168</a>',
    '{{contact_inline}}'),
  body_text = replace(replace(coalesce(body_text,''),
    'WhatsApp us on +1 (815) 365-1168 (https://wa.me/18153651168)', '{{contact_inline}}'),
    'WhatsApp +1 (815) 365-1168 (https://wa.me/18153651168)', '{{contact_inline}}')
where body like '%18153651168%' or coalesce(body_text,'') like '%18153651168%';

update app_private.outreach_templates set
  html = replace(html,
    'WhatsApp: <a href="https://wa.me/18153651168" style="color:#0883F7;text-decoration:none"><span style="color:#0883F7!important">+1 (815) 365-1168</span></a>',
    '{CONTACT_SIG}')
where html like '%18153651168%';
