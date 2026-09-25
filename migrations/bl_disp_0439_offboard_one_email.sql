-- bl_disp_0439 — ONE action, ONE e-mail when a dispatcher is rejected or suspended.
-- Applied: staging + prod 2026-09-25 (staging dry-run rolled back: 2 e-mails, line/mailbox/WA/carrier released).
--
-- Owner decision (Yaseen, 25 Sep 2026):
--   Reject / Suspend in CC must release everything by itself — LoadBoot phone line,
--   company mailbox, WhatsApp threads and every carrier — so it is free for the next
--   dispatcher. The dispatcher gets ONE premium e-mail carrying the reason (the CC note)
--   and the list of what was switched off. Every carrier he covered gets a branded
--   "a change to your dispatcher" e-mail (no reason — LoadBoot covers the truck, new
--   dispatcher within the assign SLA). No more per-item withdrawal e-mails on this path.
--   The single-carrier Unassign in CC now sends the same branded carrier e-mail.
--
-- Contact line: {{contact_inline}} (WhatsApp via the contact switch — never the Riley line).
-- Public surface: cc_dispatcher_decide / cc_dispatcher_unassign are REPLACED in place
-- (same signature, staff-only). No new public function → anon SECURITY DEFINER count unchanged.
-- Apply: staging → prod.

-- ---------------------------------------------------------------- 1. catalog
insert into app_private.email_catalog
  (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note,
   preference_group, cc_deep_link, status, discovered_in)
values
  ('dispatcher.offboarded', 'Dispatcher ended — one e-mail',
   'Reject/end of a trial or active dispatcher: reason + what was switched off (line, mailbox, WhatsApp, carriers)',
   'T', 'dispatcher', 'event', 'app_private.disp_offboard', 'once per decision', 'once',
   'account_critical', '#/dispatchers', 'live', '{code}'),
  ('dispatcher.suspended', 'Dispatcher paused — one e-mail',
   'Suspend of a dispatcher: reason + what was paused (line, mailbox, WhatsApp, carriers)',
   'T', 'dispatcher', 'event', 'app_private.disp_offboard', 'once per decision', 'once',
   'account_critical', '#/dispatchers', 'live', '{code}'),
  ('dispatcher.changed.carrier', 'Your dispatcher has changed',
   'Carrier notice when its dispatcher is removed or paused: LoadBoot covers the truck, new dispatcher within the SLA',
   'T', 'carrier', 'event', 'app_private.disp_carrier_change_email', 'per assignment end', 'once per end',
   'account_critical', '#/carriers', 'live', '{code}')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- 2. carrier e-mail
create or replace function app_private.disp_carrier_change_email(p_assignment uuid, p_mode text default 'ended')
returns void
language plpgsql security definer set search_path to 'app_private', 'public'
as $$
declare a record; v_dname text; v_cname text; v_first text; v_owner uuid; v_mail text; v_sla int := 3;
        v_html text; v_text text; v_contact text := app_private.disp_contact()->>'email'; v_paused boolean := (p_mode = 'paused');
begin
  select * into a from app_private.dispatcher_assignments where id = p_assignment;
  if a.id is null then return; end if;
  select full_name into v_dname from app_private.dispatcher_profiles where user_id = a.dispatcher_user_id;
  select o.name, o.owner_user_id, p.contact_name into v_cname, v_owner, v_first
    from public.organizations o left join public.profiles p on p.id = o.owner_user_id where o.id = a.carrier_org_id;
  select u.email into v_mail from auth.users u where u.id = v_owner;
  if v_mail is null then return; end if;
  v_first := coalesce(nullif(split_part(coalesce(v_first,''), ' ', 1), ''), 'there');
  v_dname := coalesce(nullif(v_dname,''), 'Your dispatcher');
  v_cname := coalesce(nullif(v_cname,''), 'your company');
  begin
    v_sla := coalesce(nullif(regexp_replace(coalesce((select value::text from app_private.disp_desk_config where key = 'assign_sla_business_days'), ''), '[^0-9]', '', 'g'), '')::int, 3);
  exception when others then v_sla := 3; end;

  v_html := '<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.65">'
    || app_private.disp_head('LoadBoot Dispatch', case when v_paused then 'Your dispatcher is paused for now' else 'A change to your LoadBoot dispatcher' end)
    || '<p style="margin:0 0 14px">Hi ' || app_private.disp_esc(v_first) || ',</p>'
    || '<p style="margin:0 0 14px">' || app_private.disp_esc(v_dname) || ' is no longer ' || case when v_paused then 'covering' else 'assigned to' end
    || ' ' || app_private.disp_esc(v_cname) || '. <b>Nothing changes on your side</b> &mdash; LoadBoot Dispatch covers your truck directly from today.</p>'
    || app_private.disp_strip('Your cover', 'LoadBoot Dispatch', 'New dispatcher', 'within ' || v_sla || ' business days', 'Your loads', 'unchanged')
    || app_private.disp_box('What stays the same', 'Every load already booked stays on schedule. Your rate floor, lanes and rules stay on file. Your LoadBoot pricing does not change &mdash; a dispatcher is never added to your invoice.', 'ok')
    || app_private.disp_box('What happens next', 'We are matching you with a new dedicated dispatcher. Once assigned, you will get an introduction e-mail with the name, the LoadBoot line and the e-mail address &mdash; nothing to confirm on your side. Keep your truck posted (<b>Loads &rarr; Post my truck</b>) so the new dispatcher starts from a live post.')
    || app_private.disp_box('Reach LoadBoot Dispatch', '{{contact_inline}}<br>E-mail: <a href="mailto:' || v_contact || '" style="color:#0883F7">' || v_contact || '</a>', 'note')
    || app_private.disp_btn('Open my carrier portal', 'https://loadboot.com/app/carrier/#dispatcher')
    || '<p style="margin:0 0 16px"><b>LoadBoot Dispatch</b><br><span style="color:#64748b;font-size:13px">' || v_contact || '</span></p>'
    || '<p style="color:#8ea2c3;font-size:12px;margin:0">You are receiving this because your company signed the LoadBoot Dispatch Service Agreement. This is a transactional notice about your account, not a marketing e-mail.</p></div>';

  v_text := 'Hi ' || v_first || E',\n\n' || v_dname || ' is no longer ' || case when v_paused then 'covering ' else 'assigned to ' end || v_cname
    || E'. Nothing changes on your side - LoadBoot Dispatch covers your truck directly from today.\n\n'
    || E'Every load already booked stays on schedule. Your rate floor, lanes and rules stay on file. Your pricing does not change.\n\n'
    || 'We are matching you with a new dedicated dispatcher within ' || v_sla || E' business days. You will get an introduction e-mail once assigned - nothing to confirm.\n\n'
    || E'Reach LoadBoot Dispatch: {{contact_inline}} · ' || v_contact || E'\nPortal: https://loadboot.com/app/carrier/#dispatcher\n\nLoadBoot Dispatch';

  perform app_private.sys_email(v_mail, 'dispatcher.changed.carrier',
    case when v_paused then 'Your LoadBoot dispatcher is paused — we cover your truck' else 'A change to your LoadBoot dispatcher — we cover your truck' end,
    v_html, v_text, 'dispatcher.changed:' || p_assignment::text || ':' || p_mode || ':' || extract(epoch from now())::bigint::text);
end $$;

-- ---------------------------------------------------------------- 3. dispatcher e-mail (ONE)
create or replace function app_private.disp_offboard_email(p_user uuid, p_mode text, p_reason text, p_closed jsonb)
returns void
language plpgsql security definer set search_path to 'app_private', 'public'
as $$
declare v_mail text; v_name text; v_reason text; v_items text := ''; v_plain text := ''; v_html text; v_text text; x text;
        v_paused boolean := (p_mode = 'paused'); v_contact text := app_private.disp_contact()->>'email';
begin
  select u.email into v_mail from auth.users u where u.id = p_user;
  if v_mail is null then return; end if;
  select full_name into v_name from app_private.dispatcher_profiles where user_id = p_user;
  v_name := coalesce(nullif(v_name,''), 'Dispatcher');
  v_reason := nullif(btrim(coalesce(p_reason,'')), '');
  v_reason := coalesce(v_reason, case when v_paused then 'LoadBoot has paused your dispatcher access while we review your account.' else 'LoadBoot has ended your dispatcher engagement.' end);
  v_reason := replace(replace(replace(replace(v_reason, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), E'\n', '<br>');

  for x in select value from jsonb_array_elements_text(coalesce(p_closed, '[]'::jsonb)) loop
    v_items := v_items || '<tr><td style="padding:0 10px 8px 0;color:#FC5305;vertical-align:top">&#9656;</td><td style="padding:0 0 8px 0;color:#334155">' || app_private.disp_esc(x) || '</td></tr>';
    v_plain := v_plain || '  - ' || x || E'\n';
  end loop;

  v_html := '<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.65">'
    || app_private.disp_head('LoadBoot Dispatch', case when v_paused then 'Your dispatcher access is paused' else 'Your LoadBoot dispatcher engagement has ended' end)
    || '<p style="margin:0 0 14px">Dear ' || app_private.disp_esc(v_name) || ',</p>'
    || '<p style="margin:0 0 14px">' || case when v_paused then 'LoadBoot has paused your dispatcher access, effective now.' else 'LoadBoot has ended your dispatcher engagement, effective now.' end || ' The reason from our team is below.</p>'
    || app_private.disp_box('Reason', v_reason, 'note')
    || case when v_items <> '' then app_private.disp_box(case when v_paused then 'What has been paused' else 'What has been switched off' end,
         '<table role="presentation" cellpadding="0" cellspacing="0">' || v_items || '</table>'
         || '<div style="margin-top:6px">Do not continue any broker or carrier conversation from a personal number or e-mail address. If anything is still open on your side, tell LoadBoot Dispatch today.</div>') else '' end
    || case when v_paused
         then app_private.disp_box('What this means', 'Your LoadBoot account stays open. Your carriers are covered by LoadBoot Dispatch while the pause lasts. We will contact you if and when access is restored.')
         else app_private.disp_box('What this means', 'Your LoadBoot account remains open and nothing has been deleted. Your carriers are covered by LoadBoot Dispatch. Commission on loads you booked that are already delivered is settled as normal; anything not yet delivered is settled once it is.') end
    || app_private.disp_box('Questions', '{{contact_inline}}<br>E-mail: <a href="mailto:' || v_contact || '" style="color:#0883F7">' || v_contact || '</a>')
    || '<p style="margin:0 0 4px">Thank you for your time with LoadBoot.</p>'
    || '<p style="margin:0 0 16px"><b>LoadBoot Dispatch</b><br><span style="color:#64748b;font-size:13px">' || v_contact || '</span></p>'
    || '<p style="color:#8ea2c3;font-size:12px;margin:0">You are receiving this because you were a LoadBoot dispatcher. This is a transactional notice about your account.</p></div>';

  v_text := 'Dear ' || v_name || E',\n\n' || case when v_paused then 'LoadBoot has paused your dispatcher access, effective now.' else 'LoadBoot has ended your dispatcher engagement, effective now.' end
    || E'\n\nReason:\n' || regexp_replace(coalesce(nullif(btrim(coalesce(p_reason,'')), ''), 'See above.'), '<[^>]+>', '', 'g')
    || case when v_plain <> '' then E'\n\n' || case when v_paused then 'What has been paused:' else 'What has been switched off:' end || E'\n' || rtrim(v_plain, E'\n') else '' end
    || E'\n\nDo not continue any broker or carrier conversation from a personal number or e-mail address.\n\nQuestions: {{contact_inline}} · ' || v_contact
    || E'\n\nThank you for your time with LoadBoot.\nLoadBoot Dispatch';

  perform app_private.sys_email(v_mail, case when v_paused then 'dispatcher.suspended' else 'dispatcher.offboarded' end,
    case when v_paused then 'Your LoadBoot dispatcher access is paused' else 'Your LoadBoot dispatcher engagement has ended' end,
    v_html, v_text, 'disp.offboard:' || p_user::text || ':' || p_mode || ':' || extract(epoch from now())::bigint::text);
end $$;

-- ---------------------------------------------------------------- 4. the release itself (silent — no per-item e-mails)
create or replace function app_private.disp_offboard(p_user uuid, p_mode text, p_reason text)
returns jsonb
language plpgsql security definer set search_path to 'app_private', 'public'
as $$
declare v_closed jsonb := '[]'::jsonb; r record; v_n int; v_paused boolean := (p_mode = 'paused'); v_carriers text := '';
begin
  -- carriers: the assignment rows were already ended/paused by the caller (cc_dispatcher_decide) — e-mail each carrier once
  for r in select a.id, a.status, o.name from app_private.dispatcher_assignments a join public.organizations o on o.id = a.carrier_org_id
            where a.dispatcher_user_id = p_user and a.status = case when v_paused then 'paused' else 'ended' end
              and a.updated_at > now() - interval '2 minutes' loop
    begin perform app_private.disp_carrier_change_email(r.id, p_mode); exception when others then null; end;
    v_carriers := v_carriers || case when v_carriers = '' then '' else ', ' end || r.name;
  end loop;
  if v_carriers <> '' then v_closed := v_closed || to_jsonb('Carrier' || case when position(',' in v_carriers) > 0 then 's' else '' end || ': ' || v_carriers || case when v_paused then ' — covered by LoadBoot Dispatch while paused' else ' — now covered by LoadBoot Dispatch' end); end if;

  -- LoadBoot phone line(s): released, free for the next dispatcher (dialer_lines keeps history; upsert creates the next row)
  for r in update app_private.dialer_lines set status = 'released', updated_at = now()
             where dispatcher_user_id = p_user and status = 'active' returning phone_e164 loop
    v_closed := v_closed || to_jsonb('LoadBoot phone line ' || coalesce(app_private.disp_fmt_us(r.phone_e164), r.phone_e164) || ' — no longer connects or reaches you');
    perform app_private.disp_audit('dialer.line_release', 'dispatcher', p_user::text, null, 'line ' || r.phone_e164 || ' released (offboard)', jsonb_build_object('mode', p_mode));
  end loop;

  -- company mailbox: unassigned + identity reset + paused (the address and its mail stay with LoadBoot; CC can re-assign it)
  for r in update app_private.dmail_accounts set assigned_to = null, assigned_at = null, assigned_by = auth.uid(), status = 'paused', updated_at = now()
             where assigned_to = p_user returning id, address loop
    begin perform app_private.dmail_identity_reset(r.id); exception when others then null; end;
    v_closed := v_closed || to_jsonb('Company mailbox ' || r.address || ' — access ended; the Email tab is removed from your workspace');
    perform app_private.disp_audit('dmail.assign', 'dispatcher', p_user::text, null, r.address || ' unassigned (offboard)', jsonb_build_object('account', r.id, 'mode', p_mode));
  end loop;

  -- WhatsApp threads: back to the LoadBoot pool (CC / the next dispatcher picks them up)
  if to_regclass('app_private.wa_threads') is not null then
    execute 'update app_private.wa_threads set owner_user_id = null, updated_at = now() where owner_user_id = $1' using p_user;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_closed := v_closed || to_jsonb('WhatsApp conversations (' || v_n || ') — handed back to LoadBoot Dispatch'); end if;
  end if;

  -- workspace access line (always)
  v_closed := v_closed || to_jsonb(case when v_paused then 'Dispatcher workspace — paused (loads, board and tools hidden until access is restored)' else 'Dispatcher workspace — closed (your LoadBoot login stays open)' end);

  begin perform app_private.disp_offboard_email(p_user, p_mode, p_reason, v_closed); exception when others then null; end;
  perform app_private.disp_audit('dispatcher.offboard', 'dispatcher', p_user::text, null, p_mode || coalesce(': ' || p_reason, ''), jsonb_build_object('closed', v_closed));
  return jsonb_build_object('ok', true, 'closed', v_closed);
end $$;

-- ---------------------------------------------------------------- 5. cc_dispatcher_decide — same signature, offboard wired in
create or replace function public.cc_dispatcher_decide(p_user uuid, p_action text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path to 'app_private', 'public'
as $$
declare v_new text; v_old text; v_pct numeric; v_ts date; v_te date; v_warn text; v_name text; v_mail text; v_hours int;
        v_had_assets boolean := false; v_off jsonb;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select status, commission_pct, trial_start, trial_end, full_name into v_old, v_pct, v_ts, v_te, v_name from app_private.dispatcher_profiles where user_id = p_user;
  if v_old is null then return jsonb_build_object('error','not a dispatcher'); end if;
  v_new := case p_action
    when 'screening' then 'screening' when 'skills_test' then 'skills_test' when 'trial' then 'trial'
    when 'verify' then 'verified' when 'activate' then 'active' when 'reject' then 'rejected' when 'suspend' then 'suspended'
    when 'reinstate' then case when v_te is not null and v_te >= current_date then 'trial' else 'verified' end
    else null end;
  if v_new is null then return jsonb_build_object('error','bad action'); end if;
  -- a dispatcher who ever held a line, mailbox, thread or carrier is offboarded, not just "declined"
  v_had_assets := v_old in ('trial','verified','active','suspended')
    or exists (select 1 from app_private.dispatcher_assignments where dispatcher_user_id = p_user)
    or exists (select 1 from app_private.dialer_lines where dispatcher_user_id = p_user and status = 'active')
    or exists (select 1 from app_private.dmail_accounts where assigned_to = p_user);
  update app_private.dispatcher_profiles
     set status = v_new, review_note = coalesce(p_note, review_note), reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now(),
         trial_start = case when v_new = 'trial' and trial_start is null then current_date else trial_start end,
         trial_end   = case when v_new = 'trial' and trial_end is null then app_private.add_working_days(current_date, 10) else trial_end end
   where user_id = p_user;
  if v_new = 'trial' and coalesce(v_pct, 0) = 0 then v_warn := 'commission_pct is 0 — set the trial terms now or every delivered load pays the dispatcher nothing'; end if;
  if v_new in ('suspended','rejected') then
    update app_private.dispatcher_assignments set status = case when v_new = 'suspended' then 'paused' else 'ended' end,
           ended_at = case when v_new = 'rejected' then now() else ended_at end, end_reason = coalesce(p_note, 'dispatcher ' || v_new), updated_at = now()
     where dispatcher_user_id = p_user and status = 'active';
    insert into app_private.dispatcher_messages(assignment_id, carrier_org_id, sender_role, body)
      select a.id, a.carrier_org_id, 'system', 'LoadBoot has ' || (case when v_new = 'suspended' then 'paused' else 'ended' end) || ' this dispatcher assignment. LoadBoot dispatch covers your truck until a replacement is assigned.'
        from app_private.dispatcher_assignments a where a.dispatcher_user_id = p_user and a.status in ('paused','ended') and a.updated_at > now() - interval '5 seconds';
  elsif v_new = 'trial' and v_old = 'suspended' then
    update app_private.dispatcher_assignments set status = 'active', updated_at = now() where dispatcher_user_id = p_user and status = 'paused';
  end if;
  -- in-app notice always carries the note (the reason). E-mail flag: the ONE offboard e-mail replaces the generic one
  perform app_private.disp_notify(p_user, 'dispatcher', 'dispatcher.status.' || v_new,
    case v_new when 'trial' then 'Your trial starts — open your workspace' when 'verified' then 'You are verified' when 'active' then 'You are active' when 'rejected' then 'Application closed' when 'suspended' then 'Access paused' when 'skills_test' then 'Next step: skills test — check your e-mail' else 'Application update' end,
    coalesce(p_note, 'Status: ' || v_new || '.'), '/app/agent/#dashboard',
    (v_new in ('verified','active') or (v_new = 'suspended' and not v_had_assets) or (v_new = 'trial' and not (p_action = 'trial' and v_old is distinct from 'trial'))));

  if p_action = 'trial' and v_old is distinct from 'trial' then
    begin perform app_private.disp_trial_email(p_user, p_note); exception when others then null; end;
  end if;

  if v_new in ('rejected','suspended') and v_had_assets then
    begin v_off := app_private.disp_offboard(p_user, case when v_new = 'suspended' then 'paused' else 'ended' end, p_note); exception when others then v_off := jsonb_build_object('error', sqlerrm); end;
  elsif v_new = 'rejected' then
    begin perform app_private.disp_reject_email(p_user, p_note); exception when others then null; end;
  end if;

  if v_new = 'skills_test' then
    begin
      select u.email into v_mail from auth.users u where u.id = p_user;
      v_hours := coalesce((select (value #>> '{}')::int from app_private.system_settings where key = 'dispatch.skills_test_hours'), 48);
      if v_mail is not null then
        if not exists (select 1 from app_private.skills_test_attempts t where t.user_id = p_user and t.status in ('invited','in_progress')) then
          perform app_private.disp_test_invite(p_user, 45, 48);
        end if;
      end if;
    exception when others then null; end;
  end if;

  perform app_private.disp_audit('dispatcher.decide.' || p_action, 'dispatcher', p_user::text, null, coalesce(v_name,'dispatcher') || ': ' || v_old || ' → ' || v_new, jsonb_build_object('note', p_note));
  return jsonb_build_object('ok', true, 'status', v_new, 'warning', v_warn, 'offboard', v_off);
end $$;

-- ---------------------------------------------------------------- 6. single-carrier Unassign — carrier gets the branded e-mail, not the generic notice
create or replace function public.cc_dispatcher_unassign(p_assignment uuid, p_reason text default null, p_pause boolean default false)
returns jsonb
language plpgsql security definer set search_path to 'app_private', 'public'
as $$
declare v_a record; v_open int; v_owner uuid;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select * into v_a from app_private.dispatcher_assignments where id = p_assignment;
  if v_a.id is null then return jsonb_build_object('error','assignment not found'); end if;
  select count(*) into v_open from app_private.dispatcher_bookings b where b.carrier_org_id = v_a.carrier_org_id and b.dispatcher_user_id = v_a.dispatcher_user_id and b.status in ('approved','dispatched','picked_up');
  if v_open > 0 and not p_pause and coalesce(p_reason,'') not ilike '%force%' then
    return jsonb_build_object('error', v_open || ' load(s) are moving under this assignment — finish or cancel them first, or add "force" to the reason to end anyway');
  end if;
  update app_private.dispatcher_assignments set status = case when p_pause then 'paused' else 'ended' end,
    ended_at = case when p_pause then null else now() end, end_reason = p_reason, updated_at = now() where id = p_assignment;
  select owner_user_id into v_owner from public.organizations where id = v_a.carrier_org_id;
  insert into app_private.dispatcher_messages(assignment_id, carrier_org_id, sender_role, body)
    values (p_assignment, v_a.carrier_org_id, 'system', 'LoadBoot has ' || (case when p_pause then 'paused' else 'ended' end) || ' this assignment' || coalesce(': ' || p_reason, '') || '.');
  perform app_private.disp_notify(v_a.dispatcher_user_id, 'dispatcher', 'dispatcher.unassigned', 'Assignment ' || (case when p_pause then 'paused' else 'ended' end), coalesce(p_reason, 'LoadBoot ' || (case when p_pause then 'paused' else 'ended' end) || ' your carrier assignment.'), '/app/agent/#dashboard', true);
  perform app_private.disp_notify(v_owner, 'carrier', 'dispatcher.unassigned.carrier', 'Dispatcher assignment ' || (case when p_pause then 'paused' else 'ended' end), 'LoadBoot dispatch covers your truck directly until a replacement is assigned.', '/app/carrier/#dispatcher', false);
  begin perform app_private.disp_carrier_change_email(p_assignment, case when p_pause then 'paused' else 'ended' end); exception when others then null; end;
  perform app_private.disp_audit('dispatcher.unassign', 'assignment', p_assignment::text, v_a.carrier_org_id, (case when p_pause then 'paused' else 'ended' end) || coalesce(': ' || p_reason, ''), jsonb_build_object('open_loads', v_open));
  return jsonb_build_object('ok', true, 'open_loads', v_open);
end $$;

-- the shared helpers are staff-only paths; keep them off anon
revoke all on function app_private.disp_carrier_change_email(uuid, text) from public, anon;
revoke all on function app_private.disp_offboard_email(uuid, text, text, jsonb) from public, anon;
revoke all on function app_private.disp_offboard(uuid, text, text) from public, anon;
