-- bl_wa_0487 — "Hide from dispatcher": staff can mark any WhatsApp message as Command-Center-only.
--
-- WHY: a WhatsApp message cannot be unsent through the Business API (there is no "delete for everyone"), and
-- some of what staff write on a shared thread (the founder's apology, pricing, internal context) should not be
-- read by the dispatcher the chat is assigned to. The customer still has the message; the dispatcher does not.
--
-- WHAT A DISPATCHER CAN NO LONGER SEE, once a message is hidden (staff still see everything):
--   · wa_thread      — the message is left out of the conversation.
--   · wa_media_ref   — its attachment cannot be fetched by id ("That message does not exist.").
--   · wa_thread_json — the inbox preview (last_body / last_direction / last_at) falls back to the newest
--                      message they CAN see. This is what wa_inbox and wa_thread hand the dispatcher.
--   Fail-closed: any caller that is not staff (a dispatcher, or no signed-in user at all) gets the filtered view.
--
-- NEW RPC: public.cc_wa_message_hide(p_id uuid, p_hidden boolean) — staff only; authenticated only (never anon).
--
-- The three existing functions are patched by ANCHOR on their live definition (read with pg_get_functiondef and
-- replaced one string at a time), not retyped, so staging and prod keep whatever else they carry. Each anchor is
-- asserted: if it is not found the migration fails instead of silently doing nothing.

alter table app_private.wa_messages
  add column if not exists hidden_from_dispatcher boolean not null default false,
  add column if not exists hidden_at timestamptz,
  add column if not exists hidden_by uuid;
create index if not exists wa_messages_hidden_idx on app_private.wa_messages (thread_id, created_at desc) where hidden_from_dispatcher;

-- true only for staff; a dispatcher or a caller with no user is "not staff" (fail-closed)
create or replace function app_private.wa_viewer_is_staff() returns boolean
language sql stable set search_path = app_private, public, pg_temp as $$
  select coalesce(app_private.wa_actor(auth.uid()) = 'staff', false)
$$;
revoke all on function app_private.wa_viewer_is_staff() from public, anon;

do $mig$
declare d text; n text;
begin
  -- 1. wa_thread: dispatchers do not get hidden messages
  d := pg_get_functiondef('public.wa_thread(uuid, timestamptz)'::regprocedure);
  n := replace(d, 'select * from app_private.wa_messages where thread_id = t.id and (p_before is null or created_at < p_before)',
                  'select * from app_private.wa_messages where thread_id = t.id and (p_before is null or created_at < p_before) and (v_role = ''staff'' or not hidden_from_dispatcher)');
  if n = d then raise exception 'bl_wa_0487: wa_thread anchor not found'; end if;
  execute n;

  -- 2. wa_media_ref: a hidden message's attachment cannot be fetched by a dispatcher either
  d := pg_get_functiondef('public.wa_media_ref(uuid)'::regprocedure);
  n := replace(d, 'if m.id is null then return jsonb_build_object(''error'',''That message does not exist.''); end if;',
                  'if m.id is null then return jsonb_build_object(''error'',''That message does not exist.''); end if;
  if v_role <> ''staff'' and m.hidden_from_dispatcher then return jsonb_build_object(''error'',''That message does not exist.''); end if;');
  if n = d then raise exception 'bl_wa_0487: wa_media_ref anchor not found'; end if;
  execute n;

  -- 3. wa_msg_json: staff see which messages are hidden
  d := pg_get_functiondef('app_private.wa_msg_json(app_private.wa_messages)'::regprocedure);
  n := replace(d, '''voice'', coalesce(', '''hidden'', coalesce(m.hidden_from_dispatcher, false), ''hidden_at'', m.hidden_at,
    ''voice'', coalesce(');
  if n = d then raise exception 'bl_wa_0487: wa_msg_json anchor not found'; end if;
  execute n;

  -- 4. wa_thread_json: the live body moves to wa_thread_json_raw untouched; wa_thread_json wraps it
  d := pg_get_functiondef('app_private.wa_thread_json(app_private.wa_threads)'::regprocedure);
  n := replace(d, 'FUNCTION app_private.wa_thread_json(', 'FUNCTION app_private.wa_thread_json_raw(');
  if n = d then raise exception 'bl_wa_0487: wa_thread_json anchor not found'; end if;
  execute n;
end $mig$;
revoke all on function app_private.wa_thread_json_raw(app_private.wa_threads) from public, anon;

create or replace function app_private.wa_thread_json(t app_private.wa_threads) returns jsonb
language sql stable set search_path = app_private, public, extensions, pg_temp as $$
  select case
    when not exists (select 1 from app_private.wa_messages h where h.thread_id = t.id and h.hidden_from_dispatcher)
      or app_private.wa_viewer_is_staff()
    then app_private.wa_thread_json_raw(t)
    else app_private.wa_thread_json_raw(t) || coalesce(
      (select jsonb_build_object(
          'last_body', left(coalesce(nullif(m.body, ''), case when m.media is not null then '[' || coalesce(nullif(m.media->>'type', ''), 'attachment') || ']' else '' end), 140),
          'last_direction', m.direction, 'last_at', m.created_at)
         from app_private.wa_messages m
        where m.thread_id = t.id and not m.hidden_from_dispatcher
        order by m.created_at desc limit 1),
      jsonb_build_object('last_body', '', 'last_direction', null))
  end
$$;

create or replace function public.cc_wa_message_hide(p_id uuid, p_hidden boolean default true) returns jsonb
language plpgsql security definer set search_path = app_private, public, pg_temp as $$
declare m app_private.wa_messages; v_was boolean; v_on boolean := coalesce(p_hidden, true);
begin
  if not app_private.disp_is_staff() then raise exception 'staff only'; end if;
  select hidden_from_dispatcher into v_was from app_private.wa_messages where id = p_id;
  if v_was is null then return jsonb_build_object('error', 'That message does not exist.'); end if;
  update app_private.wa_messages
     set hidden_from_dispatcher = v_on,
         hidden_at = case when v_on then now() end,
         hidden_by = case when v_on then auth.uid() end,
         updated_at = now()
   where id = p_id returning * into m;
  -- an unread inbound message the dispatcher will never see must not leave a badge on their inbox
  if v_on and not v_was and m.direction = 'inbound' and m.read_at is null then
    update app_private.wa_threads set unread = greatest(0, unread - 1) where id = m.thread_id;
  end if;
  return jsonb_build_object('ok', true, 'id', m.id, 'hidden', m.hidden_from_dispatcher);
end $$;
revoke all on function public.cc_wa_message_hide(uuid, boolean) from public, anon;
grant execute on function public.cc_wa_message_hide(uuid, boolean) to authenticated;
