-- bl_inv_0409 — investors sign up on their own page (/app/investor/#signup)
-- 1) handle_new_user: role='investor' → NO carrier organization; auto-link to the inv_investors row
--    CC created with the same email (so Hamza signs up and lands straight in his portal).
-- 2) inv_claim_by_email(): same link for a user who signed up before CC entered him, called at boot.
-- Copied from the live definition (identical on staging and prod, md5 45335852…) + the two marked blocks.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
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
     and coalesce(new.raw_user_meta_data->>'role','') not in ('driver','agent','investor')   -- 0409: investor
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
  -- 0409: investor signup → link the CC-created investor record with the same email (never a second record)
  if coalesce(new.raw_user_meta_data->>'role','') = 'investor' then
    begin
      update app_private.inv_investors set user_id = new.id
       where user_id is null and lower(email) = lower(new.email);
    exception when others then null;
    end;
  end if;
  return new;
end;
$function$;

-- Self-link for a logged-in user whose investor record was created after they signed up.
create or replace function public.inv_claim_by_email()
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare v_email text; v_n int;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode='42501'; end if;
  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then return jsonb_build_object('ok', true, 'linked', 0); end if;
  update app_private.inv_investors set user_id = auth.uid()
   where user_id is null and lower(email) = lower(v_email);
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform app_private.log_audit('investor.login_linked','investor', auth.uid()::text, null,
      'Investor login linked by e-mail', jsonb_build_object('email', v_email));
  end if;
  return jsonb_build_object('ok', true, 'linked', v_n);
end $$;
revoke all on function public.inv_claim_by_email() from public;
grant execute on function public.inv_claim_by_email() to authenticated;
