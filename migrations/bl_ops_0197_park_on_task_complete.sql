-- bl_ops_0197 — completing the incident in the existing task queue is what silences it.
-- Applied to production 2026-08-03.
--
-- bl_ops_0196 added cc_signup_health_dismiss(), but the Command Center already closes tasks
-- through cc_complete_task. Rather than bolt a second button onto the UI, hook the parking
-- onto the status change itself: mark the task done in Task queue and the addresses it
-- listed stop counting. A signup that gets stuck AFTER that is not parked, so it still rings.

create or replace function app_private.tg_signup_health_park()
returns trigger
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
begin
  if new.source_rule = 'ops.signup_health'
     and new.status in ('done','cancelled')
     and old.status not in ('done','cancelled') then
    insert into app_private.signup_health_ignore (email, added_by, note)
    select u.email, auth.uid(), 'parked on task ' || new.id
      from auth.users u
     where u.email_confirmed_at is null and u.confirmation_sent_at is not null
    on conflict (email) do nothing;
  end if;
  return new;
end $function$;

drop trigger if exists trg_signup_health_park on app_private.automation_tasks;
create trigger trg_signup_health_park
  after update of status on app_private.automation_tasks
  for each row execute function app_private.tg_signup_health_park();
