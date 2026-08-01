-- bl_voice_0186 — a real call exposed two holes in bl_voice_0183.
-- Applied to production 2026-08-01 (this file is the repo record of that change).
--
-- Call 60 (a live inbound carrier, MC 5677034, scored HOT) produced a lead titled
-- "Caller 9283936198". The caller said his name out loud in the first three seconds and
-- spelled out an email, but neither survived: contact_name is only set from the outbound
-- dynamic variable, which is 'there' for an unknown inbound number, and there was no
-- extraction field for an email at all. A hot lead the team cannot email by name is half
-- a lead.
--
-- Needs the matching Retell change: two new Post-Call Data Extraction fields named
-- caller_name (Text) and contact_email (Text). Without them these columns stay empty.
--
-- Applied as in-place rewrites so this never drifts from whatever version of
-- retell_webhook is live, and guarded so re-running changes nothing.

do $do$
declare src text;
begin
  src := pg_get_functiondef('public.retell_webhook(jsonb)'::regprocedure);
  if position('caller_name' in src) > 0 then return; end if;

  -- 1) Prefer the name the caller actually gave over the outbound placeholder.
  src := replace(src,
    'contact_name = coalesce(contact_name, nullif(nullif(call->''retell_llm_dynamic_variables''->>''name'',''there''),''the owner'')),',
    'contact_name = coalesce(nullif(nullif(contact_name,''there''),''''), nullif(v_an->>''caller_name'',''''), nullif(nullif(call->''retell_llm_dynamic_variables''->>''name'',''there''),''the owner'')),');

  -- 2) Same order when naming the lead and the CRM contact.
  src := replace(src,
    'v_name   := coalesce(nullif(rec.contact_name,''''), nullif(rec.analysis->>''company_name'',''''), ''Caller '' || v_last10);',
    'v_name   := coalesce(nullif(rec.contact_name,''''), nullif(rec.analysis->>''caller_name'',''''), nullif(rec.analysis->>''company_name'',''''), ''Caller '' || v_last10);');

  -- 3) Store the email on the CRM contact so the follow-up can actually be sent.
  src := replace(src,
    'insert into app_private.crm_contacts (name, phone, title)
          values (left(v_name,200), v_phone, nullif(v_ctype,''''))',
    'insert into app_private.crm_contacts (name, phone, title, email)
          values (left(v_name,200), v_phone, nullif(v_ctype,''''), nullif(rec.analysis->>''contact_email'',''''))');

  -- 4) And surface it on the activity, next to the MC.
  src := replace(src,
    '|| coalesce(E''\nMC/DOT: '' || nullif(rec.analysis->>''mc_number'',''''), '''')',
    '|| coalesce(E''\nEmail: '' || nullif(rec.analysis->>''contact_email'',''''), '''')
          || coalesce(E''\nMC/DOT: '' || nullif(rec.analysis->>''mc_number'',''''), '''')');

  execute src;
end $do$;

-- Backfill the one real lead this cost us, so the team is not chasing a phone number.
update app_private.crm_contacts set name = 'Yaseen'
 where name = 'Caller 9283936198' and phone = '+19283936198';
update app_private.crm_leads set title = '📞 Inbound call — Yaseen · carrier · 1 truck(s) · HOT'
 where id = 'bbb7e28d-1633-4f09-a4da-3d052fb2298b';
update app_private.lc_calls set contact_name = 'Yaseen' where call_id = 'call_376d270af007736e0bf8963cbec';
