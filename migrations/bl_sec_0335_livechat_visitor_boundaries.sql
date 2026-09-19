-- bl_sec_0335: reviewed live-chat visitor boundaries. STAGING ONLY pending review.
-- Changes only guards; existing signatures, grants and downstream behavior are preserved.
-- Re-sync live source before applying. No messages, backfills or provider calls.
do $guard$ begin
  if md5(pg_get_functiondef('public.lc_history(text)'::regprocedure)) not in ('03ec12e4086e64a096861808262fe4a0') then raise exception 'Source drift: lc_history; re-review before applying'; end if;
  if md5(pg_get_functiondef('public.lc_ob_get(text)'::regprocedure)) not in ('21fa1b8a031558d4d070062d82541373','f55a60f1de170e74c66ba751c9433a38') then raise exception 'Source drift: lc_ob_get; re-review before applying'; end if;
  if md5(pg_get_functiondef('public.lc_ob_save(text, uuid, text, text, jsonb, text, text, boolean, boolean)'::regprocedure)) not in ('61d6036fa6820804c538363a9954c827') then raise exception 'Source drift: lc_ob_save; re-review before applying'; end if;
  if md5(pg_get_functiondef('public.lc_poll(uuid, text, bigint, boolean)'::regprocedure)) not in ('65bef776d46eb123b14584d5b49d12c4') then raise exception 'Source drift: lc_poll; re-review before applying'; end if;
  if md5(pg_get_functiondef('public.lc_rate(uuid, text, integer, text, boolean, boolean)'::regprocedure)) not in ('b042086ff794d6792174b6df4edafe9b') then raise exception 'Source drift: lc_rate; re-review before applying'; end if;
  if md5(pg_get_functiondef('public.lc_send(uuid, text, text)'::regprocedure)) not in ('a895247cab034683b180804edc27102b') then raise exception 'Source drift: lc_send; re-review before applying'; end if;
  if md5(pg_get_functiondef('public.lc_start(text, text, text, text, text, text)'::regprocedure)) not in ('23b43a45baa03b720394345378d31c36') then raise exception 'Source drift: lc_start; re-review before applying'; end if;
end $guard$;

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
                      else c0.user_id is null and c0.visitor_key = p_visitor_key and coalesce(length(p_visitor_key),0) between 16 and 64 and p_visitor_key not like 'novkey%' end
           order by c0.last_msg_at desc limit 10) c), '[]'::jsonb)
$function$;

CREATE OR REPLACE FUNCTION public.lc_ob_get(p_visitor_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private', 'public'
AS $function$
declare v app_private.lc_onboarding;
begin
  -- bl_sec_0334: same floor as lc_history (16..64), and the predictable 'novkey' prefix is refused outright.
  if p_visitor_key is null or length(p_visitor_key) < 16 or length(p_visitor_key) > 64
     or p_visitor_key like 'novkey%' then
    return jsonb_build_object('error','bad key');
  end if;
  select * into v from app_private.lc_onboarding where visitor_key = p_visitor_key;
  if not found then return jsonb_build_object('exists', false); end if;
  if v.conversation_id is not null and not exists (
    select 1 from app_private.lc_conversations c
    where c.id = v.conversation_id and c.visitor_key = p_visitor_key
      and (c.user_id is null or c.user_id = auth.uid())
  ) then return jsonb_build_object('exists', false); end if;
  return jsonb_build_object('exists', true, 'role', v.role, 'step_key', v.step_key,
    'data', v.data, 'docs', v.docs, 'account_created', v.account_created,
    'account_email', v.account_email, 'completed', v.completed_at is not null);
end $function$;

CREATE OR REPLACE FUNCTION public.lc_ob_save(p_visitor_key text, p_conversation_id uuid DEFAULT NULL::uuid, p_role text DEFAULT NULL::text, p_step_key text DEFAULT NULL::text, p_patch jsonb DEFAULT NULL::jsonb, p_note text DEFAULT NULL::text, p_account_email text DEFAULT NULL::text, p_account_created boolean DEFAULT NULL::boolean, p_completed boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private', 'public'
AS $function$
declare v_id uuid; v_saves int;
begin
  if coalesce(length(p_visitor_key),0) not between 16 and 64 or p_visitor_key like 'novkey%' then return jsonb_build_object('error','bad key'); end if;
  -- A supplied link must belong to this visitor and, for account chats, this user.
  if p_conversation_id is not null and not exists (
    select 1 from app_private.lc_conversations c
    where c.id = p_conversation_id and c.visitor_key = p_visitor_key
      and (c.user_id is null or c.user_id = auth.uid())
  ) then return jsonb_build_object('error','not found'); end if;
  -- Do not bypass a saved account-chat binding by omitting/replacing the supplied link.
  if exists (
    select 1 from app_private.lc_onboarding o
    where o.visitor_key = p_visitor_key and o.conversation_id is not null
      and not exists (
        select 1 from app_private.lc_conversations c
        where c.id = o.conversation_id and c.visitor_key = p_visitor_key
          and (c.user_id is null or c.user_id = auth.uid())
      )
  ) then return jsonb_build_object('error','not found'); end if;
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
  elsif coalesce(length(p_visitor_key),0) not between 16 and 64 or p_visitor_key like 'novkey%'
     or v_conv.visitor_key is distinct from p_visitor_key then
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
  elsif coalesce(length(p_visitor_key),0) not between 16 and 64 or p_visitor_key like 'novkey%'
     or v_conv.visitor_key is distinct from p_visitor_key then
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
  elsif coalesce(length(p_visitor_key),0) not between 16 and 64 or p_visitor_key like 'novkey%'
     or v_conv.visitor_key is distinct from p_visitor_key then
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
  if coalesce(length(p_visitor_key),0) not between 16 and 64 or p_visitor_key like 'novkey%' then return jsonb_build_object('error','bad key'); end if;
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
