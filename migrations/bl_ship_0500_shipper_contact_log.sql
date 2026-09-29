-- bl_ship_0500 — shipper contact log: every contact between LoadBoot and a shipper, in one audit trail (29 Sep 2026).
-- Owner: "baki sub suggest and implement". Follows 0499 (LoadBoot never talks rates with a shipper).
--
-- Why: 0499 blocks rate talk on every text channel, but nothing RECORDED what LoadBoot did say to a shipper. If
-- FMCSA (88 FR 39368, IV.F) or a dispute asks "did your dispatch negotiate with the shipper?", the answer must be
-- a list, not a belief. Voice calls cannot be content-checked, so a staff call with a shipper is at least logged
-- here (who, when, how long, recording or not).
--
-- 1. app_private.shipper_contact_log — one row per message/call with a shipper contact (or a prospect shipper in
--    live chat). Resolver = app_private.shipper_org_for_contact (0499), same as the guard.
--    Channels: CC mail (mail_messages; outbound only once status = 'sent'), SMS (dialer_messages), WhatsApp
--    (wa_messages), CC threads on a shipper's load (comm_messages; internal notes skipped), live chat (lc_messages,
--    bot + staff + visitor), staff phone calls (dialer_calls; updated as the call ends).
--    Inbound rows carry rate_flag when the SHIPPER raised a rate — the reply must not discuss it.
-- 2. AFTER triggers: they only see rows the 0499 BEFORE guard let through. A failure to log never blocks the send
--    (raise warning instead). Refused attempts are NOT here: the guard's exception rolls back the whole
--    transaction, and this database has no autonomous-transaction route (no dblink / pg_background).
-- 3. Backfill: the last 90 days.
-- 4. cc_partner_360 → comms.contact_log (latest 50 + total), shown in CC → Shipper 360 → Comms → "LoadBoot contact".
--
-- Not covered: Riley (Retell AI) calls and the dmail edge-function mailboxes unless they write mail_messages.
-- No new public function, no anon grant: the anon SECURITY DEFINER baseline stays 36 (prod) / 35 (staging).

create table if not exists app_private.shipper_contact_log (
  id          bigint generated always as identity primary key,
  org_id      uuid references public.organizations(id) on delete set null,  -- null = prospect shipper (live chat)
  channel     text not null check (channel in ('mail','sms','whatsapp','thread','live_chat','call')),
  direction   text not null check (direction in ('in','out')),
  actor       text not null check (actor in ('staff','bot','shipper','system')),
  staff_user  uuid,
  counterparty text,
  summary     text,
  rate_flag   text,
  src_table   text not null,
  src_id      text not null,
  occurred_at timestamptz not null,
  logged_at   timestamptz not null default now(),
  unique (src_table, src_id)
);
create index if not exists shipper_contact_log_org_idx on app_private.shipper_contact_log (org_id, occurred_at desc);
alter table app_private.shipper_contact_log enable row level security;
revoke all on app_private.shipper_contact_log from public, anon, authenticated;

create or replace function app_private.shipper_contact_capture(p_src text, r jsonb)
returns void language plpgsql security definer set search_path = app_private, public as $$
declare v_org uuid; v_prospect boolean := false; v_ch text; v_dir text; v_staff uuid; v_actor text; v_cp text; v_sum text;
  v_flag text; v_at timestamptz; v_type text; v_rel text; c record;
begin
  v_at := coalesce((r->>'created_at')::timestamptz, now());
  if p_src = 'mail_messages' then
    v_ch := 'mail'; v_dir := case when r->>'direction' = 'in' then 'in' else 'out' end;
    if v_dir = 'out' and coalesce(r->>'status', '') <> 'sent' then return; end if;   -- drafts / queued / failed never reached anyone
    v_cp := r->>'peer_email'; v_org := app_private.shipper_org_for_contact(v_cp, null);
    v_staff := coalesce((r->>'sent_by')::uuid, (r->>'created_by')::uuid);
    v_at := coalesce((r->>'sent_at')::timestamptz, v_at);
    v_sum := coalesce(nullif(r->>'subject', ''), '(no subject)') || ' — '
          || coalesce(nullif(r->>'body_text', ''), regexp_replace(coalesce(r->>'body_html', ''), '<[^>]*>', ' ', 'g'));
  elsif p_src = 'dialer_messages' then
    v_ch := 'sms'; v_dir := case when r->>'direction' = 'inbound' then 'in' else 'out' end;
    v_cp := r->>'counterparty'; v_org := app_private.shipper_org_for_contact(null, v_cp);
    v_staff := (r->>'dispatcher_user_id')::uuid; v_sum := r->>'body';
  elsif p_src = 'wa_messages' then
    v_ch := 'whatsapp'; v_dir := case when r->>'direction' = 'inbound' then 'in' else 'out' end;
    select t.counterparty into v_cp from app_private.wa_threads t where t.id = (r->>'thread_id')::uuid;
    v_org := app_private.shipper_org_for_contact(null, v_cp);
    v_staff := (r->>'sender_user_id')::uuid; v_sum := coalesce(nullif(r->>'body', ''), 'template: ' || (r->>'template_name'));
  elsif p_src = 'comm_messages' then
    if coalesce(r->>'direction', '') not in ('inbound', 'outbound') then return; end if;   -- internal notes are not contact
    v_ch := 'thread'; v_dir := case when r->>'direction' = 'inbound' then 'in' else 'out' end;
    select t.related_type, t.related_id into v_type, v_rel from app_private.comm_threads t where t.id = (r->>'thread_id')::uuid;
    if v_type = 'load' and v_rel ~* '^[0-9a-f-]{36}$' and app_private.is_shipper_load(v_rel::uuid) then
      v_org := (select l.broker_org from public.loads l where l.id = v_rel::uuid);
    end if;
    v_cp := 'load ' || coalesce(v_rel, '?'); v_staff := (r->>'author_user')::uuid; v_sum := r->>'body';
  elsif p_src = 'lc_messages' then
    if coalesce(r->>'sender', '') not in ('visitor', 'staff', 'bot') then return; end if;
    v_ch := 'live_chat'; v_dir := case when r->>'sender' = 'visitor' then 'in' else 'out' end;
    select * into c from app_private.lc_conversations lc where lc.id = (r->>'conversation_id')::uuid;
    v_org := coalesce(
      (select om.org_id from public.organization_memberships om join public.organizations o on o.id = om.org_id
        where om.user_id = c.user_id and om.status = 'active' and o.kind = 'shipper' limit 1),
      app_private.shipper_org_for_contact(c.email, null));
    v_prospect := v_org is null and c.visitor_role = 'shipper';
    v_cp := coalesce(c.email, c.name, 'visitor ' || left(coalesce(c.visitor_key, ''), 8));
    v_staff := (r->>'staff_id')::uuid; v_sum := r->>'body';
    if r->>'sender' = 'bot' then v_actor := 'bot'; end if;
  elsif p_src = 'dialer_calls' then
    v_ch := 'call'; v_dir := case when r->>'direction' = 'inbound' then 'in' else 'out' end;
    v_cp := coalesce(nullif(r->>'counterparty', ''), case when v_dir = 'in' then r->>'from_number' else r->>'to_number' end);
    v_org := app_private.shipper_org_for_contact(null, v_cp);
    v_staff := (r->>'dispatcher_user_id')::uuid;
    v_at := coalesce((r->>'started_at')::timestamptz, v_at);
    v_sum := 'call · ' || coalesce(r->>'status', '?')
          || case when (r->>'duration_sec') is not null then ' · ' || ((r->>'duration_sec')::int / 60) || 'm ' || ((r->>'duration_sec')::int % 60) || 's' else '' end
          || case when jsonb_typeof(r->'recording') = 'object' and r->'recording' <> '{}'::jsonb then ' · recorded' else ' · no recording' end
          || coalesce(' · outcome: ' || nullif(r->>'outcome', ''), '') || coalesce(' · note: ' || nullif(r->>'note', ''), '');
  else
    return;
  end if;

  if v_org is null and not v_prospect then return; end if;
  if v_dir = 'in' then
    v_actor := 'shipper'; v_staff := null;
    if v_ch <> 'call' then v_flag := app_private.rate_talk_reason(v_sum, v_ch = 'mail'); end if;
  elsif v_actor is null then
    v_actor := case when v_staff is null then 'system' else 'staff' end;
  end if;

  insert into app_private.shipper_contact_log(org_id, channel, direction, actor, staff_user, counterparty, summary, rate_flag, src_table, src_id, occurred_at)
  values (v_org, v_ch, v_dir, v_actor, v_staff, v_cp, left(btrim(regexp_replace(coalesce(v_sum, ''), '\s+', ' ', 'g')), 500), v_flag,
          p_src, r->>'id', v_at)
  on conflict (src_table, src_id) do update
    set summary = excluded.summary, occurred_at = excluded.occurred_at, rate_flag = excluded.rate_flag,
        org_id = coalesce(excluded.org_id, shipper_contact_log.org_id),
        staff_user = coalesce(excluded.staff_user, shipper_contact_log.staff_user);
end $$;

create or replace function app_private.trg_shipper_contact_log()
returns trigger language plpgsql security definer set search_path = app_private, public as $$
begin
  begin
    perform app_private.shipper_contact_capture(TG_TABLE_NAME, to_jsonb(NEW));
  exception when others then
    raise warning 'bl_ship_0500 shipper_contact_log %.%: %', TG_TABLE_NAME, NEW.id, sqlerrm;   -- never block the send
  end;
  return null;
end $$;

revoke execute on function app_private.shipper_contact_capture(text, jsonb) from public, anon, authenticated;
revoke execute on function app_private.trg_shipper_contact_log() from public, anon, authenticated;

drop trigger if exists shipper_contact_log on app_private.mail_messages;
create trigger shipper_contact_log after insert or update of status on app_private.mail_messages
  for each row execute function app_private.trg_shipper_contact_log();
drop trigger if exists shipper_contact_log on app_private.dialer_messages;
create trigger shipper_contact_log after insert on app_private.dialer_messages
  for each row execute function app_private.trg_shipper_contact_log();
drop trigger if exists shipper_contact_log on app_private.wa_messages;
create trigger shipper_contact_log after insert on app_private.wa_messages
  for each row execute function app_private.trg_shipper_contact_log();
drop trigger if exists shipper_contact_log on app_private.comm_messages;
create trigger shipper_contact_log after insert on app_private.comm_messages
  for each row execute function app_private.trg_shipper_contact_log();
drop trigger if exists shipper_contact_log on app_private.lc_messages;
create trigger shipper_contact_log after insert on app_private.lc_messages
  for each row execute function app_private.trg_shipper_contact_log();
drop trigger if exists shipper_contact_log on app_private.dialer_calls;
create trigger shipper_contact_log after insert or update of status, ended_at, duration_sec, recording, outcome, note on app_private.dialer_calls
  for each row execute function app_private.trg_shipper_contact_log();

-- ───────────── backfill: last 90 days ─────────────
do $bf$
begin
  perform app_private.shipper_contact_capture('mail_messages', to_jsonb(m)) from app_private.mail_messages m where m.created_at > now() - interval '90 days';
  perform app_private.shipper_contact_capture('dialer_messages', to_jsonb(m)) from app_private.dialer_messages m where m.created_at > now() - interval '90 days';
  perform app_private.shipper_contact_capture('wa_messages', to_jsonb(m)) from app_private.wa_messages m where m.created_at > now() - interval '90 days';
  perform app_private.shipper_contact_capture('comm_messages', to_jsonb(m)) from app_private.comm_messages m where m.created_at > now() - interval '90 days';
  perform app_private.shipper_contact_capture('lc_messages', to_jsonb(m)) from app_private.lc_messages m where m.created_at > now() - interval '90 days';
  perform app_private.shipper_contact_capture('dialer_calls', to_jsonb(m)) from app_private.dialer_calls m where m.created_at > now() - interval '90 days';
end $bf$;

-- ───────────── CC: cc_partner_360 → comms.contact_log ─────────────
-- Alias xs, not pr: cc_partner_360 already has a PL/pgSQL record variable named pr (caught by the staging test).
do $do$
declare d text;
  a1 text := $a$      'staff_notices', coalesce((select jsonb_agg(jsonb_build_object('key', n.template_key,$a$;
begin
  d := pg_get_functiondef('public.cc_partner_360(uuid)'::regprocedure);
  if position('bl_ship_0500' in d) = 0 then
    if position(a1 in d) = 0 then raise exception 'bl_ship_0500: cc_partner_360 anchor not found'; end if;
    execute replace(d, a1, $b$      'contact_log', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'channel', x.channel, 'direction', x.direction,   -- bl_ship_0500
          'actor', x.actor, 'staff', coalesce(nullif(xs.contact_name, ''), xs.email), 'counterparty', x.counterparty, 'summary', x.summary,
          'rate_flag', x.rate_flag, 'at', x.occurred_at) order by x.occurred_at desc)
        from (select * from app_private.shipper_contact_log where org_id = p_org order by occurred_at desc limit 50) x
        left join public.profiles xs on xs.id = x.staff_user), '[]'::jsonb),
      'contact_log_total', (select count(*) from app_private.shipper_contact_log where org_id = p_org),
$b$ || a1);
  end if;
end $do$;
