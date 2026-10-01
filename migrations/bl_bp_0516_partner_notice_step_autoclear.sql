-- bl_bp_0516 — a partner notice about a pending step clears itself when that step is done.
-- Owner, 1 Oct 2026: TQL's portal still showed "⚠ Your FMCSA screening needs a human" (12:05) and
-- "FMCSA lists no email for your brokerage" (14:01) after staff had passed the screen and confirmed identity.
-- A notice that asks the partner to wait on / do a step should stay while the step is open and go away by
-- itself once the step is complete — nobody should have to delete it by hand.
--
-- How:
--   * partner_notifications.step — which step a notice is about ('screen', 'identity', 'doc:<item_key>').
--   * app_private.partner_notice_step_of(org, title) — the ONE registry that maps the titles our functions write
--     to a step. A new step-notice title must be added here (otherwise it simply never auto-clears).
--   * BEFORE INSERT trigger tags new notices; nothing about notify_partner or its ~40 callers changes.
--   * AFTER triggers on the step tables delete that org's notices for the step when it completes:
--       broker_screenings.outcome -> 'pass'                       clears 'screen'
--       broker_identity.status    -> 'verified'                   clears 'identity'
--       org_onboarding_items.status -> submitted/verified/waived  clears 'doc:<item_key>'
--     A failure here never rolls back the step itself.
--   * Backfill: tag existing rows, delete the ones whose step is already done (prod preview: 1 row, TQL 12:05).
-- app_private only; the anon SECURITY DEFINER surface is unaffected.

alter table app_private.partner_notifications add column if not exists step text;
create index if not exists partner_notifications_org_step_idx
  on app_private.partner_notifications (partner_org, step) where step is not null;

create or replace function app_private.partner_notice_step_of(p_org uuid, p_title text)
returns text
language sql
stable
set search_path to 'app_private, public'
as $$
  select case
    when p_title in ('⚠ Your FMCSA screening needs a human', '⚠ The FMCSA check could not complete', 'FMCSA screening did not pass')
      or p_title ~ '^⚠ MC-\S+ was not found on FMCSA$'
      then 'screen'
    when p_title in ('FMCSA lists no email for your brokerage', '📞 Call requested', '⛔ Posting paused — identity not confirmed')
      or p_title like '📧 Confirm it is you — check %'
      then 'identity'
    when p_title like '📄 Reminder: % is still missing' then
      (select 'doc:' || t.item_key
         from app_private.onboarding_packet_templates t
         join public.organizations o on o.id = p_org and o.kind = t.org_kind
        where '📄 Reminder: ' || t.label || ' is still missing' = p_title
        limit 1)
  end
$$;

revoke all on function app_private.partner_notice_step_of(uuid, text) from public, anon, authenticated;

create or replace function app_private.trg_partner_notice_tag_step()
returns trigger
language plpgsql
security definer
set search_path to 'app_private, public'
as $$
begin
  if new.step is null then
    begin
      new.step := app_private.partner_notice_step_of(new.partner_org, new.title);
    exception when others then null;   -- tagging must never block the notice
    end;
  end if;
  return new;
end $$;

revoke all on function app_private.trg_partner_notice_tag_step() from public, anon, authenticated;

drop trigger if exists trg_partner_notice_tag_step on app_private.partner_notifications;
create trigger trg_partner_notice_tag_step
  before insert on app_private.partner_notifications
  for each row execute function app_private.trg_partner_notice_tag_step();

create or replace function app_private.partner_notice_clear_step(p_org uuid, p_step text)
returns int
language plpgsql
security definer
set search_path to 'app_private, public'
as $$
declare v_n int := 0;
begin
  if p_org is null or p_step is null then return 0; end if;
  delete from app_private.partner_notifications where partner_org = p_org and step = p_step;
  get diagnostics v_n = row_count;
  return v_n;
exception when others then
  return 0;   -- clearing a notice must never roll back the step that completed
end $$;

revoke all on function app_private.partner_notice_clear_step(uuid, text) from public, anon, authenticated;

create or replace function app_private.trg_partner_notice_step_done()
returns trigger
language plpgsql
security definer
set search_path to 'app_private, public'
as $$
begin
  if tg_table_name = 'broker_screenings' then
    if new.outcome = 'pass' then perform app_private.partner_notice_clear_step(new.org_id, 'screen'); end if;
  elsif tg_table_name = 'broker_identity' then
    if new.status = 'verified' then perform app_private.partner_notice_clear_step(new.org_id, 'identity'); end if;
  elsif tg_table_name = 'org_onboarding_items' then
    if new.status in ('submitted', 'verified', 'waived') then
      perform app_private.partner_notice_clear_step(new.org_id, 'doc:' || new.item_key);
    end if;
  end if;
  return new;
end $$;

revoke all on function app_private.trg_partner_notice_step_done() from public, anon, authenticated;

drop trigger if exists trg_partner_notice_step_done on app_private.broker_screenings;
create trigger trg_partner_notice_step_done
  after insert or update of outcome on app_private.broker_screenings
  for each row execute function app_private.trg_partner_notice_step_done();

drop trigger if exists trg_partner_notice_step_done on app_private.broker_identity;
create trigger trg_partner_notice_step_done
  after insert or update of status on app_private.broker_identity
  for each row execute function app_private.trg_partner_notice_step_done();

drop trigger if exists trg_partner_notice_step_done on app_private.org_onboarding_items;
create trigger trg_partner_notice_step_done
  after insert or update of status on app_private.org_onboarding_items
  for each row execute function app_private.trg_partner_notice_step_done();

-- Backfill: tag what is already there, then clear notices whose step is already complete.
update app_private.partner_notifications n
   set step = app_private.partner_notice_step_of(n.partner_org, n.title)
 where n.step is null;

delete from app_private.partner_notifications n
 where (n.step = 'screen'   and exists (select 1 from app_private.broker_screenings s where s.org_id = n.partner_org and s.outcome = 'pass'))
    or (n.step = 'identity' and exists (select 1 from app_private.broker_identity i where i.org_id = n.partner_org and i.status = 'verified'))
    or (n.step like 'doc:%' and exists (select 1 from app_private.org_onboarding_items x
                                          where x.org_id = n.partner_org and x.item_key = substr(n.step, 5)
                                            and x.status in ('submitted', 'verified', 'waived')));
