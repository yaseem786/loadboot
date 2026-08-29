-- bl_disp_0303 — intro e-mail contact block from system settings; dispatcher's personal phone removed.
-- Yaseen 29 Aug: the carrier must never be handed the dispatcher's Pakistani number — every contact runs
-- through LoadBoot's shared identity (dispatch@loadboot.com + LoadBoot's US WhatsApp) and the WhatsApp
-- group. Both values live in app_private.system_settings (editable in CC → Settings) so no code change
-- is needed when the alias or number changes. Additive; staging first, then prod.
insert into app_private.system_setting_defs (key, value_type, description, validation, sensitivity, required_permission, default_value, environment)
values
  ('dispatch.contact_email', 'string', 'Shared dispatch e-mail shown to carriers (intro e-mail, carrier card). The dispatcher never shows a personal address.', '{"maxLength":120}'::jsonb, 'public', 'settings.manage', '"dispatch@loadboot.com"'::jsonb, 'all'),
  ('dispatch.whatsapp', 'string', 'LoadBoot US WhatsApp number shown to carriers next to the dispatch e-mail (E.164, e.g. +14692537575). Empty = not shown.', '{"maxLength":24}'::jsonb, 'public', 'settings.manage', '""'::jsonb, 'all')
on conflict (key) do nothing;
insert into app_private.system_settings (key, value) values ('dispatch.contact_email', '"dispatch@loadboot.com"'::jsonb) on conflict (key) do nothing;

create or replace function app_private.disp_contact()
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select jsonb_build_object(
    'email', coalesce(nullif((select value #>> '{}' from app_private.system_settings where key = 'dispatch.contact_email'), ''), 'dispatch@loadboot.com'),
    'whatsapp', nullif((select value #>> '{}' from app_private.system_settings where key = 'dispatch.whatsapp'), ''));
$$;

-- e-mail: dispatcher line = name only; contact = shared e-mail (+ WhatsApp when set)
do $$
declare src text; v_old text; v_new text;
begin
  src := pg_get_functiondef('app_private.disp_assign_email_html(uuid)'::regprocedure);
  v_old := '|| ''<p style="margin:0;color:#334155;font-size:14px;line-height:1.7"><b>'' || coalesce(d.full_name,''Your dispatcher'') || ''</b>'' || coalesce('' · '' || nullif(d.phone,''''), '''') || coalesce('' · hours '' || v_hours, '''') || ''<br>Questions for LoadBoot: reply to this e-mail or <a href="mailto:dispatch@loadboot.com" style="color:#0883F7">dispatch@loadboot.com</a></p>''';
  if position(v_old in src) = 0 then raise exception 'disp_assign_email_html: contact line not found'; end if;
  v_new := '|| ''<p style="margin:0;color:#334155;font-size:14px;line-height:1.7"><b>'' || coalesce(d.full_name,''Your dispatcher'') || ''</b>'' || coalesce('' · working hours '' || v_hours, '''') || '' · reaches you in the WhatsApp group and the portal thread<br>Questions for LoadBoot: reply to this e-mail, write to <a href="mailto:'' || (app_private.disp_contact()->>''email'') || ''" style="color:#0883F7">'' || (app_private.disp_contact()->>''email'') || ''</a>'' || coalesce('' or WhatsApp <a href="https://wa.me/'' || regexp_replace(app_private.disp_contact()->>''whatsapp'', ''\D'', '''', ''g'') || ''" style="color:#0883F7">'' || (app_private.disp_contact()->>''whatsapp'') || ''</a>'', '''') || ''</p>''';
  src := replace(src, v_old, v_new);
  execute src;
end $$;

-- carrier card: no dispatcher phone; shared contact instead
do $$
declare src text;
begin
  src := pg_get_functiondef('public.carrier_my_dispatcher()'::regprocedure);
  if position('''dispatcher'', jsonb_build_object(''name'', dp.full_name, ''phone'', dp.phone,' in src) = 0 then raise exception 'carrier_my_dispatcher: dispatcher block not found'; end if;
  src := replace(src, '''dispatcher'', jsonb_build_object(''name'', dp.full_name, ''phone'', dp.phone,', '''dispatcher'', jsonb_build_object(''name'', dp.full_name, ''contact_email'', app_private.disp_contact()->>''email'', ''contact_whatsapp'', app_private.disp_contact()->>''whatsapp'',');
  execute src;
end $$;
