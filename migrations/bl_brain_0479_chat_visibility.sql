-- bl_brain_0479 — the owner sees what the AI is doing in live chat (27 Sep 2026)
--
--   1. brain_config.chat_notify_new (default ON): the moment Claude/Gemini writes the FIRST reply of a new
--      conversation, staff get an in-app notification (bell) — "🤖 AI answered a new chat — <visitor>" with the
--      question and a deep link to that chat. Later replies in the same chat do not notify (one per conversation).
--      Switch: CC → AI Brain → Overview ("Tell me when the AI takes a new chat"), through cc_brain_config_set,
--      logged in the brain change log like every other config change (§9).
--   2. public.cc_brain_chats(p_limit): one row per live-chat brain job joined to its conversation — who asked,
--      what the AI answered, which desk ([[as:<desk>]] tag → Riley / Sara / Omar / Ali / Maya / Daniel), model,
--      tokens, cost, time, and whether a human has since taken over. Feeds the new CC → AI Brain → Chats tab.
--   3. (UI, same commit) CC → Live chat → "Needs you" now also lists the chats the AI is answering, with an
--      "AI answering" badge, so nothing the AI is handling is out of sight on the default tab.
--
-- Patches are anchor-replacements on the live definitions (lc_bot_deliver, cc_brain_config_set,
-- cc_brain_overview, brain_state); each DO block refuses to run if its anchor is not found, and is idempotent.
-- Anon-executable SECURITY DEFINER surface: unchanged (cc_brain_chats is revoked from public/anon below).

begin;

-- ── 1. the switch ────────────────────────────────────────────────────────────────────────────────────────
alter table app_private.brain_config add column if not exists chat_notify_new boolean not null default true;

-- cc_brain_config_set learns the key
do $do$
declare v_src text;
begin
  v_src := pg_get_functiondef('public.cc_brain_config_set'::regproc);
  if position('chat_notify_new' in v_src) > 0 then raise notice 'cc_brain_config_set already patched'; return; end if;
  if position($a$timeout_ms       = coalesce((p_patch ->> 'timeout_ms')::int, timeout_ms),$a$ in v_src) = 0 then
    raise exception 'bl_brain_0479: anchor not found in cc_brain_config_set';
  end if;
  v_src := replace(v_src,
    $a$timeout_ms       = coalesce((p_patch ->> 'timeout_ms')::int, timeout_ms),$a$,
    $b$timeout_ms       = coalesce((p_patch ->> 'timeout_ms')::int, timeout_ms),
    chat_notify_new  = coalesce((p_patch ->> 'chat_notify_new')::boolean, chat_notify_new),   -- bl_brain_0479$b$);
  execute v_src;
end $do$;

-- brain_state() and cc_brain_overview() expose it so the Overview switch shows the truth
do $do$
declare v_src text;
begin
  v_src := pg_get_functiondef('app_private.brain_state'::regproc);
  if position('chat_notify_new' in v_src) > 0 then raise notice 'brain_state already patched'; return; end if;
  if position($a$'max_tool_calls', c.max_tool_calls)$a$ in v_src) = 0 then
    raise exception 'bl_brain_0479: anchor not found in brain_state';
  end if;
  v_src := replace(v_src, $a$'max_tool_calls', c.max_tool_calls)$a$,
                          $b$'max_tool_calls', c.max_tool_calls, 'chat_notify_new', c.chat_notify_new)$b$);
  execute v_src;
end $do$;

do $do$
declare v_src text;
begin
  v_src := pg_get_functiondef('public.cc_brain_overview'::regproc);
  if position('chat_notify_new' in v_src) > 0 then raise notice 'cc_brain_overview already patched'; return; end if;
  if position($a$'config',  (select jsonb_build_object('enabled', c.enabled,$a$ in v_src) = 0 then
    raise exception 'bl_brain_0479: anchor not found in cc_brain_overview';
  end if;
  v_src := replace(v_src, $a$'config',  (select jsonb_build_object('enabled', c.enabled,$a$,
                          $b$'config',  (select jsonb_build_object('chat_notify_new', c.chat_notify_new, 'enabled', c.enabled,$b$);
  execute v_src;
end $do$;

-- ── 2. lc_bot_deliver: notify staff on the FIRST AI reply of a conversation ──────────────────────────────
-- v_bot is counted BEFORE the insert in the live function, so v_bot = 0 means "this is the first bot message".
do $do$
declare v_src text;
begin
  v_src := pg_get_functiondef('app_private.lc_bot_deliver'::regproc);
  if position('livechat.ai_answered' in v_src) > 0 then raise notice 'lc_bot_deliver already patched'; return; end if;
  if position($a$return jsonb_build_object('ok', true, 'wrote', true);$a$ in v_src) = 0 then
    raise exception 'bl_brain_0479: anchor not found in lc_bot_deliver';
  end if;
  v_src := replace(v_src, $a$return jsonb_build_object('ok', true, 'wrote', true);$a$, $b$-- bl_brain_0479: the owner wants to know the moment the AI takes a NEW chat (first bot reply only).
  if v_bot = 0 and coalesce((select bc.chat_notify_new from app_private.brain_config bc where bc.id), true) then
    begin
      insert into app_private.notifications (recipient_role, channel, template_key, payload, status, sent_at)
      values ('staff', 'in_app', 'livechat.ai_answered',
        jsonb_build_object(
          'title', '🤖 AI answered a new chat — ' || coalesce(nullif(btrim(v_conv.name), ''), 'Visitor')
                   || coalesce(' · ' || nullif(v_conv.visitor_role, ''), ''),
          'body',  coalesce((select left(regexp_replace(m.body, '\s+', ' ', 'g'), 160)
                               from app_private.lc_messages m
                              where m.conversation_id = p_conv and m.sender = 'visitor'
                              order by m.id limit 1), '(no question yet)')
                   || coalesce(' · on ' || nullif(v_conv.page, ''), ''),
          'tone',  'info',
          'url',   '/app/command-center/#/live-chat?id=' || p_conv::text,
          'conversation_id', p_conv),
        'sent', now());
    exception when others then
      raise warning 'lc_bot_deliver: ai_answered notification failed for %: %', p_conv, sqlerrm;
    end;
  end if;
  return jsonb_build_object('ok', true, 'wrote', true);$b$);
  execute v_src;
end $do$;

-- ── 3. cc_brain_chats — the Chats tab ────────────────────────────────────────────────────────────────────
create or replace function public.cc_brain_chats(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path to 'app_private', 'public'
as $$
begin
  perform app_private.brain_cc_guard();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id',          j.id,
        'created_at',  j.created_at,
        'status',      j.status,
        'model',       j.model,
        'lang',        j.lang,
        'usd',         j.usd,
        'input',       j.input_tokens,
        'cache_read',  j.cache_read,
        'output',      j.output_tokens,
        'tool_calls',  j.tool_calls,
        'secs',        round(extract(epoch from (coalesce(j.done_at, now()) - j.created_at))::numeric, 1),
        'question',    j.question,
        'desk',        substring(coalesce(j.result ->> 'reply', '') from '^\s*\[\[as:([a-z_]+)\]\]'),
        'reply',       left(regexp_replace(coalesce(j.result ->> 'reply', ''), '^\s*\[\[as:[a-z_]+\]\]\s*', ''), 600),
        'escalate',    coalesce((j.result ->> 'escalate')::boolean, false),
        'confidence',  j.result ->> 'confidence',
        'error',       j.error,
        'conv_id',     c.id,
        'name',        c.name,
        'email',       c.email,
        'visitor_role', c.visitor_role,
        'origin',      c.origin,
        'page',        c.page,
        'conv_status', c.status,
        'conv_mode',   c.mode,
        'human',       (c.mode = 'human' or coalesce(c.bot_paused, false)),
        'csat',        c.csat
      ) order by j.id desc), '[]'::jsonb)
    from (select * from app_private.brain_jobs
           where source = 'chat'
           order by id desc
           limit least(greatest(coalesce(p_limit, 100), 1), 500)) j
    left join app_private.lc_conversations c on c.id::text = j.ref_id);
end $$;
revoke execute on function public.cc_brain_chats(integer) from public, anon;
grant  execute on function public.cc_brain_chats(integer) to authenticated;

-- ── 4. change log ────────────────────────────────────────────────────────────────────────────────────────
select app_private.brain_log('config', 'config', '{}'::jsonb, jsonb_build_object('chat_notify_new', true),
  'bl_brain_0479 — new-chat notification switch (default ON) + CC → AI Brain → Chats tab + AI chats on the Needs-you tab');

commit;
