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
create function pg_temp.mkorg(p_uid uuid, p_name text) returns uuid language plpgsql as $f$
declare v_id uuid; r jsonb;
begin
  perform pg_temp.as_user(p_uid);
  r := public.cc_partner_register('broker', p_name, null);
  perform set_config('role','postgres', true);
  select org_id into v_id from public.organization_memberships where user_id = p_uid limit 1;
  return v_id;
end $f$;
do $$
declare
  uA uuid := gen_random_uuid(); uB uuid := gen_random_uuid(); uC uuid := gen_random_uuid(); uD uuid := gen_random_uuid(); uE uuid := gen_random_uuid();
  oA uuid; oB uuid; oC uuid; oD uuid; oE uuid;
  r jsonb; out text := ''; v text; v_tok uuid; n int; v_load uuid; v_broker text; q record; v_err text;
begin
  -- fixtures ---------------------------------------------------------------
  perform pg_temp.mkuser(uA, 'owner@acmefreight.com');     -- broker A: own MC, FMCSA email same domain → auto verify
  perform pg_temp.mkuser(uB, 'bob@gmail.com');             -- broker B: own MC, FMCSA email elsewhere → email claim
  perform pg_temp.mkuser(uC, 'crook@gmail.com');           -- broker C: tries A's MC → refused
  perform pg_temp.mkuser(uD, 'dave@gmail.com');            -- agent D: declares parent A (A is on LoadBoot) → routed to A owner
  perform pg_temp.mkuser(uE, 'eve@gmail.com');             -- agent E: invited by A → auto-confirm on declare
  oA := pg_temp.mkorg(uA, 'Acme Freight LLC'); oB := pg_temp.mkorg(uB, 'Bob Brokerage'); oC := pg_temp.mkorg(uC, 'Crook Logistics'); oD := pg_temp.mkorg(uD, 'Dave Agency'); oE := pg_temp.mkorg(uE, 'Eve Agency');
  out := out || format('orgs A=%s B=%s C=%s D=%s E=%s | ', oA is not null, oB is not null, oC is not null, oD is not null, oE is not null);
  perform set_config('role','postgres', true);

  -- A: pretend screening passed with FMCSA email at acmefreight.com
  update public.organizations set mc_number = '900001' where id = oA;
  insert into app_private.broker_trust(org_id) values (oA) on conflict do nothing;
  insert into app_private.broker_screenings(org_id, mc_number, outcome, legal_name, fmcsa_email, phone, checked_at, attempts)
  values (oA, '900001', 'pass', 'ACME FREIGHT LLC', 'dispatch@AcmeFreight.com', '5551234567', now(), 1);
  perform app_private.broker_identity_start(oA);
  select status||'/'||coalesce(method,'-') into v from app_private.broker_identity where org_id = oA;
  out := out || 'A identity=' || v || ' tier=' || app_private.broker_tier(oA) || ' | ';

  -- B: FMCSA email at other domain → pending + claim email queued
  update public.organizations set mc_number = '900002' where id = oB;
  insert into app_private.broker_trust(org_id) values (oB) on conflict do nothing;
  insert into app_private.broker_screenings(org_id, mc_number, outcome, legal_name, fmcsa_email, phone, checked_at, attempts)
  values (oB, '900002', 'pass', 'BOB BROKERAGE INC', 'office@bobbrokerage.com', '5559876543', now(), 1);
  perform app_private.broker_identity_start(oB);
  select status||'/'||coalesce(method,'-')||'/'||email_resends into v from app_private.broker_identity where org_id = oB;
  select email_token into v_tok from app_private.broker_identity where org_id = oB;
  select count(*) into n from app_private.message_deliveries where recipient_email = 'office@bobbrokerage.com' and template_key = 'broker.identity_claim';
  out := out || format('B identity=%s tier=%s claim_emails=%s tok=%s | ', v, app_private.broker_tier(oB), n, v_tok is not null);
  -- B can_post reason mentions masked email
  select reason into v from app_private.broker_can_post(oB);
  out := out || 'B reason=' || left(coalesce(v,'-'),80) || ' | ';
  -- resend: immediate resend blocked (10 min)
  perform pg_temp.as_user(uB); r := public.partner_identity_resend(); perform set_config('role','postgres', true);
  out := out || 'B resend_now=' || (r->>'sent') || ' | ';
  -- claim page (anon)
  perform set_config('request.jwt.claims', '{"role":"anon"}', true); perform set_config('role','anon', true);
  r := public.partner_claim_get(v_tok);
  out := out || format('claim_get company=%s mc=%s decided=%s | ', r->>'company', r->>'mc', r->>'decided');
  r := public.partner_claim_get(gen_random_uuid());
  out := out || 'claim_get bad=' || (r->>'ok') || ' | ';
  r := public.partner_claim_confirm(v_tok, 'confirm', 'Bob Owner', null);
  perform set_config('role','postgres', true);
  out := out || format('B confirm=%s tier=%s | ', r->>'confirmed', app_private.broker_tier(oB));
  -- second click = idempotent
  r := public.partner_claim_confirm(v_tok, 'decline', 'x', null);
  out := out || format('B reclick already=%s tier=%s | ', r->>'already', app_private.broker_tier(oB));

  -- decline path on a fresh copy: reuse C as an own-MC broker with pending identity
  update public.organizations set mc_number = '900003' where id = oC;
  insert into app_private.broker_trust(org_id) values (oC) on conflict do nothing;
  insert into app_private.broker_screenings(org_id, mc_number, outcome, legal_name, fmcsa_email, phone, checked_at, attempts)
  values (oC, '900003', 'pass', 'CROOK LOGISTICS', 'real@crooklogistics.com', '5550000000', now(), 1);
  perform app_private.broker_identity_start(oC);
  select email_token into v_tok from app_private.broker_identity where org_id = oC;
  r := public.partner_claim_confirm(v_tok, 'decline', 'Real Owner', 'never heard of them');
  select hold_reason into v from app_private.broker_trust where org_id = oC;
  select count(*) into n from app_private.notifications where template_key = 'broker.identity_decided' and payload->>'title' like '%IMPERSONATION%';
  out := out || format('C decline tier=%s hold=%s staff_alert=%s | ', app_private.broker_tier(oC), left(v,40), n);

  -- MC collision: C now tries to screen with A's MC
  update public.organizations set mc_number = null where id = oC;
  perform pg_temp.as_user(uC);
  r := public.partner_broker_screen('MC-900001', null);
  out := out || 'collision=' || coalesce(r->>'outcome','?') || ' ' || left(coalesce(r->>'error',''),50) || ' | ';
  perform set_config('role','postgres', true);
  select count(*) into n from app_private.partner_notifications where partner_org = oA and title like '%tried to register%';
  out := out || 'A warned=' || n || ' | ';
  -- unique index blocks a direct duplicate too
  begin
    update public.organizations set mc_number = '900001' where id = oC;
    out := out || 'UNIQUE INDEX MISSING!! | ';
  exception when unique_violation then out := out || 'unique_ok | '; end;

  -- agent D declares parent A (on LoadBoot) — screening request will queue http (rolled back)
  perform pg_temp.as_user(uD);
  r := public.partner_agent_declare('900001', 'Acme', null);
  perform set_config('role','postgres', true);
  select parent_org_id::text = oA::text into v from app_private.broker_trust where org_id = oD;
  out := out || format('D declared parent_link=%s legal=%s | ', v, (select parent_legal_name from app_private.broker_trust where org_id = oD));
  -- pretend D's screening passed → parent confirm send routes to A owner
  update app_private.broker_screenings set outcome='pass', legal_name='ACME FREIGHT LLC', fmcsa_email='dispatch@acmefreight.com', checked_at=now() where org_id = oD;
  perform app_private.broker_parent_confirm_send(oD);
  select count(*) into n from app_private.partner_notifications where partner_org = oA and title like '%agent wants to post%';
  select count(*) into v from app_private.message_deliveries where recipient_email = 'owner@acmefreight.com' and template_key like '%parent%';
  out := out || format('D confirm→A inapp=%s email_to_owner=%s tier=%s | ', n, v, app_private.broker_tier(oD));
  -- A lists agents, confirms D
  perform pg_temp.as_user(uA);
  r := public.partner_agents_list();
  out := out || format('A agents=%s status=%s | ', jsonb_array_length(r->'agents'), r->'agents'->0->>'status');
  r := public.partner_agent_decide(oD, 'confirm', 'ok');
  out := out || 'D after confirm tier=' || (r->>'tier') || ' | ';
  perform set_config('role','postgres', true);
  -- D posts a load: broker label must carry parent's name
  alter table public.loads disable trigger user;
  alter table public.loads enable trigger trg_loads_zz_trust_label;
  insert into public.loads(id, broker_org, source_type, broker, status, origin, destination) values (gen_random_uuid(), oD, 'partner_portal', 'Dave Agency', 'available', 'Dallas, TX', 'Atlanta, GA') returning id, broker into v_load, v_broker;
  alter table public.loads enable trigger user;
  alter table app_private.partner_loads disable trigger user;
  insert into app_private.partner_loads(broker_org, origin, destination, status, posted_load_id) values (oD, 'Dallas, TX', 'Atlanta, GA', 'posted', v_load);
  alter table app_private.partner_loads enable trigger user;
  out := out || 'D load.broker=' || v_broker || ' | ';
  -- A revokes D → load cancelled
  alter table public.loads disable trigger user; alter table app_private.partner_loads disable trigger user;
  perform pg_temp.as_user(uA);
  r := public.partner_agent_decide(oD, 'revoke', 'left the company');
  perform set_config('role','postgres', true);
  alter table public.loads enable trigger user; alter table app_private.partner_loads enable trigger user;
  select status into v from public.loads where id = v_load;
  out := out || format('D revoked tier=%s load=%s pl=%s | ', r->>'tier', v, (select status from app_private.partner_loads where posted_load_id = v_load));
  -- D not linked to B → B cannot decide
  perform pg_temp.as_user(uB);
  begin r := public.partner_agent_decide(oD, 'confirm', null); out := out || 'B DECIDED FOREIGN AGENT!! | ';
  exception when others then out := out || 'B foreign=' || sqlstate || ' | '; end;
  perform set_config('role','postgres', true);

  -- invite: A invites eve@gmail.com; E declares A → auto-confirmed
  perform pg_temp.as_user(uA);
  r := public.partner_agent_invite('Eve@Gmail.com', 'Eve');
  perform set_config('role','postgres', true);
  select count(*) into n from app_private.message_deliveries where recipient_email = 'eve@gmail.com' and template_key = 'broker.agent_invite';
  out := out || format('invite ok=%s email=%s | ', r->>'ok', n);
  perform pg_temp.as_user(uE);
  r := public.partner_agent_declare('900001', null, null);
  perform set_config('role','postgres', true);
  update app_private.broker_screenings set outcome='pass', checked_at=now() where org_id = oE;
  select parent_confirmed_at is not null || '/' || coalesce(parent_confirmed_by,'-') into v from app_private.broker_trust where org_id = oE;
  out := out || format('E auto=%s tier=%s invite=%s | ', v, app_private.broker_tier(oE), (select status from app_private.broker_agent_invites where lower(email)='eve@gmail.com'));
  -- C (unclaimed/declined) cannot invite
  perform pg_temp.as_user(uC);
  begin r := public.partner_agent_invite('z@z.com', null); out := out || 'C INVITED!! | ';
  exception when others then out := out || 'C invite blocked=' || sqlstate || ' | '; end;
  perform set_config('role','postgres', true);

  -- request call
  perform pg_temp.as_user(uC); r := public.partner_identity_request_call('555-1111', 'call me'); perform set_config('role','postgres', true);
  select count(*) into n from app_private.notifications where template_key = 'broker.identity_call';
  out := out || format('call_req=%s staff=%s | ', r->>'ok', n);

  -- partner_trust_status shows identity
  perform pg_temp.as_user(uB); r := public.partner_trust_status(); perform set_config('role','postgres', true);
  out := out || format('B status identity=%s parent_on_lb=%s | ', r->'identity'->>'status', r->>'parent_on_loadboot');
  perform pg_temp.as_user(uD); r := public.partner_trust_status(); perform set_config('role','postgres', true);
  out := out || format('D status parent_on_lb=%s parent=%s | ', r->>'parent_on_loadboot', r->>'parent_org_name');

  -- CC queue columns + staff verify_identity
  create or replace function app_private.has_global_permission(p text) returns boolean language sql as 'select true';
  perform set_config('request.jwt.claims', json_build_object('sub', uA, 'role','authenticated')::text, true);
  select count(*) into n from public.cc_broker_trust_queue() q2 where q2.identity_status is not null;
  select q2.identity_status||'/'||coalesce(q2.identity_method,'-')||'/'||coalesce(q2.parent_org_name,'-') into v from public.cc_broker_trust_queue() q2 where q2.org_id = oD;
  out := out || format('cc queue identity_rows=%s D=%s | ', n, v);
  begin r := public.cc_broker_trust_set(oC, 'verify_identity', null); out := out || 'VERIFY W/O NOTE!! | ';
  exception when others then out := out || 'verify_no_note=' || sqlstate || ' | '; end;
  r := public.cc_broker_trust_set(oC, 'verify_identity', 'called 555-000-0000, spoke to owner');
  r := public.cc_broker_trust_set(oC, 'release', 'cleared');
  out := out || 'C after staff verify tier=' || app_private.broker_tier(oC) || ' | ';
  r := public.cc_broker_trust_set(oB, 'resend_identity', null);
  out := out || 'resend verified=' || (r::text) || ' | ';

  raise exception 'RESULT: %', out;
end $$;
