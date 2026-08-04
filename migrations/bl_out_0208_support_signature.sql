-- bl_out_0208_support_signature.sql
-- Applied to production 2026-08-04.
--
-- Outreach signature: founder-signed -> support-desk signed.
-- Owner decision (2026-08-04): cold outreach should read as the support desk,
-- not the founder. Name used is "Riley" -- the SAME identity that answers the
-- +1 (469) 253-7575 line and places onboarding calls, so a reply or a callback
-- resolves to a consistent contact instead of an invented employee.
-- Department is tailored per audience (Carrier / Broker / Shipper Support).
--
-- Applies to all 15 outreach_templates rows. Transactional templates and the
-- email shell are NOT touched -- those stay founder-signed by design.

update app_private.outreach_templates
set html = replace(
  html,
  'Muhammad Yaseen<br>Founder, LoadBoot<br>',
  'Riley<br>' || case audience
      when 'carrier' then 'Carrier Support'
      when 'broker'  then 'Broker Support'
      when 'shipper' then 'Shipper Support'
      else 'Partner Support' end || ', LoadBoot<br>'
)
where html like '%Muhammad Yaseen<br>Founder, LoadBoot<br>%';

-- in-body "you're talking to the founder" lines must go too, or the signature
-- change reads as a contradiction inside the same email.
update app_private.outreach_templates
set html = replace(html,
  'Reply with any question &mdash; you are talking to the founder, not a sales team.',
  'Reply with any question &mdash; a real person answers, not a sales queue.')
where html like '%you are talking to the founder, not a sales team.%';

update app_private.outreach_templates
set html = replace(html,
  'Stuck on any of it? Reply. You are talking to the founder, not a support queue.',
  'Stuck on any of it? Reply &mdash; a real person answers, usually within the hour.')
where html like '%You are talking to the founder, not a support queue.%';

update app_private.outreach_templates
set html = replace(html,
  'just reply &mdash; the founder reads this inbox.',
  'just reply &mdash; we read every message that lands here.')
where html like '%the founder reads this inbox.%';

-- guard: nothing may still say Founder / Muhammad anywhere in outreach
do $$
declare n int;
begin
  select count(*) into n from app_private.outreach_templates
   where html ~* 'founder' or html like '%Muhammad%';
  if n > 0 then
    raise exception 'outreach templates still carry founder signature: % row(s)', n;
  end if;
end $$;
