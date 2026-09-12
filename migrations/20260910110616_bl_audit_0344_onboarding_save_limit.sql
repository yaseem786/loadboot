-- STAGING ONLY. Configurable trial limit: 60 accepted saves per visitor per 60-second window.
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.lc_ob_save(text,uuid,text,text,jsonb,text,text,boolean,boolean)'::regprocedure)) IS DISTINCT FROM '60c0fb2f4c0bc83d12653def282f926c' THEN RAISE EXCEPTION 'lc_ob_save definition drift'; END IF;
END $guard$;
CREATE TABLE app_private.lc_save_limit_config(id boolean PRIMARY KEY DEFAULT true CHECK(id),max_saves integer NOT NULL CHECK(max_saves BETWEEN 1 AND 1000),window_seconds integer NOT NULL CHECK(window_seconds BETWEEN 1 AND 3600));
INSERT INTO app_private.lc_save_limit_config(id,max_saves,window_seconds) VALUES(true,60,60);
CREATE TABLE app_private.lc_save_windows(visitor_hash text PRIMARY KEY,window_started timestamptz NOT NULL,saves integer NOT NULL CHECK(saves>0));
CREATE INDEX lc_save_windows_age_idx ON app_private.lc_save_windows(window_started);
ALTER TABLE app_private.lc_save_limit_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.lc_save_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.lc_save_limit_config,app_private.lc_save_windows FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.lc_ob_save(p_visitor_key text, p_conversation_id uuid DEFAULT NULL::uuid, p_role text DEFAULT NULL::text, p_step_key text DEFAULT NULL::text, p_patch jsonb DEFAULT NULL::jsonb, p_note text DEFAULT NULL::text, p_account_email text DEFAULT NULL::text, p_account_created boolean DEFAULT NULL::boolean, p_completed boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog
AS $function$
declare v_id uuid; v_max integer; v_seconds integer; v_now timestamptz; v_started timestamptz; v_hash text;
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
  select max_saves,window_seconds into v_max,v_seconds from app_private.lc_save_limit_config where id;
  if not found then return jsonb_build_object('error','save temporarily unavailable','retry_after',60); end if;
  v_now := clock_timestamp();
  v_hash := encode(sha256(convert_to(p_visitor_key,'UTF8')),'hex');
  -- A single atomic upsert serializes competing calls for this visitor. Refused calls don't save data or notes.
  insert into app_private.lc_save_windows as w(visitor_hash,window_started,saves) values(v_hash,v_now,1)
  on conflict(visitor_hash) do update set
    window_started=case when w.window_started+make_interval(secs=>v_seconds)<=v_now then v_now else w.window_started end,
    saves=case when w.window_started+make_interval(secs=>v_seconds)<=v_now then 1 else w.saves+1 end
  where w.window_started+make_interval(secs=>v_seconds)<=v_now or w.saves<v_max
  returning window_started into v_started;
  if not found then
    select window_started into v_started from app_private.lc_save_windows where visitor_hash=v_hash;
    return jsonb_build_object('error','rate_limit','retry_after',greatest(1,ceil(extract(epoch from v_started+make_interval(secs=>v_seconds)-v_now))::integer));
  end if;
  -- Bounded lazy cleanup; no scheduled sender/job and no visitor secret stored here.
  delete from app_private.lc_save_windows where visitor_hash in
    (select visitor_hash from app_private.lc_save_windows where window_started<v_now-interval '1 day' order by window_started limit 100 for update skip locked);
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
end $function$
;
-- CREATE OR REPLACE preserves the existing lc_ob_save ACL; no new public RPC or grant.

