-- bl_comp_0503 — COI "approved, agent copy pending" (owner decision, 30 Sep 2026)
--
-- A certificate the CARRIER forwarded (name changed to LoadBoot LLC, printed to PDF, no edit
-- trail to inspect) can be approved so the account goes live, while the insurance AGENT is
-- asked to email the same ACORD 25 straight to hello@loadboot.com. Owner's rules:
--   * window 14 days; reminder e-mails on day 5 and day 12
--   * no copy by day 14 -> COI back to 'pending' (carrier_mandatory_ok() goes false, so
--     booking/matching stop) and the carrier is unpublished from brokers
--   * publishing to brokers during the window stays manual (nothing here publishes)
-- Staff: CC Carrier 360 -> Verify on the COI -> "Approve · agent copy pending";
--        banner -> "Agent copy received" once the agent's e-mail arrives.
-- Additive: new columns default off, the only change to an existing function is a
-- one-line opt-out (lb.compdec_mute) in compliance_decision_notify, so this path sends ONE
-- mail ("approved + one step left") instead of "approved" followed by a second request.

alter table app_private.carrier_compliance
  add column if not exists agent_copy_pending      boolean  not null default false,
  add column if not exists agent_copy_due          date,
  add column if not exists agent_copy_agent        text,
  add column if not exists agent_copy_requested_at timestamptz,
  add column if not exists agent_copy_reminders    smallint not null default 0,
  add column if not exists agent_copy_verified_at  timestamptz;

-- 1. One-transaction mute for the stock decision mail (anchor patch, idempotent).
do $mig$
declare d text; a text := $a$if p_status not in ('valid','rejected') then return; end if;$a$;
begin
  d := pg_get_functiondef('app_private.compliance_decision_notify(uuid,text,text,text,date,uuid)'::regprocedure);
  if position('lb.compdec_mute' in d) = 0 then
    if position(a in d) = 0 then raise exception 'bl_comp_0503: anchor not found in compliance_decision_notify'; end if;
    d := replace(d, a, a || E'\n  if coalesce(current_setting(''lb.compdec_mute'', true), '''') = ''1'' then return; end if;');
    execute d;
  end if;
end $mig$;

create or replace function app_private.agent_copy_esc(t text) returns text
language sql immutable as $$
  select replace(replace(replace(coalesce(t,''),'&','&amp;'),'<','&lt;'),'>','&gt;')
$$;

-- 2. The three carrier mails (request / reminder / hold) + matching in-app notices.
create or replace function app_private.agent_copy_mail(p_org uuid, p_req text, p_kind text)
returns int language plpgsql security definer set search_path = app_private, public as $$
declare
  c app_private.carrier_compliance; m record; n int := 0;
  v_name text; v_org text; v_due text; v_days int; v_agent text; v_box text; v_boxt text;
  v_tpl text; v_sub text; v_html text; v_txt text; v_title text; v_body text; v_tone text; v_key text;
begin
  if p_kind not in ('request','reminder','hold') then raise exception 'bad kind %', p_kind; end if;
  select * into c from app_private.carrier_compliance where carrier_id = p_org and requirement_key = p_req;
  if c.id is null or c.agent_copy_due is null then return 0; end if;
  select cr.name into v_name from app_private.compliance_requirements cr where cr.key = p_req;
  v_name  := coalesce(v_name, 'Certificate of insurance');
  select o.name into v_org from public.organizations o where o.id = p_org;
  v_due   := to_char(c.agent_copy_due, 'FMMonth FMDD, YYYY');
  v_days  := greatest(c.agent_copy_due - current_date, 0);
  v_agent := coalesce(nullif(btrim(c.agent_copy_agent), ''), 'your insurance agent');

  v_boxt := 'Hi, please email a copy of our current Certificate of Insurance (ACORD 25) directly to hello@loadboot.com.'
         || E'\n\nCertificate holder:\nLoadBoot LLC\n30 N Gould St Ste N\nSheridan, WY 82801'
         || E'\n\nInsured: ' || coalesce(v_org, 'our company') || E'\nThank you!';
  v_box := '<div style="background:#f1f6ff;border:1px solid #cfe0ff;border-radius:12px;padding:14px 16px;margin:0 0 18px">'
        || '<div style="font-size:11px;font-weight:800;letter-spacing:.08em;color:#0b5cc4;text-transform:uppercase;margin-bottom:6px">Copy &amp; send this to '
        || app_private.agent_copy_esc(v_agent) || '</div>'
        || '<div style="color:#10223B;white-space:pre-wrap">' || app_private.agent_copy_esc(v_boxt) || '</div></div>';

  if p_kind = 'request' then
    v_tpl   := 'document.agent_copy.request';
    v_title := v_name || ' approved — one quick step left';
    v_sub   := v_name || ' approved ✓ — one quick step left';
    v_tone  := 'success';
    v_body  := 'Ask ' || v_agent || ' to email the certificate to hello@loadboot.com by ' || v_due || '.';
    v_html  := '<h2 style="margin:0 0 4px;font-size:21px;color:#0f172a">' || app_private.agent_copy_esc(v_name) || ' approved &#10003;</h2>'
      || '<p style="margin:0 0 16px;color:#51617a">' || app_private.agent_copy_esc(coalesce(v_org,'Your account')) || '</p>'
      || '<p style="margin:0 0 14px">Your certificate is approved and your account can move forward. One quick step is left: we need the same certificate sent to us <b>directly by '
      || app_private.agent_copy_esc(v_agent) || '</b>. It is free, it takes them a couple of minutes, and it is how brokers confirm coverage is real.</p>'
      || v_box
      || '<p style="margin:0 0 14px">Please have it reach <b>hello@loadboot.com</b> by <b>' || v_due || '</b>. If it has not arrived by then, your insurance goes back into review and bookings pause until it does.</p>'
      || '<p style="margin:0;color:#51617a;font-size:13px">Questions? {{contact_inline}}</p>';
  elsif p_kind = 'reminder' then
    v_tpl   := 'document.agent_copy.reminder';
    v_title := 'Reminder: your agent''s copy of the insurance certificate';
    v_sub   := 'Reminder — ' || v_days || ' day' || case when v_days = 1 then '' else 's' end || ' left for your agent to email your insurance certificate';
    v_tone  := 'info';
    v_body  := v_days || ' day(s) left — ' || v_agent || ' needs to email the certificate to hello@loadboot.com.';
    v_html  := '<h2 style="margin:0 0 4px;font-size:21px;color:#0f172a">We still need your agent''s copy</h2>'
      || '<p style="margin:0 0 16px;color:#51617a">' || app_private.agent_copy_esc(coalesce(v_org,'Your account')) || ' &middot; due ' || v_due || '</p>'
      || '<p style="margin:0 0 14px">Your ' || app_private.agent_copy_esc(v_name) || ' is approved, but the copy from <b>' || app_private.agent_copy_esc(v_agent)
      || '</b> has not reached hello@loadboot.com yet. You have <b>' || v_days || ' day' || case when v_days = 1 then '' else 's' end || '</b> left. Forward them this:</p>'
      || v_box
      || '<p style="margin:0;color:#51617a;font-size:13px">Already sent? Reply to this e-mail and we will look for it. {{contact_inline}}</p>';
  else
    v_tpl   := 'document.agent_copy.hold';
    v_title := 'Insurance on hold — agent copy not received';
    v_sub   := 'Action needed — your insurance is back in review';
    v_tone  := 'urgent';
    v_body  := 'The agent''s copy did not arrive by ' || v_due || '. Bookings are paused until it does.';
    v_html  := '<h2 style="margin:0 0 4px;font-size:21px;color:#0f172a">Your insurance is back in review</h2>'
      || '<p style="margin:0 0 16px;color:#51617a">' || app_private.agent_copy_esc(coalesce(v_org,'Your account')) || '</p>'
      || '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:14px 16px;margin:0 0 18px;color:#7f1d1d;font-weight:600">'
      || 'We did not receive the certificate from ' || app_private.agent_copy_esc(v_agent) || ' by ' || v_due
      || ', so your ' || app_private.agent_copy_esc(v_name) || ' is back in review and bookings are paused.</div>'
      || '<p style="margin:0 0 14px">The moment your agent emails it to <b>hello@loadboot.com</b>, we re-approve it and you are back on. Send them this:</p>'
      || v_box
      || '<p style="margin:0;color:#51617a;font-size:13px">{{contact_inline}}</p>';
  end if;
  v_txt := v_title || '. ' || v_body || E'\n\n' || v_boxt;
  v_key := 'agentcopy:' || p_kind || ':' || c.agent_copy_reminders || ':' || p_org::text || ':' || p_req || ':' || to_char(now(), 'YYYYMMDD');

  for m in select u.id as uid, u.email from public.organization_memberships om
           join auth.users u on u.id = om.user_id
           where om.org_id = p_org and om.status = 'active' and u.email is not null limit 3
  loop
    begin
      insert into app_private.notifications(recipient_role, recipient_user, channel, template_key, payload, status, sent_at)
      values ('carrier', m.uid, 'in_app', v_tpl,
        jsonb_build_object('title', case when v_tone='urgent' then '⚠ ' else '⏳ ' end || v_title,
                           'body', v_body, 'tone', v_tone, 'url', '/app/carrier/#documents'), 'sent', now());
    exception when others then null; end;
    begin
      perform app_private.sys_email(m.email, v_tpl, v_sub, v_html, v_txt, v_key || ':' || m.email);
      n := n + 1;
    exception when others then null; end;
  end loop;
  return n;
end $$;

-- 3. Staff: approve now, agent copy pending.
create or replace function public.cc_compliance_approve_agent_copy(
  p_carrier uuid, p_requirement_key text, p_expiry date,
  p_agent text default null, p_note text default null, p_days int default 14)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v text; v_due date; v_sent int;
begin
  if not public.has_global_permission('compliance.verify') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_expiry is null then raise exception 'Enter the policy expiry date from the certificate first.' using errcode='22023'; end if;
  if p_days is null or p_days < 3 or p_days > 45 then raise exception 'The window must be 3–45 days.' using errcode='22023'; end if;
  perform set_config('lb.compdec_mute', '1', true);
  v := public.cc_set_compliance(p_carrier, p_requirement_key, 'valid', p_expiry,
         coalesce(nullif(btrim(p_note), ''), 'Approved — waiting for the insurance agent''s own copy by e-mail.'));
  perform set_config('lb.compdec_mute', '', true);
  if v <> 'valid' then
    raise exception 'The certificate is % (expiry date in the past) — it cannot be approved.', v using errcode='22023';
  end if;
  v_due := current_date + p_days;
  update app_private.carrier_compliance
     set agent_copy_pending = true, agent_copy_due = v_due, agent_copy_agent = nullif(btrim(p_agent), ''),
         agent_copy_requested_at = now(), agent_copy_reminders = 0, agent_copy_verified_at = null
   where carrier_id = p_carrier and requirement_key = p_requirement_key;
  v_sent := app_private.agent_copy_mail(p_carrier, p_requirement_key, 'request');
  perform app_private.log_audit('compliance.agent_copy_requested', 'carrier', p_carrier::text, null,
     format('%s approved; agent copy due %s', p_requirement_key, v_due),
     jsonb_build_object('requirement', p_requirement_key, 'due', v_due, 'agent', p_agent, 'mails', v_sent));
  return jsonb_build_object('ok', true, 'status', v, 'due', v_due, 'mails', v_sent);
end $$;

-- 4. Staff: the agent's e-mail arrived.
create or replace function public.cc_compliance_agent_copy_received(
  p_carrier uuid, p_requirement_key text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
begin
  if not public.has_global_permission('compliance.verify') then raise exception 'not authorized' using errcode='42501'; end if;
  update app_private.carrier_compliance
     set agent_copy_pending = false, agent_copy_verified_at = now(), updated_at = now(),
         note = coalesce(nullif(btrim(p_note), ''), 'Verified — copy received directly from the insurance agent.')
   where carrier_id = p_carrier and requirement_key = p_requirement_key and agent_copy_pending;
  if not found then raise exception 'Nothing is waiting for an agent copy on this item.' using errcode='22023'; end if;
  perform app_private.log_audit('compliance.agent_copy_received', 'carrier', p_carrier::text, null,
     format('%s — agent copy received', p_requirement_key), jsonb_build_object('requirement', p_requirement_key));
  return jsonb_build_object('ok', true);
end $$;

-- 5. Staff: what is waiting (one carrier, or all when p_carrier is null).
create or replace function public.cc_agent_copy_list(p_carrier uuid default null)
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare v jsonb;
begin
  if not public.has_global_permission('compliance.verify') then raise exception 'not authorized' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'carrier', c.carrier_id, 'carrier_name', o.name, 'requirement', c.requirement_key,
           'due', c.agent_copy_due, 'days_left', c.agent_copy_due - current_date, 'agent', c.agent_copy_agent,
           'requested_at', c.agent_copy_requested_at, 'reminders', c.agent_copy_reminders) order by c.agent_copy_due), '[]'::jsonb)
    into v
    from app_private.carrier_compliance c join public.organizations o on o.id = c.carrier_id
   where c.agent_copy_pending and c.status = 'valid' and (p_carrier is null or c.carrier_id = p_carrier);
  return v;
end $$;

-- 6. Daily tick: reminders day 5 + day 12, hold on the due date.
create or replace function app_private.agent_copy_tick()
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare r record; n_rem int := 0; n_hold int := 0; n_clr int := 0;
begin
  -- Someone re-decided the item another way (rejected / re-uploaded): the wait is over.
  update app_private.carrier_compliance set agent_copy_pending = false
   where agent_copy_pending and status <> 'valid';
  get diagnostics n_clr = row_count;

  for r in select * from app_private.carrier_compliance where agent_copy_pending and status = 'valid' loop
    if current_date >= r.agent_copy_due then
      update app_private.carrier_compliance
         set status = 'pending', agent_copy_pending = false, updated_at = now(),
             note = 'On hold — the insurance agent''s copy did not reach hello@loadboot.com by '
                    || to_char(r.agent_copy_due, 'Mon DD, YYYY') || '. Approve again once it arrives.'
       where id = r.id;
      update public.organizations set broker_visible = false where id = r.carrier_id and broker_visible;
      perform app_private.agent_copy_mail(r.carrier_id, r.requirement_key, 'hold');
      perform app_private.log_audit('compliance.agent_copy_hold', 'carrier', r.carrier_id::text, null,
         format('%s back to pending — agent copy not received by %s; unpublished from brokers', r.requirement_key, r.agent_copy_due),
         jsonb_build_object('requirement', r.requirement_key, 'due', r.agent_copy_due));
      perform app_private.emit_event('compliance.updated', 'carrier', r.carrier_id::text,
         jsonb_build_object('requirement', r.requirement_key, 'status', 'pending', 'reason', 'agent_copy_missing'));
      n_hold := n_hold + 1;
    elsif (r.agent_copy_reminders = 0 and current_date >= least(r.agent_copy_requested_at::date + 5, r.agent_copy_due - 2))
       or (r.agent_copy_reminders = 1 and current_date >= r.agent_copy_due - 2) then
      update app_private.carrier_compliance set agent_copy_reminders = agent_copy_reminders + 1 where id = r.id;
      perform app_private.agent_copy_mail(r.carrier_id, r.requirement_key, 'reminder');
      n_rem := n_rem + 1;
    end if;
  end loop;
  return jsonb_build_object('cleared', n_clr, 'reminders', n_rem, 'holds', n_hold);
end $$;

-- 7. Surface: nothing new for anon (baseline stays 36/35).
revoke all on function app_private.agent_copy_esc(text) from public, anon, authenticated;
revoke all on function app_private.agent_copy_mail(uuid,text,text) from public, anon, authenticated;
revoke all on function app_private.agent_copy_tick() from public, anon, authenticated;
revoke all on function public.cc_compliance_approve_agent_copy(uuid,text,date,text,text,int) from public, anon;
revoke all on function public.cc_compliance_agent_copy_received(uuid,text,text) from public, anon;
revoke all on function public.cc_agent_copy_list(uuid) from public, anon;
grant execute on function public.cc_compliance_approve_agent_copy(uuid,text,date,text,text,int) to authenticated;
grant execute on function public.cc_compliance_agent_copy_received(uuid,text,text) to authenticated;
grant execute on function public.cc_agent_copy_list(uuid) to authenticated;

-- 8. Email catalog (CLAUDE.md §6 — every email is registered).
insert into app_private.email_catalog (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note, stop_condition, preference_group, unsub_allowed, cc_deep_link, status, send_mode)
values
 ('document.agent_copy.request', 'COI approved — agent copy requested',
  'Tells the carrier the COI is approved and asks them to have their insurance agent e-mail the same certificate to hello@ within the window.',
  'T', 'carrier', 'manual', 'public.cc_compliance_approve_agent_copy', 'once per approval', 'one per approval per day (idempotency key)',
  'sent once', 'compliance', false, '#/documents', 'live', 'live'),
 ('document.agent_copy.reminder', 'Agent copy reminder',
  'Reminds the carrier that the insurance agent''s copy has not reached hello@ yet.',
  'T', 'carrier', 'cron', 'app_private.agent_copy_tick (lb-agent-copy-tick, daily)', 'day 5 and day 12 of the window', 'max 2 per approval',
  'agent copy received, item re-decided, or hold', 'compliance', false, '#/documents', 'live', 'live'),
 ('document.agent_copy.hold', 'Insurance on hold — agent copy missing',
  'COI moved back to pending (bookings paused, unpublished from brokers) because the agent''s copy did not arrive by the due date.',
  'T', 'carrier', 'cron', 'app_private.agent_copy_tick (lb-agent-copy-tick, daily)', 'once, on the due date', 'one per approval',
  'sent once', 'compliance', false, '#/documents', 'live', 'live')
on conflict (key) do nothing;

-- 9. Daily at 15:07 UTC (morning in the US).
select cron.schedule('lb-agent-copy-tick', '7 15 * * *', $$select app_private.agent_copy_tick()$$);
