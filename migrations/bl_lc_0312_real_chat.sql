-- bl_lc_0312_real_chat.sql — Live chat: honest presence, human takeover stops the AI,
-- one-tap handoff, no wrong keyword fallbacks, CSAT + transcript, history, typing,
-- SLA alerts by email, account-aware portal chat, premium CC console RPCs.
-- Apply to STAGING first, then PROD. Additive: every existing RPC keeps its name; lc_poll and
-- cc_lc_presence_set gain optional trailing params (old signature DROPPED first so PostgREST
-- never sees two overloads). Grants re-applied explicitly at the bottom.

-- ───────────────────────── A. schema ─────────────────────────
alter table app_private.lc_presence
  add column if not exists last_seen_at timestamptz,
  add column if not exists alert_email  text;

alter table app_private.lc_conversations
  add column if not exists bot_paused          boolean not null default false,
  add column if not exists bot_paused_by       uuid,
  add column if not exists bot_paused_at       timestamptz,
  add column if not exists staff_typing_at     timestamptz,
  add column if not exists visitor_typing_at   timestamptz,
  add column if not exists visitor_seen_at     timestamptz,
  add column if not exists handoff_at          timestamptz,
  add column if not exists handoff_alert_at    timestamptz,
  add column if not exists first_staff_reply_at timestamptz,
  add column if not exists sla_alerted_at      timestamptz,
  add column if not exists csat                smallint,
  add column if not exists csat_comment        text,
  add column if not exists csat_at             timestamptz,
  add column if not exists closed_at           timestamptz,
  add column if not exists closed_by           text,
  add column if not exists transcript_sent_at  timestamptz;

create index if not exists lc_conversations_human_open_idx
  on app_private.lc_conversations (last_msg_at) where status = 'open' and mode = 'human';

-- ───────────────────────── B. presence ─────────────────────────
-- "Online" is a heartbeat, never a switch somebody flipped a month ago.
create or replace function app_private.lc_staff_online()
returns boolean language sql stable
set search_path to 'app_private, public'
as $$
  select coalesce((select available and last_seen_at is not null and last_seen_at > now() - interval '3 minutes'
                     from app_private.lc_presence where id = 1), false)
$$;

create or replace function app_private.lc_alert_email()
returns text language sql stable
set search_path to 'app_private, public'
as $$
  select coalesce(nullif(trim((select alert_email from app_private.lc_presence where id = 1)), ''), 'hello@loadboot.com')
$$;

-- Display name for a staff member (first name of profile contact, else presence name, else 'LoadBoot Team').
create or replace function app_private.lc_staff_display(p_uid uuid)
returns text language sql stable
set search_path to 'app_private, public'
as $$
  select coalesce(
    nullif(split_part(trim(coalesce((select p.contact_name from public.profiles p where p.id = p_uid), '')), ' ', 1), ''),
    nullif(trim((select staff_name from app_private.lc_presence where id = 1)), ''),
    'LoadBoot Team')
$$;

-- ───────────────────────── C. strict KB answer ─────────────────────────
-- Same scorer as lc_bot_answer_l, but the caller sets the minimum score. 2.0 = exact phrase only.
-- Used for the brain FALLBACK and the watchdog: a fuzzy keyword hit is never allowed to replace
-- an AI answer any more ("invalid truck type" → GPS marketing was exactly that).
create or replace function app_private.lc_bot_answer_l2(p_text text, p_lang text, p_min numeric default 2.0)
returns text language sql stable
set search_path to 'app_private, public, extensions'
as $$
with q as (select app_private.lc_norm(p_text) t),
tw as (select w from (select unnest(string_to_array((select t from q), ' ')) w) z where length(w) >= 2),
stop as (select unnest(array['what','when','where','which','how','why','does','need','your','with','have','this','that','from','will','can','you','the','and','for','are','was','get','has','had','who','out','all','any','not','que','como','para','por','con','los','las','una','del','sus','mas','muy']) w),
cand as (
  select k.answer, k.priority, app_private.lc_norm(p.kw) kw,
    (select count(*) from unnest(string_to_array(app_private.lc_norm(p.kw),' ')) pw where length(pw) >= 3 and pw not in (select w from stop)) nw,
    (select min(best) from (select (select max(extensions.similarity(pw, tw.w)) from tw) best
       from unnest(string_to_array(app_private.lc_norm(p.kw),' ')) pw where length(pw) >= 3 and pw not in (select w from stop)) b) minbest,
    (select avg(best) from (select (select max(extensions.similarity(pw, tw.w)) from tw) best
       from unnest(string_to_array(app_private.lc_norm(p.kw),' ')) pw where length(pw) >= 3 and pw not in (select w from stop)) c) avgbest,
    (position(app_private.lc_norm(p.kw) in (select t from q)) > 0) as exact
  from app_private.lc_kb k, unnest(k.patterns) p(kw)
  where k.lang = coalesce(p_lang,'en')
),
scored as (
  select answer, priority,
    max(case when exact then 2.0 + 0.1 * greatest(nw,1)
             when nw > 1 and minbest >= 0.45 and avgbest >= 0.6 then avgbest * (1 + 0.15 * (nw - 1))
             when nw = 1 and minbest >= 0.65 then avgbest
             else 0 end) s
  from cand group by answer, priority
)
select replace(answer, '{PHONE}', coalesce(nullif(app_private.lc_phone_display(),''), 'our 24/7 line'))
from scored where s >= p_min order by s desc, priority desc limit 1
$$;

-- The website "two answers then email" gate is OFF: it blocked the third answer for anyone who did not
-- want to hand over an email. The answer-first ride-along ask (max 3, alternating) stays.
create or replace function app_private.lc_gate_after()
returns integer language sql stable as $$ select 100000 $$;

-- ───────────────────────── D. account snapshot (signed-in users) ─────────────────────────
create or replace function app_private.lc_account_snapshot(p_user uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public'
as $$
declare v_org uuid; v_name text; v_status text; v_hazmat boolean := false; v_role text;
        v_comp jsonb; v_trucks jsonb; v_ok int; v_total int; v_pay text; v_next jsonb;
begin
  if p_user is null then return null; end if;
  select o.id, o.name, o.status, o.kind into v_org, v_name, v_status, v_role
    from public.organizations o where o.owner_user_id = p_user
    order by (o.kind = 'carrier') desc limit 1;
  if v_org is null then return null; end if;
  if v_role <> 'carrier' then
    return jsonb_build_object('org_name', v_name, 'org_status', v_status, 'kind', v_role);
  end if;
  select coalesce(p.hazmat,false) into v_hazmat from public.profiles p where p.id = p_user;

  with rows as (
    select r.key, r.name, r.sort, coalesce(c.status,'missing') st, c.note
      from app_private.compliance_requirements r
      left join app_private.carrier_compliance c on c.carrier_id = v_org and c.requirement_key = r.key
     where r.active and r.mandatory and (r.condition_key is null or (r.condition_key = 'hazmat' and v_hazmat))
  )
  select jsonb_agg(jsonb_build_object('key', key, 'name', name, 'status', st, 'note', left(note, 400)) order by sort),
         count(*) filter (where st = 'valid'), count(*),
         (select jsonb_build_object('name', name, 'status', st, 'note', left(note,400)) from rows
           where st <> 'valid' order by (st = 'rejected') desc, (st = 'missing') desc, sort limit 1)
    into v_comp, v_ok, v_total, v_next from rows;

  select coalesce(c.status,'missing') into v_pay
    from app_private.compliance_requirements r
    left join app_private.carrier_compliance c on c.carrier_id = v_org and c.requirement_key = r.key
   where r.key = 'bank_verification' and r.active limit 1;

  select jsonb_agg(jsonb_build_object('unit', t.unit_no, 'equipment', t.equipment, 'status', t.status,
                                      'vin_on_file', (nullif(trim(coalesce(t.vin,'')),'') is not null)) order by t.created_at)
    into v_trucks from app_private.fleet_trucks t where t.carrier_id = v_org;

  return jsonb_build_object('org_id', v_org, 'org_name', v_name, 'org_status', v_status, 'kind', 'carrier',
    'verified', coalesce(v_ok,0), 'total', coalesce(v_total,0), 'compliance', coalesce(v_comp,'[]'::jsonb),
    'next', v_next, 'trucks', coalesce(v_trucks,'[]'::jsonb), 'payment_status', v_pay);
end $$;

-- ───────────────────────── E. handoff: honest, deduped, alerts a human ─────────────────────────
create or replace function app_private.lc_do_handoff(p_conv uuid, p_reason text default 'requested')
returns void language plpgsql security definer
set search_path to 'app_private, public'
as $$
declare c app_private.lc_conversations; pr app_private.lc_presence;
        v_online boolean; v_msg text; v_num text; v_opts text; v_phone_ok boolean; v_es boolean;
        v_who text; v_repeat boolean; v_last_bot text; v_alert_ok boolean; v_subj text; v_html text; v_link text;
begin
  select * into c from app_private.lc_conversations where id = p_conv;
  if c.id is null then return; end if;
  select * into pr from app_private.lc_presence where id = 1;
  v_online := app_private.lc_staff_online();
  v_num := coalesce(nullif(app_private.lc_phone_display(),''), '');
  v_phone_ok := coalesce(c.visitor_role,'') in ('carrier','broker','shipper') or c.visitor_role is null;
  v_es := coalesce(c.lang,'en') = 'es';
  v_who := coalesce(nullif(trim(pr.staff_name),''), case when v_es then 'nuestro equipo' else 'our team' end);
  v_repeat := (c.mode = 'human' and c.handoff_at is not null and c.handoff_at > now() - interval '2 hours');
  select body into v_last_bot from app_private.lc_messages where conversation_id = p_conv and sender = 'bot' order by id desc limit 1;

  if v_repeat then
    -- Already handed off recently: never re-promise, never repeat the big card. One short honest line.
    v_msg := case when v_es
      then 'Sigue con el equipo — su nuevo mensaje quedó añadido y se les volvió a avisar. Yo sigo aquí mientras tanto.'
      else 'Still with the team — your new message has been added and they''ve been alerted again. I''m here in the meantime.' end;
    if coalesce(v_last_bot,'') <> v_msg then
      insert into app_private.lc_messages (conversation_id, sender, body) values (p_conv, 'bot', v_msg);
    end if;
  else
    if v_es then
      v_msg := case when v_online
        then v_who || case when pr.designation is not null then ', nuestro ' || pr.designation || ',' else '' end ||
             ' está en línea y ya recibió el aviso. 🤝 Normalmente responde aquí mismo en unos minutos — yo me quedo con usted mientras tanto.'
        else 'Nuestro equipo no está en el escritorio ahora mismo. Su conversación queda guardada palabra por palabra y ' || v_who ||
             ' la recibe por correo en cuanto vuelva — normalmente en unas horas en horario laboral de EE. UU.' ||
             case when c.email is not null then ' Le respondemos aquí y también a ' || c.email || '.' else '' end end;
      v_opts := e'\n\nLo que le resulte más cómodo:' ||
        case when v_num <> '' then e'\n📞  Llámenos 24/7 — ' || v_num else '' end ||
        e'\n📧  hello@loadboot.com, o siga escribiendo aquí';
      if v_phone_ok then v_opts := v_opts || e'\n📲  O nosotros le llamamos — ahora mismo o a la hora que elija 👇\n\n[[callform]]'; end if;
      if c.email is null then v_opts := v_opts || e'\n\nDeje un correo para que la respuesta le llegue aunque cierre esta ventana (opcional):\n\n[[form:name,email]]'; end if;
    else
      v_msg := case when v_online
        then v_who || case when pr.designation is not null then ', our ' || pr.designation || ',' else '' end ||
             ' is online and has been pinged. 🤝 They usually reply right here within a few minutes — I''ll stay with you until then.'
        else 'Our team isn''t at the desk right now. Your conversation is saved word-for-word and ' || v_who ||
             ' gets it by email the moment they''re back — usually within a few hours during US business hours.' ||
             case when c.email is not null then ' We''ll answer here and also at ' || c.email || '.' else '' end end;
      v_opts := e'\n\nWhatever is easiest for you right now:' ||
        case when v_num <> '' then e'\n📞  Call us 24/7 — ' || v_num else '' end ||
        e'\n📧  hello@loadboot.com, or just keep typing here';
      if v_phone_ok then v_opts := v_opts || e'\n📲  Or we call you — right now, or at a time you pick 👇\n\n[[callform]]'; end if;
      if c.email is null then v_opts := v_opts || e'\n\nLeave an email so the reply reaches you even if you close this window (optional):\n\n[[form:name,email]]'; end if;
    end if;
    insert into app_private.lc_messages (conversation_id, sender, body) values (p_conv, 'bot', v_msg || v_opts);
  end if;

  update app_private.lc_conversations
     set mode = 'human', pending_human = false, status = 'open',
         staff_unread = staff_unread + 1, last_msg_at = now(),
         handoff_at = coalesce(handoff_at, now())
   where id = p_conv;

  -- Alert a human: in-app (CC) always; email at most every 30 minutes per conversation.
  begin
    insert into app_private.notifications (recipient_role, channel, template_key, payload, status, sent_at)
    values ('staff','in_app','livechat.handoff',
      jsonb_build_object('title', case when v_online then '🙋 Live chat handed to ' || v_who || ' — reply NOW' else '🙋 Live chat needs a human (team offline)' end,
        'body', coalesce(c.name,'Visitor') || coalesce(' <'||c.email||'>','') || ' · ' || coalesce(c.visitor_role,'unknown role') || ' · ' || p_reason,
        'tone','urgent','url','/live-chat'), 'sent', now());
  exception when others then null; end;

  v_alert_ok := (c.handoff_alert_at is null or c.handoff_alert_at < now() - interval '30 minutes');
  if v_alert_ok then
    begin
      v_link := 'https://loadboot.com/app/command-center/#/live-chat';
      v_subj := case when v_online then '🙋 Live chat waiting for you' else '🙋 Live chat needs a human — team is offline' end
                || ' · ' || coalesce(c.name, 'visitor') || ' (' || coalesce(c.visitor_role, 'unknown role') || ')';
      v_html := '<h2 style="margin:0 0 8px;font-size:20px;color:#0b1220">' || v_subj || '</h2>'
        || '<p style="color:#475569;line-height:1.6;margin:0 0 14px">Reason: ' || p_reason || '<br>Origin: ' || coalesce(c.origin,'website')
        || coalesce(' · page ' || c.page, '') || coalesce('<br>Email: ' || c.email, '') || '</p>'
        || '<div style="background:#f6f9fd;border-left:3px solid #FC5305;padding:12px 14px;border-radius:8px;white-space:pre-wrap;color:#0b1220">'
        || coalesce((select string_agg(case m.sender when 'visitor' then '👤 ' else '⚡ ' end || left(regexp_replace(m.body, '\[\[[^\]]*\]\]', '', 'g'), 300), E'\n' order by m.id)
                      from (select * from app_private.lc_messages where conversation_id = p_conv and body not like '[[note]]%' order by id desc limit 6) m), '')
        || '</div><p style="margin:16px 0 0"><a href="' || v_link || '" style="display:inline-block;padding:12px 22px;background:#FC5305;color:#fff;border-radius:10px;text-decoration:none;font-weight:700">Open the chat →</a></p>';
      perform app_private.sys_email(app_private.lc_alert_email(), 'chat.handoff', v_subj, v_html,
        'Live chat needs a human: ' || coalesce(c.name,'visitor') || '. Open ' || v_link,
        'lchandoff:' || p_conv::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
      update app_private.lc_conversations set handoff_alert_at = now() where id = p_conv;
    exception when others then
      raise warning 'lc_do_handoff alert email failed for %: %', p_conv, sqlerrm;
    end;
  end if;
end $$;

-- Escalate = say it honestly, then hand off immediately. No name/email gate before a human.
create or replace function app_private.lc_escalate(p_conv uuid, p_opener text)
returns void language plpgsql security definer
set search_path to 'app_private, public'
as $$
begin
  if nullif(trim(coalesce(p_opener,'')),'') is not null then
    insert into app_private.lc_messages (conversation_id, sender, body) values (p_conv, 'bot', p_opener);
  end if;
  update app_private.lc_conversations set bot_misses = 0 where id = p_conv;
  perform app_private.lc_do_handoff(p_conv, 'bot could not answer');
end $$;

-- ───────────────────────── F. anchor patches on lc_bot_step / lc_bot_step_es / lc_watchdog ─────────────────────────
do $patch$
declare v_src text; v_new text; v_n int;
  a1 constant text := $a$if (not v_waiting) and app_private.lc_is_human_request(p_text) then
    if v_conv.visitor_role is null then$a$;
  b1 constant text := $a$if (not v_waiting) and app_private.lc_is_human_request(p_text) then
    perform app_private.lc_do_handoff(p_conv, 'human requested'); return;
    if v_conv.visitor_role is null then$a$;
  a2 constant text := $a$perform app_private.lc_brain_dispatch(p_conv, p_text, v_ans);$a$;
  b2 constant text := $a$perform app_private.lc_brain_dispatch(p_conv, p_text, app_private.lc_bot_answer_l2(p_text, coalesce(v_conv.lang,'en'), 2.0));$a$;
  a2es constant text := $a$perform app_private.lc_brain_dispatch(p_conv, p_text, coalesce(v_ans, v_ans_en));$a$;
  b2es constant text := $a$perform app_private.lc_brain_dispatch(p_conv, p_text, coalesce(app_private.lc_bot_answer_l2(p_text, 'es', 2.0), app_private.lc_bot_answer_l2(p_text, 'en', 2.0)));$a$;
  a3 constant text := $a$v_ans := app_private.lc_bot_answer_l(r.question, v_lang);$a$;
  b3 constant text := $a$v_ans := app_private.lc_bot_answer_l2(r.question, v_lang, 2.0);$a$;
begin
  -- lc_bot_step (en)
  v_src := pg_get_functiondef('app_private.lc_bot_step'::regproc);
  v_n := (length(v_src) - length(replace(v_src, a1, ''))) / length(a1);
  if v_n <> 1 then raise exception 'lc_bot_step anchor a1 found % times', v_n; end if;
  v_n := (length(v_src) - length(replace(v_src, a2, ''))) / length(a2);
  if v_n <> 1 then raise exception 'lc_bot_step anchor a2 found % times', v_n; end if;
  v_new := replace(replace(v_src, a1, b1), a2, b2);
  execute v_new;

  -- lc_bot_step_es: patch whichever anchors it has; skip silently if absent.
  v_src := pg_get_functiondef('app_private.lc_bot_step_es'::regproc);
  v_new := v_src;
  if position(a2 in v_new) > 0 then v_new := replace(v_new, a2, b2); end if;
  if position(a2es in v_new) > 0 then v_new := replace(v_new, a2es, b2es); end if;
  if v_new <> v_src then execute v_new; else raise warning 'lc_bot_step_es: no brain anchor, left untouched'; end if;

  -- watchdog: strict fallback only.
  v_src := pg_get_functiondef('app_private.lc_watchdog'::regproc);
  v_n := (length(v_src) - length(replace(v_src, a3, ''))) / length(a3);
  if v_n <> 1 then raise exception 'lc_watchdog anchor a3 found % times', v_n; end if;
  execute replace(v_src, a3, b3);
end $patch$;

-- ───────────────────────── G. brain context: account + no [[sys]] in history ─────────────────────────
create or replace function app_private.lc_brain_context(p_conv uuid, p_text text)
returns jsonb language sql stable
set search_path to 'app_private, public, extensions'
as $$
with c as (select * from app_private.lc_conversations where id = p_conv),
lg as (select coalesce((select lang from c), app_private.lc_detect_lang(p_text)) l),
n as (select coalesce((select history_n from app_private.lc_brain_config where id), 12) h,
             coalesce((select facts_n   from app_private.lc_brain_config where id), 6)  f),
hist as (
  select jsonb_agg(x order by x_id) j from (
    select m.id x_id,
           jsonb_build_object('who', case m.sender when 'visitor' then 'visitor' when 'staff' then 'human agent' else 'assistant' end,
                              'body', left(m.body, 900)) x
    from app_private.lc_messages m
    where m.conversation_id = p_conv and m.body not like '[[note]]%' and m.body not like '[[sys]]%'
    order by m.id desc limit (select h from n)
  ) z
),
facts as (
  select jsonb_agg(a) j from (
    select k.answer a from app_private.lc_kb k
    where k.lang = (select l from lg)
    order by (case when exists (select 1 from unnest(k.patterns) kw where position(lower(kw) in lower(coalesce(p_text,''))) > 0) then 1 else 0 end) desc,
             extensions.similarity(array_to_string(k.patterns,' '), lower(coalesce(p_text,''))) desc,
             k.priority desc
    limit (select f from n)
  ) z
)
select jsonb_build_object(
  'lang',      (select l from lg),
  'role',      (select visitor_role from c),
  'name',      (select name from c),
  'page',      (select page from c),
  'origin',    (select origin from c),
  'has_email', ((select email from c) is not null),
  'staff_online', app_private.lc_staff_online(),
  'account',   app_private.lc_account_snapshot((select user_id from c)),
  'history',   coalesce((select j from hist), '[]'::jsonb),
  'facts',     coalesce((select j from facts), '[]'::jsonb)
)
$$;

-- ───────────────────────── H. visitor RPCs ─────────────────────────
create or replace function public.lc_send(p_id uuid, p_visitor_key text, p_body text)
returns jsonb language plpgsql security definer
set search_path to 'app_private, public'
as $$
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
  -- Duplicate guard: the same text within 20 s is a double-tap, not a second question.
  if exists (select 1 from app_private.lc_messages where conversation_id = p_id and sender = 'visitor'
             and created_at > now() - interval '20 seconds' and body = left(trim(p_body), 2000)) then
    return jsonb_build_object('ok', true, 'dup', true);
  end if;
  insert into app_private.lc_messages (conversation_id, sender, body) values (p_id, 'visitor', left(trim(p_body), 2000));
  update app_private.lc_conversations
     set last_msg_at = now(), status = 'open', visitor_typing_at = null, visitor_seen_at = now(),
         staff_unread = staff_unread + (case when bot_paused then 1 else 0 end)
   where id = p_id;
  -- A human has taken over: the AI stays silent. Nothing else runs.
  if v_conv.bot_paused then return jsonb_build_object('ok', true, 'human', true); end if;
  if not app_private.lc_setup_resume(p_id, p_body, false) then
    perform app_private.lc_bot_step(p_id, p_body);
  end if;
  return jsonb_build_object('ok', true);
end $$;

drop function if exists public.lc_poll(uuid, text, bigint);
create or replace function public.lc_poll(p_id uuid, p_visitor_key text, p_after bigint default 0, p_typing boolean default false)
returns jsonb language plpgsql security definer
set search_path to 'app_private, public'
as $$
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
end $$;

-- Rating + transcript + visitor-initiated close.
create or replace function public.lc_rate(p_id uuid, p_visitor_key text, p_score integer default null, p_comment text default null,
                                          p_email_transcript boolean default false, p_close boolean default false)
returns jsonb language plpgsql security definer
set search_path to 'app_private, public'
as $$
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
end $$;

-- Previous conversations for this visitor (signed-in: by account; anonymous: by visitor key).
create or replace function public.lc_history(p_visitor_key text)
returns jsonb language sql stable security definer
set search_path to 'app_private, public'
as $$
  select coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'status', c.status, 'mode', c.mode, 'created_at', c.created_at,
            'last_msg_at', c.last_msg_at, 'unread', c.visitor_unread, 'csat', c.csat,
            'preview', (select left(regexp_replace(m.body, '\[\[[^\]]*\]\]', '', 'g'), 90) from app_private.lc_messages m
                         where m.conversation_id = c.id and m.sender = 'visitor' order by m.id limit 1)) order by c.last_msg_at desc)
    from (select * from app_private.lc_conversations c0
           where case when auth.uid() is not null then c0.user_id = auth.uid()
                      else c0.user_id is null and c0.visitor_key = p_visitor_key and coalesce(length(p_visitor_key),0) between 16 and 64 end
           order by c0.last_msg_at desc limit 10) c), '[]'::jsonb)
$$;

-- Portal greeting for a SIGNED-IN user (authenticated only — no anon surface). No conversation is created.
create or replace function public.lc_hello(p_visitor_key text default null)
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public'
as $$
declare v_uid uuid := auth.uid(); v_first text; v_acc jsonb; v_open uuid; v_role text;
begin
  if v_uid is null then return jsonb_build_object('error','sign in'); end if;
  select nullif(split_part(trim(coalesce(p.contact_name,'')), ' ', 1), ''), p.role into v_first, v_role from public.profiles p where p.id = v_uid;
  v_acc := app_private.lc_account_snapshot(v_uid);
  select c.id into v_open from app_private.lc_conversations c where c.user_id = v_uid and c.status = 'open' order by c.last_msg_at desc limit 1;
  return jsonb_build_object('ok', true, 'first', v_first, 'role', coalesce(v_acc->>'kind', v_role),
    'verified', v_acc->'verified', 'total', v_acc->'total', 'next', v_acc->'next', 'org_status', v_acc->>'org_status',
    'trucks', coalesce(jsonb_array_length(coalesce(v_acc->'trucks','[]'::jsonb)),0),
    'payment_status', v_acc->>'payment_status', 'open_conv', v_open, 'online', app_private.lc_staff_online(),
    'staff_name', nullif(trim((select staff_name from app_private.lc_presence where id = 1)),''));
end $$;


-- lc_start: the v5 widget greets a signed-in portal user itself (lc_hello) and marks its first
-- message with a '|hello' suffix on p_page; then the server must not repeat the forced greeting.
create or replace function public.lc_start(p_visitor_key text, p_origin text, p_page text, p_name text, p_email text, p_body text)
returns jsonb language plpgsql security definer
set search_path to 'app_private, public'
as $$
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
end $$;
revoke all on function public.lc_start(text, text, text, text, text, text) from public;
grant execute on function public.lc_start(text, text, text, text, text, text) to anon, authenticated;

-- ───────────────────────── I. CC RPCs ─────────────────────────
create or replace function app_private.lc_cc_ok()
returns boolean language sql stable security definer
set search_path to 'app_private, public'
as $$ select public.has_global_permission('comm.view') or public.has_global_permission('support.view') or public.has_global_permission('dispatch.manage') $$;

create or replace function public.cc_lc_presence_get()
returns jsonb language sql stable security definer
set search_path to 'app_private, public'
as $$
  select case when not app_private.lc_cc_ok() then jsonb_build_object('error','not authorized')
    else (select jsonb_build_object('available', available, 'staff_name', staff_name, 'designation', designation, 'updated_at', updated_at,
                 'last_seen_at', last_seen_at, 'online', app_private.lc_staff_online(), 'alert_email', app_private.lc_alert_email())
          from app_private.lc_presence where id = 1) end;
$$;

create or replace function public.cc_lc_heartbeat()
returns jsonb language plpgsql security definer
set search_path to 'app_private, public'
as $$
begin
  if not app_private.lc_cc_ok() then return jsonb_build_object('error','not authorized'); end if;
  update app_private.lc_presence set last_seen_at = now() where id = 1;
  return public.cc_lc_presence_get();
end $$;

drop function if exists public.cc_lc_presence_set(boolean, text, text);
create or replace function public.cc_lc_presence_set(p_available boolean, p_name text default null, p_designation text default null, p_alert_email text default null)
returns jsonb language plpgsql security definer
set search_path to 'app_private, public'
as $$
begin
  if not app_private.lc_cc_ok() then return jsonb_build_object('error','not authorized'); end if;
  if p_available and coalesce(length(trim(p_name)),0) < 2 then return jsonb_build_object('error','Apna naam likho — visitor ko yehi naam bataya jayega'); end if;
  if p_alert_email is not null and trim(p_alert_email) <> '' and p_alert_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    return jsonb_build_object('error','alert email looks wrong'); end if;
  update app_private.lc_presence set
    available = p_available,
    staff_name = case when p_available then left(trim(p_name),60) else staff_name end,
    designation = case when p_available then coalesce(nullif(left(trim(p_designation),80),''), 'Carrier Success Manager') else designation end,
    alert_email = coalesce(nullif(trim(p_alert_email),''), alert_email),
    last_seen_at = case when p_available then now() else last_seen_at end,
    set_by = auth.uid(), updated_at = now()
  where id = 1;
  return public.cc_lc_presence_get();
end $$;

create or replace function public.cc_lc_typing(p_id uuid)
returns jsonb language plpgsql security definer
set search_path to 'app_private, public'
as $$
begin
  if not app_private.lc_cc_ok() then return jsonb_build_object('error','not authorized'); end if;
  update app_private.lc_conversations set staff_typing_at = now() where id = p_id;
  update app_private.lc_presence set last_seen_at = now() where id = 1;
  return jsonb_build_object('ok', true);
end $$;

-- Staff joins: the AI stops, the visitor sees who joined.
create or replace function public.cc_lc_assign(p_id uuid, p_take boolean default true)
returns jsonb language plpgsql security definer
set search_path to 'app_private, public'
as $$
declare v_name text;
begin
  if not app_private.lc_cc_ok() then return jsonb_build_object('error','not authorized'); end if;
  if p_take then
    v_name := app_private.lc_staff_display(auth.uid());
    update app_private.lc_conversations
       set assigned_to = auth.uid(), mode = 'human', status = 'open',
           bot_paused = true, bot_paused_by = auth.uid(), bot_paused_at = coalesce(bot_paused_at, now()),
           pending_human = false, handoff_at = coalesce(handoff_at, now())
     where id = p_id;
    if not exists (select 1 from app_private.lc_messages where conversation_id = p_id and body = '[[sys]] ' || v_name || ' from LoadBoot joined the chat'
                   and created_at > now() - interval '10 minutes') then
      insert into app_private.lc_messages (conversation_id, sender, staff_id, body)
        values (p_id, 'bot', auth.uid(), '[[sys]] ' || v_name || ' from LoadBoot joined the chat');
      update app_private.lc_conversations set visitor_unread = visitor_unread + 1, last_msg_at = now() where id = p_id;
    end if;
    update app_private.lc_presence set last_seen_at = now() where id = 1;
  else
    update app_private.lc_conversations set assigned_to = null where id = p_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cc_lc_bot_resume(p_id uuid)
returns jsonb language plpgsql security definer
set search_path to 'app_private, public'
as $$
begin
  if not app_private.lc_cc_ok() then return jsonb_build_object('error','not authorized'); end if;
  update app_private.lc_conversations
     set bot_paused = false, bot_paused_by = null, bot_paused_at = null, mode = 'bot', pending_human = false, bot_misses = 0
   where id = p_id;
  insert into app_private.lc_messages (conversation_id, sender, staff_id, body)
    values (p_id, 'bot', auth.uid(), '[[sys]] Handed back to the LoadBoot AI assistant — it answers instantly, and a person is one message away.');
  update app_private.lc_conversations set visitor_unread = visitor_unread + 1, last_msg_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cc_lc_reply(p_id uuid, p_body text)
returns jsonb language plpgsql security definer
set search_path to 'app_private, public'
as $$
begin
  if not app_private.lc_cc_ok() then return jsonb_build_object('error','not authorized'); end if;
  if coalesce(length(trim(p_body)),0) not between 1 and 2000 then return jsonb_build_object('error','message must be 1–2000 chars'); end if;
  if not exists (select 1 from app_private.lc_conversations where id = p_id and bot_paused) then
    perform public.cc_lc_assign(p_id, true);
  end if;
  insert into app_private.lc_messages (conversation_id, sender, staff_id, body) values (p_id, 'staff', auth.uid(), left(trim(p_body), 2000));
  update app_private.lc_conversations
     set last_msg_at = now(), visitor_unread = visitor_unread + 1, status = 'open', mode = 'human',
         staff_unread = 0, staff_typing_at = null, sla_alerted_at = null,
         first_staff_reply_at = coalesce(first_staff_reply_at, now()),
         closed_at = null
   where id = p_id;
  update app_private.lc_presence set last_seen_at = now() where id = 1;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cc_lc_set_status(p_id uuid, p_status text)
returns jsonb language plpgsql security definer
set search_path to 'app_private, public'
as $$
declare v_conv app_private.lc_conversations; v_to text;
begin
  if not app_private.lc_cc_ok() then return jsonb_build_object('error','not authorized'); end if;
  if p_status not in ('open','closed') then return jsonb_build_object('error','bad status'); end if;
  select * into v_conv from app_private.lc_conversations where id = p_id;
  if v_conv.id is null then return jsonb_build_object('error','not found'); end if;
  if p_status = 'closed' and v_conv.status <> 'closed' then
    update app_private.lc_conversations set status = 'closed', closed_at = now(), closed_by = 'staff', staff_unread = 0 where id = p_id;
    insert into app_private.lc_messages (conversation_id, sender, staff_id, body)
      values (p_id, 'bot', auth.uid(), '[[sys]] Conversation closed by LoadBoot. If anything else comes up, just type — it reopens.');
    update app_private.lc_conversations set visitor_unread = visitor_unread + 1, last_msg_at = now() where id = p_id;
  elsif p_status = 'open' then
    update app_private.lc_conversations set status = 'open', closed_at = null, closed_by = null where id = p_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cc_lc_stats()
returns jsonb language sql stable security definer
set search_path to 'app_private, public'
as $$
  select case when not app_private.lc_cc_ok() then jsonb_build_object('error','not authorized')
    else jsonb_build_object(
      'open', (select count(*) from app_private.lc_conversations where status='open'),
      'needs_human', (select count(*) from app_private.lc_conversations where status='open' and mode='human' and staff_unread > 0),
      'unread', (select coalesce(sum(staff_unread),0) from app_private.lc_conversations where status='open'),
      'today', (select count(*) from app_private.lc_conversations where created_at > current_date),
      'leads_today', (select count(*) from app_private.lc_conversations where created_at > current_date and email is not null and user_id is null),
      'ai_resolved_today', (select count(*) from app_private.lc_conversations where created_at > current_date and mode = 'bot'),
      'oldest_wait_secs', (select coalesce(max(extract(epoch from (now() - last_msg_at)))::int, 0)
                           from app_private.lc_conversations where status='open' and mode='human' and staff_unread > 0),
      'online', app_private.lc_staff_online(),
      'staff_name', (select staff_name from app_private.lc_presence where id = 1),
      'unanswered_handoffs', (select count(*) from app_private.lc_conversations c where c.status='open' and c.mode='human'
                               and not exists (select 1 from app_private.lc_messages m where m.conversation_id=c.id and m.sender='staff')),
      'convs_7d', (select count(*) from app_private.lc_conversations where created_at > now() - interval '7 days'),
      'handoffs_7d', (select count(*) from app_private.lc_conversations where handoff_at > now() - interval '7 days'),
      'median_first_reply_secs_7d', (select percentile_cont(0.5) within group (order by extract(epoch from (first_staff_reply_at - handoff_at)))::int
                                     from app_private.lc_conversations where handoff_at > now() - interval '7 days' and first_staff_reply_at is not null),
      'handoffs_answered_15m_pct_7d', (select case when count(*) = 0 then null
                                           else round(100.0 * count(*) filter (where first_staff_reply_at is not null and first_staff_reply_at - handoff_at <= interval '15 minutes') / count(*)) end
                                       from app_private.lc_conversations where handoff_at > now() - interval '7 days' and handoff_at < now() - interval '15 minutes'),
      'csat_avg_30d', (select round(avg(csat)::numeric, 1) from app_private.lc_conversations where csat_at > now() - interval '30 days'),
      'csat_n_30d', (select count(*) from app_private.lc_conversations where csat_at > now() - interval '30 days'),
      'ai_share_7d', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where handoff_at is null) / count(*)) end
                      from app_private.lc_conversations where created_at > now() - interval '7 days')
    ) end;
$$;

create or replace function public.cc_lc_list(p_status text default 'open', p_search text default null)
returns jsonb language sql stable security definer
set search_path to 'app_private, public'
as $$
  select case when not app_private.lc_cc_ok() then jsonb_build_object('error','not authorized')
    else coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'origin', c.origin, 'page', c.page, 'status', c.status, 'mode', c.mode,
      'name', c.name, 'email', coalesce(c.email, p.email), 'visitor_role', c.visitor_role,
      'user_id', c.user_id, 'role', p.role, 'company', p.company, 'profile_status', p.status,
      'mc', p.mc, 'dot', p.dot,
      'assigned_to', c.assigned_to, 'assigned_me', (c.assigned_to = auth.uid()),
      'assigned_email', (select u.email from auth.users u where u.id = c.assigned_to),
      'waiting_secs', case when c.staff_unread > 0 then greatest(0, extract(epoch from (now() - c.last_msg_at)))::int else null end,
      'staff_unread', c.staff_unread, 'last_msg_at', c.last_msg_at, 'created_at', c.created_at,
      'last_msg', (select left(regexp_replace(m.body, '\[\[[^\]]*\]\]', '', 'g'), 120) from app_private.lc_messages m where m.conversation_id = c.id and m.body not like '[[note]]%' order by m.id desc limit 1),
      'bot_paused', c.bot_paused, 'handoff_at', c.handoff_at, 'first_staff_reply_at', c.first_staff_reply_at,
      'csat', c.csat, 'lang', c.lang,
      'visitor_online', (c.visitor_seen_at is not null and c.visitor_seen_at > now() - interval '45 seconds'),
      'visitor_typing', (c.visitor_typing_at is not null and c.visitor_typing_at > now() - interval '6 seconds'),
      'msg_count', (select count(*) from app_private.lc_messages m where m.conversation_id = c.id and m.body not like '[[note]]%')
    ) order by
      case when c.mode = 'human' and c.staff_unread > 0 then 0 when c.staff_unread > 0 then 1 else 2 end,
      c.last_msg_at desc)
    from (select * from app_private.lc_conversations c0
          where case p_status
                  when 'all' then true
                  when 'open' then c0.status = 'open'
                  when 'closed' then c0.status = 'closed'
                  when 'human' then c0.status = 'open' and c0.mode = 'human'
                  when 'ai' then c0.status = 'open' and c0.mode = 'bot'
                  when 'unread' then c0.status = 'open' and c0.staff_unread > 0
                  when 'mine' then c0.assigned_to = auth.uid()
                  when 'leads' then c0.email is not null and c0.user_id is null
                  when 'rated' then c0.csat is not null
                  else c0.status = 'open' end
            and (p_search is null or trim(p_search) = ''
                 or c0.name ilike '%'||trim(p_search)||'%'
                 or c0.email ilike '%'||trim(p_search)||'%'
                 or c0.visitor_role ilike '%'||trim(p_search)||'%'
                 or exists (select 1 from app_private.lc_messages mm where mm.conversation_id = c0.id and mm.body ilike '%'||trim(p_search)||'%'))
          order by last_msg_at desc limit 300) c
    left join public.profiles p on p.id = c.user_id), '[]'::jsonb) end;
$$;

create or replace function public.cc_lc_get(p_id uuid)
returns jsonb language plpgsql security definer
set search_path to 'app_private, public'
as $$
declare v jsonb;
begin
  if not app_private.lc_cc_ok() then return jsonb_build_object('error','not authorized'); end if;
  update app_private.lc_conversations set staff_unread = 0 where id = p_id;
  select jsonb_build_object(
    'id', c.id, 'origin', c.origin, 'page', c.page, 'status', c.status, 'mode', c.mode,
    'name', c.name, 'email', coalesce(c.email, p.email), 'visitor_role', c.visitor_role,
    'user_id', c.user_id, 'role', p.role, 'company', p.company, 'profile_status', p.status,
    'mc', p.mc, 'dot', p.dot, 'created_at', c.created_at,
    'assigned_to', c.assigned_to, 'assigned_me', (c.assigned_to = auth.uid()),
    'bot_paused', c.bot_paused, 'bot_paused_by_name', case when c.bot_paused then app_private.lc_staff_display(c.bot_paused_by) end,
    'handoff_at', c.handoff_at, 'first_staff_reply_at', c.first_staff_reply_at,
    'csat', c.csat, 'csat_comment', c.csat_comment, 'csat_at', c.csat_at, 'lang', c.lang,
    'closed_at', c.closed_at, 'closed_by', c.closed_by,
    'visitor_online', (c.visitor_seen_at is not null and c.visitor_seen_at > now() - interval '45 seconds'),
    'visitor_typing', (c.visitor_typing_at is not null and c.visitor_typing_at > now() - interval '6 seconds'),
    'account', app_private.lc_account_snapshot(c.user_id),
    'calls', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'direction', k.direction, 'status', k.status, 'at', k.created_at,
                 'duration_sec', k.duration_sec, 'summary', k.summary, 'to_number', k.to_number, 'scheduled_at', k.scheduled_at) order by k.created_at desc)
               from (select * from app_private.lc_calls k0
                      where (c.visitor_key is not null and k0.visitor_key = c.visitor_key)
                         or (c.user_id is not null and k0.requested_by = c.user_id)
                      order by k0.created_at desc limit 10) k), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'sender', m.sender, 'body', m.body, 'at', m.created_at,
                    'staff_name', case when m.sender = 'staff' or m.staff_id is not null then app_private.lc_staff_display(m.staff_id) end) order by m.id)
      from app_private.lc_messages m where m.conversation_id = c.id), '[]'::jsonb)
  ) into v
  from app_private.lc_conversations c left join public.profiles p on p.id = c.user_id where c.id = p_id;
  return coalesce(v, jsonb_build_object('error','not found'));
end $$;

-- ───────────────────────── J. SLA alert cron ─────────────────────────
-- A handoff nobody answered for 10 minutes emails the alert address; repeats every 30 minutes while it stays unanswered.
create or replace function app_private.lc_sla_alert()
returns jsonb language plpgsql security definer
set search_path to 'app_private, public'
as $$
declare r record; n int := 0; v_subj text; v_html text; v_mins int;
begin
  for r in
    select c.id, c.name, c.email, c.visitor_role, c.origin, c.handoff_at, c.last_msg_at
      from app_private.lc_conversations c
     where c.status = 'open' and c.mode = 'human' and c.staff_unread > 0
       and c.last_msg_at < now() - interval '10 minutes'
       and c.last_msg_at > now() - interval '24 hours'
       and (c.sla_alerted_at is null or c.sla_alerted_at < now() - interval '30 minutes')
     order by c.last_msg_at limit 20
  loop
    v_mins := greatest(1, extract(epoch from (now() - r.last_msg_at))::int / 60);
    v_subj := '⏱ ' || v_mins || ' min unanswered — live chat with ' || coalesce(r.name, 'a visitor') || ' (' || coalesce(r.visitor_role,'unknown role') || ')';
    v_html := '<h2 style="margin:0 0 8px;font-size:20px;color:#b91c1c">' || v_subj || '</h2>'
      || '<p style="color:#475569;line-height:1.6">They asked for a person and nobody has replied yet. Origin: ' || coalesce(r.origin,'website')
      || coalesce(' · ' || r.email, '') || '</p>'
      || '<div style="background:#f6f9fd;border-left:3px solid #FC5305;padding:12px 14px;border-radius:8px;white-space:pre-wrap;color:#0b1220">'
      || coalesce((select string_agg(case m.sender when 'visitor' then '👤 ' when 'staff' then '🧑 ' else '⚡ ' end || left(regexp_replace(m.body, '\[\[[^\]]*\]\]', '', 'g'), 300), E'\n' order by m.id)
                    from (select * from app_private.lc_messages where conversation_id = r.id and body not like '[[note]]%' order by id desc limit 6) m), '')
      || '</div><p style="margin:16px 0 0"><a href="https://loadboot.com/app/command-center/#/live-chat" style="display:inline-block;padding:12px 22px;background:#FC5305;color:#fff;border-radius:10px;text-decoration:none;font-weight:700">Reply now →</a></p>';
    begin
      perform app_private.sys_email(app_private.lc_alert_email(), 'chat.sla', v_subj, v_html,
        v_subj || ' — open https://loadboot.com/app/command-center/#/live-chat',
        'lcsla:' || r.id::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
      insert into app_private.notifications (recipient_role, channel, template_key, payload, status, sent_at)
      values ('staff','in_app','livechat.sla', jsonb_build_object('title', v_subj, 'body', 'Open Live chat and answer.', 'tone','urgent','url','/live-chat'), 'sent', now());
    exception when others then raise warning 'lc_sla_alert failed for %: %', r.id, sqlerrm; end;
    update app_private.lc_conversations set sla_alerted_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return jsonb_build_object('alerted', n);
end $$;

do $cron$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'lb-lc-sla-alert';
  perform cron.schedule('lb-lc-sla-alert', '*/2 * * * *', 'select app_private.lc_sla_alert()');
exception when others then raise warning 'cron schedule failed: %', sqlerrm;
end $cron$;

-- Housekeep: an auto-closed chat records why.
create or replace function app_private.lc_housekeep()
returns jsonb language plpgsql security definer
set search_path to 'app_private, public'
as $$
declare v_closed int; v_jobs int;
begin
  update app_private.lc_conversations set status = 'closed', closed_at = now(), closed_by = 'auto'
    where status = 'open' and mode = 'bot' and last_msg_at < now() - interval '72 hours';
  get diagnostics v_closed = row_count;
  delete from app_private.lc_misses where resolved and last_seen < now() - interval '30 days';
  delete from app_private.lc_brain_jobs where created_at < now() - interval '14 days';
  get diagnostics v_jobs = row_count;
  return jsonb_build_object('closed', v_closed, 'brain_jobs_pruned', v_jobs);
end $$;

-- ───────────────────────── K. grants ─────────────────────────
revoke all on function public.lc_poll(uuid, text, bigint, boolean) from public;
grant execute on function public.lc_poll(uuid, text, bigint, boolean) to anon, authenticated;
revoke all on function public.lc_rate(uuid, text, integer, text, boolean, boolean) from public;
grant execute on function public.lc_rate(uuid, text, integer, text, boolean, boolean) to anon, authenticated;
revoke all on function public.lc_history(text) from public;
grant execute on function public.lc_history(text) to anon, authenticated;
revoke all on function public.lc_hello(text) from public, anon;
grant execute on function public.lc_hello(text) to authenticated;
revoke all on function public.lc_send(uuid, text, text) from public;
grant execute on function public.lc_send(uuid, text, text) to anon, authenticated;

revoke all on function public.cc_lc_heartbeat() from public, anon;
grant execute on function public.cc_lc_heartbeat() to authenticated;
revoke all on function public.cc_lc_typing(uuid) from public, anon;
grant execute on function public.cc_lc_typing(uuid) to authenticated;
revoke all on function public.cc_lc_bot_resume(uuid) from public, anon;
grant execute on function public.cc_lc_bot_resume(uuid) to authenticated;
revoke all on function public.cc_lc_presence_set(boolean, text, text, text) from public, anon;
grant execute on function public.cc_lc_presence_set(boolean, text, text, text) to authenticated;
revoke all on function public.cc_lc_presence_get() from public, anon;
grant execute on function public.cc_lc_presence_get() to authenticated;
revoke all on function public.cc_lc_assign(uuid, boolean) from public, anon;
grant execute on function public.cc_lc_assign(uuid, boolean) to authenticated;
revoke all on function public.cc_lc_reply(uuid, text) from public, anon;
grant execute on function public.cc_lc_reply(uuid, text) to authenticated;
revoke all on function public.cc_lc_set_status(uuid, text) from public, anon;
grant execute on function public.cc_lc_set_status(uuid, text) to authenticated;
revoke all on function public.cc_lc_stats() from public, anon;
grant execute on function public.cc_lc_stats() to authenticated;
revoke all on function public.cc_lc_list(text, text) from public, anon;
grant execute on function public.cc_lc_list(text, text) to authenticated;
revoke all on function public.cc_lc_get(uuid) from public, anon;
grant execute on function public.cc_lc_get(uuid) to authenticated;

revoke all on function app_private.lc_account_snapshot(uuid) from public, anon, authenticated;
revoke all on function app_private.lc_sla_alert() from public, anon, authenticated;
revoke all on function app_private.lc_cc_ok() from public, anon, authenticated;
revoke all on function app_private.lc_bot_answer_l2(text, text, numeric) from public, anon, authenticated;
revoke all on function app_private.lc_staff_online() from public, anon, authenticated;
revoke all on function app_private.lc_staff_display(uuid) from public, anon, authenticated;
revoke all on function app_private.lc_alert_email() from public, anon, authenticated;
