-- bl_wa_0372 — incoming WhatsApp MEDIA becomes something you can actually see, hear and open.
-- Read off three real messages (21 Sep 2026, 10:24–10:25 UTC): a photo, a voice note and a PDF.
--
-- WHAT TELNYX SENDS FOR MEDIA (again, documented nowhere — this is from the live events):
--   payload.body = { id, from, type: "image" | "audio" | "document" | …, timestamp, foreign_id, from_user_id,
--                    <type>: { id, url, sha256, mime_type, voice?: true, caption?, filename? } }
--   e.g. image → { url: "https://rcs-outbound-east.us-east-1.telnyxcloudstorage.com/…jpeg", mime_type: "image/jpeg" }
--        audio → { …".ogg", mime_type: "audio/ogg; codecs=opus", voice: true }   ← a WhatsApp voice note
--        document → { …".pdf", mime_type: "application/pdf" }
--   bl_wa_0370 already stores that whole `body` object in wa_messages.media, so nothing was lost — this migration
--   only teaches the app to read it.
--
-- WHY THE FILE IS NOT HANDED TO THE BROWSER DIRECTLY
--   The URL points at Telnyx's storage, not ours: we do not know how long it lives, and a carrier's document
--   should not be a link anyone who sees it can open. public.wa_media_ref() returns the URL only to the
--   dispatcher who owns the conversation (or staff), and the `telnyx-wa-media` edge function is what fetches the
--   bytes and streams them to that person. The browser never sees the Telnyx URL.
-- Whether those URLs expire is UNVERIFIED — if an old photo stops opening one day, that is the reason, and the
-- fix is to copy media into LoadBoot's own storage on arrival.

create or replace function app_private.wa_msg_json(m app_private.wa_messages) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', m.id, 'direction', m.direction, 'kind', m.kind, 'body', m.body,
    'template_name', m.template_name, 'status', m.status, 'error', m.error, 'at', m.created_at,
    'sender_user_id', m.sender_user_id, 'read', m.read_at is not null,
    -- media, flattened for the screen (m.media holds Telnyx's whole `body` object)
    'has_media', m.media is not null,
    'media_kind', nullif(m.media->>'type',''),
    'mime', nullif(m.media->(m.media->>'type')->>'mime_type',''),
    'file_name', nullif(m.media->(m.media->>'type')->>'filename',''),
    'voice', coalesce((m.media->(m.media->>'type')->>'voice')::boolean, false))
$$;

-- the URL, to the people entitled to it. The edge function calls this AS THE CALLER.
create or replace function public.wa_media_ref(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); v_role text; m app_private.wa_messages; t app_private.wa_threads; v_url text;
begin
  v_role := app_private.wa_actor(v_uid);
  if v_role is null then return jsonb_build_object('error','Not allowed.'); end if;
  select * into m from app_private.wa_messages where id = p_id;
  if m.id is null then return jsonb_build_object('error','That message does not exist.'); end if;
  select * into t from app_private.wa_threads where id = m.thread_id;
  if v_role <> 'staff' and t.owner_user_id is distinct from v_uid then
    return jsonb_build_object('error','That conversation is not yours.'); end if;
  v_url := nullif(m.media->(m.media->>'type')->>'url','');
  if v_url is null then return jsonb_build_object('error','That message has no attachment.'); end if;
  return jsonb_build_object('ok', true, 'url', v_url,
    'mime', coalesce(nullif(m.media->(m.media->>'type')->>'mime_type',''), 'application/octet-stream'),
    'kind', nullif(m.media->>'type',''),
    'file_name', nullif(m.media->(m.media->>'type')->>'filename',''));
end $$;

revoke all on function public.wa_media_ref(uuid) from public, anon;
grant execute on function public.wa_media_ref(uuid) to authenticated;
