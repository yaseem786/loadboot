-- bl_disp_0605_resigned — dispatcher "Resigned" status + carrier "open again" broadcast
-- 1) status 'resigned' allowed on dispatcher_profiles
-- 2) app_private.disp_carrier_reopened_notify(org, dry): premium email to every passed, eligible dispatcher
-- 3) public.cc_dispatcher_resign(user, note): staff-only; ends assignments, releases line/mailbox/WhatsApp,
--    locks the portal (portal_hold) with a hello@ reason, sends the resignation email, re-opens the carriers
-- 4) cc_dispatcher_unassign: an ENDED (not paused) assignment now re-opens the carrier to passed dispatchers
-- 5) email_catalog rows for the two new emails

alter table app_private.dispatcher_profiles drop constraint if exists dispatcher_profiles_status_check;
alter table app_private.dispatcher_profiles add constraint dispatcher_profiles_status_check
  check (status = any (array['applied','screening','skills_test','trial','verified','active','suspended','rejected','withdrawn','resigned']));

insert into app_private.email_catalog (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note, preference_group, cc_deep_link, status, discovered_in, first_seen)
values
 ('dispatcher.carrier.reopened', 'Carrier open again — passed dispatchers',
  'A carrier''s dispatcher assignment ended and the carrier is open again: equipment, home base, haul, lanes, rate floor, match vs the dispatcher''s equipment; CTA to Choose your carrier',
  'T', 'dispatcher', 'event', 'public.cc_dispatcher_unassign / public.cc_dispatcher_resign → app_private.disp_carrier_reopened_notify',
  'once per carrier per dispatcher per day', 'once (idempotency dispreopen:<org>:<user>:<YYYYMMDD>)', 'account_critical', '#/dispatchers', 'live', '{code}', now()),
 ('dispatcher.resigned', 'Resignation confirmed — dispatcher',
  'Dispatcher resigned: what was closed (carrier, line, mailbox/WhatsApp, DAT, portal), no-contact + confidentiality, rejoin via hello@loadboot.com',
  'T', 'dispatcher', 'event', 'public.cc_dispatcher_resign',
  'once per resignation', 'once (idempotency disp.resigned:<user>:<YYYYMMDD>)', 'account_critical', '#/dispatchers', 'live', '{code}', now())
on conflict (key) do nothing;

create or replace function app_private.disp_carrier_reopened_notify(p_org uuid, p_dry boolean default false)
returns jsonb language plpgsql security definer set search_path to 'app_private','public' as $fn$
declare
  b jsonb; c_eq text[]; r record; v_disp text[]; v_m text; v_common text; v_mail text; v_name text;
  v_equip text; v_base text; v_haul text; v_lanes text; v_rpm text; v_trucks int; v_day text := to_char(now(), 'YYYYMMDD');
  v_match boolean; v_mine text; v_facts jsonb; v_html text; v_text text; v_subj text; v_idem text; v_sent int := 0; v_out jsonb := '[]'::jsonb;
begin
  if not app_private.disp_carrier_available(p_org) then
    return jsonb_build_object('sent', 0, 'skipped', 'carrier is not open for a dispatcher');
  end if;
  b := app_private.disp_carrier_book(p_org, false);
  select coalesce(array_agg(x), '{}'::text[]) into c_eq from jsonb_array_elements_text(b->'equipment') x;
  if cardinality(c_eq) = 0 then return jsonb_build_object('sent', 0, 'skipped', 'carrier equipment not on file'); end if;

  v_equip  := coalesce(nullif((select string_agg(x, ', ') from jsonb_array_elements_text(b->'equipment_labels') x), ''), 'Not on file');
  v_base   := nullif(b#>>'{org,home_base}', '');
  v_haul   := nullif((select string_agg(case x when 'otr' then 'OTR (800+ mi)' when 'regional' then 'Regional (250–800 mi)'
                                       when 'local' then 'Local (up to 250 mi)' else initcap(x) end, ', ')
                      from jsonb_array_elements_text(coalesce(b#>'{prefs,haul_types}', '[]'::jsonb)) x), '');
  v_lanes  := nullif((select string_agg(initcap(x), ', ') from jsonb_array_elements_text(coalesce(b#>'{prefs,preferred_lanes}', '[]'::jsonb)) x), '');
  v_rpm    := case when (b#>>'{prefs,min_rpm}') ~ '^[0-9.]+$' then '$' || to_char((b#>>'{prefs,min_rpm}')::numeric, 'FM990.00') || ' / mile' end;
  v_trucks := coalesce((b#>>'{fleet,count}')::int, 0);

  for r in
    select d.user_id, d.full_name from app_private.dispatcher_profiles d
     where d.status in ('skills_test','trial','verified','active') and d.blocked_at is null and d.portal_hold_at is null
       and exists (select 1 from app_private.skills_test_attempts a where a.user_id = d.user_id and a.decision = 'pass')
       and coalesce((app_private.disp_choice_eligibility(d.user_id)->>'eligible')::boolean, false)
  loop
    v_disp := app_private.disp_dispatcher_equipment(r.user_id);
    v_m := app_private.disp_choice_match(v_disp, c_eq);
    select u.email into v_mail from auth.users u where u.id = r.user_id;
    continue when v_mail is null;
    v_idem := 'dispreopen:' || p_org::text || ':' || r.user_id::text || ':' || v_day;
    continue when exists (select 1 from app_private.message_deliveries m where m.idempotency_key = v_idem);
    v_match  := v_m in ('exact', 'partial');
    v_common := coalesce(nullif((select string_agg(app_private.disp_equip_label(e), ', ' order by e) from unnest(c_eq) e where e = any(v_disp)), ''), v_equip);
    v_mine   := coalesce(nullif((select string_agg(app_private.disp_equip_label(e), ', ' order by e) from unnest(v_disp) e), ''), 'not on file');
    v_name   := coalesce(nullif(initcap(split_part(trim(coalesce(r.full_name, '')), ' ', 1)), ''), 'there');

    if p_dry then
      v_out := v_out || jsonb_build_array(jsonb_build_object('user_id', r.user_id, 'name', r.full_name, 'match', v_m, 'common', v_common));
      continue;
    end if;

    v_facts := jsonb_build_array(jsonb_build_object('k', 'Equipment', 'v', v_equip));
    if v_base  is not null then v_facts := v_facts || jsonb_build_array(jsonb_build_object('k', 'Home base', 'v', v_base)); end if;
    if v_haul  is not null then v_facts := v_facts || jsonb_build_array(jsonb_build_object('k', 'Haul type', 'v', v_haul)); end if;
    if v_lanes is not null then v_facts := v_facts || jsonb_build_array(jsonb_build_object('k', 'Preferred lanes', 'v', v_lanes)); end if;
    if v_rpm   is not null then v_facts := v_facts || jsonb_build_array(jsonb_build_object('k', 'Rate floor', 'v', v_rpm)); end if;
    if (b#>>'{prefs,weekend_ok}') is not null then
      v_facts := v_facts || jsonb_build_array(jsonb_build_object('k', 'Weekends', 'v', case when (b#>>'{prefs,weekend_ok}')::boolean then 'Yes' else 'No' end));
    end if;
    v_facts := v_facts || jsonb_build_array(
      jsonb_build_object('k', 'Trucks on file', 'v', case when v_trucks = 0 then 'Being added' else v_trucks::text end),
      case when v_match then jsonb_build_object('k', 'Matches your profile', 'v', v_common) else jsonb_build_object('k', 'Your profile', 'v', v_mine) end);

    v_subj := 'A ' || v_equip || ' carrier is open again — choose it in your portal';
    v_html := app_private.email_kit(jsonb_build_object(
      'eyebrow', case when v_match then jsonb_build_object('text', 'Carrier open again · matches your profile', 'tone', 'success')
                      else jsonb_build_object('text', 'Carrier open again', 'tone', 'info') end,
      'title',   'A ' || v_equip || ' carrier is open for a new dispatcher',
      'intro',   case when v_match then
                   'Hi ' || v_name || ', a ' || v_equip || ' carrier on LoadBoot is open again for a dispatcher, and its equipment matches what you listed in your dispatcher profile. '
                || 'It is now in your Choose your carrier tab. Carriers go to the first suitable dispatcher LoadBoot confirms, so take a look while it is open.'
                 else
                   'Hi ' || v_name || ', a ' || v_equip || ' carrier on LoadBoot is open again for a dispatcher and is now in your Choose your carrier tab. '
                || 'Its equipment is outside the equipment in your dispatcher profile (' || v_mine || '). If you have dispatched this kind of truck before, you can still choose it - tell us about that experience in your note.' end,
      'facts',   v_facts,
      'card',    jsonb_build_object('tone', 'info', 'title', 'Before you choose', 'items', jsonb_build_array(
                   'This carrier is active and ready for loads now, so it needs a dispatcher who can work full US business hours from day one.',
                   'Open the carrier''s fleet book in the tab: trucks, preferences, constraints and authority age.',
                   'The carrier''s name and contacts appear only after LoadBoot confirms your choice.',
                   'Every contact with the carrier goes through LoadBoot channels only.')),
      'step',    jsonb_build_object('title', 'Choose this carrier in your portal',
                   'text', 'Sign in, open Choose your carrier, review the fleet book and pick it if it fits. LoadBoot confirms the choice, and you get the full carrier brief before your first call.'),
      'cta',     jsonb_build_object('label', 'See the carrier', 'url', 'https://loadboot.com/app/agent/#dashboard'),
      'note',    'You get this email because you passed the LoadBoot dispatcher skills test and can choose a carrier in your portal. '
              || 'If the carrier is already taken when you open the tab, we will tell you about the next match.',
      'signoff', 'LoadBoot Dispatch'));
    v_text := 'Hi ' || v_name || E',\n\nA ' || v_equip || ' carrier on LoadBoot is open again for a dispatcher.' || E'\n\n'
           || 'Equipment: ' || v_equip || coalesce(E'\nHome base: ' || v_base, '') || coalesce(E'\nHaul type: ' || v_haul, '')
           || coalesce(E'\nPreferred lanes: ' || v_lanes, '') || coalesce(E'\nRate floor: ' || v_rpm, '')
           || E'\n\nThe carrier is active and needs a dispatcher who can work full US business hours from day one. Open the Choose your carrier tab to see the fleet book and pick it if it fits.\n\n'
           || E'https://loadboot.com/app/agent/#dashboard\n\nLoadBoot Dispatch';
    begin
      perform app_private.sys_email(v_mail, 'dispatcher.carrier.reopened', v_subj, v_html, v_text, v_idem);
      v_sent := v_sent + 1;
      v_out := v_out || jsonb_build_array(jsonb_build_object('user_id', r.user_id, 'name', r.full_name, 'match', v_m));
    exception when others then
      raise warning 'dispatcher.carrier.reopened to % failed: %', r.user_id, sqlerrm; continue;
    end;
    begin
      insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
      values (r.user_id, 'in_app', 'dispatcher.carrier.reopened',
              jsonb_build_object('title', 'A ' || v_equip || ' carrier is open again', 'body', 'It is open in your Choose your carrier tab. Review the fleet book and pick it if it fits.',
                                 'tone', 'success', 'href', '/app/agent/#dashboard'), 'sent', now());
    exception when others then null; end;
  end loop;
  perform app_private.disp_audit('dispatcher.carrier.reopened', 'carrier', p_org::text, p_org, 'carrier re-opened to passed dispatchers', jsonb_build_object('dry', p_dry, 'sent', v_sent));
  return jsonb_build_object('sent', case when p_dry then 0 else v_sent end, 'dry_run', p_dry, 'recipients', v_out);
end $fn$;
revoke all on function app_private.disp_carrier_reopened_notify(uuid, boolean) from public, anon, authenticated;

create or replace function public.cc_dispatcher_resign(p_user uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private','public' as $fn$
declare v_old text; v_name text; v_mail text; r record; v_orgs uuid[] := '{}'; v_closed jsonb := '[]'::jsonb; v_carriers text := '';
        v_n int; v_first text; v_html text; v_text text; v_reopen jsonb := '[]'::jsonb; v_o uuid;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select status, full_name into v_old, v_name from app_private.dispatcher_profiles where user_id = p_user;
  if v_old is null then return jsonb_build_object('error','not a dispatcher'); end if;
  if v_old = 'resigned' then return jsonb_build_object('error','already resigned'); end if;

  for r in update app_private.dispatcher_assignments a set status = 'ended', ended_at = now(),
             end_reason = coalesce(p_note, 'dispatcher resigned'), updated_at = now()
            where a.dispatcher_user_id = p_user and a.status in ('active','paused')
            returning a.id, a.carrier_org_id loop
    v_orgs := v_orgs || r.carrier_org_id;
    insert into app_private.dispatcher_messages(assignment_id, carrier_org_id, sender_role, body)
      values (r.id, r.carrier_org_id, 'system', 'LoadBoot has ended this dispatcher assignment. LoadBoot dispatch covers your truck until a replacement is assigned.');
    begin
      perform app_private.disp_notify((select owner_user_id from public.organizations where id = r.carrier_org_id), 'carrier', 'dispatcher.unassigned.carrier',
        'Dispatcher assignment ended', 'LoadBoot dispatch covers your truck directly until a replacement is assigned.', '/app/carrier/#dispatcher', false);
    exception when others then null; end;
    begin perform app_private.disp_carrier_change_email(r.id, 'ended'); exception when others then null; end;
    v_carriers := v_carriers || case when v_carriers = '' then '' else ', ' end || coalesce((select name from public.organizations where id = r.carrier_org_id), 'carrier');
  end loop;

  update app_private.dispatcher_profiles
     set status = 'resigned', review_note = coalesce(p_note, review_note), reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now(),
         portal_hold_at = now(), portal_hold_by = auth.uid(),
         portal_hold_reason = 'You resigned from your LoadBoot dispatcher role, so your carrier, phone line, mailbox and tools are no longer available. To rejoin LoadBoot as a dispatcher, email hello@loadboot.com and our team will review your request.'
   where user_id = p_user;

  for r in update app_private.dialer_lines set status = 'released', updated_at = now()
             where dispatcher_user_id = p_user and status = 'active' returning phone_e164 loop
    v_closed := v_closed || to_jsonb('LoadBoot phone line ' || r.phone_e164 || ' released');
    perform app_private.disp_audit('dialer.line_release', 'dispatcher', p_user::text, null, 'line ' || r.phone_e164 || ' released (resigned)', '{}'::jsonb);
  end loop;
  for r in update app_private.dmail_accounts set assigned_to = null, assigned_at = null, assigned_by = auth.uid(), status = 'paused', updated_at = now()
             where assigned_to = p_user returning id, address loop
    begin perform app_private.dmail_identity_reset(r.id); exception when others then null; end;
    v_closed := v_closed || to_jsonb('Company mailbox ' || r.address || ' closed');
  end loop;
  update app_private.wa_threads set owner_user_id = null, updated_at = now() where owner_user_id = p_user;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_closed := v_closed || to_jsonb('WhatsApp conversations (' || v_n || ') handed back to LoadBoot Dispatch'); end if;

  select u.email into v_mail from auth.users u where u.id = p_user;
  v_first := coalesce(nullif(initcap(split_part(trim(coalesce(v_name,'')), ' ', 1)), ''), 'there');
  if v_mail is not null then
    v_html := app_private.email_kit(jsonb_build_object(
      'eyebrow', jsonb_build_object('text', 'Resignation confirmed', 'tone', 'info'),
      'title',   'Thank you, ' || v_first || '. Your dispatcher access is now closed.',
      'intro',   'We received your message that you are moving on, and we have closed your LoadBoot dispatcher role. Thank you for the time you spent with us, and we wish you the best.',
      'facts',   jsonb_build_array(
                   jsonb_build_object('k', 'Carrier assignment', 'v', case when v_carriers = '' then 'None open' else 'Ended · now covered by LoadBoot Dispatch' end),
                   jsonb_build_object('k', 'LoadBoot phone line', 'v', 'Released'),
                   jsonb_build_object('k', 'Company mailbox & WhatsApp', 'v', 'Access ended'),
                   jsonb_build_object('k', 'Load board (DAT) access', 'v', 'Removed'),
                   jsonb_build_object('k', 'Dispatcher portal', 'v', 'Locked')),
      'card',    jsonb_build_object('tone', 'info', 'title', 'Please keep in mind', 'items', jsonb_build_array(
                   'Please do not contact the carrier or its brokers. LoadBoot Dispatch is now handling the account.',
                   'Carrier details stay confidential under your dispatcher agreement.',
                   'Any commission already earned on delivered loads stays in your LoadBoot account.')),
      'step',    jsonb_build_object('title', 'Email hello@loadboot.com',
                   'text', 'If your plans change, write to us at hello@loadboot.com. Our team will review your request and reopen your access if a suitable carrier is available.'),
      'cta',     jsonb_build_object('label', 'Email hello@loadboot.com', 'url', 'mailto:hello@loadboot.com?subject=Rejoin%20LoadBoot%20as%20a%20dispatcher'),
      'signoff', 'LoadBoot Dispatch'));
    v_text := 'Hi ' || v_first || E',\n\nWe received your message that you are moving on, and we have closed your LoadBoot dispatcher role. '
           || E'Your carrier assignment, LoadBoot phone line, company mailbox, WhatsApp, DAT access and dispatcher portal are now closed.\n\n'
           || E'Please do not contact the carrier or its brokers, and keep carrier details confidential under your agreement. Any commission already earned on delivered loads stays in your LoadBoot account.\n\n'
           || E'Want to rejoin later? Email hello@loadboot.com and our team will review your request.\n\nLoadBoot Dispatch';
    begin
      perform app_private.sys_email(v_mail, 'dispatcher.resigned', 'Your resignation is confirmed — LoadBoot dispatcher access closed',
                                    v_html, v_text, 'disp.resigned:' || p_user::text || ':' || to_char(now(), 'YYYYMMDD'));
    exception when others then raise warning 'dispatcher.resigned email failed: %', sqlerrm; end;
  end if;

  foreach v_o in array v_orgs loop
    begin v_reopen := v_reopen || jsonb_build_array(app_private.disp_carrier_reopened_notify(v_o, false));
    exception when others then v_reopen := v_reopen || jsonb_build_array(jsonb_build_object('error', sqlerrm)); end;
  end loop;

  perform app_private.disp_audit('dispatcher.resigned', 'dispatcher', p_user::text, null,
    coalesce(v_name,'dispatcher') || ': ' || v_old || ' → resigned' || coalesce(' — ' || p_note, ''), jsonb_build_object('closed', v_closed, 'carriers', v_carriers));
  return jsonb_build_object('ok', true, 'status', 'resigned', 'carriers', v_carriers, 'closed', v_closed, 'reopened', v_reopen);
end $fn$;
revoke all on function public.cc_dispatcher_resign(uuid, text) from public, anon;
grant execute on function public.cc_dispatcher_resign(uuid, text) to authenticated;

-- 4) every ENDED assignment re-opens the carrier to passed dispatchers (paused = no broadcast)
create or replace function public.cc_dispatcher_unassign(p_assignment uuid, p_reason text default null, p_pause boolean default false)
returns jsonb language plpgsql security definer set search_path to 'app_private','public' as $fn$
declare v_a record; v_open int; v_owner uuid; v_reopen jsonb;
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
  perform app_private.disp_notify(v_a.dispatcher_user_id, 'dispatcher', 'dispatcher.unassigned', 'Assignment ' || (case when p_pause then 'paused' else 'ended' end), coalesce(p_reason, 'LoadBoot ' || (case when p_pause then 'paused' else 'ended' end) || ' your carrier assignment.'), '/app/agent/#dashboard', false);
  perform app_private.disp_notify(v_owner, 'carrier', 'dispatcher.unassigned.carrier', 'Dispatcher assignment ' || (case when p_pause then 'paused' else 'ended' end), 'LoadBoot dispatch covers your truck directly until a replacement is assigned.', '/app/carrier/#dispatcher', false);
  begin perform app_private.disp_carrier_change_email(p_assignment, case when p_pause then 'paused' else 'ended' end); exception when others then null; end;
  begin perform app_private.disp_unassign_email(p_assignment, case when p_pause then 'paused' else 'ended' end, p_reason); exception when others then null; end;   -- bl_disp_0444
  if not p_pause then   -- bl_disp_0605: carrier open again → passed dispatchers
    begin v_reopen := app_private.disp_carrier_reopened_notify(v_a.carrier_org_id, false); exception when others then v_reopen := jsonb_build_object('error', sqlerrm); end;
  end if;
  perform app_private.disp_audit('dispatcher.unassign', 'assignment', p_assignment::text, v_a.carrier_org_id, (case when p_pause then 'paused' else 'ended' end) || coalesce(': ' || p_reason, ''), jsonb_build_object('open_loads', v_open));
  return jsonb_build_object('ok', true, 'open_loads', v_open, 'reopened', v_reopen);
end $fn$;
