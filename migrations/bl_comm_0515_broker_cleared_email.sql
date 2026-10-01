-- bl_comm_0515 — broker.cleared: the email a broker gets when its brokerage is confirmed.
-- Identity reaches 'verified' by four routes (staff in CC = cc_broker_trust_set 'verify_identity'; automatic at
-- screen time = broker_identity_start; FMCSA-email link = partner_claim_confirm; phone code = partner_verify_code).
-- Each drops an in-app "✅ Identity confirmed — you can post now" notice, none sends an email. On 1 Oct 2026 TQL
-- was cleared by hand and only learned it because the owner wrote by hand. One trigger on broker_identity covers
-- all four routes: when status first becomes 'verified' and the FMCSA screen has passed, the owner gets one email
-- (idempotency brokercleared:<org>). Agent workspaces (own flow), demo orgs and orgs already cleared before this
-- migration are untouched — the trigger only reacts to a NEW transition.
-- Catalog row in the same file (CLAUDE.md §6). Contact line via {{contact_inline}} (§7). app_private only, so
-- the anon SECURITY DEFINER surface is unaffected.

insert into app_private.email_catalog
  (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note, stop_condition,
   preference_group, unsub_allowed, cc_deep_link, status, send_mode, discovered_in)
values
  ('broker.cleared', 'Broker cleared — you can post',
   'Tells a broker its FMCSA authority screen passed and its identity was confirmed (by staff, FMCSA e-mail link, phone code or automatically), and what is left: accept the Master Broker Agreement, post the first load, and upload the packet to lift the posting limit.',
   'T', 'broker', 'event',
   'app_private.trg_broker_identity_cleared (broker_identity → verified) → app_private.broker_cleared_email',
   'once per org', 'once (idempotency brokercleared:<org>)', 'n/a — fires once',
   'account_critical', false, '#/partners', 'live', 'live', array['code'])
on conflict (key) do nothing;

create or replace function app_private.broker_cleared_email(p_org uuid)
returns boolean
language plpgsql
security definer
set search_path to 'app_private, public'
as $$
declare
  o public.organizations; v_email text; v_agr boolean := false; v_lim int; v_tier text; v_html text; v_text text;
  p constant text := '<p style="color:#475569;margin:0 0 14px;font-size:15px;line-height:1.6">';
begin
  select * into o from public.organizations where id = p_org;
  if o.id is null or o.kind <> 'broker' or coalesce(o.is_demo, false) then return false; end if;
  if app_private.is_agent_org(p_org) or exists (select 1 from app_private.broker_trust t where t.org_id = p_org and coalesce(t.is_agent, false)) then return false; end if;
  if not exists (select 1 from app_private.broker_screenings s where s.org_id = p_org and s.outcome = 'pass') then return false; end if;
  if not exists (select 1 from app_private.broker_identity i where i.org_id = p_org and i.status = 'verified') then return false; end if;
  select u.email into v_email from auth.users u where u.id = o.owner_user_id;
  if v_email is null then return false; end if;

  begin
    select c.agreement_ok, c.posting_limit, c.tier into v_agr, v_lim, v_tier from app_private.broker_can_post(p_org) c;
  exception when others then v_agr := false; v_lim := null; v_tier := null;
  end;

  v_html :=
       '<h2 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#0b1220">You are cleared to post, ' || coalesce(nullif(trim(o.name), ''), 'there') || ' ✅</h2>'
    || p || 'We checked your broker authority with FMCSA and confirmed your brokerage. Your LoadBoot account is cleared.</p>'
    || '<div style="background:#f6f9fd;border:1px solid #e3edfa;border-radius:12px;padding:16px 18px;margin:0 0 18px"><b style="color:#0b1220">What is left</b><br><span style="color:#334155">'
    || case when coalesce(v_agr, false)
            then '1️⃣ Post your first load — verified carriers request to book, you approve<br>'
            else '1️⃣ Accept the Master Broker Agreement — one click in the portal<br>2️⃣ Post your first load — verified carriers request to book, you approve<br>' end
    || case when v_tier is distinct from 'verified' then
         case when coalesce(v_agr, false) then '2️⃣ ' else '3️⃣ ' end
         || 'Upload your W-9, bank/payment instructions and claims-handling procedure under Onboarding. '
         || 'Until they are verified you can keep ' || coalesce(v_lim, 3)::text || ' loads open at a time; once they are, the limit is lifted.'
       else '' end
    || '</span></div>'
    || '<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:12px;background:#FC5305"><a href="https://loadboot.com/app/partner/#post" style="display:inline-block;padding:14px 26px;color:#ffffff;font-weight:700;text-decoration:none;font-size:15px">Open your broker portal →</a></td></tr></table>'
    || '<p style="color:#64748b;font-size:13px;margin:16px 0 0">Questions: {{contact_inline}}</p>';
  v_text := 'You are cleared to post on LoadBoot. '
    || case when coalesce(v_agr, false) then '' else 'Accept the Master Broker Agreement (one click), then ' end
    || 'post your first load at https://loadboot.com/app/partner/#post .'
    || case when v_tier is distinct from 'verified'
            then ' Upload your W-9, bank instructions and claims procedure under Onboarding to lift the ' || coalesce(v_lim, 3)::text || '-load limit.'
            else '' end;

  perform app_private.sys_email(v_email, 'broker.cleared',
    'You are cleared to post on LoadBoot, ' || coalesce(nullif(trim(o.name), ''), 'broker'),
    v_html, v_text, 'brokercleared:' || p_org::text);
  return true;
end $$;

revoke all on function app_private.broker_cleared_email(uuid) from public, anon, authenticated;

create or replace function app_private.trg_broker_identity_cleared()
returns trigger
language plpgsql
security definer
set search_path to 'app_private, public'
as $$
begin
  if new.status = 'verified' and (tg_op = 'INSERT' or old.status is distinct from 'verified') then
    begin
      perform app_private.broker_cleared_email(new.org_id);
    exception when others then null;   -- an email must never roll back the verification itself
    end;
  end if;
  return new;
end $$;

revoke all on function app_private.trg_broker_identity_cleared() from public, anon, authenticated;

drop trigger if exists trg_broker_identity_cleared on app_private.broker_identity;
create trigger trg_broker_identity_cleared
  after insert or update of status on app_private.broker_identity
  for each row execute function app_private.trg_broker_identity_cleared();
