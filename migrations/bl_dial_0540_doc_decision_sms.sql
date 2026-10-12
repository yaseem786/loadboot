-- bl_dial_0540 (item N) — Document decision SMS (carrier campaign CS3VIAJ).
--
-- When staff approve / reject a carrier document in CC, the carrier gets ONE text per review session:
--   • every decision goes through app_private.compliance_decision_notify (all CC decide paths) → doc_sms_note() puts it
--     on ONE open queue row per carrier and pushes due_at to "last decision + 10 min" (debounce);
--   • cron doc_sms_sweep (every minute) turns due rows into a single summary text, runs every gate, and records WHY a
--     text did not go (CC shows it under the decision);
--   • edge fn doc-sms-worker (pg_net, only when something is ready) claims 'ready' rows → dialer_messages row first →
--     Telnyx → doc_sms_worker_done. A row is claimed once ('sending'); a lost worker is marked failed, never re-sent.
--
-- Gates (all must pass): doc_sms_config.enabled · dialer_config.enabled AND sms_enabled · a member's number has a live
-- sms_consent row (the carrier ticked the SMS box) · not on STOP / toll-fraud lists · test mode (allow_all=false → only
-- test_numbers receive; fail-closed) · max_per_day per carrier · an active LoadBoot line in doc_sms_config.line_id ·
-- carrier local time 8:00–21:00 (otherwise held to 9:00 next morning) · there is something to say:
-- a document rejected / still missing, OR the account just became fully approved (sent once per carrier, ever).
-- Body: "LoadBoot: " prefix + " Reply STOP to opt out." come from app_private.sms_compose (the shared SMS path); the
-- first text to a number gets dialer_config.sms_first_msg_suffix from sms_consent_guard. ≤2 segments: detail is dropped
-- level by level until it fits. Staff notes are scrubbed (no e-mails, no digit runs of 9+ = TIN/account/phone).
-- Email is unchanged. lb.compdec_mute (bulk/system ops) mutes the SMS too.
--
-- New public functions: cc_doc_sms_status (authenticated, compliance.view), doc_sms_worker_claim / doc_sms_worker_done
-- (service_role only). None is anon-executable → anon SECDEF surface unchanged (35 staging / 36 prod).
-- Config is env-specific and NOT set here (enabled=false, no line, no worker_url): see claude/DOC-SMS-0540.md.

-- ---------------------------------------------------------------------------------------------------------------
create table if not exists app_private.doc_sms_config (
  id               int primary key default 1 check (id = 1),
  enabled          boolean not null default false,
  allow_all        boolean not null default false,          -- false = only test_numbers receive
  test_numbers     text[]  not null default '{}',
  line_id          uuid references app_private.dialer_lines(id) on delete set null,
  messaging_profile_id text,                                -- null = dialer_config.telnyx_messaging_profile_id
  debounce_minutes int not null default 10 check (debounce_minutes between 1 and 120),
  max_per_day      int not null default 3  check (max_per_day between 1 and 10),
  worker_url       text,
  updated_at       timestamptz not null default now(),
  updated_by       uuid
);
insert into app_private.doc_sms_config (id) values (1) on conflict (id) do nothing;
alter table app_private.doc_sms_config enable row level security;
revoke all on app_private.doc_sms_config from public, anon, authenticated;

create table if not exists app_private.doc_sms_queue (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  status      text not null default 'collecting' check (status in ('collecting','skipped','ready','sending','sent','failed')),
  due_at      timestamptz not null,
  decisions   jsonb not null default '[]'::jsonb,         -- [{key, status, note, doc, at}]
  doc_ids     uuid[] not null default '{}',
  kind        text check (kind in ('attention','approved')),
  body        text,                                       -- what goes into sms_compose
  preview     text,                                       -- the full text the carrier gets (prefix/suffix included)
  segments    int,
  to_number   text,
  reason      text,                                       -- why it was held / skipped / failed
  message_id  uuid references app_private.dialer_messages(id) on delete set null,
  sent_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists doc_sms_queue_one_open on app_private.doc_sms_queue (org_id) where status = 'collecting';
create index if not exists doc_sms_queue_due on app_private.doc_sms_queue (status, due_at);
create index if not exists doc_sms_queue_org on app_private.doc_sms_queue (org_id, created_at desc);
alter table app_private.doc_sms_queue enable row level security;
revoke all on app_private.doc_sms_queue from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Segment count: plain ASCII subset of GSM-7 → 160/153, anything else → UCS-2 70/67 (conservative).
create or replace function app_private.sms_segments(p text) returns int language sql immutable as $$
  select case when p is null or p = '' then 0
    when p ~ '^[A-Za-z0-9 @$_!"#%&''()*+,./:;<=>?-]*$'
      then case when length(p) <= 160 then 1 else ceil(length(p) / 153.0)::int end
    else case when length(p) <= 70 then 1 else ceil(length(p) / 67.0)::int end end
$$;

-- Staff note → SMS-safe: no e-mails, no digit runs with 9+ digits (TIN, account, phone, policy no.), GSM-only, one line.
create or replace function app_private.sms_clean(p text, p_max int) returns text language plpgsql immutable as $$
declare t text := coalesce(p, ''); m text;
begin
  t := translate(t, '–—‘’“”…•', '--''''"".-');
  t := regexp_replace(t, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '', 'g');
  for m in select (regexp_matches(t, '\d[\d\s().-]{6,}\d', 'g'))[1] loop
    if length(regexp_replace(m, '\D', '', 'g')) >= 9 then t := replace(t, m, '#'); end if;
  end loop;
  t := regexp_replace(t, '[^A-Za-z0-9 @$_!"#%&''()*+,./:;<=>?-]', ' ', 'g');
  t := regexp_replace(regexp_replace(t, '\s+', ' ', 'g'), ' ([.,;:])', '\1', 'g');
  t := rtrim(btrim(t), ' .;:,');
  if length(t) > p_max then t := rtrim(left(t, greatest(p_max - 3, 1)), ' .;:,') || '...'; end if;
  return t;
end $$;

create or replace function app_private.doc_sms_label(p_key text, p_name text) returns text language sql immutable as $$
  select case p_key
    when 'insurance_coi' then 'COI'               when 'mc_authority' then 'MC authority'
    when 'w9' then 'W-9'                          when 'dispatch_agreement' then 'Dispatch agreement'
    when 'hazmat_registration' then 'Hazmat registration' when 'hazmat_endorsement' then 'Hazmat endorsement'
    when 'hazmat_insurance' then 'Hazmat COI'     when 'bank_verification' then 'Bank verification'
    else coalesce(nullif(btrim(split_part(coalesce(p_name, ''), ' (', 1)), ''), 'Document') end
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Hook target: one open row per carrier, debounced.
create or replace function app_private.doc_sms_note(p_org uuid, p_req_key text, p_status text, p_note text, p_document uuid)
returns void language plpgsql security definer set search_path to 'app_private', 'public' as $$
declare v_due timestamptz;
begin
  if p_org is null or p_status not in ('valid','rejected') then return; end if;
  if exists (select 1 from public.organizations o where o.id = p_org and coalesce(o.is_demo, false)) then return; end if;
  select now() + make_interval(mins => coalesce((select debounce_minutes from app_private.doc_sms_config where id = 1), 10)) into v_due;
  insert into app_private.doc_sms_queue (org_id, due_at, decisions, doc_ids)
  values (p_org, v_due,
          jsonb_build_array(jsonb_build_object('key', p_req_key, 'status', p_status, 'note', left(p_note, 300), 'doc', p_document, 'at', now())),
          case when p_document is null then '{}'::uuid[] else array[p_document] end)
  on conflict (org_id) where status = 'collecting' do update
     set due_at = excluded.due_at,
         decisions = app_private.doc_sms_queue.decisions || excluded.decisions,
         doc_ids = case when p_document is null or p_document = any(app_private.doc_sms_queue.doc_ids)
                        then app_private.doc_sms_queue.doc_ids else app_private.doc_sms_queue.doc_ids || p_document end,
         reason = null,
         updated_at = now();
end $$;

-- The text, from the carrier's CURRENT state (a reject-then-approve inside the window texts nothing about that doc).
create or replace function app_private.doc_sms_compose(p_org uuid, p_decisions jsonb, p_number text)
returns jsonb language plpgsql stable security definer set search_path to 'app_private', 'public' as $$
declare s jsonb; v_ok boolean; rej jsonb; v_missing text[]; v_approved text[]; v_kind text; n int;
  lvl int; b text; det text; v_full text; v_seg int; v_first boolean; sfx text;
  link constant text := 'https://loadboot.com/app/carrier/#documents';
begin
  s    := app_private.carrier_onboarding_state(p_org);
  v_ok := app_private.carrier_mandatory_ok(p_org);
  select coalesce(array_agg(app_private.doc_sms_label(r.key, x.n) order by x.o), '{}') into v_missing
    from jsonb_array_elements_text(coalesce(s->'missing', '[]'::jsonb)) with ordinality x(n, o)
    left join app_private.compliance_requirements r on r.name = x.n;
  select coalesce(jsonb_agg(jsonb_build_object('label', app_private.doc_sms_label(r.key, x.n),
           'note', coalesce(
             (select d->>'note' from jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb)) d
               where d->>'key' = r.key and d->>'status' = 'rejected' and nullif(btrim(d->>'note'), '') is not null
               order by d->>'at' desc limit 1),
             (select c.note from app_private.carrier_compliance c
               where c.carrier_id = p_org and c.requirement_key = r.key order by c.updated_at desc nulls last limit 1)))
         order by x.o), '[]'::jsonb) into rej
    from jsonb_array_elements_text(coalesce(s->'rejected', '[]'::jsonb)) with ordinality x(n, o)
    left join app_private.compliance_requirements r on r.name = x.n;
  select coalesce(array_agg(distinct app_private.doc_sms_label(r.key, r.name)), '{}') into v_approved
    from jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb)) d
    join app_private.compliance_requirements r on r.key = d->>'key'
   where d->>'status' = 'valid'
     and exists (select 1 from app_private.carrier_compliance c
                  where c.carrier_id = p_org and c.requirement_key = r.key and c.status = 'valid');
  n := jsonb_array_length(rej);

  if n > 0 or cardinality(v_missing) > 0 then
    v_kind := 'attention';
  elsif v_ok and cardinality(v_approved) > 0
        and not exists (select 1 from app_private.doc_sms_queue x
                         where x.org_id = p_org and x.kind = 'approved' and x.status in ('ready','sending','sent')) then
    v_kind := 'approved';
  else
    return jsonb_build_object('kind', null);
  end if;

  select (c.confirmation_sent_at is null) into v_first from app_private.sms_consent c
   where c.number = p_number and c.revoked_at is null;
  v_first := coalesce(v_first, true);
  select sms_first_msg_suffix into sfx from app_private.dialer_config where id = 1;

  for lvl in 0..3 loop
    if v_kind = 'approved' then
      b := 'You''re fully approved - every required document is verified. See it here: ' || link;
    elsif n > 0 then
      select string_agg(e->>'label'
               || case when lvl <= 1 and nullif(app_private.sms_clean(e->>'note', 200), '') is not null
                       then ': ' || app_private.sms_clean(e->>'note', case lvl when 0 then 110 else 45 end) else '' end, '; ')
        into det from jsonb_array_elements(rej) e;
      b := n || case when n = 1 then ' document needs' else ' documents need' end || ' your attention'
        || case when lvl < 3 then ' - ' || det else '' end || '.'
        || case when cardinality(v_missing) > 0 and lvl <= 1 then ' Still needed: ' || array_to_string(v_missing, ', ') || '.' else '' end
        || ' Fix it here: ' || link;
    else
      b := case when cardinality(v_approved) > 0 and lvl <= 1 then array_to_string(v_approved, ', ') || ' approved. ' else '' end
        || 'Still needed: '
        || case when lvl <= 2 then array_to_string(v_missing, ', ')
                else cardinality(v_missing) || ' document' || case when cardinality(v_missing) = 1 then '' else 's' end end
        || '. Upload here: ' || link;
    end if;
    v_full := app_private.sms_compose(b, p_number)->>'body';
    if v_first and sfx is not null and position(sfx in v_full) = 0 then v_full := v_full || sfx; end if;
    v_seg := app_private.sms_segments(v_full);
    exit when v_seg <= 2;
  end loop;
  return jsonb_build_object('kind', v_kind, 'body', b, 'preview', v_full, 'segments', v_seg, 'first', v_first);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Cron, every minute. Cheap when idle (one index probe); pings the worker only when a row is ready.
create or replace function app_private.doc_sms_sweep() returns jsonb
language plpgsql security definer set search_path to 'app_private', 'public' as $$
declare cfg app_private.doc_sms_config; dc app_private.dialer_config; q app_private.doc_sms_queue;
  v_tz text; v_local timestamp; v_num text; c jsonb; why text; n_done int := 0; n_ready int := 0; v_line boolean;
begin
  select * into cfg from app_private.doc_sms_config where id = 1;
  select * into dc  from app_private.dialer_config where id = 1;
  v_line := exists (select 1 from app_private.dialer_lines l where l.id = cfg.line_id and l.status = 'active');

  update app_private.doc_sms_queue
     set status = 'failed', reason = 'The sender did not confirm within 10 minutes. Not retried, so the carrier never gets the same text twice.',
         updated_at = now()
   where status = 'sending' and updated_at < now() - interval '10 minutes';

  for q in select * from app_private.doc_sms_queue where status = 'collecting' and due_at <= now()
           order by due_at limit 50 for update skip locked loop
    v_tz := coalesce(nullif(app_private.riley_plan_tz(q.org_id), ''), 'America/Chicago');
    v_local := now() at time zone v_tz;
    if extract(hour from v_local) < 8 or extract(hour from v_local) >= 21 then
      update app_private.doc_sms_queue
         set due_at = (date_trunc('day', v_local) + case when extract(hour from v_local) >= 21 then interval '1 day 9 hours' else interval '9 hours' end) at time zone v_tz,
             reason = 'Held for quiet hours: texts go 8 am - 9 pm carrier time (' || v_tz || ').', updated_at = now()
       where id = q.id;
      continue;
    end if;

    select m.e into v_num
      from (select app_private.dial_e164(coalesce(u.raw_user_meta_data->>'phone', '')) e, om.member_role, om.created_at
              from public.organization_memberships om join auth.users u on u.id = om.user_id
             where om.org_id = q.org_id and om.status = 'active') m
      join app_private.sms_consent sc on sc.number = m.e and sc.revoked_at is null
     order by (m.member_role in ('owner','admin')) desc nulls last, m.created_at
     limit 1;

    c := app_private.doc_sms_compose(q.org_id, q.decisions, v_num);
    why := case
      when c->>'kind' is null then 'Nothing to text: no document is rejected or missing, and the account did not just become fully approved.'
      when not coalesce(cfg.enabled, false) then 'Document SMS is switched off (doc_sms_config.enabled).'
      when not (coalesce(dc.enabled, false) and coalesce(dc.sms_enabled, false)) then 'Text messaging is switched off (dialer_config.sms_enabled).'
      when v_num is null then 'No SMS consent: nobody on this account has ticked the text-message box for their number.'
      when exists (select 1 from app_private.dialer_sms_optout o where o.number = v_num) then 'This number replied STOP.'
      when app_private.dial_blocked(v_num, false) is not null then app_private.dial_blocked(v_num, false)
      when not coalesce(cfg.allow_all, false) and not (v_num = any(cfg.test_numbers)) then 'Test mode: only the test number(s) get document texts.'
      when (select count(*) from app_private.doc_sms_queue x where x.org_id = q.org_id and x.status in ('ready','sending','sent')
             and x.updated_at > now() - interval '24 hours') >= coalesce(cfg.max_per_day, 3)
        then 'Daily limit reached: ' || coalesce(cfg.max_per_day, 3) || ' document texts to this carrier in 24 hours.'
      when not v_line then 'No active LoadBoot line is set for document texts (doc_sms_config.line_id).'
      else null end;

    update app_private.doc_sms_queue
       set status = case when why is null then 'ready' else 'skipped' end, reason = why,
           kind = c->>'kind', body = c->>'body', preview = c->>'preview', segments = (c->>'segments')::int,
           to_number = v_num, updated_at = now()
     where id = q.id;
    n_done := n_done + 1;
    if why is null then n_ready := n_ready + 1; end if;
  end loop;

  if cfg.worker_url is not null and (n_ready > 0 or exists (select 1 from app_private.doc_sms_queue where status = 'ready')) then
    perform net.http_post(url := cfg.worker_url, headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb);
  end if;
  return jsonb_build_object('processed', n_done, 'ready', n_ready);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Worker side (service_role only). Claim re-checks the switches + consent, writes the dialer_messages row (so the text
-- exists in LoadBoot's record before it leaves, and lands in the carrier's SMS thread for replies).
create or replace function public.doc_sms_worker_claim(p_limit int default 10) returns jsonb
language plpgsql security definer set search_path to 'app_private', 'public' as $$
declare cfg app_private.doc_sms_config; dc app_private.dialer_config; ln app_private.dialer_lines;
  q app_private.doc_sms_queue; t app_private.sms_threads; m app_private.dialer_messages; v_prof text; out jsonb := '[]'::jsonb;
begin
  select * into cfg from app_private.doc_sms_config where id = 1;
  select * into dc  from app_private.dialer_config where id = 1;
  select * into ln  from app_private.dialer_lines where id = cfg.line_id and status = 'active';
  v_prof := coalesce(cfg.messaging_profile_id, dc.telnyx_messaging_profile_id);
  for q in select * from app_private.doc_sms_queue where status = 'ready'
           order by updated_at limit least(greatest(coalesce(p_limit, 10), 1), 25) for update skip locked loop
    begin
      if not (coalesce(cfg.enabled, false) and coalesce(dc.enabled, false) and coalesce(dc.sms_enabled, false)) then
        raise exception 'Text messaging was switched off before the send.'; end if;
      if ln.id is null then raise exception 'No active LoadBoot line is set for document texts.'; end if;
      if exists (select 1 from app_private.dialer_sms_optout o where o.number = q.to_number) then
        raise exception 'This number replied STOP before the send.'; end if;
      if not exists (select 1 from app_private.sms_consent c where c.number = q.to_number and c.revoked_at is null) then
        raise exception 'SMS consent was withdrawn before the send.'; end if;

      select * into t from app_private.sms_threads where counterparty = q.to_number;
      if t.id is null then
        insert into app_private.sms_threads (counterparty, carrier_org_id, contact_kind, line_id, last_at)
        values (q.to_number, q.org_id, 'carrier', ln.id, now()) returning * into t;
      end if;
      insert into app_private.dialer_messages (line_id, direction, counterparty, body, status, contact_kind, carrier_org_id, thread_id)
      values (ln.id, 'outbound', q.to_number, app_private.sms_compose(q.body, q.to_number)->>'body', 'queued', 'carrier', q.org_id, t.id)
      returning * into m;
      update app_private.sms_threads
         set last_at = now(), last_body = left(m.body, 300), last_direction = 'outbound', last_outbound_at = now(), updated_at = now()
       where id = t.id;
      update app_private.doc_sms_queue set status = 'sending', message_id = m.id, preview = m.body, updated_at = now() where id = q.id;
      out := out || jsonb_build_object('queue_id', q.id, 'message_id', m.id, 'from', ln.phone_e164, 'to', q.to_number,
                                       'text', m.body, 'messaging_profile_id', v_prof);
    exception when others then
      update app_private.doc_sms_queue set status = 'failed', reason = left(sqlerrm, 300), updated_at = now() where id = q.id;
    end;
  end loop;
  return jsonb_build_object('ok', true, 'items', out);
end $$;

create or replace function public.doc_sms_worker_done(p_queue uuid, p_ok boolean, p_telnyx_id text default null, p_error text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public' as $$
declare q app_private.doc_sms_queue;
begin
  update app_private.doc_sms_queue
     set status = case when p_ok then 'sent' else 'failed' end,
         sent_at = case when p_ok then now() else sent_at end,
         reason = case when p_ok then null else left(coalesce(p_error, 'Send failed.'), 300) end,
         updated_at = now()
   where id = p_queue and status = 'sending' returning * into q;
  if q.id is null then return jsonb_build_object('ok', false, 'error', 'That text is not being sent.'); end if;
  if q.message_id is not null then
    update app_private.dialer_messages
       set status = case when p_ok then 'sent' else 'failed' end,
           telnyx_message_id = coalesce(p_telnyx_id, telnyx_message_id), error = left(p_error, 300), updated_at = now()
     where id = q.message_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- CC carrier page: "SMS sent 10:42" under the decision.
create or replace function public.cc_doc_sms_status(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path to 'app_private', 'public' as $$
declare cfg app_private.doc_sms_config; dc app_private.dialer_config;
begin
  if not public.has_global_permission('compliance.view') then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into cfg from app_private.doc_sms_config where id = 1;
  select * into dc  from app_private.dialer_config where id = 1;
  return jsonb_build_object(
    'switch', jsonb_build_object('doc_sms', coalesce(cfg.enabled, false),
                                 'sms', coalesce(dc.enabled, false) and coalesce(dc.sms_enabled, false),
                                 'test_mode', not coalesce(cfg.allow_all, false)),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', q.id, 'status', q.status, 'kind', q.kind, 'reason', q.reason, 'due_at', q.due_at, 'sent_at', q.sent_at,
               'created_at', q.created_at, 'updated_at', q.updated_at, 'body', q.preview, 'segments', q.segments,
               'msg_status', m.status,
               'to', case when q.to_number is null then null else '***' || right(q.to_number, 4) end,
               'keys', (select coalesce(jsonb_agg(distinct d->>'key'), '[]'::jsonb) from jsonb_array_elements(q.decisions) d))
             order by q.created_at desc)
        from (select * from app_private.doc_sms_queue where org_id = p_org order by created_at desc limit 10) q
        left join app_private.dialer_messages m on m.id = q.message_id), '[]'::jsonb));
end $$;

revoke all on function app_private.sms_segments(text) from public, anon, authenticated;
revoke all on function app_private.sms_clean(text, int) from public, anon, authenticated;
revoke all on function app_private.doc_sms_label(text, text) from public, anon, authenticated;
revoke all on function app_private.doc_sms_note(uuid, text, text, text, uuid) from public, anon, authenticated;
revoke all on function app_private.doc_sms_compose(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function app_private.doc_sms_sweep() from public, anon, authenticated;
revoke all on function public.doc_sms_worker_claim(int) from public, anon, authenticated;
revoke all on function public.doc_sms_worker_done(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.doc_sms_worker_claim(int) to service_role;
grant execute on function public.doc_sms_worker_done(uuid, boolean, text, text) to service_role;
revoke all on function public.cc_doc_sms_status(uuid) from public, anon;
grant execute on function public.cc_doc_sms_status(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Hook: anchor-patch compliance_decision_notify (after the mute check, so bulk/system ops stay silent).
do $p$
declare d text;
  a text := $a$  if coalesce(current_setting('lb.compdec_mute', true), '') = '1' then return; end if;
$a$;
begin
  d := pg_get_functiondef('app_private.compliance_decision_notify(uuid,text,text,text,date,uuid)'::regprocedure);
  if position('doc_sms_note' in d) > 0 then return; end if;
  if position(a in d) = 0 then raise exception 'bl_dial_0540: anchor not found in compliance_decision_notify'; end if;
  d := replace(d, a, a || $b$  -- bl_dial_0540 (N): queue the decision text (debounced; sent by doc_sms_sweep). Never blocks the decision.
  begin perform app_private.doc_sms_note(p_org, p_req_key, p_status, p_note, p_document); exception when others then null; end;
$b$);
  execute d;
end $p$;

do $c$
begin
  if exists (select 1 from cron.job where jobname = 'doc_sms_sweep') then perform cron.unschedule('doc_sms_sweep'); end if;
  perform cron.schedule('doc_sms_sweep', '* * * * *', 'select app_private.doc_sms_sweep()');
end $c$;
