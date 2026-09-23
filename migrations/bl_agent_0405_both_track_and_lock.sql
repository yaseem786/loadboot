-- bl_agent_0405 — "Both" track + intent lock + CC merge (22 Sep 2026, Yaseen's decisions):
--   1. Chooser gets a third option: dispatcher AND referral partner on one account (intent 'both').
--   2. Legacy accounts (pre-0402, no portal_intent): the track picked at sign-in becomes the
--      account's track — agent_set_intent is the single write path; 'referral'/'both' also opt the
--      referral row in so the link works at once. Once set, only a further explicit choice widens
--      it to 'both'; it never narrows (nothing is destroyed).
--   3. CC: cc_dispatchers_page exposes referral_opted / intent / referred_n so dual-track people
--      appear under Dispatchers with a referral badge; the Referral-partners screen lists sole
--      partners by default (frontend). Additive; no data deleted.

-- 1+2 · agent_set_intent accepts 'both'; referral/both opt the referral row in
create or replace function public.agent_set_intent(p_intent text)
returns jsonb
language plpgsql
security definer
set search_path to 'app_private', 'public'
as $$
declare v_cur text; v_new text;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode='42501'; end if;
  if p_intent not in ('dispatcher','referral','both') then raise exception 'bad intent' using errcode='22023'; end if;
  select portal_intent into v_cur from public.profiles where id = auth.uid();
  v_new := case when p_intent = 'both' or v_cur = 'both' then 'both'
                when v_cur is null or v_cur = p_intent then p_intent
                else 'both' end;
  update public.profiles set portal_intent = v_new where id = auth.uid();
  if v_new in ('referral','both') then
    update app_private.referrers set opted_in_at = coalesce(opted_in_at, now())
     where user_id = auth.uid() and kind = 'affiliate';
  end if;
  return jsonb_build_object('ok', true, 'intent', v_new);
end $$;
revoke all on function public.agent_set_intent(text) from public, anon;
grant execute on function public.agent_set_intent(text) to authenticated;

-- 1 · signup trigger: 'both' is a valid intent and opts the referral row in
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  admin_exists boolean; v_role text; v_company text; v_org uuid; v_intent text; v_ref text;
begin
  select exists(select 1 from public.profiles where role='admin') into admin_exists;
  v_role    := case when admin_exists then 'carrier' else 'admin' end;
  v_company := coalesce(new.raw_user_meta_data->>'company','');
  v_intent  := nullif(new.raw_user_meta_data->>'intent','');
  if v_intent not in ('dispatcher','referral','both') then v_intent := null; end if;
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
              case when v_intent in ('referral','both') then now() else null end);
      insert into app_private.agent_profiles (user_id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'name',''));
    exception when others then null;
    end;
  end if;
  return new;
end;
$$;

-- 3 · CC dispatcher roster: referral_opted / intent / referred_n (dual-track badge)
create or replace function public.cc_dispatchers_page(p_q text default null, p_status text default null, p_before timestamptz default null, p_before_id uuid default null, p_limit integer default 50, p_user uuid default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'app_private', 'public'
as $$
declare v_lim int := least(greatest(coalesce(p_limit,50),1),200); v_q text := nullif(trim(coalesce(p_q,'')),'');
        v_rows jsonb; v_n int;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  with base as (
    select d.user_id, d.full_name, d.country, d.status, d.years_exp, d.created_at, d.commission_pct,
           d.trial_start, d.trial_end, d.reviewed_at, u.email, u.last_sign_in_at
      from app_private.dispatcher_profiles d
      left join auth.users u on u.id = d.user_id
     where (p_user is null or d.user_id = p_user)
       and (p_status is null or p_status='all' or d.status = p_status)
       and (v_q is null
            or lower(coalesce(d.full_name,'')) like '%'||lower(v_q)||'%'
            or lower(coalesce(u.email,'')) like '%'||lower(v_q)||'%'
            or lower(coalesce(d.country,'')) like '%'||lower(v_q)||'%')
       and (p_before is null or (d.created_at, d.user_id) < (p_before, coalesce(p_before_id,'00000000-0000-0000-0000-000000000000'::uuid)))
     order by d.created_at desc, d.user_id desc
     limit v_lim + 1)
  select count(*), coalesce(jsonb_agg(jsonb_build_object(
      'user_id', b.user_id, 'name', b.full_name, 'email', b.email, 'country', b.country, 'status', b.status,
      'years_exp', b.years_exp, 'applied_at', b.created_at, 'commission_pct', b.commission_pct,
      'trial_start', b.trial_start, 'trial_end', b.trial_end,
      'stage_since', coalesce(b.reviewed_at, b.created_at),
      'carriers', (select count(*) from app_private.dispatcher_assignments a where a.dispatcher_user_id=b.user_id and a.status='active'),
      'active_trucks', (select count(*) from app_private.dispatcher_assignments a
                          join app_private.fleet_trucks t on t.carrier_id=a.carrier_org_id and coalesce(t.status,'active') not in ('inactive','retired')
                         where a.dispatcher_user_id=b.user_id and a.status='active'),
      'open_rc', (select count(*) from app_private.dispatcher_bookings k where k.dispatcher_user_id=b.user_id and k.status='rc_received'),
      'moving', (select count(*) from app_private.dispatcher_bookings k where k.dispatcher_user_id=b.user_id and k.status in ('approved','dispatched','picked_up')),
      'delivered', (select count(*) from app_private.dispatcher_bookings k where k.dispatcher_user_id=b.user_id and k.status='delivered'),
      'owed', (select coalesce(sum(c.amount),0) from app_private.dispatcher_commission c where c.dispatcher_user_id=b.user_id and c.status='approved'),
      'test', (select jsonb_build_object('status',t.status,'decision',t.decision,'score',t.staff_score,'max',t.max_score,
                       'told', t.passed_email_at is not null, 'submitted_at', t.submitted_at, 'start_by', t.start_by)
                 from app_private.skills_test_attempts t where t.user_id=b.user_id order by t.created_at desc limit 1),
      -- bl_agent_0405: dual-track (dispatcher + referral partner) shows here, not as a second "partner" row
      'referral_opted', (select r.opted_in_at from app_private.referrers r where r.user_id=b.user_id and r.kind='affiliate' limit 1),
      'intent', (select p.portal_intent from public.profiles p where p.id=b.user_id),
      'referred_n', (select count(*) from app_private.referral_edges e join app_private.referrers r on r.id=e.referrer_id where r.user_id=b.user_id),
      'last_activity', (select max(x) from (values
            (b.last_sign_in_at),
            ((select max(k.updated_at) from app_private.dispatcher_bookings k where k.dispatcher_user_id=b.user_id)),
            ((select max(m.created_at) from app_private.dispatcher_messages m
                join app_private.dispatcher_assignments a2 on a2.id=m.assignment_id
               where a2.dispatcher_user_id=b.user_id and m.sender_role='dispatcher')),
            ((select max(t2.submitted_at) from app_private.skills_test_attempts t2 where t2.user_id=b.user_id))
          ) v(x))
    ) order by b.created_at desc, b.user_id desc), '[]'::jsonb)
    into v_n, v_rows
    from base b;
  return jsonb_build_object(
    'rows', coalesce((select jsonb_agg(e order by i) from jsonb_array_elements(v_rows) with ordinality x(e,i) where i <= v_lim), '[]'::jsonb),
    'has_more', v_n > v_lim);
end $$;
