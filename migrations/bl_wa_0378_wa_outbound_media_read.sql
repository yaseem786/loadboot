-- bl_wa_0378 — two holes found by reading the bl_wa_0375 outbound-media path end to end (21 Sep 2026),
-- BEFORE the first file was ever sent. Neither would have shown up as an error; both would have looked
-- like the feature working.
--
-- 1. AN OUTBOUND ATTACHMENT COULD NEVER BE OPENED AGAIN.
--    bl_wa_0372's public.wa_media_ref() reads the file's location from media->:type->'url' — Telnyx's own
--    storage, which is where an INBOUND file lives. bl_wa_0375 stores an outbound file as
--    media->:type->'path' (an object in LoadBoot's private wa-media bucket); there is no 'url'. So every
--    outbound photo, voice note and document answered 'That message has no attachment.' — the dispatcher
--    could send a rate confirmation and then never see it again, and the bubble in his own thread would
--    read "Photo unavailable". wa_media_ref now returns EITHER a url (inbound, Telnyx) OR a bucket+path
--    (outbound, ours) and the edge function fetches whichever it is given.
--
-- 2. EVERY DISPATCHER COULD READ EVERY CARRIER'S ATTACHMENTS.
--    bl_wa_0374's "wa media read" policy let ANY wa actor select ANY object in wa-media. The paths are
--    random, but storage.list() enumerates them, so one dispatcher could have listed and downloaded every
--    WhatsApp file LoadBoot ever sent, including another carrier's documents — through the client, with no
--    RPC and no ownership check. The browser never reads this bucket (it only uploads; reading goes through
--    wa_media_ref + the edge function, which uses the service role and bypasses RLS), so the policy bought
--    nothing. It is now staff-only. Uploads are also pinned to a thread the uploader may actually write to,
--    instead of any path under wa/.
--
-- Additive and reversible. APPLY ON STAGING FIRST.

-- ---------------------------------------------------------------- 1. the reader
create or replace function public.wa_media_ref(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); v_role text; m app_private.wa_messages; t app_private.wa_threads;
  v_type text; v_obj jsonb; v_url text; v_path text;
begin
  v_role := app_private.wa_actor(v_uid);
  if v_role is null then return jsonb_build_object('error','Not allowed.'); end if;
  select * into m from app_private.wa_messages where id = p_id;
  if m.id is null then return jsonb_build_object('error','That message does not exist.'); end if;
  select * into t from app_private.wa_threads where id = m.thread_id;
  if v_role <> 'staff' and t.owner_user_id is distinct from v_uid then
    return jsonb_build_object('error','That conversation is not yours.'); end if;

  v_type := nullif(m.media->>'type','');
  v_obj  := case when v_type is not null then m.media->v_type else null end;
  v_url  := nullif(v_obj->>'url','');     -- inbound: Telnyx storage
  v_path := nullif(v_obj->>'path','');    -- outbound: our private wa-media bucket
  if v_url is null and v_path is null then return jsonb_build_object('error','That message has no attachment.'); end if;

  return jsonb_strip_nulls(jsonb_build_object('ok', true,
    'url', v_url,
    'bucket', case when v_url is null then 'wa-media' end,
    'path', case when v_url is null then v_path end,
    'mime', coalesce(nullif(v_obj->>'mime_type',''), 'application/octet-stream'),
    'kind', v_type,
    'file_name', nullif(v_obj->>'filename','')));
end $$;

revoke all on function public.wa_media_ref(uuid) from public, anon;
grant execute on function public.wa_media_ref(uuid) to authenticated;

-- ---------------------------------------------------------------- 2. the bucket
-- may this actor put a file under wa/<thread_id>/…? Staff always; a dispatcher only for a conversation he
-- owns or is entitled to take. The cast is guarded — a hand-made path must fail closed, not raise.
create or replace function app_private.wa_can_write_object(p_uid uuid, p_name text) returns boolean
language plpgsql stable security definer set search_path = app_private, public as $$
declare parts text[] := storage.foldername(p_name); v_tid uuid; t app_private.wa_threads;
begin
  if app_private.wa_actor(p_uid) is null then return false; end if;
  if app_private.disp_is_staff() then return true; end if;
  if array_length(parts, 1) is distinct from 2 or parts[1] <> 'wa' then return false; end if;
  begin v_tid := parts[2]::uuid; exception when others then return false; end;
  select * into t from app_private.wa_threads where id = v_tid;
  if t.id is null then return false; end if;
  return t.owner_user_id = p_uid
      or (t.owner_user_id is null and app_private.wa_can_take(p_uid, t.carrier_org_id));
end $$;

drop policy if exists "wa media insert" on storage.objects;
create policy "wa media insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'wa-media' and app_private.wa_can_write_object(auth.uid(), name));

-- the browser has no business reading this bucket directly; wa_media_ref is the only door.
drop policy if exists "wa media read" on storage.objects;
create policy "wa media read" on storage.objects for select to authenticated
  using (bucket_id = 'wa-media' and app_private.disp_is_staff());
