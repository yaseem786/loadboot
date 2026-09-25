-- bl_disp_0443 — Carrier report → permanent block, and the contact rule in both portals (owner, 25 Sep 2026)
--
-- Owner decisions (25 Sep 2026, on top of bl_disp_0442 "Choose your carrier"):
--   * Before Command Center accepts a choice the candidate sees NO carrier identity (name, contact, MC/DOT) —
--     only the operation and the AGE of the authority. Done in 0442 (disp_carrier_label + p_full gating).
--   * The dispatcher portal states the contact rule as terms, accepted before the first choice (0442:
--     dispatcher_accept_conduct_terms) and repeated in the trial e-mail (this file, §7).
--   * The carrier portal warns: your dispatcher reaches you ONLY from the LoadBoot line / LoadBoot group; any other
--     number, WhatsApp or e-mail → report it here; contact outside LoadBoot is not covered by LoadBoot.
--     A report goes to Command Center; UPHOLD = same-day suspension + permanent block (no reinstate, no re-apply),
--     the assignment ends, the carrier is free for a replacement. DISMISS = the carrier is told, nothing changes.
--   * The candidates who already passed before 0442 shipped get ONE e-mail that the tab is open (§9, run by hand
--     after the front-end deploy — never from the migration, the tab must exist first).
--
-- Objects: dispatcher_profiles.blocked_at/blocked_reason · app_private.dispatcher_reports ·
--          public.carrier_report_dispatcher · public.cc_dispatcher_reports · public.cc_dispatcher_report_decide ·
--          anchor patches: cc_dispatcher_decide (no reinstate when blocked), dispatcher_reapply (no re-apply when
--          blocked), disp_trial_email (contact rule box), disp_assign_email_html (carrier warning box) ·
--          app_private.disp_choice_backfill_email · 6 catalog rows.
-- Anon SECURITY DEFINER surface: unchanged (every new public function is revoked from public, anon).

-- ---------------------------------------------------------------- 1. the block flag
alter table app_private.dispatcher_profiles add column if not exists blocked_at     timestamptz;
alter table app_private.dispatcher_profiles add column if not exists blocked_reason text;

-- ---------------------------------------------------------------- 2. carrier reports
create table if not exists app_private.dispatcher_reports (
  id                 uuid primary key default gen_random_uuid(),
  carrier_org_id     uuid not null references public.organizations(id) on delete cascade,
  dispatcher_user_id uuid not null references auth.users(id) on delete cascade,
  assignment_id      uuid,
  reported_by        uuid,
  kind               text not null check (kind in ('off_platform_contact','asked_personal_contact','off_platform_offer','other')),
  channel            text,          -- call / sms / whatsapp / email / social / other (free text, ≤40)
  contact_seen       text,          -- the number / handle / address the carrier was contacted from
  detail             text,
  status             text not null default 'open' check (status in ('open','reviewing','upheld','dismissed')),
  decided_by         uuid,
  decided_at         timestamptz,
  decision_note      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists dispatcher_reports_status_idx on app_private.dispatcher_reports (status, created_at desc);
create index if not exists dispatcher_reports_dispatcher_idx on app_private.dispatcher_reports (dispatcher_user_id, created_at desc);
alter table app_private.dispatcher_reports enable row level security;

create or replace function app_private.disp_report_kind_label(p_kind text) returns text
language sql immutable as $$
  select case p_kind
    when 'off_platform_contact'   then 'Contacted from a number or account that is not LoadBoot'
    when 'asked_personal_contact' then 'Asked for a personal number, WhatsApp or e-mail'
    when 'off_platform_offer'     then 'Offered to work outside LoadBoot'
    else 'Other conduct concern' end
$$;
revoke all on function app_private.disp_report_kind_label(text) from public, anon;

-- ---------------------------------------------------------------- 3. carrier: report the dispatcher
create or replace function public.carrier_report_dispatcher(p_kind text, p_channel text default null, p_contact text default null, p_detail text default null) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_org uuid := app_private.my_carrier_org(); v_a record; v_id uuid; v_cname text; v_dname text; v_kind text; v_detail text;
        v_contact text; v_channel text; v_open int; v_label text; v_line text;
        v_staff text := app_private.disp_contact()->>'email'; v_mail text; v_html text; v_text text; v_cc_url text;
begin
  if auth.uid() is null or v_org is null then return jsonb_build_object('error','not authorized'); end if;
  v_kind := case when p_kind in ('off_platform_contact','asked_personal_contact','off_platform_offer','other') then p_kind end;
  if v_kind is null then return jsonb_build_object('error','pick what happened'); end if;
  v_detail  := nullif(left(btrim(coalesce(p_detail,'')), 2000), '');
  v_contact := nullif(left(btrim(coalesce(p_contact,'')), 120), '');
  v_channel := nullif(left(btrim(coalesce(p_channel,'')), 40), '');
  if v_detail is null and v_contact is null then
    return jsonb_build_object('error','Tell us the number or account you were contacted from, or what happened — one line is enough.'); end if;
  select * into v_a from app_private.dispatcher_assignments
   where carrier_org_id = v_org and (status in ('active','paused') or ended_at > now() - interval '90 days')
   order by (status <> 'ended') desc, assigned_at desc nulls last limit 1;
  if v_a.id is null then return jsonb_build_object('error','no dispatcher has been assigned to this carrier'); end if;
  select count(*) into v_open from app_private.dispatcher_reports where assignment_id = v_a.id and status in ('open','reviewing');
  if v_open >= 3 then return jsonb_build_object('error','You already have ' || v_open || ' open reports on this dispatcher — LoadBoot is reviewing them.'); end if;

  select name into v_cname from public.organizations where id = v_org;
  select full_name into v_dname from app_private.dispatcher_profiles where user_id = v_a.dispatcher_user_id;
  select phone_e164 into v_line from app_private.dialer_lines where dispatcher_user_id = v_a.dispatcher_user_id and status = 'active' order by created_at limit 1;
  insert into app_private.dispatcher_reports (carrier_org_id, dispatcher_user_id, assignment_id, reported_by, kind, channel, contact_seen, detail)
  values (v_org, v_a.dispatcher_user_id, v_a.id, auth.uid(), v_kind, v_channel, v_contact, v_detail) returning id into v_id;
  v_label := app_private.disp_report_kind_label(v_kind);
  v_cc_url := 'https://loadboot.com/app/command-center/#/dispatcher?id=' || v_a.dispatcher_user_id::text || '&tab=carriers';

  -- ---- Command Center: in-app card + branded e-mail to the dispatch inbox
  perform app_private.disp_notify(null, 'staff', 'dispatcher.report.staff',
    coalesce(v_cname,'A carrier') || ' reported ' || coalesce(v_dname,'their dispatcher') || ' — ' || lower(v_label),
    coalesce('Contact seen: ' || v_contact || E'\n', '') || coalesce(v_detail || E'\n', '')
      || 'Uphold in Command Center = same-day suspension + permanent block. Dismiss = the carrier is told, nothing changes.',
    '/app/command-center/#/dispatcher?id=' || v_a.dispatcher_user_id::text || '&tab=carriers', false);
  v_html := '<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.65">'
    || app_private.disp_head('LoadBoot Dispatch &middot; Carrier report', app_private.disp_esc(coalesce(v_cname,'A carrier')) || ' reported ' || app_private.disp_esc(coalesce(v_dname,'their dispatcher')))
    || '<p style="margin:0 0 14px">A carrier used <b>Report a contact</b> in their Dispatcher tab. Nothing has changed yet &mdash; Command Center decides.</p>'
    || app_private.disp_strip('Carrier', app_private.disp_esc(coalesce(v_cname,'—')), 'Dispatcher', app_private.disp_esc(coalesce(v_dname,'—'))
         || coalesce('<div style="font-size:10.5px;letter-spacing:.12em;color:#8ea2c3;font-weight:700;margin-top:2px">LOADBOOT LINE ' || app_private.disp_esc(app_private.disp_fmt_us(v_line)) || '</div>', ''),
         'What', '<span style="color:#f87171">' || app_private.disp_esc(v_label) || '</span>')
    || app_private.disp_box('The report',
         '<b>Channel:</b> ' || app_private.disp_esc(coalesce(v_channel,'not stated')) || '<br>'
      || '<b>Contact seen:</b> ' || app_private.disp_esc(coalesce(v_contact,'not stated')) || '<br>'
      || '<b>Detail:</b> ' || coalesce(replace(app_private.disp_esc(v_detail), E'\n', '<br>'), '—') || '<br>'
      || '<b>Assignment:</b> ' || app_private.disp_esc(coalesce(v_a.status,'?')) || coalesce(' since ' || to_char(v_a.assigned_at, 'FMDD Mon YYYY'), ''), 'note')
    || app_private.disp_box('What Uphold does',
         '<b>Uphold</b> suspends the dispatcher the same day and blocks the account permanently: the assignment ends, the LoadBoot line and mailbox are released, the carrier is free for a replacement, and the dispatcher cannot be reinstated or re-apply.<br>'
      || '<b>Dismiss</b> closes the report and tells the carrier; nothing else changes. Check the call log and the thread first &mdash; the LoadBoot line above is the only number the dispatcher may use.', 'stop')
    || app_private.disp_btn('Open in Command Center', v_cc_url)
    || '<p style="color:#8ea2c3;font-size:12px;margin:0">Staff notice &middot; dispatcher.report.staff &middot; report ' || v_id::text || '</p></div>';
  v_text := coalesce(v_cname,'A carrier') || ' reported ' || coalesce(v_dname,'their dispatcher') || ' (' || v_label || E').\n'
    || 'Channel: ' || coalesce(v_channel,'?') || ' · Contact seen: ' || coalesce(v_contact,'?') || E'\n' || coalesce('Detail: ' || v_detail || E'\n', '') || 'Open: ' || v_cc_url;
  begin
    perform app_private.sys_email(v_staff, 'dispatcher.report.staff',
      'Carrier report: ' || coalesce(v_cname,'carrier') || ' → ' || coalesce(v_dname,'dispatcher') || ' (' || lower(v_label) || ')',
      v_html, v_text, 'disp.report.staff:' || v_id::text);
  exception when others then null; end;

  -- ---- the carrier: in-app + receipt
  perform app_private.disp_notify(auth.uid(), 'carrier', 'dispatcher.report.receipt',
    'Report received — LoadBoot is reviewing it',
    'Thank you. Do not respond to the contact. Keep using the LoadBoot line and your LoadBoot group; we come back to you in the Dispatcher tab and by e-mail.',
    '/app/carrier/#dispatcher', false);
  select u.email into v_mail from auth.users u where u.id = auth.uid();
  if v_mail is not null then
    v_html := '<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.65">'
      || app_private.disp_head('LoadBoot Dispatch &middot; Report received', 'We are reviewing your report')
      || '<p style="margin:0 0 14px">Thank you for telling us. LoadBoot reviews every report of contact outside its channels &mdash; usually within one working day.</p>'
      || app_private.disp_box('What you reported', app_private.disp_esc(v_label) || coalesce('<br><b>Contact seen:</b> ' || app_private.disp_esc(v_contact), '') || coalesce('<br>' || replace(app_private.disp_esc(v_detail), E'\n', '<br>'), ''), 'note')
      || app_private.disp_box('Until you hear from us',
           '<b>Do not respond</b> to the number or account you reported. Keep working with your dispatcher through the LoadBoot line and your LoadBoot WhatsApp group only &mdash; those are logged and covered by LoadBoot. Anything arranged outside them is not.', 'stop')
      || app_private.disp_btn('Open my Dispatcher tab', 'https://loadboot.com/app/carrier/#dispatcher')
      || '<p style="margin:0 0 16px"><b>LoadBoot Dispatch</b><br><span style="color:#64748b;font-size:13px">{{contact_inline}}<br>' || v_staff || '</span></p>'
      || '<p style="color:#8ea2c3;font-size:12px;margin:0">Transactional notice about a report you filed in your LoadBoot carrier portal.</p></div>';
    v_text := 'Thank you for telling us. LoadBoot reviews every report of contact outside its channels, usually within one working day.'
      || E'\n\nYou reported: ' || v_label || coalesce(E'\nContact seen: ' || v_contact, '') || coalesce(E'\n' || v_detail, '')
      || E'\n\nDo not respond to the number or account you reported. Keep using the LoadBoot line and your LoadBoot WhatsApp group only.\n\n{{contact_inline}}';
    begin
      perform app_private.sys_email(v_mail, 'dispatcher.report.receipt', 'We received your report about your dispatcher', v_html, v_text, 'disp.report.receipt:' || v_id::text);
    exception when others then null; end;
  end if;

  perform app_private.disp_audit('dispatcher.reported', 'dispatcher_report', v_id::text, v_org,
    coalesce(v_cname,'carrier') || ' reported ' || coalesce(v_dname,'dispatcher') || ': ' || v_label,
    jsonb_build_object('kind', v_kind, 'channel', v_channel, 'contact_seen', v_contact, 'assignment', v_a.id, 'by', auth.uid()));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.carrier_report_dispatcher(text, text, text, text) from public, anon;
grant execute on function public.carrier_report_dispatcher(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------- 4. staff: the reports
create or replace function public.cc_dispatcher_reports(p_status text default 'open', p_user uuid default null) returns jsonb
language sql stable security definer set search_path = app_private, public as $$
  select case when not app_private.disp_is_staff() then jsonb_build_object('error','not authorized') else
    coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'status', r.status, 'kind', r.kind, 'kind_label', app_private.disp_report_kind_label(r.kind),
        'channel', r.channel, 'contact_seen', r.contact_seen, 'detail', r.detail,
        'created_at', r.created_at, 'decided_at', r.decided_at, 'decision_note', r.decision_note,
        'age_hours', round(extract(epoch from (now() - r.created_at))/3600, 1),
        'assignment_id', r.assignment_id,
        'assignment_status', (select a.status from app_private.dispatcher_assignments a where a.id = r.assignment_id),
        'dispatcher_user_id', r.dispatcher_user_id,
        'dispatcher', (select jsonb_build_object('name', d.full_name, 'status', d.status, 'blocked_at', d.blocked_at,
              'line', (select l.phone_e164 from app_private.dialer_lines l where l.dispatcher_user_id = d.user_id and l.status = 'active' order by l.created_at limit 1),
              'open_reports', (select count(*) from app_private.dispatcher_reports x where x.dispatcher_user_id = d.user_id and x.status in ('open','reviewing')),
              'upheld_reports', (select count(*) from app_private.dispatcher_reports x where x.dispatcher_user_id = d.user_id and x.status = 'upheld'))
            from app_private.dispatcher_profiles d where d.user_id = r.dispatcher_user_id),
        'carrier_org_id', r.carrier_org_id,
        'carrier', (select jsonb_build_object('name', o.name) from public.organizations o where o.id = r.carrier_org_id)
      ) order by (r.status in ('open','reviewing')) desc, r.created_at desc)
      from app_private.dispatcher_reports r
     where (p_status is null or p_status = 'all' or (p_status = 'open' and r.status in ('open','reviewing')) or r.status = p_status)
       and (p_user is null or r.dispatcher_user_id = p_user)
     limit 200), '[]'::jsonb) end
$$;
revoke all on function public.cc_dispatcher_reports(text, uuid) from public, anon;
grant execute on function public.cc_dispatcher_reports(text, uuid) to authenticated;

-- ---------------------------------------------------------------- 5. staff: uphold (= permanent block) / dismiss / reviewing
create or replace function public.cc_dispatcher_report_decide(p_id uuid, p_action text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare rp record; d record; v_note text := nullif(btrim(coalesce(p_note,'')), ''); v_reason text; v_off jsonb; v_owner uuid; v_mail text;
        v_cname text; v_html text; v_text text; v_contact text := app_private.disp_contact()->>'email'; v_n int := 0;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select * into rp from app_private.dispatcher_reports where id = p_id for update;
  if rp.id is null then return jsonb_build_object('error','report not found'); end if;
  if rp.status in ('upheld','dismissed') then return jsonb_build_object('error','this report was already ' || rp.status); end if;
  select * into d from app_private.dispatcher_profiles where user_id = rp.dispatcher_user_id;
  select owner_user_id, name into v_owner, v_cname from public.organizations where id = rp.carrier_org_id;

  if p_action = 'reviewing' then
    update app_private.dispatcher_reports set status = 'reviewing', decision_note = coalesce(v_note, decision_note), updated_at = now() where id = p_id;
    return jsonb_build_object('ok', true, 'status', 'reviewing');

  elsif p_action = 'uphold' then
    v_reason := 'Permanent block — a carrier report of contact outside LoadBoot channels was upheld' || coalesce(': ' || v_note, '.');
    -- the dispatcher: suspended + blocked, every live assignment ended (the carrier must be free for a replacement)
    update app_private.dispatcher_profiles
       set status = 'suspended', blocked_at = now(), blocked_reason = v_reason, review_note = v_reason,
           reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
     where user_id = rp.dispatcher_user_id;
    update app_private.dispatcher_assignments
       set status = 'ended', ended_at = now(), end_reason = v_reason, updated_at = now()
     where dispatcher_user_id = rp.dispatcher_user_id and status in ('active','paused');
    get diagnostics v_n = row_count;
    insert into app_private.dispatcher_messages(assignment_id, carrier_org_id, sender_role, body)
      select a.id, a.carrier_org_id, 'system', 'LoadBoot has ended this dispatcher assignment after a conduct review. LoadBoot Dispatch covers your truck directly until a replacement is assigned.'
        from app_private.dispatcher_assignments a where a.dispatcher_user_id = rp.dispatcher_user_id and a.status = 'ended' and a.updated_at > now() - interval '5 seconds';
    update app_private.dispatcher_carrier_choices
       set status = 'withdrawn', decided_by = auth.uid(), decided_at = now(), decision_note = 'dispatcher blocked', updated_at = now()
     where dispatcher_user_id = rp.dispatcher_user_id and status = 'pending';
    -- every other open report on this dispatcher closes with this one
    update app_private.dispatcher_reports
       set status = 'upheld', decided_by = auth.uid(), decided_at = now(), updated_at = now(),
           decision_note = case when id = p_id then v_note else 'blocked with report ' || p_id::text end
     where dispatcher_user_id = rp.dispatcher_user_id and status in ('open','reviewing');
    -- line, mailbox, WhatsApp threads released; each carrier e-mailed once; the ONE offboard e-mail carries the reason
    begin v_off := app_private.disp_offboard(rp.dispatcher_user_id, 'ended', v_reason); exception when others then v_off := jsonb_build_object('error', sqlerrm); end;

    -- the dispatcher: the decision letter (the offboard e-mail above lists what was switched off)
    perform app_private.disp_notify(rp.dispatcher_user_id, 'dispatcher', 'dispatcher.blocked',
      'Your LoadBoot dispatcher account is permanently blocked', v_reason, '/app/agent/#dashboard', false);
    select u.email into v_mail from auth.users u where u.id = rp.dispatcher_user_id;
    if v_mail is not null then
      v_html := '<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.65">'
        || app_private.disp_head('LoadBoot Dispatch &middot; Account decision', 'Your dispatcher account is permanently blocked')
        || '<p style="margin:0 0 14px">Dear ' || app_private.disp_esc(coalesce(nullif(d.full_name,''),'Dispatcher')) || ', a carrier reported contact from you outside LoadBoot channels. LoadBoot reviewed the report and upheld it.</p>'
        || app_private.disp_box('Decision', 'Your dispatcher account is suspended as of today and <b>blocked permanently</b>. Every assignment has ended, your LoadBoot line and mailbox are released, and you cannot be reinstated or re-apply.' || coalesce('<br><br><b>From LoadBoot:</b> ' || replace(app_private.disp_esc(v_note), E'\n', '<br>'), ''), 'stop')
        || app_private.disp_box('Why this rule exists', 'You accepted the contact rules before choosing a carrier: every contact goes through the carrier''s LoadBoot WhatsApp group, your LoadBoot line and your LoadBoot mailbox &mdash; never a personal number, WhatsApp or e-mail. Carriers are told to report anything else, and LoadBoot acts on it.', 'note')
        || app_private.disp_box('Disagree?', 'Reply to this e-mail within 7 days with what you have (screenshots, the number involved). A different team member reviews it. The block stays in place while that happens.')
        || '<p style="margin:0 0 16px"><b>LoadBoot Dispatch</b><br><span style="color:#64748b;font-size:13px">{{contact_inline}}<br>' || v_contact || '</span></p>'
        || '<p style="color:#8ea2c3;font-size:12px;margin:0">Transactional notice about your LoadBoot dispatcher account.</p></div>';
      v_text := 'Dear ' || coalesce(nullif(d.full_name,''),'Dispatcher') || E',\n\nA carrier reported contact from you outside LoadBoot channels. LoadBoot reviewed the report and upheld it.\n\n'
        || E'Your dispatcher account is suspended as of today and blocked permanently. Every assignment has ended, your LoadBoot line and mailbox are released, and you cannot be reinstated or re-apply.'
        || coalesce(E'\n\nFrom LoadBoot: ' || v_note, '') || E'\n\nDisagree? Reply within 7 days with what you have. The block stays in place while that is reviewed.\n\n{{contact_inline}} · ' || v_contact;
      begin
        perform app_private.sys_email(v_mail, 'dispatcher.blocked', 'Your LoadBoot dispatcher account is permanently blocked', v_html, v_text, 'disp.blocked:' || rp.dispatcher_user_id::text);
      exception when others then null; end;
    end if;

    -- the carrier: outcome (the assignment-ended e-mail went out from disp_offboard)
    perform app_private.disp_notify(v_owner, 'carrier', 'dispatcher.report.upheld',
      'Your report was upheld — the dispatcher is blocked',
      'Thank you for reporting it. That dispatcher is permanently blocked from LoadBoot and your assignment has ended. LoadBoot Dispatch covers your truck directly until a replacement is assigned.',
      '/app/carrier/#dispatcher', false);
    select u.email into v_mail from auth.users u where u.id = v_owner;
    if v_mail is not null then
      v_html := '<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.65">'
        || app_private.disp_head('LoadBoot Dispatch &middot; Report outcome', 'Your report was upheld')
        || '<p style="margin:0 0 14px">Thank you for telling us. LoadBoot reviewed your report and upheld it. That dispatcher is <b>permanently blocked</b> from LoadBoot.</p>'
        || app_private.disp_box('What happens now', 'Your dispatcher assignment has ended. LoadBoot Dispatch covers your truck directly until a replacement dispatcher is assigned &mdash; keep your truck posted in the portal. If the blocked dispatcher contacts you again from any number, do not respond; forward it to us.', 'ok')
        || app_private.disp_box('The rule, once more', 'Your dispatcher reaches you only from the LoadBoot line and your LoadBoot WhatsApp group. Anything else &rarr; Dispatcher tab &rarr; <b>Report a contact</b>. Work arranged outside LoadBoot channels is not covered by LoadBoot.', 'note')
        || app_private.disp_btn('Open my Dispatcher tab', 'https://loadboot.com/app/carrier/#dispatcher')
        || '<p style="margin:0 0 16px"><b>LoadBoot Dispatch</b><br><span style="color:#64748b;font-size:13px">{{contact_inline}}<br>' || v_contact || '</span></p>'
        || '<p style="color:#8ea2c3;font-size:12px;margin:0">Transactional notice about a report you filed in your LoadBoot carrier portal.</p></div>';
      v_text := E'Thank you for telling us. LoadBoot reviewed your report and upheld it. That dispatcher is permanently blocked from LoadBoot.\n\nYour dispatcher assignment has ended. LoadBoot Dispatch covers your truck directly until a replacement is assigned. If the blocked dispatcher contacts you again, do not respond; forward it to us.\n\n{{contact_inline}}';
      begin
        perform app_private.sys_email(v_mail, 'dispatcher.report.upheld', 'Your report was upheld — the dispatcher is blocked', v_html, v_text, 'disp.report.upheld:' || p_id::text);
      exception when others then null; end;
    end if;

    perform app_private.disp_audit('dispatcher.report.uphold', 'dispatcher_report', p_id::text, rp.carrier_org_id,
      coalesce(d.full_name,'dispatcher') || ' permanently blocked — report by ' || coalesce(v_cname,'carrier') || ' upheld',
      jsonb_build_object('note', v_note, 'assignments_ended', v_n, 'offboard', v_off));
    return jsonb_build_object('ok', true, 'status', 'upheld', 'blocked', true, 'assignments_ended', v_n, 'offboard', v_off);

  elsif p_action = 'dismiss' then
    update app_private.dispatcher_reports set status = 'dismissed', decided_by = auth.uid(), decided_at = now(), decision_note = v_note, updated_at = now() where id = p_id;
    perform app_private.disp_notify(v_owner, 'carrier', 'dispatcher.report.dismissed',
      'We looked into your report',
      'LoadBoot reviewed your report and did not find a breach of the contact rule' || coalesce(': ' || v_note, '.') || ' Your assignment continues as before. If it happens again, report it again — every report is reviewed.',
      '/app/carrier/#dispatcher', false);
    select u.email into v_mail from auth.users u where u.id = v_owner;
    if v_mail is not null then
      v_html := '<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.65">'
        || app_private.disp_head('LoadBoot Dispatch &middot; Report outcome', 'We looked into your report')
        || '<p style="margin:0 0 14px">Thank you for telling us. LoadBoot reviewed your report and did not find a breach of the contact rule. Your dispatcher assignment continues as before.</p>'
        || case when v_note is not null then app_private.disp_box('From LoadBoot', replace(app_private.disp_esc(v_note), E'\n', '<br>'), 'note') else '' end
        || app_private.disp_box('If it happens again', 'Report it again &mdash; every report is reviewed. Your dispatcher reaches you only from the LoadBoot line and your LoadBoot WhatsApp group; work arranged outside LoadBoot channels is not covered by LoadBoot.')
        || app_private.disp_btn('Open my Dispatcher tab', 'https://loadboot.com/app/carrier/#dispatcher')
        || '<p style="margin:0 0 16px"><b>LoadBoot Dispatch</b><br><span style="color:#64748b;font-size:13px">{{contact_inline}}<br>' || v_contact || '</span></p>'
        || '<p style="color:#8ea2c3;font-size:12px;margin:0">Transactional notice about a report you filed in your LoadBoot carrier portal.</p></div>';
      v_text := E'Thank you for telling us. LoadBoot reviewed your report and did not find a breach of the contact rule. Your dispatcher assignment continues as before.' || coalesce(E'\n\nFrom LoadBoot: ' || v_note, '') || E'\n\nIf it happens again, report it again — every report is reviewed.\n\n{{contact_inline}}';
      begin
        perform app_private.sys_email(v_mail, 'dispatcher.report.dismissed', 'We looked into your report about your dispatcher', v_html, v_text, 'disp.report.dismissed:' || p_id::text);
      exception when others then null; end;
    end if;
    perform app_private.disp_audit('dispatcher.report.dismiss', 'dispatcher_report', p_id::text, rp.carrier_org_id,
      'report by ' || coalesce(v_cname,'carrier') || ' on ' || coalesce(d.full_name,'dispatcher') || ' dismissed', jsonb_build_object('note', v_note));
    return jsonb_build_object('ok', true, 'status', 'dismissed');
  end if;
  return jsonb_build_object('error','bad action');
end $$;
revoke all on function public.cc_dispatcher_report_decide(uuid, text, text) from public, anon;
grant execute on function public.cc_dispatcher_report_decide(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- 6. a blocked dispatcher cannot be reinstated or re-apply (anchor patches on the live bodies)
do $p$
declare src text; anchor text; add text;
begin
  src := pg_get_functiondef('public.cc_dispatcher_decide(uuid, text, text)'::regprocedure);
  anchor := 'if v_old is null then return jsonb_build_object(''error'',''not a dispatcher''); end if;';
  add := E'\n  if p_action in (''reinstate'',''trial'',''verify'',''activate'',''screening'',''skills_test'') and exists (select 1 from app_private.dispatcher_profiles where user_id = p_user and blocked_at is not null)\n    then return jsonb_build_object(''error'',''permanently blocked — a carrier report was upheld; no reinstate''); end if;';
  if src not like '%' || anchor || '%' then raise exception 'bl_disp_0443: cc_dispatcher_decide anchor missing'; end if;
  if src like '%permanently blocked — a carrier report was upheld%' then raise notice 'cc_dispatcher_decide already patched'; else execute replace(src, anchor, anchor || add); end if;

  src := pg_get_functiondef('public.dispatcher_reapply(boolean)'::regprocedure);
  anchor := 'if v_status <> ''rejected'' then';
  add := E'if exists (select 1 from app_private.dispatcher_profiles where user_id = v_uid and blocked_at is not null) then\n    return jsonb_build_object(''ok'', false, ''eligible'', false, ''reason'', ''blocked'', ''status'', v_status);\n  end if;\n  ';
  if src not like '%' || anchor || '%' then raise exception 'bl_disp_0443: dispatcher_reapply anchor missing'; end if;
  if src like '%''reason'', ''blocked''%' then raise notice 'dispatcher_reapply already patched'; else execute replace(src, anchor, add || anchor); end if;
end $p$;

-- ---------------------------------------------------------------- 7. the contact rule inside the trial e-mail and the carrier intro e-mail
do $p$
declare src text; anchor text; add text;
begin
  -- dispatcher: trial terms e-mail (app_private.disp_trial_email) — after "Rules that end a trial"
  src := pg_get_functiondef('app_private.disp_trial_email(uuid, text)'::regprocedure);
  anchor := '|| ''Never tell a carrier your pay is added to their bill. Never share carrier bank or payout details with anyone.'', ''stop'')';
  add := E'\n    || app_private.disp_box(''Contact rule &mdash; permanent block'',\n         ''Every contact with the carrier goes through LoadBoot channels only: the carrier&rsquo;s LoadBoot WhatsApp group, your LoadBoot line, your LoadBoot mailbox. Never a personal phone, WhatsApp, e-mail or social account &mdash; yours or theirs. Never move a carrier, driver, broker or load off LoadBoot. ''\n      || ''Carriers are told to report anything else. A report LoadBoot upholds means same-day suspension and a permanent block &mdash; no reinstatement, no re-application. You accepted these rules before choosing your carrier.'', ''stop'')';
  if src not like '%' || anchor || '%' then raise exception 'bl_disp_0443: disp_trial_email anchor missing'; end if;
  if src like '%Contact rule &mdash; permanent block%' then raise notice 'disp_trial_email already patched'; else execute replace(src, anchor, anchor || add); end if;

  -- carrier: the "meet your dispatcher" intro (app_private.disp_assign_email_html) — after "What your dispatcher cannot do"
  src := pg_get_functiondef('app_private.disp_assign_email_html'::regproc);
  anchor := 'Your dispatcher never sees your bank details or payout information.'')';
  add := E'\n    || app_private.disp_box(''Protect yourself &mdash; one rule'',\n         ''Your dispatcher reaches you <b>only</b> from the LoadBoot line above and your LoadBoot WhatsApp group. If anyone contacts you from any other number, WhatsApp, e-mail or social account claiming to be your dispatcher, do not respond: open your portal &rarr; <b>Dispatcher</b> tab &rarr; <b>Report a contact</b>. LoadBoot reviews every report; a dispatcher who breaks this rule is blocked permanently. Work arranged outside LoadBoot channels is not covered by LoadBoot.'', ''stop'')';
  if src not like '%' || anchor || '%' then raise exception 'bl_disp_0443: disp_assign_email_html anchor missing'; end if;
  if src like '%Protect yourself &mdash; one rule%' then raise notice 'disp_assign_email_html already patched'; else execute replace(src, anchor, anchor || add); end if;
end $p$;

-- ---------------------------------------------------------------- 8. one-time nudge for the candidates who passed before the tab existed
-- NOT called here. Run by hand AFTER the front-end deploy: select app_private.disp_choice_backfill_email();
-- Idempotent twice over: the idempotency key disppass.choose:<attempt> and the message_deliveries check.
create or replace function app_private.disp_choice_backfill_email() returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare r record; v_mail text; v_name text; v_html text; v_text text; v_sent int := 0; v_skipped int := 0; v_out jsonb := '[]'::jsonb;
        v_contact text := app_private.disp_contact()->>'email';
begin
  for r in
    select d.user_id, d.full_name, a.id attempt_id
      from app_private.dispatcher_profiles d
      join lateral (select x.id from app_private.skills_test_attempts x where x.user_id = d.user_id and x.decision = 'pass' and x.passed_email_at is not null
                    order by x.reviewed_at desc nulls last, x.attempt_no desc limit 1) a on true
     where d.status = 'skills_test' and d.blocked_at is null
       and not exists (select 1 from app_private.dispatcher_assignments g where g.dispatcher_user_id = d.user_id and g.status <> 'ended')
       and not exists (select 1 from app_private.dispatcher_carrier_choices c where c.dispatcher_user_id = d.user_id and c.status = 'pending')
  loop
    if exists (select 1 from app_private.message_deliveries m where m.idempotency_key = 'disppass.choose:' || r.attempt_id::text) then v_skipped := v_skipped + 1; continue; end if;
    select u.email into v_mail from auth.users u where u.id = r.user_id;
    if v_mail is null then v_skipped := v_skipped + 1; continue; end if;
    v_name := coalesce(nullif(initcap(split_part(trim(coalesce(r.full_name,'')), ' ', 1)), ''), 'there');
    begin
      insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
      values (r.user_id, 'in_app', 'dispatcher.test_passed_inapp',
        jsonb_build_object('title', 'Choose your carrier — the tab is open', 'body', 'You passed. Every carrier open for a dedicated dispatcher is in your portal with its fleet book. Read the contact rules, then pick the one that fits.', 'tone', 'success', 'url', '/app/agent/#dashboard'),
        'sent', now());
    exception when others then null; end;
    v_html :=
         '<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.06em;color:#16a34a;text-transform:uppercase">Next step</p>'
      || '<h2 style="margin:0 0 10px;color:#10223B;font-size:24px">Choose your carrier &mdash; the tab is open</h2>'
      || '<p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6">Hi ' || app_private.disp_esc(v_name) || ' &mdash; you passed the skills test, and since then we have opened something new in your portal.</p>'
      || '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:14px;color:#334155">'
      || '<tr><td style="padding:14px 16px;background:#f1f5f9;border-radius:10px;line-height:1.9">'
      || '<b style="color:#10223B">How it works now</b><br>'
      || '<b>1.</b> Sign in. The <b>Choose your carrier</b> tab lists every carrier open for a dedicated dispatcher &mdash; every truck, every preference, every constraint, the age of each authority. Carrier names and contacts appear only after LoadBoot confirms your choice.<br>'
      || '<b>2.</b> Read the contact rules and accept them &mdash; every contact with a carrier goes through LoadBoot channels only; anything else is a permanent block.<br>'
      || '<b>3.</b> Pick the carrier you want to dispatch for. LoadBoot confirms it, your 10 working day paid trial starts, and you receive that carrier''s full operating brief before your first call.'
      || '</td></tr></table>'
      || '<p style="margin:18px 0 0"><a href="https://loadboot.com/app/agent/#dashboard" style="display:inline-block;background:#0883F7;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:8px">Choose my carrier</a></p>'
      || '<p style="margin:14px 0 0;color:#334155;font-size:14px;line-height:1.7">If no carrier is open today the tab says so &mdash; we onboard carriers every week and will tell you the moment one opens. Questions: {{contact_inline}} &middot; ' || v_contact || '</p>'
      || '<p style="margin:14px 0 0;color:#94a3b8;font-size:12px">Sent because you passed the LoadBoot dispatcher skills test. Transactional notice about your application, not a marketing e-mail.</p>';
    v_text := 'Hi ' || v_name || E' — you passed the skills test, and since then we have opened something new in your portal.\n\n'
      || E'1. Sign in: the "Choose your carrier" tab lists every carrier open for a dedicated dispatcher. Names and contacts appear only after LoadBoot confirms your choice.\n'
      || E'2. Read and accept the contact rules — every contact with a carrier goes through LoadBoot channels only; anything else is a permanent block.\n'
      || E'3. Pick the carrier you want to dispatch for. LoadBoot confirms it and your paid trial starts.\n\nhttps://loadboot.com/app/agent/#dashboard\n\nQuestions: {{contact_inline}} · ' || v_contact;
    begin
      perform app_private.sys_email(v_mail, 'dispatcher.carrier.open', 'LoadBoot Dispatcher — choose your carrier: the tab is open', v_html, v_text, 'disppass.choose:' || r.attempt_id::text);
      v_sent := v_sent + 1; v_out := v_out || to_jsonb(coalesce(r.full_name, r.user_id::text));
    exception when others then v_skipped := v_skipped + 1; end;
  end loop;
  perform app_private.disp_audit('dispatcher.carrier.open.backfill', 'dispatcher', 'batch', null, v_sent || ' candidate(s) e-mailed, ' || v_skipped || ' skipped', jsonb_build_object('sent_to', v_out));
  return jsonb_build_object('sent', v_sent, 'skipped', v_skipped, 'names', v_out);
end $$;
revoke all on function app_private.disp_choice_backfill_email() from public, anon;

-- ---------------------------------------------------------------- 9. e-mail catalog (rule §6)
insert into app_private.email_catalog
  (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note,
   preference_group, unsub_allowed, cc_deep_link, status, discovered_in)
values
  ('dispatcher.report.staff', 'Carrier report — staff notice',
   'A carrier reported their dispatcher for contact outside LoadBoot channels: carrier, dispatcher, LoadBoot line, what was seen, Uphold/Dismiss link',
   'S', 'staff', 'event', 'public.carrier_report_dispatcher', 'once per report', 'once (idempotency disp.report.staff:<report>); max 3 open reports per assignment',
   'staff_internal', false, '#/dispatchers', 'live', '{code}'),
  ('dispatcher.report.receipt', 'Carrier report — receipt',
   'Carrier receipt: report received, do not respond to the contact, keep to the LoadBoot line and group',
   'T', 'carrier', 'event', 'public.carrier_report_dispatcher', 'once per report', 'once (idempotency disp.report.receipt:<report>)',
   'account_critical', false, '#/dispatchers', 'live', '{code}'),
  ('dispatcher.report.upheld', 'Carrier report — upheld',
   'Carrier outcome: the report was upheld, the dispatcher is permanently blocked, the assignment ended, LoadBoot Dispatch covers the truck',
   'T', 'carrier', 'event', 'public.cc_dispatcher_report_decide', 'once per decision', 'once (idempotency disp.report.upheld:<report>)',
   'account_critical', false, '#/dispatchers', 'live', '{code}'),
  ('dispatcher.report.dismissed', 'Carrier report — dismissed',
   'Carrier outcome: reviewed, no breach found, assignment continues, report again if it recurs',
   'T', 'carrier', 'event', 'public.cc_dispatcher_report_decide', 'once per decision', 'once (idempotency disp.report.dismissed:<report>)',
   'account_critical', false, '#/dispatchers', 'live', '{code}'),
  ('dispatcher.blocked', 'Dispatcher permanently blocked',
   'Decision letter to the dispatcher: a carrier report was upheld, account suspended and blocked permanently, no reinstate / re-apply, 7-day appeal by reply',
   'T', 'dispatcher', 'event', 'public.cc_dispatcher_report_decide', 'once per dispatcher', 'once (idempotency disp.blocked:<user>)',
   'account_critical', false, '#/dispatchers', 'live', '{code}'),
  ('dispatcher.carrier.open', 'Choose your carrier — tab is open (backfill)',
   'One-time nudge to candidates who passed before the Choose-your-carrier tab existed: the tab is open, names after confirmation, contact rules, pick one',
   'T', 'dispatcher', 'manual', 'app_private.disp_choice_backfill_email', 'once per pass', 'once (idempotency disppass.choose:<attempt>)',
   'account_critical', false, '#/dispatchers', 'live', '{code}')
on conflict (key) do update set name = excluded.name, purpose = excluded.purpose, class = excluded.class, audience_role = excluded.audience_role,
  trigger_type = excluded.trigger_type, trigger_source = excluded.trigger_source, cadence = excluded.cadence, cap_note = excluded.cap_note,
  preference_group = excluded.preference_group, unsub_allowed = excluded.unsub_allowed, cc_deep_link = excluded.cc_deep_link,
  status = 'live', updated_at = now();

-- ---------------------------------------------------------------- 10. guard: nothing new is anon-executable
do $g$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname in ('carrier_report_dispatcher','cc_dispatcher_reports','cc_dispatcher_report_decide')
                and has_function_privilege('anon', p.oid, 'execute'))
  then raise exception 'bl_disp_0443: a new public function is anon-executable'; end if;
end $g$;
