-- bl_dial_0547 — SMS routing the owner asked for (13 Oct) + the CC "Text messages" control room.
--
--   1. Document decision texts (bl_dial_0540) go from LoadBoot's MAIN line (doc_sms_config.from_e164, default the one public
--      number from the contact switch, +1 815 365-1168) instead of a dispatcher's line. line_id stays as a fallback only.
--      For the main line no messaging_profile_id is sent unless doc_sms_config.messaging_profile_id is set: Telnyx then uses
--      the number's own profile (the dispatcher profile would not own 815).
--   2. A reply to the main line is no longer dropped. dialer_sms_hook skipped every inbound text to a number that is not a
--      dispatcher line ('no line'), so a carrier answering STOP to a document text would NOT have been recorded. Now the
--      main line is handled like a line: STOP/START land in dialer_sms_optout, the reply lands in the SMS inbox (thread
--      routed by wa_route; no line, so a dispatcher answers from their OWN number).
--   3. A dispatcher's text goes from the number of the dispatcher who is SENDING it. dialer_sms_prepare used the thread's
--      line first, so dispatcher A answering a thread opened on B's line texted from B's number. Order is now: the sender's
--      own active line → the thread's line (CC staff without a line) → the thread owner's line.
--   4. Test texts: cc_doc_sms_test(number) sends one plain test text through the real path (queue → worker → Telnyx) to a
--      number on the test list. Consent + STOP still apply (sms_consent_guard). Going live for every carrier
--      (allow_all=true) is refused until a test text was actually delivered/sent in the last 30 days.
--   5. CC RPCs: cc_sms_center() (read) and cc_doc_sms_config_set(p) (write, audited via disp_audit). Staff only
--      (disp_is_staff, same gate as cc_dialer_config_set). Neither is anon-executable → anon SECDEF surface unchanged.

-- ---------------------------------------------------------------------------------------------------------------
alter table app_private.doc_sms_config add column if not exists from_e164 text;
update app_private.doc_sms_config c
   set from_e164 = coalesce((select app_private.dial_e164(d.wa_number) from app_private.dialer_config d where d.id = 1), '+18153651168'),
       updated_at = now()
 where c.id = 1 and c.from_e164 is null;

alter table app_private.doc_sms_queue alter column org_id drop not null;
alter table app_private.doc_sms_queue drop constraint if exists doc_sms_queue_kind_check;
alter table app_private.doc_sms_queue add constraint doc_sms_queue_kind_check check (kind in ('attention','approved','test'));

-- ---------------------------------------------------------------------------------------------------------------
-- Sweep: a main line counts as a sender (anchor-patched; the rest of the sweep is bl_dial_0540 unchanged).
do $p$
declare d text;
  a1 text := $a$v_line := exists (select 1 from app_private.dialer_lines l where l.id = cfg.line_id and l.status = 'active');$a$;
  a2 text := $a$'No active LoadBoot line is set for document texts (doc_sms_config.line_id).'$a$;
begin
  d := pg_get_functiondef('app_private.doc_sms_sweep()'::regprocedure);
  if position('cfg.from_e164' in d) > 0 then return; end if;
  if position(a1 in d) = 0 or position(a2 in d) = 0 then raise exception 'bl_dial_0547: anchor not found in doc_sms_sweep'; end if;
  d := replace(d, a1, $b$v_line := cfg.from_e164 is not null   -- bl_dial_0547: the main line
    or exists (select 1 from app_private.dialer_lines l where l.id = cfg.line_id and l.status = 'active');$b$);
  d := replace(d, a2, $b$'No sending number is set for document texts (CC → Text messages → Main line).'$b$);
  execute d;
end $p$;

-- Claim: main line first; test rows skip only the document-texts switch (never STOP, consent or the master SMS switch).
create or replace function public.doc_sms_worker_claim(p_limit int default 10) returns jsonb
language plpgsql security definer set search_path to 'app_private', 'public' as $$
declare cfg app_private.doc_sms_config; dc app_private.dialer_config; ln app_private.dialer_lines;
  q app_private.doc_sms_queue; t app_private.sms_threads; m app_private.dialer_messages; v_prof text; v_from text;
  v_kind text; out jsonb := '[]'::jsonb;
begin
  select * into cfg from app_private.doc_sms_config where id = 1;
  select * into dc  from app_private.dialer_config where id = 1;
  if cfg.from_e164 is not null then
    v_from := cfg.from_e164; v_prof := cfg.messaging_profile_id;
  else
    select * into ln from app_private.dialer_lines where id = cfg.line_id and status = 'active';
    v_from := ln.phone_e164; v_prof := coalesce(cfg.messaging_profile_id, dc.telnyx_messaging_profile_id);
  end if;
  for q in select * from app_private.doc_sms_queue where status = 'ready'
           order by updated_at limit least(greatest(coalesce(p_limit, 10), 1), 25) for update skip locked loop
    begin
      if not (coalesce(dc.enabled, false) and coalesce(dc.sms_enabled, false)) then
        raise exception 'Text messaging was switched off before the send.'; end if;
      if q.kind is distinct from 'test' and not coalesce(cfg.enabled, false) then
        raise exception 'Document texts were switched off before the send.'; end if;
      if q.kind = 'test' and not (q.to_number = any(cfg.test_numbers)) then
        raise exception 'This number was taken off the test list before the send.'; end if;
      if v_from is null then raise exception 'No sending number is set for document texts.'; end if;
      if exists (select 1 from app_private.dialer_sms_optout o where o.number = q.to_number) then
        raise exception 'This number replied STOP before the send.'; end if;
      if not exists (select 1 from app_private.sms_consent c where c.number = q.to_number and c.revoked_at is null) then
        raise exception 'No SMS consent on file for this number (the carrier must tick the text box, or log a verbal yes).'; end if;

      v_kind := case when q.org_id is null then null else 'carrier' end;
      select * into t from app_private.sms_threads where counterparty = q.to_number;
      if t.id is null then
        insert into app_private.sms_threads (counterparty, carrier_org_id, contact_kind, line_id, last_at)
        values (q.to_number, q.org_id, v_kind, ln.id, now()) returning * into t;
      end if;
      insert into app_private.dialer_messages (line_id, direction, counterparty, body, status, contact_kind, carrier_org_id, thread_id)
      values (ln.id, 'outbound', q.to_number, app_private.sms_compose(q.body, q.to_number)->>'body', 'queued', v_kind, q.org_id, t.id)
      returning * into m;
      update app_private.sms_threads
         set last_at = now(), last_body = left(m.body, 300), last_direction = 'outbound', last_outbound_at = now(), updated_at = now()
       where id = t.id;
      update app_private.doc_sms_queue set status = 'sending', message_id = m.id, preview = m.body,
             segments = app_private.sms_segments(m.body), updated_at = now() where id = q.id;
      out := out || jsonb_build_object('queue_id', q.id, 'message_id', m.id, 'from', v_from, 'to', q.to_number,
                                       'text', m.body, 'messaging_profile_id', v_prof);
    exception when others then
      update app_private.doc_sms_queue set status = 'failed', reason = left(sqlerrm, 300), updated_at = now() where id = q.id;
    end;
  end loop;
  return jsonb_build_object('ok', true, 'items', out);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Inbound: a text to the main line is recorded (STOP included) instead of being skipped as 'no line'.
do $p$
declare d text;
  a text := $a$    if ln.id is null then return jsonb_build_object('ok', true, 'skipped', 'no line'); end if;$a$;
begin
  d := pg_get_functiondef('public.dialer_sms_hook(jsonb)'::regprocedure);
  if position('bl_dial_0547' in d) > 0 then return; end if;
  if position(a in d) = 0 then raise exception 'bl_dial_0547: anchor not found in dialer_sms_hook'; end if;
  d := replace(d, a, $b$    -- bl_dial_0547: the main line (document texts) is a LoadBoot number too — record its replies and STOPs.
    if ln.id is null and v_to is distinct from (select c.from_e164 from app_private.doc_sms_config c where c.id = 1) then
      return jsonb_build_object('ok', true, 'skipped', 'no line'); end if;$b$);
  execute d;
end $p$;

-- Outbound: the sender's own line first.
do $p$
declare d text;
  a text := $a$  select * into ln from app_private.dialer_lines where id = t.line_id and status = 'active';
  if ln.id is null then select * into ln from app_private.dialer_lines where dispatcher_user_id = coalesce(t.owner_user_id, v_uid) and status = 'active'; end if;$a$;
begin
  d := pg_get_functiondef('public.dialer_sms_prepare(jsonb)'::regprocedure);
  if position('bl_dial_0547' in d) > 0 then return; end if;
  if position(a in d) = 0 then raise exception 'bl_dial_0547: anchor not found in dialer_sms_prepare'; end if;
  d := replace(d, a, $b$  -- bl_dial_0547: a text goes from the number of the person SENDING it; CC staff without a line use the thread's line.
  select * into ln from app_private.dialer_lines where dispatcher_user_id = v_uid and status = 'active' order by last_seen_at desc nulls last limit 1;
  if ln.id is null then select * into ln from app_private.dialer_lines where id = t.line_id and status = 'active'; end if;
  if ln.id is null then select * into ln from app_private.dialer_lines where dispatcher_user_id = t.owner_user_id and status = 'active' order by last_seen_at desc nulls last limit 1; end if;$b$);
  execute d;
end $p$;

-- ---------------------------------------------------------------------------------------------------------------
-- CC: one read for the whole Text messages screen.
create or replace function public.cc_sms_center() returns jsonb
language plpgsql stable security definer set search_path to 'app_private', 'public' as $$
declare cfg app_private.doc_sms_config; dc app_private.dialer_config; v_tested timestamptz; v_main_ok boolean;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error', 'not authorized'); end if;
  select * into cfg from app_private.doc_sms_config where id = 1;
  select * into dc  from app_private.dialer_config where id = 1;
  select max(coalesce(q.sent_at, q.updated_at)) into v_tested from app_private.doc_sms_queue q
   where q.kind = 'test' and q.status = 'sent' and q.updated_at > now() - interval '30 days';
  v_main_ok := cfg.from_e164 is not null or exists (select 1 from app_private.dialer_lines l where l.id = cfg.line_id and l.status = 'active');
  return jsonb_build_object(
    'ok', true,
    'config', jsonb_build_object('enabled', cfg.enabled, 'allow_all', cfg.allow_all, 'test_numbers', to_jsonb(cfg.test_numbers),
       'from_e164', cfg.from_e164, 'line_id', cfg.line_id, 'messaging_profile_id', cfg.messaging_profile_id,
       'debounce_minutes', cfg.debounce_minutes, 'max_per_day', cfg.max_per_day, 'worker', cfg.worker_url is not null,
       'updated_at', cfg.updated_at),
    'dialer', jsonb_build_object('enabled', coalesce(dc.enabled, false), 'sms_enabled', coalesce(dc.sms_enabled, false),
       'messaging_profile_id', dc.telnyx_messaging_profile_id, 'first_suffix', dc.sms_first_msg_suffix,
       'first_suffix_unicode', coalesce(dc.sms_first_msg_suffix, '') ~ '[^ -~]'),
    'main_number', app_private.dial_e164(dc.wa_number),
    'last_test_at', v_tested,
    'steps', jsonb_build_array(
       jsonb_build_object('key', 'sms', 'ok', coalesce(dc.enabled, false) and coalesce(dc.sms_enabled, false)),
       jsonb_build_object('key', 'sender', 'ok', v_main_ok),
       jsonb_build_object('key', 'test', 'ok', v_tested is not null),
       jsonb_build_object('key', 'doc', 'ok', coalesce(cfg.enabled, false)),
       jsonb_build_object('key', 'live', 'ok', coalesce(cfg.allow_all, false))),
    'kpi', (select jsonb_build_object(
              'sent_24h',   count(*) filter (where status = 'sent' and kind <> 'test' and updated_at > now() - interval '24 hours'),
              'sent_7d',    count(*) filter (where status = 'sent' and kind <> 'test'),
              'waiting',    count(*) filter (where status in ('collecting','ready','sending')),
              'skipped_7d', count(*) filter (where status = 'skipped'),
              'failed_7d',  count(*) filter (where status = 'failed'))
              from app_private.doc_sms_queue where created_at > now() - interval '7 days' or status in ('collecting','ready','sending')),
    'lines', coalesce((
       select jsonb_agg(jsonb_build_object('id', l.id, 'number', l.phone_e164, 'label', l.label, 'last_seen_at', l.last_seen_at,
                'dispatcher', coalesce(nullif(dp.full_name, ''), 'Dispatcher'), 'user_id', l.dispatcher_user_id,
                'out_7d', (select count(*) from app_private.dialer_messages x where x.line_id = l.id and x.direction = 'outbound' and x.created_at > now() - interval '7 days'),
                'in_7d',  (select count(*) from app_private.dialer_messages x where x.line_id = l.id and x.direction = 'inbound'  and x.created_at > now() - interval '7 days'),
                'last_text_at', (select max(x.created_at) from app_private.dialer_messages x where x.line_id = l.id))
              order by dp.full_name nulls last)
         from app_private.dialer_lines l left join app_private.dispatcher_profiles dp on dp.user_id = l.dispatcher_user_id
        where l.status = 'active'), '[]'::jsonb),
    'main_in_7d', (select count(*) from app_private.dialer_messages x where x.line_id is null and x.direction = 'inbound' and x.created_at > now() - interval '7 days'),
    'feed', coalesce((
       select jsonb_agg(jsonb_build_object('id', q.id, 'org_id', q.org_id, 'carrier', o.name, 'status', q.status, 'kind', q.kind,
                'reason', q.reason, 'body', q.preview, 'segments', q.segments, 'due_at', q.due_at, 'sent_at', q.sent_at,
                'created_at', q.created_at, 'updated_at', q.updated_at, 'msg_status', m.status, 'error', m.error,
                'to', case when q.to_number is null then null else '***' || right(q.to_number, 4) end,
                'keys', (select coalesce(jsonb_agg(distinct d->>'key'), '[]'::jsonb) from jsonb_array_elements(q.decisions) d))
              order by q.created_at desc)
         from (select * from app_private.doc_sms_queue order by created_at desc limit 80) q
         left join public.organizations o on o.id = q.org_id
         left join app_private.dialer_messages m on m.id = q.message_id), '[]'::jsonb));
end $$;

-- CC: change the document-text settings. Every change is audited; going live needs a delivered test first.
create or replace function public.cc_doc_sms_config_set(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'app_private', 'public' as $$
declare v_nums text[]; v_bad text; v_from text;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error', 'not authorized'); end if;
  p := coalesce(p, '{}'::jsonb);
  if p ? 'test_numbers' then
    select array_agg(distinct app_private.dial_e164(x)) filter (where app_private.dial_e164(x) is not null),
           min(x) filter (where app_private.dial_e164(x) is null and btrim(x) <> '')
      into v_nums, v_bad from jsonb_array_elements_text(coalesce(p->'test_numbers', '[]'::jsonb)) x;
    if v_bad is not null then return jsonb_build_object('error', 'Not a valid US mobile number: ' || v_bad); end if;
    if cardinality(coalesce(v_nums, '{}')) > 10 then return jsonb_build_object('error', 'Up to 10 test numbers.'); end if;
  end if;
  if p ? 'from_e164' and nullif(btrim(p->>'from_e164'), '') is not null then
    v_from := app_private.dial_e164(p->>'from_e164');
    if v_from is null then return jsonb_build_object('error', 'The main line must be a US number, e.g. +18153651168.'); end if;
  end if;
  if coalesce((p->>'allow_all')::boolean, false) and not exists (
       select 1 from app_private.doc_sms_queue q where q.kind = 'test' and q.status = 'sent' and q.updated_at > now() - interval '30 days') then
    return jsonb_build_object('error', 'Send a test text to your own phone first and check it arrived. Going live for every carrier is unlocked after one test text is sent.');
  end if;
  update app_private.doc_sms_config set
    enabled      = coalesce((p->>'enabled')::boolean, enabled),
    allow_all    = coalesce((p->>'allow_all')::boolean, allow_all),
    test_numbers = case when p ? 'test_numbers' then coalesce(v_nums, '{}') else test_numbers end,
    from_e164    = case when p ? 'from_e164' then v_from else from_e164 end,
    messaging_profile_id = case when p ? 'messaging_profile_id' then nullif(btrim(p->>'messaging_profile_id'), '') else messaging_profile_id end,
    debounce_minutes = case when nullif(p->>'debounce_minutes', '') is null then debounce_minutes
                            else least(greatest((p->>'debounce_minutes')::int, 1), 120) end,
    max_per_day  = case when nullif(p->>'max_per_day', '') is null then max_per_day
                        else least(greatest((p->>'max_per_day')::int, 1), 10) end,
    updated_at = now(), updated_by = auth.uid()
  where id = 1;
  -- Owner decision (d): the em dash in the first-text suffix makes every first text UCS-2 (4 segments instead of 2).
  if coalesce((p->>'first_suffix_ascii')::boolean, false) then
    update app_private.dialer_config set sms_first_msg_suffix = replace(replace(sms_first_msg_suffix, '—', '-'), '–', '-'),
           updated_at = now(), updated_by = auth.uid() where id = 1;
  end if;
  perform app_private.disp_audit('docsms.config', 'doc_sms', '1', null, 'document text settings changed', p);
  return jsonb_build_object('ok', true);
end $$;

-- CC: one test text to a number on the test list, through the real queue → worker → Telnyx path.
create or replace function public.cc_doc_sms_test(p_number text) returns jsonb
language plpgsql security definer set search_path to 'app_private', 'public' as $$
declare cfg app_private.doc_sms_config; dc app_private.dialer_config; v_num text := app_private.dial_e164(p_number);
  b text := 'Test text from LoadBoot Command Center. Document updates will come from this number. No action needed.'; v_id uuid;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error', 'not authorized'); end if;
  select * into cfg from app_private.doc_sms_config where id = 1;
  select * into dc  from app_private.dialer_config where id = 1;
  if v_num is null then return jsonb_build_object('error', 'Not a valid US mobile number.'); end if;
  if not (v_num = any(cfg.test_numbers)) then return jsonb_build_object('error', 'Add this number to the test list first.'); end if;
  if not (coalesce(dc.enabled, false) and coalesce(dc.sms_enabled, false)) then
    return jsonb_build_object('error', 'Text messaging is switched off. Turn on step 1 first.'); end if;
  if cfg.from_e164 is null and cfg.line_id is null then return jsonb_build_object('error', 'Set the main line first.'); end if;
  if exists (select 1 from app_private.dialer_sms_optout o where o.number = v_num) then
    return jsonb_build_object('error', 'This number replied STOP. Text START from it to the main line to opt back in.'); end if;
  if not exists (select 1 from app_private.sms_consent c where c.number = v_num and c.revoked_at is null) then
    return jsonb_build_object('error', 'No SMS consent on file for this number. Tick the text box on a test carrier account with this phone, or log your verbal yes in the dialer, then try again.'); end if;
  if exists (select 1 from app_private.doc_sms_queue q where q.kind = 'test' and q.to_number = v_num and q.created_at > now() - interval '2 minutes') then
    return jsonb_build_object('error', 'A test text to this number went out less than 2 minutes ago.'); end if;
  insert into app_private.doc_sms_queue (org_id, status, due_at, kind, body, preview, segments, to_number, decisions)
  values (null, 'ready', now(), 'test', b, app_private.sms_compose(b, v_num)->>'body',
          app_private.sms_segments(app_private.sms_compose(b, v_num)->>'body'), v_num, '[]'::jsonb)
  returning id into v_id;
  perform app_private.disp_audit('docsms.test', 'doc_sms', v_id::text, null, 'test document text queued', jsonb_build_object('to', '***' || right(v_num, 4)));
  if cfg.worker_url is not null then
    perform net.http_post(url := cfg.worker_url, headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

revoke all on function public.cc_sms_center() from public, anon;
revoke all on function public.cc_doc_sms_config_set(jsonb) from public, anon;
revoke all on function public.cc_doc_sms_test(text) from public, anon;
grant execute on function public.cc_sms_center() to authenticated;
grant execute on function public.cc_doc_sms_config_set(jsonb) to authenticated;
grant execute on function public.cc_doc_sms_test(text) to authenticated;
revoke all on function public.doc_sms_worker_claim(int) from public, anon, authenticated;
grant execute on function public.doc_sms_worker_claim(int) to service_role;
