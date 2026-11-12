-- bl_disp_0603_carrier_available_email  (12 Nov 2026)
-- Owner ask: "jab koi naya carrier approve hota hai, skills test pass dispatchers ko premium email jaye k naya carrier
-- aaya hai jo un ki profile se match karta hai" — and "sab ko jaye jitne bhi skill test passed dispatcher hon".
--
-- Fulfils the promise in dispatcher.carrier.open ("we will tell you the moment one opens").
--   * Fires when app_private.carrier_onboarding.stage becomes 'approved' (CC "Approve account").
--   * Recipients: EVERY dispatcher who passed the skills test, is not blocked, and can choose a carrier right now
--     (app_private.disp_choice_eligibility(...).eligible). Owner, 12 Nov: "sab ko jaye" - every passed dispatcher gets it,
--     not only the matching ones. exact/partial match -> "matches your profile" wording; otherwise a neutral
--     "new carrier opened" email that says plainly the equipment is outside their stated profile.
--   * Opportunity notice, not account-critical: preference group load_ops, unsubscribe allowed (§6.4).
--   * One email per (carrier, dispatcher, approval day). No carrier name or contact — same rule as the Choose tab.
--   * Body = app_private.email_kit (§10), sender key dispatcher.carrier.available (catalog row below, §6).
--   * Manual / dry run: select app_private.disp_carrier_available_notify('<org>', true);  -- lists who would get it

insert into app_private.email_catalog
  (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note,
   preference_group, unsub_allowed, cc_deep_link, status, discovered_in)
values
  ('dispatcher.carrier.available', 'New carrier opened — dispatchers',
   'A carrier was approved and opened for a dispatcher: equipment, home base, haul type, lanes, rate floor, and whether it matches the dispatcher''s equipment profile; CTA to the Choose your carrier tab. Sent to every passed dispatcher who can choose a carrier. No carrier name or contact.',
   'T', 'dispatcher', 'event', 'app_private.disp_carrier_available_notify (trigger on carrier_onboarding -> approved)',
   'once per carrier approval', 'once per carrier per dispatcher per approval day (idempotency dispavail:<org>:<user>:<yyyymmdd>)',
   'load_ops', true, '#/dispatchers', 'live', '{code}')
on conflict (key) do update set name = excluded.name, purpose = excluded.purpose, class = excluded.class, audience_role = excluded.audience_role,
  trigger_type = excluded.trigger_type, trigger_source = excluded.trigger_source, cadence = excluded.cadence, cap_note = excluded.cap_note,
  preference_group = excluded.preference_group, unsub_allowed = excluded.unsub_allowed, cc_deep_link = excluded.cc_deep_link,
  status = 'live', updated_at = now();

create or replace function app_private.disp_carrier_available_notify(p_org uuid, p_dry boolean default false)
returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare
  b jsonb; c_eq text[]; r record; v_disp text[]; v_m text; v_common text; v_mail text; v_name text;
  v_equip text; v_base text; v_haul text; v_lanes text; v_rpm text; v_trucks int; v_day text;
  v_match boolean; v_mine text; v_facts jsonb; v_html text; v_text text; v_subj text; v_idem text; v_sent int := 0; v_out jsonb := '[]'::jsonb;
begin
  if not app_private.disp_carrier_available(p_org) then
    return jsonb_build_object('sent', 0, 'skipped', 'carrier is not open for a dispatcher');
  end if;
  b := app_private.disp_carrier_book(p_org, false);
  select coalesce(array_agg(x), '{}'::text[]) into c_eq from jsonb_array_elements_text(b->'equipment') x;
  if cardinality(c_eq) = 0 then
    return jsonb_build_object('sent', 0, 'skipped', 'carrier equipment not on file');
  end if;

  v_equip  := coalesce(nullif((select string_agg(x, ', ') from jsonb_array_elements_text(b->'equipment_labels') x), ''), 'Not on file');
  v_base   := nullif(b#>>'{org,home_base}', '');
  v_haul   := nullif((select string_agg(case x when 'otr' then 'OTR (800+ mi)' when 'regional' then 'Regional (250–800 mi)'
                                          when 'local' then 'Local (up to 250 mi)' else initcap(x) end, ', ')
                      from jsonb_array_elements_text(coalesce(b#>'{prefs,haul_types}', '[]'::jsonb)) x), '');
  v_lanes  := nullif((select string_agg(initcap(x), ', ') from jsonb_array_elements_text(coalesce(b#>'{prefs,preferred_lanes}', '[]'::jsonb)) x), '');
  v_rpm    := case when (b#>>'{prefs,min_rpm}') ~ '^[0-9.]+$' then '$' || to_char((b#>>'{prefs,min_rpm}')::numeric, 'FM990.00') || ' / mile' end;
  v_trucks := coalesce((b#>>'{fleet,count}')::int, 0);
  v_day    := to_char(coalesce((select ob.decided_at from app_private.carrier_onboarding ob
                                 where ob.carrier_id = p_org and ob.stage = 'approved' order by ob.decided_at desc nulls last limit 1), now()), 'YYYYMMDD');

  for r in
    select d.user_id, d.full_name
      from app_private.dispatcher_profiles d
     where d.status in ('skills_test','trial','verified','active') and d.blocked_at is null
       and exists (select 1 from app_private.skills_test_attempts a where a.user_id = d.user_id and a.decision = 'pass')
       and coalesce((app_private.disp_choice_eligibility(d.user_id)->>'eligible')::boolean, false)
  loop
    v_disp := app_private.disp_dispatcher_equipment(r.user_id);
    v_m := app_private.disp_choice_match(v_disp, c_eq);
    select u.email into v_mail from auth.users u where u.id = r.user_id;
    continue when v_mail is null;
    v_idem := 'dispavail:' || p_org::text || ':' || r.user_id::text || ':' || v_day;
    continue when exists (select 1 from app_private.message_deliveries m where m.idempotency_key = v_idem);

    v_match  := v_m in ('exact', 'partial');
    v_common := coalesce(nullif((select string_agg(app_private.disp_equip_label(e), ', ' order by e) from unnest(c_eq) e where e = any(v_disp)), ''), v_equip);
    v_mine   := coalesce(nullif((select string_agg(app_private.disp_equip_label(e), ', ' order by e) from unnest(v_disp) e), ''), 'not on file');
    v_name := coalesce(nullif(initcap(split_part(trim(coalesce(r.full_name, '')), ' ', 1)), ''), 'there');

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
      case when v_match then jsonb_build_object('k', 'Matches your profile', 'v', v_common)
           else jsonb_build_object('k', 'Your profile', 'v', v_mine) end);

    v_subj := case when v_match then 'New ' || v_equip || ' carrier matches your profile — choose it in your portal'
                   else 'New ' || v_equip || ' carrier on LoadBoot — open in your portal' end;
    v_html := app_private.email_kit(jsonb_build_object(
      'eyebrow', case when v_match then jsonb_build_object('text', 'New carrier · matches your profile', 'tone', 'success')
                      else jsonb_build_object('text', 'New carrier on LoadBoot', 'tone', 'info') end,
      'title',   'A new ' || v_equip || ' carrier just opened for a dispatcher',
      'intro',   case when v_match then
                   'Hi ' || v_name || ', a carrier was approved on LoadBoot and its equipment matches what you listed in your dispatcher profile. '
                || 'It is now in your Choose your carrier tab. Carriers go to the first suitable dispatcher LoadBoot confirms, so take a look while it is open.'
                 else
                   'Hi ' || v_name || ', a carrier was approved on LoadBoot and is now in your Choose your carrier tab. Its equipment (' || v_equip
                || ') is outside the equipment in your dispatcher profile (' || v_mine || '). If you have dispatched this kind of truck before, '
                || 'you can still choose it - tell us about that experience in your note.' end,
      'facts',   v_facts,
      'card',    jsonb_build_object('tone', 'info', 'title', 'Before you choose', 'items', jsonb_build_array(
                   'Open the carrier''s fleet book in the tab: trucks, preferences, constraints and authority age.',
                   'The carrier''s name and contacts appear only after LoadBoot confirms your choice.',
                   'Every contact with the carrier goes through LoadBoot channels only.')),
      'step',    jsonb_build_object('title', 'Choose this carrier in your portal',
                   'text', 'Sign in, open Choose your carrier, review the fleet book and pick it if it fits. LoadBoot confirms the choice, and you get the full carrier brief before your first call.'),
      'cta',     jsonb_build_object('label', 'See the carrier', 'url', 'https://loadboot.com/app/agent/#dashboard'),
      'note',    'You get this email because you passed the LoadBoot dispatcher skills test and can choose a carrier in your portal. '
              || 'If the carrier is already taken when you open the tab, we will tell you about the next match.',
      'signoff', 'LoadBoot Dispatch'));
    v_text := 'Hi ' || v_name || E',\n\nA new ' || v_equip || ' carrier was approved on LoadBoot'
           || case when v_match then ' and matches your dispatcher profile (' || v_common || ').' else ' (outside your stated equipment: ' || v_mine || ').' end || E'\n\n'
           || 'Equipment: ' || v_equip || coalesce(E'\nHome base: ' || v_base, '') || coalesce(E'\nHaul type: ' || v_haul, '')
           || coalesce(E'\nPreferred lanes: ' || v_lanes, '') || coalesce(E'\nRate floor: ' || v_rpm, '')
           || E'\n\nOpen the Choose your carrier tab to see the fleet book and pick it if it fits. The carrier''s name and contacts appear only after LoadBoot confirms your choice.\n\n'
           || E'https://loadboot.com/app/agent/#dashboard\n\nLoadBoot Dispatch';

    begin
      perform app_private.sys_email(v_mail, 'dispatcher.carrier.available', v_subj, v_html, v_text, v_idem);
      v_sent := v_sent + 1;
      v_out := v_out || jsonb_build_array(jsonb_build_object('user_id', r.user_id, 'name', r.full_name, 'match', v_m));
    exception when others then
      raise warning 'dispatcher.carrier.available to % failed: %', r.user_id, sqlerrm;
      continue;
    end;
    begin
      insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
      values (r.user_id, 'in_app', 'dispatcher.carrier.available',
              jsonb_build_object('title', 'New ' || v_equip || ' carrier' || case when v_match then ' matches your profile' else ' on LoadBoot' end,
                                 'body', 'It is open in your Choose your carrier tab. Review the fleet book and pick it if it fits.',
                                 'tone', 'success', 'href', '/app/agent/#dashboard'),
              'sent', now());
    exception when others then null; end;
  end loop;

  return jsonb_build_object('sent', case when p_dry then 0 else v_sent end, 'dry_run', p_dry, 'recipients', v_out);
end $$;

create or replace function app_private.disp_carrier_available_on_approve()
returns trigger
language plpgsql security definer set search_path = app_private, public as $$
begin
  if new.stage = 'approved' and (tg_op = 'INSERT' or old.stage is distinct from 'approved') then
    begin
      perform app_private.disp_carrier_available_notify(new.carrier_id, false);
    exception when others then
      raise warning 'disp_carrier_available_notify(%) failed: %', new.carrier_id, sqlerrm;  -- never block an approval
    end;
  end if;
  return new;
end $$;

drop trigger if exists trg_disp_carrier_available on app_private.carrier_onboarding;
create trigger trg_disp_carrier_available
  after insert or update of stage on app_private.carrier_onboarding
  for each row execute function app_private.disp_carrier_available_on_approve();

revoke execute on function app_private.disp_carrier_available_notify(uuid, boolean) from public, anon, authenticated;
revoke execute on function app_private.disp_carrier_available_on_approve() from public, anon, authenticated;
