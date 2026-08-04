-- bl_agent_0210_payout_merge_and_echo.sql   (applied to production 2026-08-04)
--
-- Two blockers that stopped an agent from ever FIXING their payout details.
--
-- 1) agent_save_onboarding REPLACED payout_details wholesale. An agent coming back
--    to add just an IBAN would have wiped their uploaded ID, bank proof, tax data
--    and the reviewer's own review flags. Now it MERGES, and null/empty incoming
--    keys are dropped so a blank box never erases a stored value.
--
-- 2) agent_onboarding_status stripped payout_details entirely, so the portal could
--    not prefill the form or show what staff had asked for. It now returns the
--    agent's OWN coordinates back to their OWN session, minus the tax TIN
--    (SSN/EIN stays write-only), plus the review metadata the new flow needs.
--
-- Also: re-submitting after an info request clears 'details_requested' and puts
-- payout_status back to 'pending' so the row re-enters the normal review queue.
--
-- The full bodies are the ones live in production; this file is the committed copy
-- applied via apply_migration on 2026-08-04. To reproduce, run the definitions in
-- this order: agent_save_onboarding, then agent_onboarding_status.

create or replace function public.agent_save_onboarding(p jsonb, p_submit boolean default false)
returns jsonb language plpgsql security definer
set search_path to 'app_private, public' as $function$
declare v_status text; v_email text; v_in jsonb; v_k text;
begin
  if auth.uid() is null then raise exception 'not authorized' using errcode='42501'; end if;

  -- strip null/empty incoming payout keys: a field the UI did not render must not
  -- null out a value already on file.
  v_in := coalesce(p->'payout_details','{}'::jsonb);
  for v_k in select jsonb_object_keys(v_in) loop
    if v_in->v_k = 'null'::jsonb or (jsonb_typeof(v_in->v_k) = 'string' and coalesce(trim(v_in->>v_k),'') = '') then
      v_in := v_in - v_k;
    end if;
  end loop;

  insert into app_private.agent_profiles as ap (user_id, full_name, phone, city, state, agency, website, years_exp, network, payout_method, payout_details, tax_form, tax_id_last4, agreement_signed_at, agreement_name, agreement_ip, status, updated_at)
  values (auth.uid(), p->>'full_name', p->>'phone', p->>'city', p->>'state', p->>'agency', p->>'website',
          nullif(p->>'years_exp','')::int, coalesce(p->'network','{}'::jsonb),
          p->>'payout_method', v_in, p->>'tax_form', p->>'tax_id_last4',
          case when coalesce(p->>'agreement_name','') <> '' then now() end, nullif(p->>'agreement_name',''), p->>'agreement_ip',
          case when p_submit then 'under_review' else 'draft' end, now())
  on conflict (user_id) do update set
    full_name = coalesce(excluded.full_name, ap.full_name), phone = coalesce(excluded.phone, ap.phone),
    city = coalesce(excluded.city, ap.city), state = coalesce(excluded.state, ap.state),
    agency = coalesce(excluded.agency, ap.agency), website = coalesce(excluded.website, ap.website),
    years_exp = coalesce(excluded.years_exp, ap.years_exp),
    network = case when excluded.network <> '{}'::jsonb then excluded.network else ap.network end,
    payout_method = coalesce(excluded.payout_method, ap.payout_method),
    -- MERGE, never replace.
    payout_details = coalesce(ap.payout_details,'{}'::jsonb) || excluded.payout_details,
    tax_form = coalesce(excluded.tax_form, ap.tax_form), tax_id_last4 = coalesce(excluded.tax_id_last4, ap.tax_id_last4),
    agreement_signed_at = coalesce(excluded.agreement_signed_at, ap.agreement_signed_at),
    agreement_name = coalesce(excluded.agreement_name, ap.agreement_name),
    agreement_ip = coalesce(excluded.agreement_ip, ap.agreement_ip),
    status = case when p_submit then 'under_review' else ap.status end,
    updated_at = now()
  returning status into v_status;

  -- resubmitting after staff asked for details clears the request flag and puts the
  -- payout row back in the normal review queue.
  if p_submit then
    update app_private.agent_profiles
       set payout_details = (coalesce(payout_details,'{}'::jsonb) - 'details_requested')
                            || jsonb_build_object('payout_status','pending')
     where user_id = auth.uid()
       and coalesce(payout_details->>'payout_status','') in ('info_requested','rejected');
  end if;

  if p_submit then
    if not exists (select 1 from app_private.agent_profiles ap2 where ap2.user_id = auth.uid()
                     and coalesce(ap2.full_name,'') <> '' and coalesce(ap2.phone,'') <> ''
                     and ap2.agreement_signed_at is not null and coalesce(ap2.payout_method,'') <> '') then
      raise exception 'complete name, phone, payout method and sign the agreement before submitting' using errcode='22023';
    end if;
    begin
      insert into app_private.notifications(recipient_role, channel, template_key, payload)
      values ('staff', 'in_app', 'agent.review_requested',
        jsonb_build_object('user', auth.uid(), 'title', 'Agent verification requested', 'body', coalesce(p->>'full_name','An agent') || ' submitted onboarding - review in the Agents tab.'));
    exception when others then null; end;
    begin
      insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
      values (auth.uid(), 'in_app', 'agent.submitted', jsonb_build_object(
        'title', 'Application received - under review',
        'body', 'Our team reviews within 1 business day. You will get an email the moment a decision is made. Track progress in the Verification Center.',
        'tone', 'info', 'url', '/app/agent/#verify'), 'sent', now());
    exception when others then null; end;
    begin
      select email into v_email from auth.users where id = auth.uid();
      if v_email is not null then
        perform app_private.sys_email(v_email, 'agent.submitted', 'LoadBoot Agent: application received',
          '<div style="font-family:Inter,Arial,sans-serif"><h2>Got it - your application is under review</h2>'
          || '<p>Thanks ' || coalesce(p->>'full_name','') || '! A real person reviews every agent application - typically within <b>1 business day</b>. '
          || 'You will get an email (and an in-app notification) the moment a decision is made.</p>'
          || '<p>Meanwhile you can track every step in your <a href="https://loadboot.com/app/agent/#verify">Verification Center</a>.</p></div>',
          null, 'agentsubmit:' || auth.uid()::text || ':' || to_char(now(),'YYYYMMDD'));
      end if;
    exception when others then null; end;
  end if;
  return jsonb_build_object('ok', true, 'status', v_status);
end; $function$;

create or replace function public.agent_onboarding_status()
returns jsonb language sql stable security definer
set search_path to 'app_private, public' as $function$
  select jsonb_build_object(
    'profile', (select (to_jsonb(p) - 'payout_details')
                       -- the agent's own coordinates, back to the agent's own session,
                       -- so the form prefills instead of demanding a re-type. The tax
                       -- identification number stays write-only.
                       || jsonb_build_object('payout_details',
                            case when p.payout_details is null then '{}'::jsonb
                            else (p.payout_details - 'tax')
                                 || jsonb_build_object('tax', coalesce(p.payout_details->'tax','{}'::jsonb) - 'tin')
                            end)
                from app_private.agent_profiles p where p.user_id = auth.uid()),
    'docs', (select jsonb_build_object(
        'id_doc', (p.payout_details ? 'id_doc') and coalesce(p.payout_details->>'id_doc','') <> '',
        'bank_doc', (p.payout_details ? 'bank_doc') and coalesce(p.payout_details->>'bank_doc','') <> '',
        'id_doc_status', coalesce(p.payout_details->>'id_doc_status', 'pending'),
        'id_doc_reason', p.payout_details->>'id_doc_reason',
        'bank_doc_status', coalesce(p.payout_details->>'bank_doc_status', 'pending'),
        'bank_doc_reason', p.payout_details->>'bank_doc_reason')
      from app_private.agent_profiles p where p.user_id = auth.uid()),
    'referrer_status', (select r.status from app_private.referrers r where r.user_id = auth.uid() order by r.created_at limit 1));
$function$;
