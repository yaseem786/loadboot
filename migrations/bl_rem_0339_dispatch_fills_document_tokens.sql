-- bl_rem_0339_dispatch_fills_document_tokens
--
-- The document emails name the actual documents. delivery-worker does no merge-field
-- substitution by design, so the fill happens HERE, at queue time, where the carrier
-- is already in hand:
--   {{MISSING_LIST}}  -> "Certificate of Insurance (Auto Liability $1M), W-9 Tax Form"
--   {{DOC_PROGRESS}}  -> "2 of 4 verified"
--
-- Three things this is careful about:
--   1. The plain-text half is rebuilt from the SUBSTITUTED html, so the two versions
--      of the email can never disagree about what the carrier still owes.
--   2. Any token left unfilled is stripped before queueing. A carrier must never
--      receive a literal {{MISSING_LIST}}, whatever a future template does.
--   3. If the document list somehow comes back empty, the copy falls back to
--      "your remaining verification documents" rather than an empty orange box.
--      Never invent a document name.

create or replace function app_private.reminder_dispatch(
  p_keys text[] default null,
  p_dry_run boolean default true,
  p_ignore_cadence boolean default false,
  p_by uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare r record; v_key text; v_tpl record; v_id uuid; v_q int := 0; v_skip int := 0; v_rows jsonb := '[]'::jsonb;
        v_html text; v_text text; v_list text; v_st jsonb;
begin
  for r in select * from app_private.reminder_recipients() loop
    v_key := app_private.reminder_for_carrier(r.org);
    if v_key is null then continue; end if;
    if p_keys is not null and not (v_key = any(p_keys)) then continue; end if;
    if not r.opted_in then v_skip := v_skip + 1; continue; end if;
    if r.suppressed then v_skip := v_skip + 1; continue; end if;
    if not p_ignore_cadence and not app_private.reminder_due(r.org, v_key) then v_skip := v_skip + 1; continue; end if;

    select * into v_tpl from app_private.comm_templates where key = 'carrier.reminder.' || v_key;
    if v_tpl.key is null then v_skip := v_skip + 1; continue; end if;

    v_html := v_tpl.body;
    if v_key in ('docs_start', 'docs_finish', 'docs_fix') then
      v_list := coalesce(app_private.reminder_doc_list(r.org), 'your remaining verification documents');
      v_st   := app_private.carrier_onboarding_state(r.org);
      v_html := replace(v_html, '{{MISSING_LIST}}', v_list);
      v_html := replace(v_html, '{{DOC_PROGRESS}}',
                  coalesce(v_st->>'verified_count','0') || ' of ' || coalesce(v_st->>'required_count','0') || ' verified');
    end if;
    -- Safety net: nothing with an unfilled token may reach an inbox.
    v_html := regexp_replace(v_html, '\{\{[A-Za-z0-9_]+\}\}', '', 'g');
    v_text := coalesce(v_tpl.body_text, app_private.html_to_text(v_html));
    if v_tpl.body_text is null then v_text := app_private.html_to_text(v_html); end if;

    v_rows := v_rows || jsonb_build_object('company', r.company, 'email', r.email, 'reminder', v_key);
    if p_dry_run then continue; end if;

    insert into app_private.message_deliveries(org_id, source, template_key, channel, provider,
        recipient_user, recipient_email, idempotency_key, status, scheduled_at, meta)
    values (r.org, 'campaign', v_tpl.key, 'email', 'resend', r.uid, r.email,
        'rem:' || v_key || ':' || r.org::text || ':' || to_char(now() at time zone 'UTC','YYYYMMDD'),
        'queued', now(),
        jsonb_build_object('subject', v_tpl.subject, 'body_html', v_html, 'body_text', v_text,
                           'category', 'dispatch'))
    on conflict (idempotency_key) do nothing
    returning id into v_id;

    if v_id is null then v_skip := v_skip + 1; continue; end if;   -- already queued today
    insert into app_private.reminder_log(carrier_id, reminder_key, delivery_id, sent_by)
      values (r.org, v_key, v_id, p_by);
    v_q := v_q + 1;
  end loop;

  return jsonb_build_object('dry_run', p_dry_run, 'queued', v_q, 'skipped', v_skip, 'rows', v_rows);
end $function$;

revoke execute on function app_private.reminder_dispatch(text[], boolean, boolean, uuid) from anon, public, authenticated;
