-- bl_wa_0507 — WhatsApp reactions showed as a broken "Attachment / file" bubble ("That message has no attachment").
-- Additive: wa_msg_json also returns reaction_emoji + reaction_to (the reacted message's text, 120 chars).
CREATE OR REPLACE FUNCTION app_private.wa_msg_json(m app_private.wa_messages)
 RETURNS jsonb LANGUAGE sql STABLE
 SET search_path TO 'app_private', 'public', 'extensions', 'pg_temp'
AS $function$
  select jsonb_build_object('id', m.id, 'direction', m.direction, 'kind', m.kind, 'body', m.body,
    'template_name', m.template_name, 'status', m.status, 'error', m.error, 'at', m.created_at,
    'sender_user_id', m.sender_user_id, 'read', m.read_at is not null,
    'has_media', m.media is not null,
    'media_kind', nullif(m.media->>'type',''),
    'mime', nullif(m.media->(m.media->>'type')->>'mime_type',''),
    'file_name', nullif(m.media->(m.media->>'type')->>'filename',''),
    'hidden', coalesce(m.hidden_from_dispatcher, false), 'hidden_at', m.hidden_at,
    'voice', coalesce((m.media->(m.media->>'type')->>'voice')::boolean, false),
    'reaction_emoji', case when m.media->>'type' = 'reaction' then coalesce(m.media->'reaction'->>'emoji', '') end,
    'reaction_to', case when m.media->>'type' = 'reaction' then
      (select left(coalesce(nullif(r.body,''), '[attachment]'), 120) from app_private.wa_messages r
        where r.thread_id = m.thread_id and r.telnyx_message_id = m.media->'reaction'->>'message_id' limit 1) end)
$function$;
