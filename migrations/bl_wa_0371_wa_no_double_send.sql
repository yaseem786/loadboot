-- bl_wa_0371 — one click, one message.
-- The FIRST live outbound test (21 Sep 2026, 09:05 UTC) sent the same reply TWICE, 1.3 seconds apart, because
-- nothing on either side stopped a second click: two rows, two Telnyx ids, two messages on the carrier's phone.
--   * Command Center's composer now disables the button while a send is in flight (whatsappLive.js).
--   * And the server refuses it too, below: an identical outbound body to the same conversation inside 15 seconds.
-- Meta bills per conversation and a carrier reading the same line twice looks careless, so the rule belongs in
-- Postgres, not only in the browser. Everything else here is bl_wa_0368's wa_send_prepare, unchanged.

create or replace function public.wa_send_prepare(p jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); v_role text; cfg app_private.dialer_config; t app_private.wa_threads;
  tpl app_private.wa_templates; v_vars jsonb; v_body text; v_open boolean; n int; m app_private.wa_messages;
  v_kind text := 'text'; v_payload jsonb; r jsonb;
begin
  v_role := app_private.wa_actor(v_uid);
  if v_role is null then return jsonb_build_object('ok', false, 'error','Not allowed.'); end if;
  select * into cfg from app_private.dialer_config where id = 1;
  if not (coalesce(cfg.enabled,false) and coalesce(cfg.wa_enabled,false)) then
    return jsonb_build_object('ok', false, 'error','WhatsApp is not switched on yet.'); end if;
  if cfg.wa_number is null then return jsonb_build_object('ok', false, 'error','No WhatsApp number is configured.'); end if;
  if coalesce(cfg.terms_required,false) and v_role <> 'staff'
     and not exists (select 1 from app_private.dialer_terms_acceptances a where a.user_id = v_uid and a.version = coalesce(cfg.terms_version,1)) then
    return jsonb_build_object('ok', false, 'error','Accept the LoadBoot Phone Terms first.'); end if;

  if nullif(p->>'thread_id','') is not null then
    select * into t from app_private.wa_threads where id = (p->>'thread_id')::uuid;
  elsif nullif(p->>'to','') is not null then
    r := public.wa_start(p->>'to', null);
    if r ? 'error' then return jsonb_build_object('ok', false, 'error', r->>'error'); end if;
    select * into t from app_private.wa_threads where id = (r->'thread'->>'id')::uuid;
  end if;
  if t.id is null then return jsonb_build_object('ok', false, 'error','That conversation does not exist.'); end if;
  if v_role <> 'staff' then
    if t.owner_user_id is null then
      if not app_private.wa_can_take(v_uid, t.carrier_org_id) then
        return jsonb_build_object('ok', false, 'error', coalesce(app_private.wa_lock_reason(t.carrier_org_id), 'Not allowed.')); end if;
      update app_private.wa_threads set owner_user_id = v_uid, updated_at = now() where id = t.id and owner_user_id is null returning * into t;
    elsif t.owner_user_id <> v_uid then
      return jsonb_build_object('ok', false, 'error','Another dispatcher owns this conversation.');
    end if;
  end if;
  if t.status <> 'open' then return jsonb_build_object('ok', false, 'error','This conversation is closed.'); end if;

  select count(*) into n from app_private.wa_messages x where x.direction = 'outbound' and x.created_at > now() - interval '1 hour';
  if n >= coalesce(cfg.max_wa_per_hour, 120) then return jsonb_build_object('ok', false, 'error','Hourly WhatsApp limit reached - try again shortly.'); end if;

  v_open := t.last_inbound_at is not null and t.last_inbound_at > now() - interval '24 hours';

  if nullif(p->'template'->>'name','') is not null then
    select * into tpl from app_private.wa_templates where name = p->'template'->>'name';
    if tpl.name is null then return jsonb_build_object('ok', false, 'error','That template does not exist.'); end if;
    if tpl.status <> 'approved' then
      return jsonb_build_object('ok', false, 'error','That template is ' || tpl.status || ' at Meta - it cannot be sent yet.'); end if;
    v_vars := case when jsonb_typeof(p->'template'->'vars') = 'array' then p->'template'->'vars' else '[]'::jsonb end;
    if jsonb_array_length(v_vars) <> tpl.variables then
      return jsonb_build_object('ok', false, 'error','This template needs ' || tpl.variables || ' values.'); end if;
    if exists (select 1 from jsonb_array_elements_text(v_vars) x where btrim(coalesce(x,'')) = '') then
      return jsonb_build_object('ok', false, 'error','Fill in every value first.'); end if;
    v_kind := 'template';
    v_body := app_private.wa_fill(tpl.body, v_vars);
    v_payload := jsonb_build_object('type','template','template',
      jsonb_build_object('name', tpl.name, 'language', jsonb_build_object('policy','deterministic','code', tpl.language))
      || case when tpl.variables = 0 then '{}'::jsonb else jsonb_build_object('components', jsonb_build_array(
           jsonb_build_object('type','body','parameters',
             (select jsonb_agg(jsonb_build_object('type','text','text', x)) from jsonb_array_elements_text(v_vars) x)))) end);
  else
    v_body := btrim(coalesce(p->>'body',''));
    if v_body = '' then return jsonb_build_object('ok', false, 'error','Write a message first.'); end if;
    if length(v_body) > 3000 then return jsonb_build_object('ok', false, 'error','That message is too long (3000 characters max).'); end if;
    if not v_open then
      return jsonb_build_object('ok', false, 'error','The 24-hour window is closed - send an approved template instead.', 'needs_template', true); end if;
    v_payload := jsonb_build_object('type','text','text', jsonb_build_object('body', v_body, 'preview_url', false));
  end if;

  -- bl_wa_0371: the same line, to the same person, twice within 15 seconds is a double click, not a decision.
  if exists (select 1 from app_private.wa_messages x
              where x.thread_id = t.id and x.direction = 'outbound' and x.body = v_body
                and x.created_at > now() - interval '15 seconds') then
    return jsonb_build_object('ok', false, 'error','That message just went out a moment ago.');
  end if;

  insert into app_private.wa_messages (thread_id, direction, sender_user_id, kind, body, template_name, template_vars, status)
  values (t.id, 'outbound', v_uid, v_kind, v_body, tpl.name, v_vars, 'queued') returning * into m;
  update app_private.wa_threads set last_at = now(), last_body = left(v_body, 300), last_direction = 'outbound',
     last_outbound_at = now(), updated_at = now() where id = t.id;

  return jsonb_build_object('ok', true, 'id', m.id, 'thread_id', t.id, 'from', cfg.wa_number, 'to', t.counterparty,
    'whatsapp_message', v_payload, 'messaging_profile_id', cfg.wa_messaging_profile_id, 'message', app_private.wa_msg_json(m));
end $$;
