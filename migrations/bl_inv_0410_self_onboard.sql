-- bl_inv_0410 — self-serve investor onboarding
-- An investor who signs up on /app/investor/#signup and has NO record yet gets, if CC has enabled a
-- "standard offer" (settings key self_onboard): an investor record, an agreement on the offer's terms,
-- the agreement document (built client-side from the same template, English governing) and LoadBoot's
-- pre-signature (the signer named in the offer). The investor then reads it in any language and signs;
-- once both signatures exist the agreement gets its signed_date (existing inv_sign behaviour).
-- Additive: new key, two RPCs, one column.

alter table app_private.inv_investors add column if not exists source text;  -- 'cc' (default) | 'self'

create or replace function public.cc_inv_settings_set(p_key text, p_value jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
begin
  if not app_private.inv_can_manage() then raise exception 'not authorized' using errcode='42501'; end if;
  if p_key not in ('payment_instructions','fx','forecast','vendors','links','plan','revenue_model','traffic','business_plan','self_onboard') then
    raise exception 'unknown setting' using errcode='22023'; end if;
  insert into app_private.inv_settings (key, value, updated_by) values (p_key, coalesce(p_value,'{}'::jsonb), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  perform app_private.log_audit('investor.setting_saved','investor', p_key, null, 'Investor setting saved', jsonb_build_object('key', p_key));
  return jsonb_build_object('ok', true);
end $$;

-- Step 1 (right after sign-up): link by e-mail, or create investor + agreement from the standard offer.
create or replace function public.inv_self_onboard(p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare v_uid uuid; v_email text; v_inv uuid; v_agr uuid; o jsonb; v_name text; v_lang text;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'not signed in' using errcode='42501'; end if;
  select email into v_email from auth.users where id = v_uid;
  -- a) CC already created this person → link (same as inv_claim_by_email)
  update app_private.inv_investors set user_id = v_uid where user_id is null and lower(email) = lower(v_email);
  select id into v_inv from app_private.inv_investors where user_id = v_uid limit 1;
  if v_inv is not null then
    select id into v_agr from app_private.inv_agreements where investor_id = v_inv and status <> 'draft' order by created_at limit 1;
    return jsonb_build_object('ok', true, 'created', false, 'investor_id', v_inv, 'agreement_id', v_agr,
      'needs_doc', v_agr is not null and not exists (select 1 from app_private.inv_agreement_docs d where d.agreement_id = v_agr),
      'offer', (select value from app_private.inv_settings where key = 'self_onboard'));
  end if;
  -- b) nobody knows this e-mail → standard offer, if enabled
  select value into o from app_private.inv_settings where key = 'self_onboard';
  if o is null or coalesce((o->>'enabled')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'reason', 'not_enabled');
  end if;
  if coalesce((o->>'commitment_cap')::numeric, 0) <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'offer_incomplete');
  end if;
  v_name := coalesce(nullif(btrim(p->>'name'),''), (select nullif(contact_name,'') from public.profiles where id = v_uid), split_part(v_email,'@',1));
  v_lang := case when p->>'lang' in ('en','ur_roman','ur') then p->>'lang' else 'en' end;
  insert into app_private.inv_investors (user_id, name, email, status, created_by, preferred_lang, relationship, source)
  values (v_uid, v_name, v_email, 'active', v_uid, v_lang, coalesce(o->>'relationship_label','Signed up online'), 'self')
  returning id into v_inv;
  insert into app_private.inv_agreements (investor_id, title, currency, commitment_cap, original_cap, payback_rate_pct, permanent_share_pct,
    payback_basis, share_type, exit_participation_pct, early_stop_share_mode, loss_carry_forward, profit_definition, exit_treatment,
    early_stop_terms, buyout_terms, status, created_by)
  values (v_inv, coalesce(nullif(o->>'title',''), 'Investment agreement'), coalesce(nullif(o->>'currency',''),'PKR'),
    (o->>'commitment_cap')::numeric, (o->>'commitment_cap')::numeric, coalesce((o->>'payback_rate_pct')::numeric, 0),
    coalesce((o->>'permanent_share_pct')::numeric, 0), 'actual_funded', coalesce(nullif(o->>'share_type',''),'profit_share'),
    nullif(o->>'exit_participation_pct','')::numeric, coalesce(nullif(o->>'early_stop_share_mode',''),'pro_rata'),
    coalesce((o->>'loss_carry_forward')::boolean, false), nullif(o->>'profit_definition',''), nullif(o->>'exit_treatment',''),
    nullif(o->>'early_stop_terms',''), nullif(o->>'buyout_terms',''), 'active', v_uid)
  returning id into v_agr;
  perform app_private.log_audit('investor.self_onboarded','investor', v_inv::text, null,
    'Investor signed up online on the standard offer', jsonb_build_object('agreement', v_agr, 'email', v_email, 'cap', o->>'commitment_cap'));
  return jsonb_build_object('ok', true, 'created', true, 'investor_id', v_inv, 'agreement_id', v_agr, 'needs_doc', true, 'offer', o);
end $$;
revoke all on function public.inv_self_onboard(jsonb) from public;
grant execute on function public.inv_self_onboard(jsonb) to authenticated;

-- Step 2: the portal publishes version 1 of the document (built from the template with the offer's params)
-- and LoadBoot's pre-signature is attached. Only for the investor's own agreement, only when no document exists.
create or replace function public.inv_publish_self_doc(p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare a app_private.inv_agreements; o jsonb; v_body text; v_hash text; v_id uuid; v_signer text; v_title text;
begin
  a := app_private.inv_guard((p->>'agreement_id')::uuid);
  if app_private.inv_my_investor() is distinct from a.investor_id then raise exception 'not your agreement' using errcode='42501'; end if;
  if exists (select 1 from app_private.inv_agreement_docs d where d.agreement_id = a.id) then
    raise exception 'a document already exists for this agreement' using errcode='22023'; end if;
  select value into o from app_private.inv_settings where key = 'self_onboard';
  if o is null or coalesce((o->>'enabled')::boolean, false) is not true then raise exception 'self sign-up is not enabled' using errcode='22023'; end if;
  v_body := p->>'body_md';
  if coalesce(btrim(v_body),'') = '' then raise exception 'document body is empty' using errcode='22023'; end if;
  v_hash := encode(extensions.digest(convert_to(v_body, 'UTF8'), 'sha256'), 'hex');
  insert into app_private.inv_agreement_docs (agreement_id, version, lang, title, body_md, body_hash, published_by, params)
  values (a.id, 1, 'en', coalesce(nullif(p->>'title',''),'Investment Agreement'), v_body, v_hash, auth.uid(), p->'params')
  returning id into v_id;
  v_signer := coalesce(nullif(o->>'company_signer',''), 'Muhammad Yaseen');
  v_title  := coalesce(nullif(o->>'company_signer_title',''), 'Member / Manager');
  insert into app_private.inv_signatures (doc_id, party, signer_name, signer_title, user_id, body_hash, signature_png, consent_text)
  values (v_id, 'company', v_signer, v_title, null, v_hash, nullif(o->>'company_signature_png',''),
          'Pre-signed on behalf of LoadBoot LLC as the standard offer (settings: self_onboard).');
  perform app_private.log_audit('investor.doc_published','investor', v_id::text, null,
    'Agreement document published (self sign-up, pre-signed by ' || v_signer || ')', jsonb_build_object('agreement', a.id, 'version', 1, 'hash', v_hash));
  return jsonb_build_object('ok', true, 'id', v_id, 'version', 1, 'hash', v_hash);
end $$;
revoke all on function public.inv_publish_self_doc(jsonb) from public;
grant execute on function public.inv_publish_self_doc(jsonb) to authenticated;

-- ── 0410b: fix trg_inv_notify (0406). The single IF chain referenced NEW.<field> of OTHER tables
-- (e.g. new.reversal_of while firing on inv_agreement_docs) — plpgsql evaluated it and raised
-- "record new has no field", which broke cc_inv_publish_doc / doc inserts. Same logic, per-table branches.
create or replace function app_private.trg_inv_notify()
returns trigger language plpgsql security definer
set search_path to 'app_private, public' as $$
declare v_inv uuid; v_cur text;
begin
  if tg_table_name = 'inv_updates' then
    if new.agreement_id is null then
      insert into app_private.inv_notifications (investor_id, agreement_id, kind, title, body, ref_kind, ref_id)
        select i.id, null, 'update', new.title, new.body, 'update', new.id::text from app_private.inv_investors i where i.status = 'active';
      if new.send_email then
        perform app_private.sys_email(i.email, 'investor.notice', 'LoadBoot · ' || new.title,
          app_private.inv_email_html(new.title, new.body, '[]'::jsonb, 'Open the portal', 'https://loadboot.com/app/investor/'), new.title || E'\n\n' || new.body, 'inv:update:' || new.id::text || ':' || i.id::text)
        from app_private.inv_investors i where i.status = 'active' and i.email is not null;
      end if;
    else
      perform app_private.inv_notify(app_private.inv_investor_of(new.agreement_id), new.agreement_id, 'update', new.title, new.body, 'update', new.id::text);
    end if;
    return new;
  end if;
  v_inv := app_private.inv_investor_of(new.agreement_id);
  select currency into v_cur from app_private.inv_agreements where id = new.agreement_id;
  if tg_table_name = 'inv_requests' then
    if tg_op = 'INSERT' then
      perform app_private.inv_notify(v_inv, new.agreement_id, 'request', 'Capital request #' || new.seq || ' — ' || v_cur || ' ' || to_char(new.amount, 'FM999,999,999'),
        coalesce(new.reason,''), 'request', new.id::text, jsonb_build_array(jsonb_build_object('k','Amount','v', v_cur || ' ' || to_char(new.amount,'FM999,999,999')), jsonb_build_object('k','For','v', coalesce(new.reason,''))));
    end if;
  elsif tg_table_name = 'inv_expenses' then
    if tg_op = 'INSERT' and new.reversal_of is null then
      perform app_private.inv_notify(v_inv, new.agreement_id, 'expense', 'Expense recorded — ' || v_cur || ' ' || to_char(new.amount,'FM999,999,999'),
        coalesce(new.vendor,'') || case when new.description is not null then ' · ' || new.description else '' end || ' (' || new.category || ')', 'expense', new.id::text,
        jsonb_build_array(jsonb_build_object('k','Amount','v', v_cur || ' ' || to_char(new.amount,'FM999,999,999')), jsonb_build_object('k','Paid to','v', coalesce(new.vendor,'—')), jsonb_build_object('k','Category','v', new.category)));
    end if;
  elsif tg_table_name = 'inv_receipts' then
    if tg_op = 'UPDATE' and new.confirmed_by_staff_at is not null and old.confirmed_by_staff_at is null then
      perform app_private.inv_notify(v_inv, new.agreement_id, 'receipt', 'Payment confirmed — ' || v_cur || ' ' || to_char(new.amount,'FM999,999,999'),
        'LoadBoot confirmed receiving your payment of ' || to_char(new.received_date, 'DD Mon YYYY') || '. It now counts toward your funded amount.', 'receipt', new.id::text);
    elsif tg_op = 'UPDATE' and new.rejected_at is not null and old.rejected_at is null then
      perform app_private.inv_notify(v_inv, new.agreement_id, 'receipt', 'Declared payment not found', coalesce(new.rejected_reason,''), 'receipt', new.id::text);
    end if;
  elsif tg_table_name = 'inv_payouts' then
    if tg_op = 'UPDATE' and new.status = 'paid' and old.status is distinct from 'paid' then
      perform app_private.inv_notify(v_inv, new.agreement_id, 'payout', 'Payout sent — ' || v_cur || ' ' || to_char(new.total,'FM999,999,999'),
        'Please confirm in the portal once it reaches you.', 'payout', new.id::text);
    end if;
  elsif tg_table_name = 'inv_agreement_docs' then
    if tg_op = 'INSERT' then
      perform app_private.inv_notify(v_inv, new.agreement_id, 'document', 'Agreement version ' || new.version || ' published', 'Read it in the portal and sign when you are ready.', 'document', new.id::text);
    end if;
  elsif tg_table_name = 'inv_amendments' then
    if tg_op = 'UPDATE' and new.status in ('accepted','declined') and old.status = 'proposed' then
      perform app_private.inv_notify(v_inv, new.agreement_id, 'amendment', 'Your proposal was ' || new.status, coalesce(new.decision_note,''), 'amendment', new.id::text);
    end if;
  elsif tg_table_name = 'inv_flags' then
    if tg_op = 'UPDATE' and new.answer is not null and old.answer is null then
      perform app_private.inv_notify(v_inv, new.agreement_id, 'flag', 'Your question was answered', new.answer, 'flag', new.id::text);
    end if;
  end if;
  return new;
end $$;
