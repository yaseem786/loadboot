-- bl_bp_0519 — a broker's organizations.dot_number follows its passed FMCSA screen.
-- Owner, 1 Oct 2026: TQL's org row had dot_number NULL while its screen (bl_bp_0514) holds USDOT 2223295.
-- Cause: broker_screen_collect copies a resolved MC to the org but never the USDOT, and staff verification
-- (cc_broker_trust_set) writes only broker_screenings. On prod every screened broker org had dot_number NULL.
-- Rule: when a screen is (or becomes) 'pass' with a USDOT, write that USDOT to the org.
-- Agent workspaces are excluded: their screen is the PARENT brokerage's record (LinkLane -> LINKLANE INC.,
-- Vertex 2 -> M&M BROKERAGE), so its USDOT is not theirs. Failed/unknown screens never write (unverified number).
-- app_private only; the anon SECURITY DEFINER surface is unaffected.

create or replace function app_private.trg_broker_screen_sync_org_dot()
returns trigger
language plpgsql
security definer
set search_path to 'app_private, public'
as $$
begin
  if new.outcome = 'pass' and nullif(btrim(coalesce(new.dot_number, '')), '') is not null
     and not exists (select 1 from app_private.broker_trust t where t.org_id = new.org_id and coalesce(t.is_agent, false))
     and not app_private.is_agent_org(new.org_id) then
    begin
      update public.organizations o
         set dot_number = btrim(new.dot_number), updated_at = now()
       where o.id = new.org_id and o.kind = 'broker'
         and o.dot_number is distinct from btrim(new.dot_number);
    exception when others then null;   -- syncing the org must never roll back the screen
    end;
  end if;
  return new;
end $$;

revoke all on function app_private.trg_broker_screen_sync_org_dot() from public, anon, authenticated;

drop trigger if exists trg_broker_screen_sync_org_dot on app_private.broker_screenings;
create trigger trg_broker_screen_sync_org_dot
  after insert or update of outcome, dot_number on app_private.broker_screenings
  for each row execute function app_private.trg_broker_screen_sync_org_dot();

-- Backfill (prod preview: TQL only -> 2223295).
update public.organizations o
   set dot_number = btrim(s.dot_number), updated_at = now()
  from app_private.broker_screenings s
 where s.org_id = o.id and o.kind = 'broker' and s.outcome = 'pass'
   and nullif(btrim(coalesce(s.dot_number, '')), '') is not null
   and o.dot_number is distinct from btrim(s.dot_number)
   and not exists (select 1 from app_private.broker_trust t where t.org_id = o.id and coalesce(t.is_agent, false))
   and not app_private.is_agent_org(o.id);
