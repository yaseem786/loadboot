-- ROLLBACK-LIVECHAT-2026-09-19.sql — restores PRODUCTION to its pre-package state (verified identical to LIVECHAT-PROD-2026-09-15.json on 19 Sep 2026 before applying).
-- Undoes bl_sec_0335 + bl_sec_0336 + bl_audit_0344 on prod. lc_request_call / lc_chat_request_call were patched in place by 0336 from prod's own copies;
-- they are NOT in the 15 Sep snapshot, so this file restores them by reversing the exact 0336 replace() anchors (guarded by the post-patch md5).
-- Edge: redeploy lc-doc-check from LC-DOC-PROD-BEFORE-2026-09-15.json (v10 source, ezbr 835629f2...) — the v11 edge REQUIRES lc_ob_upload_check.
-- Run only as a whole, inside one transaction. Not executed.
begin;
CREATE OR REPLACE FUNCTION public.lc_history(p_visitor_key text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
  select coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'status', c.status, 'mode', c.mode, 'created_at', c.created_at,
            'last_msg_at', c.last_msg_at, 'unread', c.visitor_unread, 'csat', c.csat,
            'preview', (select left(regexp_replace(m.body, '\[\[[^\]]*\]\]', '', 'g'), 90) from app_private.lc_messages m
                         where m.conversation_id = c.id and m.sender = 'visitor' order by m.id limit 1)) order by c.last_msg_at desc)
    from (select * from app_private.lc_conversations c0
           where case when auth.uid() is not null then c0.user_id = auth.uid()
                      else c0.user_id is null and c0.visitor_key = p_visitor_key and coalesce(length(p_visitor_key),0) between 16 and 64 end
           order by c0.last_msg_at desc limit 10) c), '[]'::jsonb)
$function$;
-- expected md5 after: 03ec12e4086e64a096861808262fe4a0
CREATE OR REPLACE FUNCTION public.lc_identify(p_id uuid, p_visitor_key text, p_name text, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare v_conv app_private.lc_conversations; v_email text; v_name text; v_first text; v_had_email boolean;
begin
  select * into v_conv from app_private.lc_conversations
    where id = p_id and (visitor_key = p_visitor_key or (auth.uid() is not null and user_id = auth.uid()));
  if v_conv.id is null then return jsonb_build_object('error','not found'); end if;
  v_name := left(nullif(trim(coalesce(p_name,'')),''), 120);
  v_email := (select (regexp_match(coalesce(p_email,''), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'))[1]);
  if p_email is not null and trim(p_email) <> '' and v_email is null then
    return jsonb_build_object('error','That email doesn''t look right — try again?');
  end if;
  if v_name is null and v_email is null then return jsonb_build_object('error','Enter your name or email'); end if;
  v_had_email := v_conv.email is not null;
  update app_private.lc_conversations
    set name = coalesce(v_name, name),
        email = coalesce(email, v_email),
        lead_stage = case when coalesce(email, v_email) is not null then 'done' else 'email' end,
        last_msg_at = now()
    where id = p_id;
  -- People go by their first name. "Perfect, Mirobid Mirsaidov" reads like a form letter.
  v_first := nullif(split_part(trim(coalesce(v_name, v_conv.name, '')), ' ', 1), '');
  insert into app_private.lc_messages (conversation_id, sender, body)
    values (p_id, 'visitor', '📇 ' || concat_ws(' · ', v_name, v_email));
  if v_email is not null and not v_had_email then
    perform app_private.lc_capture_lead(p_id);
  end if;
  if v_conv.pending_human then
    perform app_private.lc_do_handoff(p_id, 'human requested');
  elsif v_email is not null and not v_had_email then
    insert into app_private.lc_messages (conversation_id, sender, body)
      values (p_id, 'bot', 'Perfect' || coalesce(', ' || v_first, '') || ' — saved! ✅ Our team will email you at ' || v_email ||
        ' within one business day' ||
        case coalesce(v_conv.visitor_role,'')
          when 'carrier' then ' with your setup steps and this week''s lane rates.'
          when 'broker'  then ' with how free posting works and a login.'
          when 'shipper' then ' with how to post your first shipment.'
          when 'dispatcher' then ' about both routes — the salaried dispatcher roles and the 1% agent program.'
          when 'referral' then ' with your referral link and how payouts work.'
          else '.' end ||
        E'\n\nMeanwhile I''m right here — ask me anything.');
  else
    insert into app_private.lc_messages (conversation_id, sender, body)
      values (p_id, 'bot', 'Thanks' || coalesce(', ' || v_first, '') || '! 🤝 Anything else I can help with?');
  end if;
  return jsonb_build_object('ok', true);
end $function$;
-- expected md5 after: ab257eff9c8ec496adbdafe6f7717d2e
CREATE OR REPLACE FUNCTION public.lc_ob_doc_log(p_visitor_key text, p_conversation_id uuid DEFAULT NULL::uuid, p_doc jsonb DEFAULT NULL::jsonb, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private', 'public'
AS $function$
declare v_count int;
begin
  if p_visitor_key is null or length(p_visitor_key) < 8 then return jsonb_build_object('error','bad key'); end if;
  select coalesce(jsonb_array_length(docs),0) into v_count
    from app_private.lc_onboarding where visitor_key = p_visitor_key;
  if coalesce(v_count,0) >= 40 then return jsonb_build_object('error','limit'); end if;
  insert into app_private.lc_onboarding as o (visitor_key, conversation_id, docs)
  values (p_visitor_key, p_conversation_id, jsonb_build_array(coalesce(p_doc,'{}'::jsonb)))
  on conflict (visitor_key) do update set
    docs = o.docs || coalesce(p_doc,'{}'::jsonb),
    conversation_id = coalesce(o.conversation_id, excluded.conversation_id),
    updated_at = now();
  if p_note is not null and p_conversation_id is not null then
    if exists (select 1 from app_private.lc_conversations c
               where c.id = p_conversation_id and c.visitor_key = p_visitor_key) then
      insert into app_private.lc_messages (conversation_id, sender, body)
      values (p_conversation_id, 'bot', '[[note]] ' || left(p_note, 880));
      update app_private.lc_conversations set last_msg_at = now() where id = p_conversation_id;
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $function$;
-- expected md5 after: 85938450a638e994e47f2e405a5ceec9
CREATE OR REPLACE FUNCTION public.lc_ob_get(p_visitor_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private', 'public'
AS $function$
declare v app_private.lc_onboarding;
begin
  if p_visitor_key is null or length(p_visitor_key) < 8 then return jsonb_build_object('error','bad key'); end if;
  select * into v from app_private.lc_onboarding where visitor_key = p_visitor_key;
  if not found then return jsonb_build_object('exists', false); end if;
  return jsonb_build_object('exists', true, 'role', v.role, 'step_key', v.step_key,
    'data', v.data, 'docs', v.docs, 'account_created', v.account_created,
    'account_email', v.account_email, 'completed', v.completed_at is not null);
end $function$;
-- expected md5 after: f55a60f1de170e74c66ba751c9433a38
CREATE OR REPLACE FUNCTION public.lc_ob_save(p_visitor_key text, p_conversation_id uuid DEFAULT NULL::uuid, p_role text DEFAULT NULL::text, p_step_key text DEFAULT NULL::text, p_patch jsonb DEFAULT NULL::jsonb, p_note text DEFAULT NULL::text, p_account_email text DEFAULT NULL::text, p_account_created boolean DEFAULT NULL::boolean, p_completed boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private', 'public'
AS $function$
declare v_id uuid; v_saves int;
begin
  if p_visitor_key is null or length(p_visitor_key) < 8 then return jsonb_build_object('error','bad key'); end if;
  if p_role is not null and p_role not in ('carrier','broker','shipper','dispatcher','agent') then
    return jsonb_build_object('error','bad role'); end if;
  if p_patch is not null and pg_column_size(p_patch) > 16384 then return jsonb_build_object('error','too big'); end if;
  select count(*) into v_saves from app_private.lc_onboarding
    where visitor_key = p_visitor_key and updated_at > now() - interval '1 day';
  insert into app_private.lc_onboarding as o (visitor_key, conversation_id, role, step_key, data)
  values (p_visitor_key, p_conversation_id, p_role, coalesce(p_step_key,'role'), coalesce(p_patch,'{}'::jsonb))
  on conflict (visitor_key) do update set
    conversation_id = coalesce(excluded.conversation_id, o.conversation_id),
    role = coalesce(excluded.role, o.role),
    step_key = coalesce(p_step_key, o.step_key),
    data = case when p_patch is null then o.data else o.data || p_patch end,
    account_email = coalesce(p_account_email, o.account_email),
    account_created = coalesce(p_account_created, o.account_created),
    completed_at = case when p_completed is true then coalesce(o.completed_at, now()) else o.completed_at end,
    updated_at = now()
  returning id into v_id;
  if p_account_email is not null or p_account_created is not null or p_completed is not null then
    update app_private.lc_onboarding set
      account_email = coalesce(p_account_email, account_email),
      account_created = coalesce(p_account_created, account_created),
      completed_at = case when p_completed is true then coalesce(completed_at, now()) else completed_at end
    where id = v_id;
  end if;
  if p_note is not null and p_conversation_id is not null then
    if exists (select 1 from app_private.lc_conversations c
               where c.id = p_conversation_id and c.visitor_key = p_visitor_key) then
      insert into app_private.lc_messages (conversation_id, sender, body)
      values (p_conversation_id, 'bot', '[[note]] ' || left(p_note, 590));
      update app_private.lc_conversations set last_msg_at = now(),
        lead_stage = coalesce(lead_stage,'new') where id = p_conversation_id;
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $function$;
-- expected md5 after: 61d6036fa6820804c538363a9954c827
CREATE OR REPLACE FUNCTION public.lc_poll(p_id uuid, p_visitor_key text, p_after bigint DEFAULT 0, p_typing boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare v_conv app_private.lc_conversations; v_staff text; v_online boolean;
begin
  select * into v_conv from app_private.lc_conversations where id = p_id;
  if v_conv.id is null then return jsonb_build_object('error','not found'); end if;
  if v_conv.user_id is not null then
    if auth.uid() is null or v_conv.user_id is distinct from auth.uid() then
      return jsonb_build_object('error','sign in to continue this conversation');
    end if;
  elsif v_conv.visitor_key is distinct from p_visitor_key then
    return jsonb_build_object('error','not found');
  end if;
  if v_conv.visitor_unread > 0 or p_typing or v_conv.visitor_seen_at is null or v_conv.visitor_seen_at < now() - interval '30 seconds' then
    update app_private.lc_conversations
       set visitor_unread = 0,
           visitor_seen_at = now(),
           visitor_typing_at = case when p_typing then now() else visitor_typing_at end
     where id = p_id;
  end if;
  v_online := app_private.lc_staff_online();
  v_staff := case when v_conv.bot_paused then app_private.lc_staff_display(v_conv.bot_paused_by)
                  when v_online then nullif(trim((select staff_name from app_private.lc_presence where id = 1)),'') end;
  return jsonb_build_object('ok', true, 'status', v_conv.status, 'mode', v_conv.mode,
    'bot_paused', v_conv.bot_paused, 'staff_name', v_staff, 'online', v_online,
    'staff_typing', (v_conv.staff_typing_at is not null and v_conv.staff_typing_at > now() - interval '6 seconds'),
    'csat', v_conv.csat, 'closed_at', v_conv.closed_at, 'has_email', (v_conv.email is not null),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'sender', m.sender, 'body', m.body, 'at', m.created_at,
                                  'staff_name', case when m.sender = 'staff' then app_private.lc_staff_display(m.staff_id) end) order by m.id)
      from app_private.lc_messages m where m.conversation_id = p_id and m.id > coalesce(p_after,0) and m.body not like '[[note]]%'), '[]'::jsonb));
end $function$;
-- expected md5 after: 65bef776d46eb123b14584d5b49d12c4
CREATE OR REPLACE FUNCTION public.lc_rate(p_id uuid, p_visitor_key text, p_score integer DEFAULT NULL::integer, p_comment text DEFAULT NULL::text, p_email_transcript boolean DEFAULT false, p_close boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare v_conv app_private.lc_conversations; v_to text; v_txt text; v_html text; v_sent boolean := false;
begin
  select * into v_conv from app_private.lc_conversations where id = p_id;
  if v_conv.id is null then return jsonb_build_object('error','not found'); end if;
  if v_conv.user_id is not null then
    if auth.uid() is null or v_conv.user_id is distinct from auth.uid() then return jsonb_build_object('error','sign in to continue this conversation'); end if;
  elsif v_conv.visitor_key is distinct from p_visitor_key then
    return jsonb_build_object('error','not found');
  end if;
  if p_score is not null and p_score not between 1 and 5 then return jsonb_build_object('error','score must be 1–5'); end if;

  if p_score is not null then
    update app_private.lc_conversations
       set csat = p_score, csat_comment = left(nullif(trim(coalesce(p_comment,'')),''), 1000), csat_at = now()
     where id = p_id;
    insert into app_private.lc_messages (conversation_id, sender, body)
      values (p_id, 'bot', '[[note]] Visitor rated this chat ' || p_score || '/5' || coalesce(': ' || left(trim(p_comment), 300), ''));
    if p_score <= 2 then
      begin
        insert into app_private.notifications (recipient_role, channel, template_key, payload, status, sent_at)
        values ('staff','in_app','livechat.csat_low',
          jsonb_build_object('title','⭐ Low chat rating (' || p_score || '/5)',
            'body', coalesce(v_conv.name,'Visitor') || coalesce(': ' || left(trim(p_comment),160), ''), 'tone','warning','url','/live-chat'), 'sent', now());
      exception when others then null; end;
    end if;
  end if;

  if p_close and v_conv.status = 'open' then
    update app_private.lc_conversations set status = 'closed', closed_at = now(), closed_by = 'visitor' where id = p_id;
    insert into app_private.lc_messages (conversation_id, sender, body) values (p_id, 'bot', '[[sys]] Conversation ended by you. Reopen any time — just type.');
  end if;

  if p_email_transcript then
    v_to := coalesce(v_conv.email, (select p.email from public.profiles p where p.id = v_conv.user_id));
    if v_to is null or v_to !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
      return jsonb_build_object('ok', true, 'transcript', false, 'reason', 'no email on file');
    end if;
    select string_agg(to_char(m.created_at at time zone 'America/Chicago', 'Mon DD HH24:MI') || '  ' ||
             case m.sender when 'visitor' then 'You' when 'staff' then coalesce(app_private.lc_staff_display(m.staff_id),'LoadBoot') else 'LoadBoot AI' end || ': ' ||
             regexp_replace(regexp_replace(m.body, '\[\[[^\]]*\]\]', '', 'g'), '<[^>]*>', '', 'g'), E'\n' order by m.id)
      into v_txt
      from app_private.lc_messages m where m.conversation_id = p_id and m.body not like '[[note]]%' and m.body not like '[[sys]]%';
    v_html := '<h2 style="margin:0 0 8px;font-size:20px;color:#0b1220">Your LoadBoot chat transcript</h2>'
      || '<p style="color:#475569;margin:0 0 14px">Here is a copy of your conversation, as requested. Reply to this email any time to continue it with a person.</p>'
      || '<pre style="white-space:pre-wrap;font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.6;background:#f6f9fd;border-radius:10px;padding:14px;color:#0b1220">'
      || replace(replace(replace(coalesce(v_txt,''), '&','&amp;'), '<','&lt;'), '>','&gt;') || '</pre>';
    perform app_private.sys_email(v_to, 'chat.transcript', 'Your LoadBoot chat transcript', v_html, v_txt,
      'lctranscript:' || p_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
    update app_private.lc_conversations set transcript_sent_at = now() where id = p_id;
    v_sent := true;
  end if;
  return jsonb_build_object('ok', true, 'transcript', v_sent);
end $function$;
-- expected md5 after: b042086ff794d6792174b6df4edafe9b
CREATE OR REPLACE FUNCTION public.lc_send(p_id uuid, p_visitor_key text, p_body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare v_conv app_private.lc_conversations;
begin
  select * into v_conv from app_private.lc_conversations where id = p_id;
  if v_conv.id is null then return jsonb_build_object('error','not found'); end if;
  if v_conv.user_id is not null then
    if auth.uid() is null or v_conv.user_id is distinct from auth.uid() then
      return jsonb_build_object('error','sign in to continue this conversation');
    end if;
  elsif v_conv.visitor_key is distinct from p_visitor_key then
    return jsonb_build_object('error','not found');
  end if;
  if coalesce(length(trim(p_body)),0) not between 1 and 2000 then return jsonb_build_object('error','message must be 1–2000 chars'); end if;
  if (select count(*) from app_private.lc_messages where conversation_id = p_id and sender='visitor'
      and created_at > now() - interval '5 minutes') >= 30
    then return jsonb_build_object('error','slow down a moment'); end if;
  if exists (select 1 from app_private.lc_messages where conversation_id = p_id and sender = 'visitor'
             and created_at > now() - interval '20 seconds' and body = left(trim(p_body), 2000)) then
    return jsonb_build_object('ok', true, 'dup', true);
  end if;
  insert into app_private.lc_messages (conversation_id, sender, body) values (p_id, 'visitor', left(trim(p_body), 2000));
  update app_private.lc_conversations
     set last_msg_at = now(), status = 'open', visitor_typing_at = null, visitor_seen_at = now(),
         staff_unread = staff_unread + (case when bot_paused then 1 else 0 end)
   where id = p_id;
  if v_conv.bot_paused then return jsonb_build_object('ok', true, 'human', true); end if;
  if not app_private.lc_setup_resume(p_id, p_body, false) then
    perform app_private.lc_bot_step(p_id, p_body);
  end if;
  return jsonb_build_object('ok', true);
end $function$;
-- expected md5 after: a895247cab034683b180804edc27102b
CREATE OR REPLACE FUNCTION public.lc_start(p_visitor_key text, p_origin text, p_page text, p_name text, p_email text, p_body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare
  v_id uuid;
  v_uid uuid := auth.uid();
  v_pname text; v_pemail text; v_role text; v_mail text;
  v_page text := p_page; v_greeted boolean := false;
begin
  if coalesce(length(trim(p_visitor_key)),0) not between 16 and 64 then return jsonb_build_object('error','bad key'); end if;
  if coalesce(length(trim(p_body)),0) not between 1 and 2000 then return jsonb_build_object('error','message must be 1–2000 chars'); end if;
  if p_origin not in ('website','carrier','partner','agent') then return jsonb_build_object('error','bad origin'); end if;
  if (select count(*) from app_private.lc_conversations
      where visitor_key = p_visitor_key and created_at > now() - interval '1 day') >= 5
    then return jsonb_build_object('error','too many chats today — email hello@loadboot.com'); end if;
  if v_page like '%|hello' then v_greeted := true; v_page := left(v_page, length(v_page) - 6); end if;

  if v_uid is not null then
    select nullif(trim(coalesce(p.contact_name, '')), ''), nullif(trim(coalesce(p.email, '')), '')
      into v_pname, v_pemail
      from public.profiles p where p.id = v_uid;
    select case o.kind when 'carrier' then 'carrier' when 'broker' then 'broker' when 'shipper' then 'shipper' else null end
      into v_role
      from public.organizations o
     where o.owner_user_id = v_uid
     order by (o.kind = 'carrier') desc
     limit 1;
    if v_role is null and p_origin = 'carrier' then v_role := 'carrier'; end if;
  end if;

  v_mail := coalesce(nullif(trim(p_email),''), v_pemail);

  insert into app_private.lc_conversations (visitor_key, user_id, origin, page, name, email, mode, visitor_role)
    values (p_visitor_key, v_uid, p_origin, left(v_page, 200),
            left(coalesce(nullif(trim(p_name),''), v_pname), 120),
            left(v_mail, 200), 'bot', v_role)
    returning id into v_id;

  if v_mail is not null then
    update app_private.lc_conversations set lead_stage = 'done' where id = v_id;
  end if;
  update app_private.lc_conversations set visitor_seen_at = now() where id = v_id;

  insert into app_private.lc_messages (conversation_id, sender, body) values (v_id, 'visitor', left(trim(p_body), 2000));

  if not app_private.lc_setup_resume(v_id, p_body, false) then
    if not v_greeted then perform app_private.lc_setup_resume(v_id, p_body, true); end if;
    perform app_private.lc_bot_step(v_id, p_body);
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end $function$;
-- expected md5 after: 23b43a45baa03b720394345378d31c36
do $r$ declare src text; begin
  select pg_get_functiondef(p.oid) into strict src from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='lc_chat_request_call';
  if md5(src) <> 'cba3f910d8f4f099ad094654cdeef0a3' then raise exception 'lc_chat_request_call drift: %', md5(src); end if;
  src := replace(src, $n$elsif coalesce(length(p_visitor_key),0) not between 16 and 64 or p_visitor_key like 'novkey%' or v_conv.visitor_key is distinct from p_visitor_key then$n$, $o$elsif v_conv.visitor_key is distinct from p_visitor_key then$o$);
  src := replace(src, $n$if v_role is null or v_role not in ('carrier','broker','shipper') then$n$, $o$if v_role not in ('carrier','broker','shipper') then$o$);
  execute src;
  select pg_get_functiondef(p.oid) into strict src from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='lc_request_call';
  if md5(src) <> 'f5c7193b45828ef51a1147c8bd5a12be' then raise exception 'lc_request_call drift: %', md5(src); end if;
  src := replace(src, $n$coalesce(length(p_visitor_key),0) not between 16 and 64 or p_visitor_key like 'novkey%'$n$, $o$coalesce(length(trim(p_visitor_key)),0) not between 16 and 64$o$);
  src := replace(src, $n$if p_role is null or p_role not in ('carrier','broker','shipper') then$n$, $o$if p_role not in ('carrier','broker','shipper') then$o$);
  execute src;
end $r$;
-- expected after: lc_chat_request_call 61ffb15ce0475c59a2eb178801488465, lc_request_call b90eb1899a3056e162d96e59caad8b90
drop function if exists public.lc_ob_upload_check(text,uuid);
revoke all on function public.lc_ob_doc_log(text,uuid,jsonb,text) from public;
grant execute on function public.lc_ob_doc_log(text,uuid,jsonb,text) to anon, authenticated, service_role;
drop table if exists app_private.lc_save_windows;
drop table if exists app_private.lc_save_limit_config;
delete from supabase_migrations.schema_migrations where version in ('20260919195205','20260919195240','20260919195311');
-- verify before commit: anon SECDEF names must equal the 9 Sep baseline (lc_ob_doc_log back, lc_ob_upload_check gone), count 33.
commit;
