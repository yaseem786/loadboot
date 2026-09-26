-- bl_agent_0442 — agent onboarding silently dropped Country, Street and ZIP.
-- The agent verification form (app/carrier/app.js, agent wizard step 0) sends country/street/zip,
-- CC (cc_agents_queue) reads them, but agent_save_onboarding only wrote city/state — so every agent
-- saw "address not filled" after saving (reported by Gursewak Singh on WhatsApp, 25 Sep 2026).
-- Same function, same signature: street/zip/country added to the insert and the merge (an empty
-- incoming value never overwrites one already on file). Anon surface unchanged. Staging → prod.

create or replace function public.agent_save_onboarding(p jsonb, p_submit boolean default false)
returns jsonb
language plpgsql security definer
set search_path to 'app_private, public'
as $function$
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

  insert into app_private.agent_profiles as ap (user_id, full_name, phone, city, state, street, zip, country, agency, website, years_exp, network, payout_method, payout_details, tax_form, tax_id_last4, agreement_signed_at, agreement_name, agreement_ip, status, updated_at)
  values (auth.uid(), p->>'full_name', p->>'phone', p->>'city', p->>'state',
          nullif(btrim(coalesce(p->>'street','')),''), nullif(btrim(coalesce(p->>'zip','')),''), nullif(btrim(coalesce(p->>'country','')),''),
          p->>'agency', p->>'website',
          nullif(p->>'years_exp','')::int, coalesce(p->'network','{}'::jsonb),
          p->>'payout_method', v_in, p->>'tax_form', p->>'tax_id_last4',
          case when coalesce(p->>'agreement_name','') <> '' then now() end, nullif(p->>'agreement_name',''), p->>'agreement_ip',
          case when p_submit then 'under_review' else 'draft' end, now())
  on conflict (user_id) do update set
    full_name = coalesce(excluded.full_name, ap.full_name), phone = coalesce(excluded.phone, ap.phone),
    city = coalesce(excluded.city, ap.city), state = coalesce(excluded.state, ap.state),
    street = coalesce(excluded.street, ap.street), zip = coalesce(excluded.zip, ap.zip), country = coalesce(excluded.country, ap.country),
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
        jsonb_build_object('user', auth.uid(), 'title', '🤝 Agent verification requested', 'body', coalesce(p->>'full_name','An agent') || ' submitted onboarding — review in the Agents tab.'));
    exception when others then null; end;
    begin
      insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
      values (auth.uid(), 'in_app', 'agent.submitted', jsonb_build_object(
        'title', '📨 Application received — under review',
        'body', 'Our team reviews within 1 business day. You will get an email the moment a decision is made. Track progress in the Verification Center.',
        'tone', 'info', 'url', '/app/agent/#verify'), 'sent', now());
    exception when others then null; end;
    begin
      select email into v_email from auth.users where id = auth.uid();
      if v_email is not null then
        perform app_private.sys_email(v_email, 'agent.submitted', 'LoadBoot Agent: application received ✅',
          '<div style="font-family:Inter,Arial,sans-serif"><h2>Got it — your application is under review</h2>'
          || '<p>Thanks ' || coalesce(p->>'full_name','') || '! A real person reviews every agent application — typically within <b>1 business day</b>. '
          || 'You will get an email (and an in-app notification) the moment a decision is made.</p>'
          || '<p>Meanwhile you can track every step in your <a href="https://loadboot.com/app/agent/#verify">Verification Center</a>.</p></div>',
          null, 'agentsubmit:' || auth.uid()::text || ':' || to_char(now(),'YYYYMMDD'));
      end if;
    exception when others then null; end;
  end if;
  return jsonb_build_object('ok', true, 'status', v_status);
end; $function$;
