-- bl_match_0567 (23 Oct 2026, Yaseen approved):
--  1) Broker gets a premium email_kit email when CC posts their partner load to the board (catalog load.partner.posted).
--  2) cc_decide_partner_load no longer sends the old hand-made 'load.posted' carrier email (up to 25, no cap):
--     carriers now get only the ranked bl_match_0566 alert (3/day). Carrier in-app notice is unchanged.
--  3) bl_match_0566 prefs alerts only go to compliant carriers (match_eligibility.compliant), like the old loop did.
-- Function edits are text replacements on the live definition (staging/prod bodies differ), and fail loudly if an anchor is missing.

insert into app_private.email_catalog
select (jsonb_populate_record(null::app_private.email_catalog, to_jsonb(c) || jsonb_build_object(
  'key','load.partner.posted','name','Broker: your load is live on the board',
  'purpose','Sent to the broker (owner/admin, max 2) when LoadBoot approves and posts their partner-portal load to the carrier board (bl_match_0567).',
  'trigger_type','event','trigger_source','cc_decide_partner_load',
  'sends_total',0,'sends_30d',0,'sms_enabled',false,'sms_text',null,'created_at',now(),'updated_at',now()))).*
from app_private.email_catalog c where c.key = 'load_email_live'
on conflict (key) do nothing;

create or replace function app_private.partner_posted_email(p_load uuid) returns int
language plpgsql security definer set search_path to 'app_private','public','extensions','pg_temp' as $$
declare l public.loads; j jsonb; m record; v_lane text; v_rate text; v_html text; v_txt text; v_sub text; v_gate jsonb; v_n int := 0;
begin
  select * into l from public.loads where id = p_load;
  if l.id is null or l.broker_org is null or coalesce(l.is_demo, false) then return 0; end if;
  if exists (select 1 from public.organizations o where o.id = l.broker_org and coalesce(o.is_demo, false)) then return 0; end if;
  j := to_jsonb(l);
  v_lane := coalesce(l.origin,'—') || ' → ' || coalesce(l.destination,'—');
  v_rate := coalesce('$' || to_char(l.rate, 'FM999,999,990'), '—')
            || case when l.rate is not null and coalesce(l.miles,0) > 0 then ' · $' || round(l.rate / l.miles, 2)::text || '/mi' else '' end;
  v_sub := 'Your load is live on LoadBoot: ' || v_lane;
  v_html := app_private.email_kit(jsonb_build_object(
    'eyebrow', jsonb_build_object('text', 'Live on the board', 'tone', 'success'),
    'title', v_lane,
    'intro_html', 'Your load passed LoadBoot review and is now <b>live on the carrier board</b>. Verified carriers whose equipment and lanes fit it can see it and request it now.',
    'facts', jsonb_build_array(
      jsonb_build_object('k','Rate','v', v_rate),
      jsonb_build_object('k','Miles','v', coalesce(l.miles::text || ' mi','—')),
      jsonb_build_object('k','Equipment','v', coalesce(l.equipment,'—') || coalesce(' · ' || nullif(j->>'commodity',''), '')),
      jsonb_build_object('k','Pickup','v', coalesce(to_char(l.pickup_date::date, 'Dy Mon DD'), '—') || coalesce(' · ' || nullif(j->>'pickup_time',''), '')),
      jsonb_build_object('k','Delivery','v', coalesce(to_char((j->>'delivery_date')::date, 'Dy Mon DD'), '—') || coalesce(' · ' || nullif(j->>'delivery_time',''), ''))),
    'cta', jsonb_build_object('label','View your load','url','https://loadboot.com/app/partner/#loads'),
    'note', 'We will email you as soon as a carrier requests this load. You can edit or cancel it from My Loads.'));
  v_txt := 'Your load is live on the LoadBoot carrier board.' || E'\n' || v_lane || E'\n' || v_rate
           || E'\n\nView it: https://loadboot.com/app/partner/#loads';
  for m in select u.id as uid, u.email from public.organization_memberships om join auth.users u on u.id = om.user_id
            where om.org_id = l.broker_org and om.status = 'active' and coalesce(om.member_role,'') <> 'driver' and u.email is not null
            order by (om.member_role = 'owner') desc, (om.member_role = 'admin') desc, om.created_at limit 2 loop
    begin
      v_gate := app_private.email_gate('load.partner.posted', m.email, m.uid);
      if coalesce((v_gate->>'allowed')::boolean, true) then
        perform app_private.sys_email(m.email, 'load.partner.posted', v_sub, v_html, v_txt, 'partner-posted:' || l.id::text || ':' || m.email);
        v_n := v_n + 1;
      end if;
    exception when others then raise warning 'partner_posted_email % %: %', l.id, m.email, sqlerrm; end;
  end loop;
  return v_n;
end $$;

do $mig$
declare v_def text; v_new text;
  a_post constant text := $a$'Load posted to the board', 'Your load '||v_lane||' is now live and bookable by carriers.', 'success', '/app/partner/');$a$;
  a_loop constant text := $a$where coalesce(dp.available, true) and not coalesce(o.is_demo, false) and dp.carrier_id is distinct from l.broker_org loop$a$;
begin
  -- cc_decide_partner_load: drop old carrier email, add broker email
  v_def := pg_get_functiondef('public.cc_decide_partner_load(uuid,text)'::regprocedure);
  if position('partner_posted_email' in v_def) = 0 then
    if position(a_post in v_def) = 0 then raise exception 'bl_match_0567: broker anchor not found in cc_decide_partner_load'; end if;
    v_new := regexp_replace(v_def,
      'perform app_private\.sys_email\(m2\.email, ''load\.posted''.*?ec\.carrier_id::text\);',
      'null; -- bl_match_0567: carrier email now comes from the ranked match engine (bl_match_0566)', 's');
    if v_new = v_def then raise exception 'bl_match_0567: carrier email block not found in cc_decide_partner_load'; end if;
    v_new := replace(v_new, a_post, a_post || E'\n    begin perform app_private.partner_posted_email(v_load); exception when others then null; end; -- bl_match_0567');
    execute v_new;
  end if;

  -- tp_match_new_load: prefs alerts only to compliant carriers
  v_def := pg_get_functiondef('app_private.tp_match_new_load(uuid)'::regprocedure);
  if position('e.compliant' in v_def) = 0 then
    if position(a_loop in v_def) = 0 then raise exception 'bl_match_0567: loop anchor not found in tp_match_new_load'; end if;
    execute replace(v_def, a_loop, replace(a_loop, ' loop',
      E'\n              and dp.carrier_id in (select e.carrier_id from app_private.match_eligibility(l.id) e where e.compliant) loop'));
  end if;
end $mig$;
