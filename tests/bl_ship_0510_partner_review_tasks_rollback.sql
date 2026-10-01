-- bl_ship_0510 rollback test (staging only). One DO block that ends with RAISE, so nothing is kept (tasks, bells, logs).
-- Throwaway shippers, all created 10 h ago and pending:
--   A has a rule task (opened 9 h ago)            → cron adds no second task (dedupe across rules)
--   B has no task                                → cron opens exactly one, a second run adds none
--   C held now, task opened before the hold       → reconcile closes it "shipper put on hold"; cron skips C
--   D parked now, task opened before the park     → reconcile closes it "parked by staff"; cron skips D
--   E held 2 h ago, task opened 1 h ago (after)   → stays open
--   F approved (active), open task               → closed by the existing branch
do $$
declare
  o uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  t uuid[] := array[gen_random_uuid(), null, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  u uuid; i int; n int; s text; d text; ok text[] := '{}'; bad text[] := '{}';
begin
  for i in 1..6 loop
    u := gen_random_uuid();
    insert into auth.users(id, email, email_confirmed_at, aud, role) values (u, 'bl0510-' || left(u::text, 8) || '@bl0510test.com', now(), 'authenticated', 'authenticated');
    insert into public.organizations(id, kind, name, status, created_at, owner_user_id) values (o[i], 'shipper', 'BL0510 Test ' || i, 'pending', now() - interval '10 hours', u);
    insert into app_private.shipper_trust(org_id) values (o[i]) on conflict do nothing;
    if t[i] is not null then
      insert into app_private.automation_tasks(id, task_type, title, status, priority, related_type, related_id, source_rule, created_at)
      values (t[i], 'partner_review', 'BL0510 review ' || i, 'open', 'urgent', 'organization', o[i]::text, 'partner_submitted_review',
              now() - case when i = 5 then interval '1 hour' else interval '9 hours' end);
    end if;
  end loop;
  update app_private.shipper_trust set hold_reason = 'test hold', held_at = now() where org_id = o[3];
  perform app_private.log_audit('partner.park', 'org', o[4]::text, null, 'test park', null);
  update app_private.shipper_trust set hold_reason = 'test hold', held_at = now() - interval '2 hours' where org_id = o[5];
  update public.organizations set status = 'active' where id = o[6];

  -- cron, twice
  perform app_private.cron_pending_partner_alert();
  perform app_private.cron_pending_partner_alert();
  select count(*) into n from app_private.automation_tasks where related_id = o[1]::text and task_type = 'partner_review' and status in ('open','in_progress');
  if n = 1 then ok := ok || text 'A no duplicate'; else bad := bad || ('A open tasks=' || n); end if;
  select count(*) into n from app_private.automation_tasks where related_id = o[2]::text and task_type = 'partner_review';
  if n = 1 then ok := ok || text 'B exactly one'; else bad := bad || ('B tasks=' || n); end if;
  select count(*) into n from app_private.automation_tasks where related_id in (o[3]::text, o[4]::text) and source_rule = 'ops.pending_partner';
  if n = 0 then ok := ok || text 'cron skips held + parked'; else bad := bad || ('cron made ' || n || ' for C/D'); end if;
  select count(*) into n from app_private.notifications where template_key = 'partner.pending_overdue' and payload->>'org' in (o[3]::text, o[4]::text, o[5]::text);
  if n = 0 then ok := ok || text 'no staff bell for decided'; else bad := bad || ('bells for decided=' || n); end if;

  -- reconcile
  perform app_private.automation_tasks_reconcile();
  select status, description into s, d from app_private.automation_tasks where id = t[3];
  if s = 'done' and d like '%auto-closed%shipper put on hold%' then ok := ok || text 'C closed: hold'; else bad := bad || ('C ' || s || ' / ' || coalesce(d, '')); end if;
  select status, description into s, d from app_private.automation_tasks where id = t[4];
  if s = 'done' and d like '%parked by staff%' then ok := ok || text 'D closed: park'; else bad := bad || ('D ' || s || ' / ' || coalesce(d, '')); end if;
  select status into s from app_private.automation_tasks where id = t[5];
  if s = 'open' then ok := ok || text 'E (after hold) stays open'; else bad := bad || ('E ' || s); end if;
  select status into s from app_private.automation_tasks where id = t[6];
  if s = 'done' then ok := ok || text 'F approved closed'; else bad := bad || ('F ' || s); end if;
  select status into s from app_private.automation_tasks where id = t[1];
  if s = 'open' then ok := ok || text 'A (undecided) stays open'; else bad := bad || ('A ' || s); end if;
  if exists (select 1 from app_private.automation_task_autoclose_log where task_id = t[3] and reason = 'shipper put on hold')
    then ok := ok || text 'autoclose log row'; else bad := bad || text 'no autoclose log'; end if;

  raise exception 'bl_ship_0510 test: % pass, % fail | PASS: % | FAIL: %', cardinality(ok), cardinality(bad), array_to_string(ok, '; '), array_to_string(bad, '; ');
end $$;
