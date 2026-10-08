-- bl_wa_0532 — WhatsApp "Reply" (quoted replies), both directions. ADDITIVE. STAGING FIRST (snslhvmkjusozgjelghi).
--
-- WHAT: a message can point at the message it answers.
--   · inbound  — Meta sends `context: { from, id }` on the message object when the other side used Reply; Telnyx
--                hands it through at payload.body.context. The id is Meta's wamid (or, if Telnyx maps it, the
--                Telnyx id of the quoted message) — we match either, inside the same thread.
--   · outbound — Telnyx's /v2/messages/whatsapp takes `whatsapp_message.context.message_id` (the Cloud API shape;
--                Telnyx docs show a wamid). An INBOUND message has a wamid (body.foreign_id). An OUTBOUND one does
--                not: Telnyx's send response and its status webhooks carry no wamid (checked on staging's
--                wa_webhook_log, 21 Sep). So quoting one of our OWN messages sends the Telnyx id as context and the
--                edge function retries ONCE without context if Telnyx refuses it (`context_fallback`): the quote
--                then shows in LoadBoot only. Nothing is sent twice — a refused request sends nothing.
-- COLUMNS (nullable, no defaults — safe on a live table):
--   wa_messages.wamid           Meta's id. Inbound: body.foreign_id. Backfilled below from wa_webhook_log.
--   wa_messages.reply_to        the quoted row, same thread. FK, on delete set null.
--   wa_messages.reply_to_wamid  the raw id the other side quoted / we sent as context, kept even when no row matched.
-- HIDDEN MESSAGES (bl_wa_0487): a dispatcher cannot quote a message hidden from him (wa_send_prepare refuses), and a
-- quote of a hidden message renders as "Message hidden" for him (wa_msg_json returns quote.hidden = true, no body).
-- Live functions are patched BY ANCHOR on their current definition (pg_get_functiondef + replace), each anchor
-- asserted, so staging and prod keep whatever else they carry. wa_msg_json is small and is replaced whole
-- (its live body is bl_wa_0507's, verified on staging 8 Oct 2026).
-- No new public function: the anon-executable SECURITY DEFINER surface does not change (35 staging / 36 prod).

alter table app_private.wa_messages
  add column if not exists wamid text,
  add column if not exists reply_to uuid references app_private.wa_messages(id) on delete set null,
  add column if not exists reply_to_wamid text;
create index if not exists wa_messages_wamid_ix    on app_private.wa_messages (wamid)    where wamid is not null;
create index if not exists wa_messages_reply_to_ix on app_private.wa_messages (reply_to) where reply_to is not null;

-- wamid for the inbound rows that are already there: the raw event is still in the log
update app_private.wa_messages m
   set wamid = nullif(l.payload->'payload'->'body'->>'foreign_id', '')
  from app_private.wa_webhook_log l
 where m.wamid is null and m.direction = 'inbound' and l.event_id = m.telnyx_message_id
   and nullif(l.payload->'payload'->'body'->>'foreign_id', '') is not null;

do $mig$
declare d text; n text;
begin
  -- 1. wa_hook: keep the wamid, and read the quoted id off an inbound reply
  d := pg_get_functiondef('public.wa_hook(jsonb, boolean)'::regprocedure);
  n := replace(d, '  b jsonb; v_btype text;', '  b jsonb; v_btype text; v_ctx text; v_reply_to uuid;');
  if n = d then raise exception 'bl_wa_0532: wa_hook anchor 1 (declare) not found'; end if;
  d := n;
  n := replace(d, '    insert into app_private.wa_messages (thread_id, direction, kind, body, media, status, telnyx_message_id)',
$a$    -- bl_wa_0532: the other side pressed Reply. Meta's context.id is a wamid; match it (or a Telnyx id) in THIS thread.
    v_ctx := nullif(coalesce(b->'context'->>'id', b->'context'->>'message_id'), '');
    if v_ctx is not null then
      select x.id into v_reply_to from app_private.wa_messages x
       where x.thread_id = t.id and (x.wamid = v_ctx or x.telnyx_message_id = v_ctx)
       order by x.created_at desc limit 1;
    end if;
    insert into app_private.wa_messages (thread_id, direction, kind, body, media, status, telnyx_message_id, wamid, reply_to, reply_to_wamid)$a$);
  if n = d then raise exception 'bl_wa_0532: wa_hook anchor 2 (insert) not found'; end if;
  d := n;
  n := replace(d, 'left(v_text, 4000), v_media, ''received'', v_id)',
                  'left(v_text, 4000), v_media, ''received'', v_id, nullif(b->>''foreign_id'',''''), v_reply_to, v_ctx)');
  if n = d then raise exception 'bl_wa_0532: wa_hook anchor 3 (values) not found'; end if;
  execute n;

  -- 2. wa_send_prepare: accept p.reply_to, refuse a foreign or (for a dispatcher) hidden target, add context to the payload
  d := pg_get_functiondef('public.wa_send_prepare(jsonb)'::regprocedure);
  n := replace(d, '  v_kind text := ''text''; v_payload jsonb; r jsonb;',
                  '  v_kind text := ''text''; v_payload jsonb; r jsonb; v_reply uuid; v_reply_row app_private.wa_messages; v_ctx_id text; v_ctx_fallback boolean := false;');
  if n = d then raise exception 'bl_wa_0532: wa_send_prepare anchor 1 (declare) not found'; end if;
  d := n;
  n := replace(d, '  insert into app_private.wa_messages (thread_id, direction, sender_user_id, kind, body, media, template_name, template_vars, status)',
$a$  -- bl_wa_0532: a quoted reply. The target must be in THIS thread; a dispatcher cannot quote a message hidden from him.
  v_reply := nullif(p->>'reply_to','')::uuid;
  if v_reply is not null then
    select * into v_reply_row from app_private.wa_messages x where x.id = v_reply and x.thread_id = t.id;
    if v_reply_row.id is null or (v_role <> 'staff' and coalesce(v_reply_row.hidden_from_dispatcher, false)) then
      return jsonb_build_object('ok', false, 'error', 'The message you are replying to is not in this conversation.'); end if;
    v_ctx_id := coalesce(nullif(v_reply_row.wamid,''), nullif(v_reply_row.telnyx_message_id,''));
    v_ctx_fallback := nullif(v_reply_row.wamid,'') is null;   -- our own message: no wamid; Telnyx may refuse its id as context
    if v_ctx_id is not null then
      v_payload := v_payload || jsonb_build_object('context', jsonb_build_object('message_id', v_ctx_id));
    end if;
  end if;
  insert into app_private.wa_messages (thread_id, direction, sender_user_id, kind, body, media, template_name, template_vars, status, reply_to, reply_to_wamid)$a$);
  if n = d then raise exception 'bl_wa_0532: wa_send_prepare anchor 2 (insert) not found'; end if;
  d := n;
  n := replace(d, 'v_media, tpl.name, v_vars, ''queued'') returning * into m;',
                  'v_media, tpl.name, v_vars, ''queued'', v_reply_row.id, v_ctx_id) returning * into m;');
  if n = d then raise exception 'bl_wa_0532: wa_send_prepare anchor 3 (values) not found'; end if;
  d := n;
  n := replace(d, '''messaging_profile_id'', cfg.wa_messaging_profile_id, ''message'', app_private.wa_msg_json(m));',
                  '''messaging_profile_id'', cfg.wa_messaging_profile_id, ''context_fallback'', v_ctx_fallback, ''context_id'', v_ctx_id, ''message'', app_private.wa_msg_json(m));');
  if n = d then raise exception 'bl_wa_0532: wa_send_prepare anchor 4 (return) not found'; end if;
  execute n;
end $mig$;

-- 3. wa_msg_json: the quote, flattened for the screen. bl_wa_0507's body + wamid / reply_to / quote.
create or replace function app_private.wa_msg_json(m app_private.wa_messages) returns jsonb
language sql stable set search_path = app_private, public, extensions, pg_temp as $$
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
        where r.thread_id = m.thread_id and r.telnyx_message_id = m.media->'reaction'->>'message_id' limit 1) end,
    -- bl_wa_0532: quoted replies
    'wamid', m.wamid, 'reply_to', m.reply_to, 'reply_to_wamid', m.reply_to_wamid,
    'quote', case
      when m.reply_to is not null then
        (select case when coalesce(q.hidden_from_dispatcher, false) and not app_private.wa_viewer_is_staff()
             then jsonb_build_object('id', q.id, 'hidden', true)      -- "Message hidden": no text, no kind, for a dispatcher
             else jsonb_build_object('id', q.id, 'hidden', false, 'direction', q.direction, 'kind', q.kind,
                    'media_kind', nullif(q.media->>'type',''),
                    'body', left(coalesce(nullif(q.body,''), case when q.media is not null then '[' || coalesce(nullif(q.media->>'type',''), 'attachment') || ']' else '' end), 160))
             end
           from app_private.wa_messages q where q.id = m.reply_to)
      when m.reply_to_wamid is not null then jsonb_build_object('missing', true)   -- they quoted something LoadBoot never stored
      else null end)
$$;
revoke all on function app_private.wa_msg_json(app_private.wa_messages) from public, anon;

-- CHECK after applying (names, not just the count):
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');  -- 35 staging / 36 prod
