-- bl_wa_0370 — the REAL Telnyx inbound WhatsApp payload, read from the first live message (21 Sep 2026, 08:59 UTC).
-- Replaces the guesswork in bl_wa_0367's wa_hook with what Telnyx actually sends. Nothing else changes.
--
-- WHAT TELNYX ACTUALLY SENDS (verified, not documented anywhere by them):
--   data.event_type = "message.received"
--   data.payload = {
--     id: "<telnyx message id>",            -- what we store in wa_messages.telnyx_message_id
--     to: "+18153651168",                   -- a STRING here, not the array SMS uses
--     from: { phone_number: "+19283936198", carrier, line_type },
--     type: "WHATSAPP",                     -- UPPERCASE
--     direction: "inbound", record_type: "message", messaging_profile_id: "...",
--     body: {                               -- the WhatsApp message itself lives one level down
--       id, from, type: "text",
--       text: { body: "hey" },              -- <<< the text. bl_wa_0367 looked at payload.text and found nothing
--       timestamp: "1789981175",
--       foreign_id: "wamid.HBgLMTkyODM5MzYxOTgV...",   -- Meta's own message id
--       from_user_id: "US.1602319518181498"
--     }
--   }
-- So: text = payload.body.text.body. For a non-text message (image, document, audio, location…) `body.type`
-- says which, and the whole `body` object is kept in wa_messages.media so nothing is lost until we have seen
-- one of those live too. A caption, where one exists, is read from body.<type>.caption.
-- The older shapes bl_wa_0367 guessed at are kept as fallbacks — they cost nothing and protect against a change.
-- Outbound status webhooks have still NOT been seen; the status branch is unchanged and will be checked on the
-- first reply we send.

create or replace function public.wa_hook(p jsonb, p_verified boolean default true) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare ev text := p->>'event_type'; pl jsonb := coalesce(p->'payload','{}'::jsonb); v_id text := coalesce(pl->>'id', p->>'id');
  v_from text; v_to text; v_text text; v_dir text; v_status text; cfg app_private.dialer_config;
  t app_private.wa_threads; m app_private.wa_messages; mt jsonb; rt jsonb; v_media jsonb; res jsonb;
  b jsonb; v_btype text;
begin
  insert into app_private.wa_webhook_log (event_id, event_type, verified, payload)
  values (coalesce(v_id, gen_random_uuid()::text), ev, p_verified, p) on conflict (event_id) do nothing;
  if not coalesce(p_verified, false) then return jsonb_build_object('ok', true, 'logged_only', true); end if;
  select * into cfg from app_private.dialer_config where id = 1;

  b := case when jsonb_typeof(pl->'body') = 'object' then pl->'body' else '{}'::jsonb end;   -- the WhatsApp message
  v_btype := lower(coalesce(b->>'type',''));

  v_from := app_private.dial_e164(coalesce(pl->'from'->>'phone_number',
                                           case when jsonb_typeof(pl->'from') = 'string' then pl->>'from' end,
                                           b->>'from'));
  v_to   := app_private.dial_e164(coalesce(case when jsonb_typeof(pl->'to') = 'string' then pl->>'to' end,
                                           pl->'to'->0->>'phone_number', pl->'to'->>'phone_number'));
  v_text := coalesce(
      b->'text'->>'body',                                              -- the real shape
      case when v_btype <> '' then b->(v_btype)->>'caption' end,       -- image/video/document caption
      case when jsonb_typeof(pl->'text') = 'string' then pl->>'text' when jsonb_typeof(pl->'text') = 'object' then pl->'text'->>'body' end,
      pl->'whatsapp_message'->'text'->>'body', pl->'message'->'text'->>'body', '');
  v_media := case
      when jsonb_typeof(pl->'media') = 'array' and jsonb_array_length(pl->'media') > 0 then pl->'media'
      when v_btype not in ('', 'text') then b                          -- keep the whole body until we have seen one live
      else null end;
  v_dir := lower(coalesce(pl->>'direction',''));

  if v_id is not null and exists (select 1 from app_private.wa_messages where telnyx_message_id = v_id) then
    v_status := lower(coalesce(pl->'to'->0->>'status', pl->>'status', ''));
    update app_private.wa_messages set updated_at = now(),
       status = case when v_status = 'delivered' then 'delivered' when v_status = 'read' then 'read'
                     when v_status in ('sending_failed','delivery_failed','failed') then 'failed'
                     when v_status in ('sent','queued','sending','delivery_unconfirmed') and status = 'queued' then 'sent'
                     when ev = 'message.delivered' then 'delivered' when ev = 'message.read' then 'read'
                     when ev = 'message.failed' then 'failed' when ev = 'message.sent' and status = 'queued' then 'sent'
                     else status end,
       error = case when v_status in ('sending_failed','delivery_failed','failed') or ev = 'message.failed'
                    then left(coalesce(pl->'errors'->0->>'detail', pl->'errors'->0->>'title', nullif(v_status,'')), 300) else error end
     where telnyx_message_id = v_id returning * into m;
    update app_private.wa_webhook_log set result = jsonb_build_object('status_update', true, 'message_id', m.id) where event_id = v_id;
    return jsonb_build_object('ok', true, 'status_update', true);
  end if;

  if ev = 'message.received' or v_dir = 'inbound' then
    if v_from is null then return jsonb_build_object('ok', true, 'skipped','no from'); end if;
    if cfg.wa_number is not null and v_to is not null and v_to <> cfg.wa_number then
      return jsonb_build_object('ok', true, 'skipped','not our WhatsApp number'); end if;
    select * into t from app_private.wa_threads where wa_number = coalesce(cfg.wa_number, v_to) and counterparty = v_from;
    if t.id is null then
      insert into app_private.wa_threads (wa_number, counterparty, owner_user_id, last_at, last_direction)
      values (coalesce(cfg.wa_number, v_to), v_from, null, now(), 'inbound') returning * into t;
    end if;
    if t.owner_user_id is null or t.carrier_org_id is null then
      rt := app_private.wa_route(v_from);
      if rt <> '{}'::jsonb then
        update app_private.wa_threads set
           carrier_org_id = coalesce(carrier_org_id, nullif(rt->>'carrier_org_id','')::uuid),
           owner_user_id  = coalesce(owner_user_id,  nullif(rt->>'owner_user_id','')::uuid),
           updated_at = now()
         where id = t.id returning * into t;
      end if;
    end if;
    if t.owner_user_id is not null and coalesce(t.contact_name,'') = '' then
      mt := app_private.dial_match(t.owner_user_id, v_from);
      if nullif(mt->>'contact_name','') is not null then
        update app_private.wa_threads set contact_name = mt->>'contact_name', contact_kind = nullif(mt->>'kind',''),
          carrier_org_id = coalesce(carrier_org_id, nullif(mt->>'carrier_org_id','')::uuid) where id = t.id returning * into t;
      end if;
    end if;
    insert into app_private.wa_messages (thread_id, direction, kind, body, media, status, telnyx_message_id)
    values (t.id, 'inbound', case when v_media is not null then 'media' else 'text' end, left(v_text, 4000), v_media, 'received', v_id)
    on conflict (telnyx_message_id) do nothing returning * into m;
    if m.id is null then return jsonb_build_object('ok', true, 'dup', true); end if;
    update app_private.wa_threads set unread = unread + 1, last_at = now(),
       last_body = left(coalesce(nullif(v_text,''), '[' || coalesce(nullif(v_btype,''), 'attachment') || ']'), 300),
       last_direction = 'inbound', last_inbound_at = now(), status = 'open', updated_at = now() where id = t.id returning * into t;
    res := jsonb_build_object('ok', true, 'thread_id', t.id, 'message_id', m.id, 'unassigned', t.owner_user_id is null,
                              'routed', coalesce(rt->>'why', 'pool'), 'kind', coalesce(nullif(v_btype,''), 'text'));
    if t.owner_user_id is not null then
      res := res || jsonb_build_object('notify', jsonb_build_object('user_id', t.owner_user_id,
        'title', 'WhatsApp from ' || coalesce(nullif(t.contact_name,''), t.counterparty),
        'body', left(coalesce(nullif(v_text,''), 'Sent an attachment'), 120), 'url', '/app/agent/#today'));
    end if;
    update app_private.wa_webhook_log set result = res, thread_id = t.id where event_id = v_id;
    return res;
  end if;

  return jsonb_build_object('ok', true, 'ignored', ev);
end $$;

revoke all on function public.wa_hook(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.wa_hook(jsonb, boolean) to service_role;
