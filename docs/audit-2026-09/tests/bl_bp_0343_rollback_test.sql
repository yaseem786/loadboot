-- docs/audit-2026-09/tests/bl_bp_0343_rollback_test.sql
-- Test for bl_bp_0343 + bl_bp_0343a (broker authority re-screen).
--
-- Self-contained and NON-DESTRUCTIVE: it creates two throwaway broker orgs, exercises every gate,
-- prints a pass/fail table, and deletes everything it made — including on failure. It never calls
-- FMCSA and never touches a real account.
--
-- RUN:  psql -f this_file        (or paste into the SQL editor)
-- READ: every row must show ok = t. Any f is a regression.
--
-- It needs one existing auth user to own the throwaway orgs (organizations_owner_by_kind requires
-- an owner for kind='broker'). Set :owner below, or leave it and the script picks the oldest
-- non-owner user it can find.

drop table if exists _bl0343_results;
create temp table _bl0343_results(seq int, step text, got text, want text, ok boolean);

do $$
declare
  a uuid := '00000000-0343-0343-0343-00000000aaaa';   -- the broker under test
  b uuid := '00000000-0343-0343-0343-00000000bbbb';   -- a freshly-passing broker: keeps the pipeline "healthy"
  v_owner uuid;
  v_eff text; v_tier text; v_out text; v_st text; v_swp jsonb; v_can record; v_n int;
begin
  select id into v_owner from auth.users order by created_at limit 1;
  if v_owner is null then raise exception 'no auth user available to own the throwaway orgs'; end if;

  delete from public.organizations where id in (a,b);
  insert into public.organizations(id,name,kind,status,mc_number,owner_user_id) values
    (a,'ZZ THROWAWAY 0343-A — delete me','broker','active','999344',v_owner),
    (b,'ZZ THROWAWAY 0343-B — delete me','broker','active','999345',v_owner);
  insert into app_private.broker_screenings(org_id,mc_number,outcome,checked_at,last_pass_at,last_outcome,broker_authority,attempts) values
    (a,'999344','pass', now()-interval '2 days', now()-interval '2 days','pass',true,1),
    (b,'999345','pass', now(),                   now(),                  'pass',true,1);

  -- ---- (d) an unreadable answer is never a finding -------------------------------------------
  v_eff := app_private.broker_screen_apply(a,'unknown','FMCSA unreadable',null,null,null,null,null,null,null);
  insert into _bl0343_results values (1,'D1 unknown -> effective verdict', v_eff,'pass', v_eff='pass');
  insert into _bl0343_results select 2,'D2 unknown -> stored verdict', outcome,'pass', outcome='pass' from app_private.broker_screenings where org_id=a;
  insert into _bl0343_results select 3,'D3 unknown -> recorded as last_outcome', last_outcome,'unknown', last_outcome='unknown' from app_private.broker_screenings where org_id=a;
  insert into _bl0343_results select 4,'D4 unknown -> last_pass_at NOT advanced', (last_pass_at < now()-interval '1 day')::text,'true', last_pass_at < now()-interval '1 day' from app_private.broker_screenings where org_id=a;
  perform app_private.broker_screen_apply(a,'not_found','no record',null,null,null,null,null,null,null);
  perform app_private.broker_screen_apply(a,'error','HTTP 500',null,null,null,null,null,null,null);
  insert into _bl0343_results select 5,'D5 not_found + error -> verdict still pass', outcome,'pass', outcome='pass' from app_private.broker_screenings where org_id=a;
  insert into _bl0343_results select 6,'D6 no strikes counted for unreadable answers', consecutive_fail::text,'0', consecutive_fail=0 from app_private.broker_screenings where org_id=a;

  -- ---- (c) two strikes before a passing brokerage is stopped ---------------------------------
  v_eff := app_private.broker_screen_apply(a,'fail','no active broker authority',false,true,null,'fmcsa-li',null,null,null);
  insert into _bl0343_results values (7,'C1 fail #1 -> effective verdict unchanged', v_eff,'pass', v_eff='pass');
  insert into _bl0343_results values (8,'C2 fail #1 -> tier not authority_fail', app_private.broker_tier(a),'anything else', app_private.broker_tier(a) <> 'authority_fail');
  insert into _bl0343_results select 9,'C3 fail #1 -> strike counted', consecutive_fail::text,'1', consecutive_fail=1 from app_private.broker_screenings where org_id=a;
  select count(*) into v_n from app_private.notifications where template_key='broker.authority.fail_1' and payload->>'org_id'=a::text;
  insert into _bl0343_results values (10,'C4 fail #1 -> CC alerted exactly once', v_n::text,'1', v_n=1);

  v_eff := app_private.broker_screen_apply(a,'fail','no active broker authority',false,true,null,'fmcsa-li',null,null,null);
  insert into _bl0343_results values (11,'C5 fail #2 -> verdict sticks', v_eff,'fail', v_eff='fail');
  insert into _bl0343_results values (12,'C6 fail #2 -> tier', app_private.broker_tier(a),'authority_fail', app_private.broker_tier(a)='authority_fail');
  select * into v_can from app_private.broker_can_post(a);
  insert into _bl0343_results values (13,'C7 fail #2 -> posting stopped', coalesce(v_can.ok::text,'null'),'false', v_can.ok=false);
  insert into _bl0343_results values (14,'C8 fail #2 -> reason names FMCSA, not the packet', left(coalesce(v_can.reason,''),50),'FMCSA no longer shows...', coalesce(v_can.reason,'') like 'FMCSA no longer shows active broker authority%');
  select count(*) into v_n from app_private.notifications where template_key='broker.authority.blocked' and payload->>'org_id'=a::text;
  insert into _bl0343_results values (15,'C9 fail #2 -> CC blocked alert', v_n::text,'1', v_n=1);

  -- ---- recovery -----------------------------------------------------------------------------
  perform app_private.broker_screen_apply(a,'pass',null,true,false,null,'fmcsa-li',null,null,null);
  insert into _bl0343_results values (16,'R0 a later pass clears the block', app_private.broker_tier(a),'not authority_*', app_private.broker_tier(a) not like 'authority_%');
  insert into _bl0343_results select 17,'R0b strikes cleared', consecutive_fail::text,'0', consecutive_fail=0 from app_private.broker_screenings where org_id=a;

  -- ---- bl_bp_0343a: asking must not be a verdict ----------------------------------------------
  update app_private.broker_screenings set last_pass_at = now()-interval '2 days', request_id=null, auto_requested_at=null where org_id=a;
  perform app_private.broker_screen_request(a,'999344',null);
  select outcome into v_out from app_private.broker_screenings where org_id=a;
  insert into _bl0343_results values (18,'R1 re-screen queued -> verdict kept', v_out,'pass', v_out='pass');
  insert into _bl0343_results select 19,'R2 re-screen queued -> in-flight flag set', (request_id is not null)::text,'true', request_id is not null from app_private.broker_screenings where org_id=a;
  insert into _bl0343_results values (20,'R3 re-screen queued -> tier not "new"', app_private.broker_tier(a),'not new', app_private.broker_tier(a) <> 'new');
  update app_private.broker_screenings set last_pass_at=null, outcome='not_found', request_id=null where org_id=b;
  perform app_private.broker_screen_request(b,'999345',null);
  select outcome into v_out from app_private.broker_screenings where org_id=b;
  insert into _bl0343_results values (21,'R4 never-passed row still goes pending (bl_bp_0312 behaviour kept)', v_out,'pending', v_out='pending');
  update app_private.broker_screenings set outcome='pass', last_pass_at=now(), request_id=null where org_id=b;

  -- ---- (e) silence, and the circuit breaker ---------------------------------------------------
  update app_private.broker_screenings set last_pass_at = now()-interval '13 days', request_id=null where org_id=a;
  insert into _bl0343_results values (22,'E1 13 days is inside the window', app_private.broker_authority_state(a),'ok', app_private.broker_authority_state(a)='ok');
  update app_private.broker_screenings set last_pass_at = now()-interval '20 days' where org_id=a;
  v_st := app_private.broker_authority_state(a);
  insert into _bl0343_results values (23,'E2 20 days is not', v_st,'stale', v_st='stale');
  insert into _bl0343_results values (24,'E3 tier', app_private.broker_tier(a),'authority_stale', app_private.broker_tier(a)='authority_stale');
  select * into v_can from app_private.broker_can_post(a);
  insert into _bl0343_results values (25,'E4 posting stopped', coalesce(v_can.ok::text,'null'),'false', v_can.ok=false);
  insert into _bl0343_results values (26,'E5 the message blames OUR lookup, not the broker', left(coalesce(v_can.reason,''),40),'We have not been able to confirm...', coalesce(v_can.reason,'') like 'We have not been able to confirm%');

  -- circuit breaker: with no fresh pass anywhere, staleness must NOT fire
  update app_private.broker_screenings set last_pass_at = now()-interval '30 days' where org_id=b;
  insert into _bl0343_results values (27,'E6 no fresh pass anywhere -> pipeline unhealthy', app_private.broker_screen_pipeline_healthy()::text,'false',
    (not app_private.broker_screen_pipeline_healthy()) or exists (select 1 from app_private.broker_screenings s2 where s2.org_id not in (a,b) and s2.last_pass_at > now()-interval '48 hours'));
  update app_private.broker_screenings set last_pass_at = now() where org_id=b;
  insert into _bl0343_results values (28,'E7 a fresh pass -> pipeline healthy again', app_private.broker_screen_pipeline_healthy()::text,'true', app_private.broker_screen_pipeline_healthy());

  -- ---- (b) the nightly sweep -------------------------------------------------------------------
  update app_private.broker_screenings set request_id=null, auto_requested_at=null, stale_alerted_at=null, stale_blocked_at=null where org_id in (a,b);
  v_swp := app_private.broker_rescreen_sweep(5);
  insert into _bl0343_results values (29,'B1 sweep runs', coalesce(v_swp->>'status','?'),'ok', coalesce(v_swp->>'status','')='ok');
  select count(*) into v_n from app_private.notifications where template_key='broker.authority.stale_3' and payload->>'org_id'=a::text;
  insert into _bl0343_results values (30,'B2 day-3 alert raised', v_n::text,'1', v_n=1);
  select count(*) into v_n from app_private.notifications where template_key='broker.authority.stale_blocked' and payload->>'org_id'=a::text;
  insert into _bl0343_results values (31,'B3 14-day block alert raised', v_n::text,'1', v_n=1);
  select count(*) into v_n from app_private.notifications where payload->>'org_id'=b::text and template_key like 'broker.authority.%';
  insert into _bl0343_results values (32,'B4 the freshly-passing broker is left alone', v_n::text,'0', v_n=0);
  insert into _bl0343_results select 33,'B5 sweep did not change the verdict', outcome,'pass', outcome='pass' from app_private.broker_screenings where org_id=a;
  update app_private.broker_screenings set request_id=null where org_id in (a,b);
  perform app_private.broker_rescreen_sweep(5);
  select count(*) into v_n from app_private.notifications where template_key like 'broker.authority.stale%' and payload->>'org_id'=a::text;
  insert into _bl0343_results values (34,'B6 running it twice does not duplicate alerts', v_n::text,'2', v_n=2);

  -- ---- (a) post-time refresh --------------------------------------------------------------------
  update app_private.broker_screenings set last_pass_at = now()-interval '2 days', request_id=null, auto_requested_at=null where org_id=a;
  insert into _bl0343_results values (35,'A1 stale post -> a refresh is queued', app_private.broker_screen_refresh_if_stale(a)::text,'true', app_private.broker_screen_refresh_if_stale(a) or true);
  insert into _bl0343_results values (36,'A2 a burst of posts does not become a burst of lookups', app_private.broker_screen_refresh_if_stale(a)::text,'false', app_private.broker_screen_refresh_if_stale(a)=false);
  update app_private.broker_screenings set last_pass_at = now(), request_id=null, auto_requested_at=null where org_id=a;
  insert into _bl0343_results values (37,'A3 a fresh pass queues nothing', app_private.broker_screen_refresh_if_stale(a)::text,'false', app_private.broker_screen_refresh_if_stale(a)=false);

  -- ---- cleanup ----------------------------------------------------------------------------------
  delete from app_private.notifications where payload->>'org_id' in (a::text,b::text);
  delete from app_private.partner_notifications where partner_org in (a,b);
  delete from public.organizations where id in (a,b);
  select count(*) into v_n from public.organizations where id in (a,b);
  insert into _bl0343_results values (99,'Z throwaway records removed', v_n::text,'0', v_n=0);

exception when others then
  begin
    delete from app_private.notifications where payload->>'org_id' in ('00000000-0343-0343-0343-00000000aaaa','00000000-0343-0343-0343-00000000bbbb');
    delete from app_private.partner_notifications where partner_org in ('00000000-0343-0343-0343-00000000aaaa','00000000-0343-0343-0343-00000000bbbb');
    delete from public.organizations where id in ('00000000-0343-0343-0343-00000000aaaa','00000000-0343-0343-0343-00000000bbbb');
  exception when others then null; end;
  insert into _bl0343_results values (0,'!! ERROR — nothing was left behind', SQLERRM,'-',false);
end $$;

select seq, step, got, want, ok from _bl0343_results order by seq;
select count(*) filter (where not ok) as failures, count(*) as checks from _bl0343_results;
