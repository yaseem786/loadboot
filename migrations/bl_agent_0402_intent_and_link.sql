-- bl_agent_0402 — referral INTENT + working referral links (22 Sep 2026)
-- Why: every agent-portal signup auto-created a referral row (131 "Referral Partners", 0 real
-- referrals ever). Dispatcher applicants never chose the referral track. And cc_claim_referral
-- only honoured ACTIVE referrers, so the 99 pending partners' links silently did nothing.
-- What: (1) referrers.opted_in_at — null = auto-provisioned, never chose the track;
--       (2) profiles.portal_intent (dispatcher|referral|both) + profiles.signup_ref (server-side
--           capture of ?ref= at signup, survives device changes);
--       (3) links work for pending-but-opted-in partners (the edge is the record; money still
--           needs CC approval + KYC before payout, and backfills on approval);
--       (4) approve → immediate accrual rescan (no 30-min wait);
--       (5) RPCs: agent_referral_opt_in, agent_set_intent, claim_pending_referral; agent_feed and
--           cc_agents_list expose the new fields. All new public fns are authenticated-only.

alter table app_private.referrers add column if not exists opted_in_at timestamptz;
alter table public.profiles add column if not exists portal_intent text
  check (portal_intent in ('dispatcher','referral','both'));
alter table public.profiles add column if not exists signup_ref text;

-- ---- backfill: who really chose the referral track ----
update app_private.referrers r set opted_in_at = coalesce(ap.updated_at, r.created_at)
  from app_private.agent_profiles ap
 where ap.user_id = r.user_id and r.opted_in_at is null
   and (r.status = 'active' or ap.status <> 'draft'
        or exists (select 1 from app_private.referral_edges e where e.referrer_id = r.id));
update app_private.referrers r set opted_in_at = r.created_at
 where r.opted_in_at is null and (r.kind <> 'affiliate' or r.status = 'active');
update public.profiles p set portal_intent =
  case when dp.user_id is not null and r.opted_in_at is not null then 'both'
       when dp.user_id is not null then 'dispatcher'
       when r.opted_in_at is not null then 'referral' end
  from app_private.referrers r
  left join app_private.dispatcher_profiles dp on dp.user_id = r.user_id
 where r.user_id = p.id and r.kind = 'affiliate';

-- ---- shared claim helper (server-side; no auth.uid() dependency) ----
create or replace function app_private.referral_claim_for_org(p_org uuid, p_code text, p_by uuid)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare r record; v_owner uuid;
begin
  if p_org is null or nullif(trim(coalesce(p_code,'')), '') is null then return jsonb_build_object('ok', false, 'reason', 'no_code'); end if;
  select * into r from app_private.referrers
   where code = upper(trim(p_code)) and status in ('pending','active') and opted_in_at is not null;
  if r.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select owner_user_id into v_owner from public.organizations where id = p_org;
  if r.org_id = p_org or (r.user_id is not null and r.user_id = v_owner) then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  if exists (select 1 from app_private.referral_edges where child_org = p_org) then return jsonb_build_object('ok', false, 'reason', 'already'); end if;
  insert into app_private.referral_edges(child_org, referrer_id, claimed_by) values (p_org, r.id, p_by);
  perform app_private.log_audit('referral.claim','org',p_org::text,null,'referred by '||r.code,jsonb_build_object('referrer',r.id));
  perform app_private.emit_event('referral.claimed','org',p_org::text, jsonb_build_object('code',r.code));
  return jsonb_build_object('ok', true, 'referrer_code', r.code);
end $$;
revoke all on function app_private.referral_claim_for_org(uuid, text, uuid) from public, anon, authenticated;

-- manual claim (Referral tab "I have a code") — same behaviour, now honours pending+opted-in partners
create or replace function public.cc_claim_referral(p_code text)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_org uuid; res jsonb;
begin
  v_org := coalesce(app_private.my_carrier_org(), app_private.my_partner_org());
  if v_org is null then raise exception 'only carrier, broker or shipper accounts can claim a referral' using errcode='42501'; end if;
  res := app_private.referral_claim_for_org(v_org, p_code, auth.uid());
  if (res->>'ok')::boolean then return res; end if;
  case res->>'reason'
    when 'not_found' then raise exception 'referral code not found' using errcode='22023';
    when 'self' then raise exception 'self-referral is not allowed' using errcode='22023';
    when 'already' then raise exception 'this account already has a referrer on record' using errcode='22023';
    else raise exception 'referral code missing' using errcode='22023';
  end case;
end $$;

-- silent post-login claim: profiles.signup_ref (captured at signup) or the code the portal still holds
create or replace function public.claim_pending_referral(p_code text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_org uuid; v_code text; res jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'anon'); end if;
  select signup_ref into v_code from public.profiles where id = auth.uid();
  v_code := coalesce(nullif(trim(coalesce(v_code,'')), ''), nullif(trim(coalesce(p_code,'')), ''));
  if v_code is null then return jsonb_build_object('ok', false, 'reason', 'no_code'); end if;
  v_org := coalesce(app_private.my_carrier_org(), app_private.my_partner_org());
  if v_org is null then return jsonb_build_object('ok', false, 'reason', 'no_org'); end if;  -- keep signup_ref; org comes later
  res := app_private.referral_claim_for_org(v_org, v_code, auth.uid());
  update public.profiles set signup_ref = null where id = auth.uid();
  return res;
end $$;
revoke all on function public.claim_pending_referral(text) from public, anon;
grant execute on function public.claim_pending_referral(text) to authenticated;

-- opt in to the referral track (creates the row for someone who never had one)
create or replace function public.agent_referral_opt_in()
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_ref app_private.referrers; v_name text; v_has_dp boolean;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode='42501'; end if;
  select coalesce(nullif(contact_name,''), split_part(email,'@',1)) into v_name from public.profiles where id = auth.uid();
  v_ref := app_private.agent_referrer_for(auth.uid());
  if v_ref.id is null then
    insert into app_private.referrers (user_id, org_id, kind, code, display_name, status, opted_in_at)
    values (auth.uid(), null, 'affiliate', 'LB' || upper(substr(md5(auth.uid()::text || now()::text), 1, 6)), coalesce(v_name,''), 'pending', now())
    returning * into v_ref;
  else
    update app_private.referrers set opted_in_at = coalesce(opted_in_at, now()) where id = v_ref.id returning * into v_ref;
  end if;
  insert into app_private.agent_profiles (user_id, full_name) values (auth.uid(), coalesce(v_name,'')) on conflict (user_id) do nothing;
  v_has_dp := exists (select 1 from app_private.dispatcher_profiles where user_id = auth.uid());
  update public.profiles set portal_intent = case when v_has_dp then 'both' else 'referral' end where id = auth.uid();
  perform app_private.log_audit('referral.opt_in','user',auth.uid()::text,null,'opted into the referral track',jsonb_build_object('code',v_ref.code));
  return jsonb_build_object('ok', true, 'code', v_ref.code, 'link', 'https://loadboot.com/?ref=' || v_ref.code, 'intent', case when v_has_dp then 'both' else 'referral' end);
end $$;
revoke all on function public.agent_referral_opt_in() from public, anon;
grant execute on function public.agent_referral_opt_in() to authenticated;

-- record the track a signed-in person chose (dispatcher applicants; referral partners who also apply)
create or replace function public.agent_set_intent(p_intent text)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_cur text; v_new text;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode='42501'; end if;
  if p_intent not in ('dispatcher','referral') then raise exception 'bad intent' using errcode='22023'; end if;
  select portal_intent into v_cur from public.profiles where id = auth.uid();
  v_new := case when v_cur is null or v_cur = p_intent then p_intent else 'both' end;
  update public.profiles set portal_intent = v_new where id = auth.uid();
  return jsonb_build_object('ok', true, 'intent', v_new);
end $$;
revoke all on function public.agent_set_intent(text) from public, anon;
grant execute on function public.agent_set_intent(text) to authenticated;

-- ---- signup trigger: intent + ref captured server-side; referral track only when chosen ----
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  admin_exists boolean; v_role text; v_company text; v_org uuid; v_intent text; v_ref text;
begin
  select exists(select 1 from public.profiles where role='admin') into admin_exists;
  v_role    := case when admin_exists then 'carrier' else 'admin' end;
  v_company := coalesce(new.raw_user_meta_data->>'company','');
  v_intent  := nullif(new.raw_user_meta_data->>'intent','');
  if v_intent not in ('dispatcher','referral') then v_intent := null; end if;
  v_ref     := nullif(upper(regexp_replace(coalesce(new.raw_user_meta_data->>'ref',''), '[^A-Za-z0-9]', '', 'g')), '');
  insert into public.profiles (id, email, company, contact_name, role, status, portal_intent, signup_ref)
  values (new.id, new.email, v_company, coalesce(new.raw_user_meta_data->>'name',''), v_role,
          case when admin_exists then 'pending' else 'active' end, v_intent, v_ref);
  if v_role = 'carrier'
     and coalesce(new.raw_user_meta_data->>'role','') not in ('driver','agent')
     and coalesce(new.raw_user_meta_data->>'partner_kind','') not in ('broker','shipper','facility') then
    begin
      insert into public.organizations (kind, name, owner_user_id, status)
      values ('carrier', coalesce(nullif(trim(v_company), ''), split_part(new.email, '@', 1), 'New Carrier'), new.id, 'active')
      returning id into v_org;
      insert into public.organization_memberships (org_id, user_id, member_role, status)
      values (v_org, new.id, 'owner', 'active');
    exception when others then null;
    end;
    -- the org exists now → tie the referral immediately (the portal's post-login claim is the fallback)
    if v_org is not null and v_ref is not null then
      begin
        if (app_private.referral_claim_for_org(v_org, v_ref, new.id)->>'ok')::boolean then
          update public.profiles set signup_ref = null where id = new.id;
        end if;
      exception when others then null;
      end;
    end if;
  end if;
  if coalesce(new.raw_user_meta_data->>'role','') = 'agent' then
    begin
      insert into app_private.referrers (user_id, org_id, kind, code, display_name, status, opted_in_at)
      values (new.id, null, 'affiliate',
              'LB' || upper(substr(md5(new.id::text || now()::text), 1, 6)),
              coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)), 'pending',
              case when v_intent = 'referral' then now() else null end);
      insert into app_private.agent_profiles (user_id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'name',''));
    exception when others then null;
    end;
  end if;
  return new;
end;
$$;

-- ---- agent_feed: expose opted_in / intent / has_dispatcher (anchor patch, no retyping) ----
do $$
declare d text; a text := $a$'has_code', true, 'code', v_ref.code, 'name', v_ref.display_name,$a$;
begin
  select pg_get_functiondef(oid) into d from pg_proc where proname = 'agent_feed' and pronamespace = 'public'::regnamespace;
  if d like '%''opted_in'', v_ref.opted_in_at is not null,%' then return; end if;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'agent_feed anchor not unique'; end if;
  d := replace(d, a, a || $b$
    'opted_in', v_ref.opted_in_at is not null,
    'intent', (select portal_intent from public.profiles where id = auth.uid()),
    'has_dispatcher', exists (select 1 from app_private.dispatcher_profiles dp where dp.user_id = auth.uid()),
    'referrer_status', v_ref.status,$b$);
  execute d;
end $$;

-- ---- approve → rescan now (was: wait for the 30-min cron) ----
do $$
declare d text; a text := $a$   where user_id = p_user;$a$;
begin
  select pg_get_functiondef(oid) into d from pg_proc where proname = 'cc_agent_decide' and pronamespace = 'public'::regnamespace;
  if d like '%referral_accrue_all%' then return; end if;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'cc_agent_decide anchor not unique'; end if;
  d := replace(d, a, a || $b$
  if p_action = 'approve' then
    update app_private.referrers set opted_in_at = coalesce(opted_in_at, now()) where user_id = p_user;
    begin perform app_private.referral_accrue_all(); exception when others then null; end;
  end if;$b$);
  execute d;
end $$;

-- ---- CC list: kind / opted-in / intent / dispatcher status, so the screen can separate the tracks ----
create or replace function public.cc_agents_list()
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select case when not (public.has_global_permission('carriers.approve') or public.has_global_permission('dispatch.manage'))
    then jsonb_build_object('error','not authorized')
    else coalesce(jsonb_agg(jsonb_build_object(
      'user_id', r.user_id, 'name', coalesce(ap.full_name, r.display_name), 'email', (select email from auth.users u where u.id = r.user_id),
      'code', r.code, 'status', coalesce(ap.status, 'no-profile'), 'referrer_status', r.status,
      'kind', r.kind, 'opted_in_at', r.opted_in_at, 'intent', p.portal_intent,
      'dispatcher_status', dp.status,
      'country', ap.country, 'joined_at', r.created_at,
      'referred', (select count(*) from app_private.referral_edges e where e.referrer_id = r.id),
      'last_referral_at', (select max(e.created_at) from app_private.referral_edges e where e.referrer_id = r.id),
      'downline', (select count(*) from app_private.referrers r2 where r2.parent_referrer = r.id),
      'earned', coalesce((select sum(amount) from app_private.referral_commissions c where c.referrer_id = r.id), 0),
      'accrued', coalesce((select sum(amount) from app_private.referral_commissions c where c.referrer_id = r.id and c.status = 'accrued'), 0),
      'payable', coalesce((select sum(amount) from app_private.referral_commissions c where c.referrer_id = r.id and c.status = 'payable'), 0),
      'paid', coalesce((select sum(amount) from app_private.referral_commissions c where c.referrer_id = r.id and c.status = 'paid'), 0),
      'open_payout', exists (select 1 from app_private.referral_payout_requests pq where pq.referrer_id = r.id and pq.status in ('requested','approved'))
    ) order by r.created_at desc), '[]'::jsonb) end
  from app_private.referrers r
  left join app_private.agent_profiles ap on ap.user_id = r.user_id
  left join app_private.dispatcher_profiles dp on dp.user_id = r.user_id
  left join public.profiles p on p.id = r.user_id
  where r.user_id is not null;
$$;
