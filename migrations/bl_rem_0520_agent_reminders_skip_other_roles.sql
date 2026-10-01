-- bl_rem_0520 — draft-agent reminders stop once the person has gone on as a broker, shipper or carrier.
-- Owner, 1 Oct 2026: steve@sadvgrp.com signed up through the Agent portal (18 Sep 12:23), left the agent profile
-- in 'draft', and 49 minutes later opened the shipper account "Sourcing Advisory Group". cc_run_onboarding_reminders
-- keyed only on agent_profiles.status = 'draft', so he still got three "Finish your LoadBoot Agent setup" emails
-- (19, 21, 25 Sep) as a shipper. Same exposure today: arora.tinshu (broker + carrier), techcentralnc (carrier).
-- Rule: the AGENTS loop skips a draft agent who belongs to any broker/shipper/carrier org. Approved agents are not
-- in this loop (it reads drafts only), so their "(Agent)" broker workspaces are untouched.
-- Patched by replacing one anchor line in the live definition (raises if the anchor is gone).
-- public.cc_run_onboarding_reminders keeps its ACL (create or replace); check the anon surface after.

do $$
declare
  d text;
  a text := 'where ap.status = ''draft'' and u.email is not null';
begin
  d := pg_get_functiondef('public.cc_run_onboarding_reminders'::regproc);
  if position('bl_rem_0520' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then
    raise exception 'bl_rem_0520: anchor not found exactly once in cc_run_onboarding_reminders';
  end if;
  d := replace(d, a, a
    || E'\n        and not exists (select 1 from public.organization_memberships om join public.organizations og on og.id = om.org_id'
    || E'\n                         where om.user_id = ap.user_id and og.kind in (''broker'',''shipper'',''carrier''))  -- bl_rem_0520');
  execute d;
end $$;
