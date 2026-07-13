-- bl_agent_0077 — the money must MOVE ITSELF:
-- 1) cron every 30 min: referral_accrue_all() (carrier-side + broker-side + agent-own loads
--    + promote payable) — no human needed for commissions to land.
-- 2) commission INSERT trigger → in-app notification + email to the agent
--    ("💰 $X added — clears in 15 days"), idempotent per commission.

create or replace function app_private.trg_agent_on_commission()
 returns trigger language plpgsql
 set search_path to 'app_private, public'
as $$
declare v_user uuid; v_email text; v_lane text;
begin
  select r.user_id into v_user from app_private.referrers r where r.id = new.referrer_id;
  if v_user is null then return new; end if;
  begin
    select l.origin || ' → ' || l.destination into v_lane
      from app_private.trips t join public.loads l on l.id = t.load_id where t.id = new.trip_id;
  exception when others then v_lane := null; end;
  perform app_private.agent_notify(new.referrer_id, 'agent.commission',
    '💰 $' || new.amount || ' commission added',
    coalesce(v_lane, 'A delivered load') || ' — clears the 15-day window on ' || to_char(new.payable_at, 'Mon DD') || ', then becomes payable.');
  begin
    select u.email into v_email from auth.users u where u.id = v_user;
    if v_email is not null then
      perform app_private.sys_email(v_email, 'agent.commission',
        '💰 $' || new.amount || ' commission — LoadBoot Agent',
        '<div style="font-family:Inter,Arial,sans-serif"><h2 style="color:#16a34a">$' || new.amount || ' added to your balance</h2>'
        || '<p>' || coalesce(v_lane, 'A delivered load') || ' · level ' || new.level || ' · clears ' || to_char(new.payable_at, 'Mon DD, YYYY') || '.</p>'
        || '<p><a href="https://loadboot.com/app/agent/#earnings" style="background:#0883F7;color:#fff;padding:11px 20px;border-radius:9px;text-decoration:none;font-weight:800">See your ledger →</a></p></div>',
        null, 'agentcomm:' || new.id::text);
    end if;
  exception when others then null; end;
  return new;
end; $$;
drop trigger if exists trg_agent_on_commission_t on app_private.referral_commissions;
create trigger trg_agent_on_commission_t after insert on app_private.referral_commissions
for each row execute function app_private.trg_agent_on_commission();

-- self-driving accrual
select cron.unschedule('lb-referral-accrue') where exists (select 1 from cron.job where jobname = 'lb-referral-accrue');
select cron.schedule('lb-referral-accrue', '*/30 * * * *', $$select app_private.referral_accrue_all();$$);

notify pgrst, 'reload schema';
