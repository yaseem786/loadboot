-- bl_bp_0318 rollback test — run as one statement; ends with RAISE EXCEPTION so nothing persists.
create function pg_temp.mkuser(p_uid uuid, p_email text) returns void language plpgsql as $f$
begin
  insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values (p_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, 'x', now(), jsonb_build_object('partner_kind','broker'), '{"provider":"email","providers":["email"]}', now(), now());
end $f$;
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
end $f$;
create function pg_temp.pg() returns void language plpgsql as $f$ begin perform set_config('role','postgres', true); end $f$;
create function pg_temp.mkorg(p_uid uuid, p_name text) returns uuid language plpgsql as $f$
declare v_id uuid; r jsonb;
begin
  perform pg_temp.as_user(p_uid);
  r := public.cc_partner_register('broker', p_name, null);
  perform pg_temp.pg();
  select org_id into v_id from public.organization_memberships where user_id = p_uid limit 1;
  return v_id;
end $f$;
-- pretend fmcsa-verify answered for this org's current screening request
create function pg_temp.screen(p_org uuid, p_mc text, p_legal text, p_email text, p_phone text, p_outcome text) returns void language plpgsql as $f$
begin
  update app_private.broker_screenings set outcome = p_outcome, request_id = null, checked_at = now(), legal_name = p_legal, fmcsa_email = p_email, phone = p_phone,
         authority_source = 'test', reason = case when p_outcome = 'fail' then 'test fail' end, mc_number = p_mc, updated_at = now()
   where org_id = p_org;
  perform app_private.agent_parent_screened(p_org);
end $f$;
create function pg_temp.code_for(p_parent uuid) returns text language plpgsql as $f$
declare v text;
begin
  select (regexp_match(md.meta->>'body_html', 'font-family:ui-monospace[^>]*>([0-9]{6})<'))[1] into v
    from app_private.message_deliveries md where md.template_key = 'broker.parent_confirm' and md.idempotency_key like 'agentconfirm:' || p_parent::text || ':%'
   order by md.created_at desc limit 1;
  return v;
end $f$;
create function pg_temp.ld(p_dest text, p_days int, p_parent uuid) returns jsonb language sql as $f$
  select jsonb_build_object('origin','Dallas, TX','destination',p_dest,'hazmat','false','confirm_duplicate','true','pickup_date',(current_date+p_days)::text,
    'equipment','Van','rate','1800','miles','800','weight','30000','commodity','paper',
    'accessorials', jsonb_build_object('detention_per_hr','50','detention_free_hours','2','layover_per_day','250','tonu','150','lumper_policy','broker pays','fcfs','true'), 'pickup_window','08:00-16:00',
    'details', case when p_parent is null then '{}'::jsonb else jsonb_build_object('agent_parent_id', p_parent) end) $f$;
do $$
declare
  uP uuid := gen_random_uuid(); uA uuid := gen_random_uuid();
  oP uuid; oA uuid; p1 uuid; p2 uuid; p3 uuid;
  r jsonb; out text := ''; v text; n int; v_code text; v_load1 uuid; v_load2 uuid; v_tok uuid; q record; v_err text; v_lid uuid;
begin
  perform pg_temp.mkuser(uP, 'owner@bigbroker.com');   -- brokerage P on LoadBoot
  perform pg_temp.mkuser(uA, 'agent@gmail.com');       -- freelance agent A
  oP := pg_temp.mkorg(uP, 'Big Broker LLC'); oA := pg_temp.mkorg(uA, 'Alex Agency');
  perform pg_temp.pg();
  update public.organizations set mc_number = '700001' where id = oP;
  insert into app_private.broker_trust(org_id) values (oP) on conflict do nothing;
  insert into app_private.broker_screenings(org_id, mc_number, outcome, legal_name, fmcsa_email, phone, checked_at, attempts)
  values (oP, '700001', 'pass', 'BIG BROKER LLC', 'ops@bigbroker.com', '5550000001', now(), 1);
  perform app_private.broker_identity_start(oP);
  out := out || 'P tier=' || app_private.broker_tier(oP) || ' | ';

  -- 1. agent declares brokerage #1 (Acme, NOT on LoadBoot); FMCSA lists ops@acmefreight.com; agent typed a same-domain address
  perform pg_temp.as_user(uA);
  r := public.partner_agent_declare('700002', 'Acme Freight', 'dispatch@acmefreight.com');
  perform pg_temp.pg();
  p1 := (r->>'parent_id')::uuid;
  out := out || format('declare1 queued=%s parent=%s | ', r->>'queued', p1 is not null);
  perform pg_temp.screen(oA, '700002', 'ACME FREIGHT LLC', 'ops@acmefreight.com', '5550000002', 'pass');
  select status || '/' || coalesce(contact_source,'-') || '/' || coalesce(sent_to,'-') into v from (select case when confirmed_at is not null then 'confirmed' when screen_outcome='pass' then 'pending' else 'x' end status, contact_source, sent_to from app_private.agent_parents where id = p1) s;
  select count(*) into n from app_private.message_deliveries where template_key = 'broker.parent_confirm' and idempotency_key like 'agentconfirm:' || p1::text || ':%';
  v_code := pg_temp.code_for(p1);
  out := out || format('p1 %s emails=%s code_len=%s tier=%s | ', v, n, length(coalesce(v_code,'')), app_private.broker_tier(oA));

  -- 2. wrong code, then the real one
  perform pg_temp.as_user(uA);
  r := public.partner_verify_code('000000'); out := out || 'wrong=' || (r->>'ok') || ' ';
  r := public.partner_verify_code(v_code);  out := out || 'right=' || (r->>'ok') || '/' || (r->>'parent') || ' ';
  r := public.partner_verify_code(v_code);  out := out || 'reuse=' || (r->>'ok') || ' | ';
  perform pg_temp.pg();
  select confirmed_by into v from app_private.agent_parents where id = p1;
  out := out || format('p1 confirmed_by=%s tier=%s primary_mc=%s | ', v, app_private.broker_tier(oA), (select parent_mc from app_private.broker_trust where org_id = oA));

  -- 3. no call for parents any more
  perform pg_temp.as_user(uA); r := public.partner_verify_call('parent'); perform pg_temp.pg();
  out := out || 'call=' || (r->>'ok') || ':' || left(r->>'why', 40) || ' | ';

  -- 4. agent adds brokerage #2 = P (on LoadBoot) → owner gets in-app + email; owner approves in portal
  perform pg_temp.as_user(uA); r := public.partner_agent_declare('700001', 'Big Broker', null); perform pg_temp.pg();
  p2 := (r->>'parent_id')::uuid;
  perform pg_temp.screen(oA, '700001', 'BIG BROKER LLC', 'ops@bigbroker.com', '5550000001', 'pass');
  select contact_source || '/' || sent_to into v from app_private.agent_parents where id = p2;
  out := out || format('p2 %s parent_on_lb=%s | ', v, (select parent_org_id = oP from app_private.agent_parents where id = p2));
  perform pg_temp.as_user(uP); r := public.partner_agents_list(); perform pg_temp.pg();
  out := out || format('P sees agents=%s status=%s other=%s | ', jsonb_array_length(r->'agents'), r->'agents'->0->>'status', r->'agents'->0->>'other_brokerages');
  perform pg_temp.as_user(uP); r := public.partner_agent_decide(oA, 'confirm', 'ok'); perform pg_temp.pg();
  out := out || format('P confirm tier=%s p2_confirmed=%s | ', r->>'tier', (select confirmed_at is not null from app_private.agent_parents where id = p2));

  -- 5. posting: must choose; per-brokerage limit
  perform pg_temp.as_user(uA);
  begin r := public.cc_partner_submit_load(pg_temp.ld('Atlanta, GA', 2, null)); v_err := 'no error';
  exception when others then v_err := sqlerrm; end;
  out := out || 'post_nochoice=' || left(v_err, 40) || ' | ';
  r := public.cc_accept_agreement('broker_carrier');
  r := public.cc_partner_submit_load(pg_temp.ld('Atlanta, GA', 2, p1));
  v_load1 := (r->>'id')::uuid;
  r := public.cc_partner_submit_load(pg_temp.ld('Miami, FL', 3, p1));
  r := public.cc_partner_submit_load(pg_temp.ld('Tampa, FL', 4, p1));
  begin r := public.cc_partner_submit_load(pg_temp.ld('Denver, CO', 5, p1)); v_err := 'no error';
  exception when others then v_err := sqlerrm; end;
  out := out || 'post4_p1=' || left(v_err, 50) || ' | ';
  r := public.cc_partner_submit_load(pg_temp.ld('Denver, CO', 5, p2));
  v_load2 := (r->>'id')::uuid;
  perform pg_temp.pg();
  out := out || format('post_p2=%s details_name=%s | ', v_load2 is not null, (select details->>'agent_parent_name' from app_private.partner_loads where id = v_load2));

  -- 6. staff posts both → loads.broker label per brokerage
  create or replace function public.has_global_permission(p_perm text) returns boolean language sql as 'select true';
  alter table public.loads disable trigger trg_load_posted_match;  -- staging lacks loads.is_demo (schema drift, unrelated)
  r := public.cc_decide_partner_load(v_load1, 'post');
  r := public.cc_decide_partner_load(v_load2, 'post');
  out := out || format('label1=%s | label2=%s | ', (select l.broker from public.loads l join app_private.partner_loads pl on pl.posted_load_id = l.id where pl.id = v_load1),
                                                   (select l.broker from public.loads l join app_private.partner_loads pl on pl.posted_load_id = l.id where pl.id = v_load2));

  -- 7. P revokes → only P's load cancelled; agent still confirmed via Acme
  perform pg_temp.as_user(uP); r := public.partner_agent_decide(oA, 'revoke', 'left us'); perform pg_temp.pg();
  out := out || format('after_revoke tier=%s load2=%s load1=%s | ', app_private.broker_tier(oA),
    (select l.status from public.loads l join app_private.partner_loads pl on pl.posted_load_id = l.id where pl.id = v_load2),
    (select l.status from public.loads l join app_private.partner_loads pl on pl.posted_load_id = l.id where pl.id = v_load1));

  -- 8. brokerage #3: FMCSA has no email → no email, agent told to fix the record
  perform pg_temp.as_user(uA); r := public.partner_agent_declare('700003', 'Ghost Logistics', 'me@gmail.com'); perform pg_temp.pg();
  p3 := (r->>'parent_id')::uuid;
  perform pg_temp.screen(oA, '700003', 'GHOST LOGISTICS INC', null, null, 'pass');
  select count(*) into n from app_private.message_deliveries where idempotency_key like 'agentconfirm:' || p3::text || ':%';
  out := out || format('p3 emails=%s notice=%s | ', n, exists(select 1 from app_private.partner_notifications where partner_org = oA and title like '%FMCSA lists no email%'));
  -- token page still works; decline → hold
  update app_private.agent_parents set screen_outcome='pass', fmcsa_email='x@ghost.com', updated_at=now() where id = p3;
  select confirm_token into v_tok from app_private.agent_parents where id = p3;
  perform set_config('role','anon', true);
  r := public.partner_agent_confirm_get(v_tok); out := out || 'tok_get=' || (r->>'ok') || '/' || (r->>'parent_legal_name') || ' ';
  r := public.partner_agent_confirm(v_tok, 'decline', 'Ghost owner', 'never heard of them');
  perform pg_temp.pg();
  out := out || format('decline tier=%s hold=%s | ', app_private.broker_tier(oA), (select left(hold_reason,30) from app_private.broker_trust where org_id = oA));
  -- re-declaring a declined brokerage is refused
  perform pg_temp.as_user(uA);
  begin r := public.partner_agent_declare('700003', 'Ghost Logistics', null); v_err := 'no error'; exception when others then v_err := sqlerrm; end;
  perform pg_temp.pg();
  out := out || 'redeclare_declined=' || left(v_err, 30) || ' | ';
  -- staff release + status payload
  perform pg_temp.as_user(uA); r := public.partner_trust_status(); perform pg_temp.pg();
  out := out || format('status parents=%s statuses=%s verify_call=%s', jsonb_array_length(r->'parents'),
    (select string_agg(e->>'status', ',') from jsonb_array_elements(r->'parents') e), coalesce(r->>'verify_call','null'));
  raise exception 'RESULT:%', out;
end $$;
