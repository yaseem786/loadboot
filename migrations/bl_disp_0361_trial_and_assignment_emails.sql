-- bl_disp_0361 — three branded e-mails + the end of the carrier "confirm my dispatcher" step.
--   1. Trial e-mail        (cc_dispatcher_decide → trial)   app_private.disp_trial_email      replaces the generic disp_notify body
--   2. Carrier brief       (cc_dispatcher_assign)           app_private.disp_assign_brief_*   to the DISPATCHER; "close these first" is built from EMPTY profile fields
--   3. Carrier intro       (cc_dispatcher_assign)           app_private.disp_assign_email_html REWRITTEN: no confirm button; LoadBoot line + LoadBoot mailbox, never personal contacts
--   4. ack_state is always 'confirmed' in carrier_my_dispatcher + dispatcher_workspace_feed (the carrier already signed the Dispatch
--      Service Agreement). carrier_ack_at is left untouched — we do not write a confirmation nobody gave.
-- Never in any e-mail: carrier fee %, bank / payout data, the dispatcher's personal phone or e-mail.
-- The two public RPCs are patched by ANCHOR (read live body → replace one string → re-create) so staging and prod keep whatever else they have.
-- Every anchor is asserted: a missing anchor raises and the whole migration rolls back.

create or replace function app_private.disp_esc(t text) returns text language sql immutable as
$$ select replace(replace(replace(replace(coalesce(t,''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') $$;

-- bordered box with a small caps label. p_body is code-built markup (user data inside it is already escaped). p_tone: '', 'stop', 'ok', 'note'
create or replace function app_private.disp_box(p_label text, p_body text, p_tone text default '') returns text language sql immutable as $$
  select '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-radius:12px;'
    || case p_tone when 'stop' then 'border:1px solid #fecaca;background:#fef2f2;color:#7f1d1d'
                   when 'ok'   then 'border:1px solid #bbf7d0;background:#f0fdf4;color:#14532d'
                   when 'note' then 'border-left:3px solid #FC5305;background:#fff8f2;color:#334155;border-radius:0 10px 10px 0'
                   else 'border:1px solid #e5e9f0;color:#334155' end
    || '"><tr><td style="padding:14px 18px;line-height:1.65">'
    || case when coalesce(p_label,'') <> '' then '<div style="font-size:11px;letter-spacing:.12em;font-weight:700;text-transform:uppercase;margin-bottom:8px;color:'
         || case p_tone when 'stop' then '#b91c1c' when 'note' then '#9a3412' when 'ok' then '#166534' else '#64748b' end || '">' || p_label || '</div>' else '' end
    || p_body || '</td></tr></table>' $$;

-- navy strip with up to three key/value cells. Values are code-built markup.
create or replace function app_private.disp_strip(k1 text, v1 text, k2 text, v2 text, k3 text, v3 text) returns text language sql immutable as $$
  select '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#10223B;border-radius:14px;margin:0 0 18px"><tr>'
    || (select string_agg('<td style="padding:15px 16px;color:#ffffff;vertical-align:top"><div style="font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#8ea2c3;font-weight:700">'
          || x.k || '</div><div style="font-size:16px;font-weight:800">' || x.v || '</div></td>', '' order by x.o)
        from (values (1,k1,v1),(2,k2,v2),(3,k3,v3)) x(o,k,v) where x.k is not null and x.v is not null)
    || '</tr></table>' $$;

create or replace function app_private.disp_head(p_eye text, p_title text) returns text language sql immutable as $$
  select '<div style="font-size:11px;letter-spacing:.16em;font-weight:700;color:#0883F7;text-transform:uppercase;margin-bottom:6px">' || p_eye || '</div>'
      || '<div style="font-size:23px;font-weight:800;color:#10223B;letter-spacing:-.01em;margin:0 0 14px;line-height:1.25">' || p_title || '</div>' $$;

create or replace function app_private.disp_btn(p_label text, p_url text) returns text language sql immutable as $$
  select '<p style="margin:0 0 18px"><a href="' || p_url || '" style="display:inline-block;background:#0883F7;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:8px">' || p_label || '</a></p>' $$;

-- +14695272754 → (469) 527-2754 ; anything else is returned as it is
create or replace function app_private.disp_fmt_us(p text) returns text language sql immutable as $$
  select case when p ~ '^\+1\d{10}$' then '(' || substr(p,3,3) || ') ' || substr(p,6,3) || '-' || substr(p,9,4) else p end $$;

-- the dispatcher's LoadBoot line (dialer) and LoadBoot mailbox (dmail). Either may be null. The dmail table does not exist on every
-- database yet, so it is looked up dynamically and its absence is not an error.
create or replace function app_private.disp_official_contacts(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path to 'app_private', 'public' as $fn$
declare v_line text; v_box text;
begin
  if to_regclass('app_private.dialer_lines') is not null then
    execute 'select phone_e164 from app_private.dialer_lines where dispatcher_user_id = $1 and status = ''active'' limit 1' into v_line using p_user;
  end if;
  if to_regclass('app_private.dmail_accounts') is not null then
    execute 'select address from app_private.dmail_accounts where assigned_to = $1 order by assigned_at desc nulls last limit 1' into v_box using p_user;
  end if;
  return jsonb_build_object('line', v_line, 'mailbox', v_box);
end $fn$;

-- ───────────────────────── 1. TRIAL E-MAIL ─────────────────────────
create or replace function app_private.disp_trial_email(p_user uuid, p_note text) returns void
language plpgsql security definer set search_path to 'app_private', 'public' as $fn$
declare v_mail text; d record; v_pct text; v_note text; v_html text; v_text text; v_contact text := app_private.disp_contact()->>'email';
begin
  select u.email into v_mail from auth.users u where u.id = p_user;
  if v_mail is null then return; end if;
  select full_name, commission_pct, trial_start, trial_end into d from app_private.dispatcher_profiles where user_id = p_user;
  -- 0 / null commission = terms not set yet. Say so; never print a rate nobody agreed.
  v_pct := case when coalesce(d.commission_pct,0) > 0 then trim(trailing '.' from trim(trailing '0' from to_char(d.commission_pct, 'FM990.00'))) || '%' end;
  v_note := nullif(btrim(coalesce(p_note,'')), '');

  v_html := '<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.65">'
    || app_private.disp_head('LoadBoot Dispatch &middot; Trial', 'Welcome aboard &mdash; your trial has started')
    || '<p style="margin:0 0 14px">Dear ' || app_private.disp_esc(coalesce(nullif(d.full_name,''),'Dispatcher')) || ',</p>'
    || '<p style="margin:0 0 14px">We would like to work with you. Your dispatcher workspace is now open. These are your trial terms in plain words &mdash; please read them once before your first call.</p>'
    || app_private.disp_strip('Starts', to_char(d.trial_start, 'FMDD Mon YYYY'), 'Ends', to_char(d.trial_end, 'FMDD Mon YYYY'),
         'Commission', coalesce('<span style="color:#FC5305">' || v_pct || '</span>', '<span style="font-size:13px;font-weight:700">Confirmed to you in writing</span>'))
    || case when v_note is not null then app_private.disp_box('A note from LoadBoot', replace(app_private.disp_esc(v_note), E'\n', '<br>'), 'note') else '' end
    || app_private.disp_box('Your trial terms',
         '<b>Length:</b> ' || coalesce(to_char(d.trial_start, 'FMDD Mon') || ' to ' || to_char(d.trial_end, 'FMDD Mon YYYY') || ' (working days).', 'the dates above.') || '<br>'
      || '<b>Pay:</b> ' || coalesce(v_pct || ' of the gross line haul on every load you book that is delivered.', 'your commission rate is confirmed to you in writing before your first booking.')
      || ' No base pay during the trial. Your rate is fixed on each load when LoadBoot approves it.<br>'
      || '<b>After the trial:</b> if it goes well, we agree a written package with you. Nothing beyond the trial is promised in this e-mail.<br>'
      || '<b>Load boards:</b> you work from authorised board access only &mdash; never ask a carrier for a permanent personal password.<br>'
      || '<b>Hours:</b> US Eastern business hours.')
    || app_private.disp_box('Your official channels',
         '<b>E-mail:</b> your LoadBoot address, inside your workspace (Email tab). Do not run LoadBoot business from a personal e-mail.<br>'
      || '<b>Phone:</b> your LoadBoot line, inside your workspace. Every broker and carrier call goes through it and is recorded.<br>'
      || '<b>WhatsApp:</b> only the carrier''s LoadBoot dispatch group &mdash; availability, load offers, approvals.')
    || app_private.disp_box('Rules that end a trial',
         'Never book or commit a truck without the carrier''s approval &mdash; silence is not approval. Never promise a load, rate or payment timing that is not verified. '
      || 'Never tell a carrier your pay is added to their bill. Never share carrier bank or payout details with anyone.', 'stop')
    || app_private.disp_box('What happens next', 'LoadBoot assigns you a carrier. You will get a second e-mail with that carrier''s full operating brief &mdash; read it completely before you introduce yourself.')
    || app_private.disp_btn('Open my workspace', 'https://loadboot.com/app/agent/#dashboard')
    || '<p style="margin:0 0 16px"><b>LoadBoot Dispatch</b><br><span style="color:#64748b;font-size:13px">' || v_contact || '</span></p>'
    || '<p style="color:#8ea2c3;font-size:12px;margin:0">You are receiving this because your LoadBoot dispatcher trial has started. This is a summary; the Independent Dispatcher Services Agreement governs the trial.</p></div>';

  v_text := 'Dear ' || coalesce(nullif(d.full_name,''),'Dispatcher') || E',\n\nYour LoadBoot dispatch trial has started: '
    || coalesce(to_char(d.trial_start,'FMDD Mon YYYY'),'?') || ' to ' || coalesce(to_char(d.trial_end,'FMDD Mon YYYY'),'?')
    || '. Commission: ' || coalesce(v_pct, 'confirmed to you in writing') || E'. No base pay during the trial.\n'
    || coalesce(E'\nA note from LoadBoot: ' || v_note || E'\n', '')
    || E'\nRules that end a trial: never book without the carrier''s approval; never promise an unverified load, rate or payment timing; never tell a carrier your pay is added to their bill; never share carrier bank details.\n\nWorkspace: https://loadboot.com/app/agent/#dashboard\n\nLoadBoot Dispatch - ' || v_contact;

  perform app_private.sys_email(v_mail, 'dispatcher.trial.welcome', 'Your LoadBoot dispatch trial has started', v_html, v_text,
    'disp.trial:' || p_user::text || ':' || coalesce(to_char(d.trial_start,'YYYYMMDD'),'x'));
end $fn$;

-- ───────────────────────── 2. CARRIER BRIEF (to the dispatcher) ─────────────────────────
create or replace function app_private.disp_assign_brief_html(p_assignment uuid) returns text
language plpgsql stable security definer set search_path to 'app_private', 'public' as $fn$
declare a record; d record; o record; pf record; pr record; t record; drv record;
  v_floor numeric; v_home text; v_rows text := ''; v_todo text[] := '{}'; v_not text[] := '{}'; v_trucks int := 0; v_fresh boolean; v_tracking boolean;
  v_unit text; v_load text; v_todo_html text := ''; i int; e text; v_contact text := app_private.disp_contact()->>'email';
begin
  select * into a from app_private.dispatcher_assignments where id = p_assignment;
  if a.id is null then return null; end if;
  select full_name into d from app_private.dispatcher_profiles where user_id = a.dispatcher_user_id;
  select id, name, owner_user_id into o from public.organizations where id = a.carrier_org_id;
  select mc, dot, home_base, min_rpm, max_deadhead into pf from public.profiles where id = o.owner_user_id;
  select * into pr from app_private.carrier_dispatch_prefs where carrier_id = a.carrier_org_id;

  v_floor := coalesce(case when coalesce(a.sop->>'min_rate','') ~ '^\d+(\.\d+)?$' then (a.sop->>'min_rate')::numeric end, pr.min_rpm, pf.min_rpm);
  v_home  := coalesce(nullif(pr.home_base,''), nullif(pf.home_base,''));

  for t in select * from app_private.fleet_trucks where carrier_id = a.carrier_org_id and coalesce(status,'active') not in ('inactive','retired') order by unit_no nulls last, created_at limit 6 loop
    v_trucks := v_trucks + 1;
    v_unit := case when coalesce(t.unit_no,'') <> '' then 'Unit ' || app_private.disp_esc(t.unit_no) else 'Truck ' || v_trucks end;
    v_home := coalesce(v_home, nullif(concat_ws(', ', nullif(t.domicile_city,''), nullif(t.domicile_state,'')), ''));
    v_load := concat_ws(' &middot; ',
      case when t.dock_high is true then 'Dock-high' when t.dock_high is false then 'Not dock-high' end,
      case when t.liftgate is true then 'Liftgate' || coalesce(' ' || t.liftgate_cap_lbs || ' lb','') when t.liftgate is false then 'No liftgate' end,
      case when t.has_etrack then 'E-track' end, case when t.has_load_bars then 'Load bars' end, case when t.has_straps then 'Straps' end,
      case when t.has_pallet_jack then 'Pallet jack' end, case when t.has_tarps then 'Tarps' end, case when t.has_chains then 'Chains' end);
    v_rows := v_rows || '<tr><td style="padding:6px 0;border-bottom:1px solid #eef2f7;color:#64748b;width:38%;vertical-align:top">' || v_unit || '</td><td style="padding:6px 0;border-bottom:1px solid #eef2f7">'
      || app_private.disp_esc(concat_ws(' · ', nullif(coalesce(nullif(t.trailer_type,''), t.equipment),''), nullif(concat_ws(' ', t.vin_year, t.vin_make, t.vin_model),''),
           case when t.trailer_len_ft is not null then t.trailer_len_ft || ' ft' when t.cargo_len_in is not null then round(t.cargo_len_in/12.0) || ' ft cargo' end,
           case when t.payload_lbs is not null then to_char(t.payload_lbs,'FM999,999') || ' lb payload' end))
      || case when v_load <> '' then '<br><span style="color:#64748b;font-size:13px">' || v_load || '</span>' else '' end || '</td></tr>';
    if t.trailer_len_ft is null and t.cargo_len_in is null then v_todo := v_todo || (v_unit || ': trailer / cargo length &mdash; 53 ft, 48 ft or other?'); end if;
    if t.payload_lbs is null then v_todo := v_todo || (v_unit || ': true legal max payload in lbs' || case when coalesce(t.vin_gvwr,'') <> '' then ' (the VIN figure on file is a GVWR class band, not cargo capacity)' else '' end || '.'); end if;
    -- only when the carrier SAID there is none. NULL = unknown, and unknown is not printed as a fact.
    if lower(coalesce(t.temp_control,'')) in ('none','no') and not ('Temperature control' = any(v_not)) then v_not := v_not || 'Temperature control'::text; end if;
  end loop;
  if v_trucks = 0 then v_todo := v_todo || 'No truck is registered on this carrier&rsquo;s profile. The carrier registers it in the portal (Fleet) before any load is pursued.'::text; v_not := '{}'; end if;
  if pr.hazmat is false then v_not := v_not || 'Hazmat'::text; end if;
  if pr.team_drivers is false then v_not := v_not || 'Team'::text; end if;

  if v_floor is null then v_todo := v_todo || 'Rate floor: nothing on file. Get the carrier&rsquo;s minimum $/mile.'::text;
  elsif pr.min_rpm_basis is null then v_todo := v_todo || ('Is the $' || to_char(v_floor,'FM990.00') || '/mi floor for loaded miles only, or all miles including deadhead?'); end if;
  if coalesce(pr.max_deadhead_miles, pf.max_deadhead) is null then v_todo := v_todo || 'Deadhead limit in miles.'::text; end if;

  select name, phone, installed_app, location_on into drv from app_private.fleet_drivers where carrier_id = a.carrier_org_id and coalesce(status,'active') = 'active' order by created_at limit 1;
  if drv.name is null then v_todo := v_todo || 'Driver name and phone &mdash; none on file.'::text; end if;
  v_tracking := coalesce(drv.installed_app, false) and coalesce(drv.location_on, false);

  select exists (select 1 from app_private.truck_availability av where av.carrier_id = a.carrier_org_id and av.updated_at > now() - interval '24 hours') into v_fresh;
  if not v_fresh then v_todo := v_todo || 'Current truck location, empty/loaded, next free time and usable HOS &mdash; then ask the carrier to keep it posted: Loads &rarr; Post my truck.'::text; end if;
  if pr.dat_seat is null then v_todo := v_todo || 'DAT dispatcher-seat access &mdash; allowed? any seat cost?'::text; end if;

  i := 0; foreach e in array v_todo loop i := i + 1; v_todo_html := v_todo_html || '<b>' || i || '.</b> ' || e || '<br>'; end loop;

  return '<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.65">'
    || app_private.disp_head('LoadBoot Dispatch &middot; Carrier assignment', 'You are now the dedicated dispatcher for ' || app_private.disp_esc(coalesce(o.name,'this carrier')))
    || '<p style="margin:0 0 14px">Dear ' || app_private.disp_esc(coalesce(nullif(d.full_name,''),'Dispatcher')) || ', this carrier is now open in your workspace. Read this brief fully before you introduce yourself.</p>'
    || app_private.disp_strip('Authority', coalesce('MC ' || app_private.disp_esc(nullif(pf.mc,'')), 'MC not on file') || coalesce('<div style="font-size:10.5px;letter-spacing:.12em;color:#8ea2c3;font-weight:700;margin-top:2px">USDOT ' || app_private.disp_esc(nullif(pf.dot,'')) || '</div>',''),
         'Home base', coalesce(app_private.disp_esc(v_home), 'Not on file'),
         'Rate floor', coalesce('<span style="color:#FC5305">$' || to_char(v_floor,'FM990.00') || '/mi</span>' || coalesce('<div style="font-size:10.5px;letter-spacing:.12em;color:#8ea2c3;font-weight:700;margin-top:2px">' || case pr.min_rpm_basis when 'loaded' then 'LOADED MILES' when 'all' then 'ALL MILES' end || '</div>',''), 'Not on file'))
    || app_private.disp_box('Carrier operating profile', '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">'
         || v_rows
         || (select coalesce(string_agg('<tr><td style="padding:6px 0;border-bottom:1px solid #eef2f7;color:#64748b;width:38%;vertical-align:top">' || x.k || '</td><td style="padding:6px 0;border-bottom:1px solid #eef2f7">' || x.v || '</td></tr>', '' order by x.o), '')
             from (values
               (1, 'Not possible',    nullif(array_to_string(v_not, ', '), '')),
               (2, 'Load size',       app_private.disp_esc(nullif(pr.load_size,''))),
               (3, 'Max weight',      case when pr.max_weight_lbs is not null then to_char(pr.max_weight_lbs,'FM999,999') || ' lb' end),
               (4, 'Deadhead limit',  coalesce(pr.max_deadhead_miles, pf.max_deadhead) || ' mi'),
               (5, 'Preferred lanes', app_private.disp_esc(nullif(array_to_string(pr.preferred_lanes, ', '), ''))),
               (6, 'Avoid states',    app_private.disp_esc(nullif(array_to_string(pr.avoid_states, ', '), ''))),
               (7, 'Haul types',      app_private.disp_esc(nullif(array_to_string(pr.haul_types, ', '), ''))),
               (8, 'Weekends',        case when pr.weekend_ok is true then 'Available' when pr.weekend_ok is false then 'Not available' end),
               (9, 'Home time',       app_private.disp_esc(nullif(pr.home_time,''))),
               (10,'DAT seat',        case pr.dat_seat when 'yes' then 'Allowed' when 'no' then 'Not allowed' when 'paid' then 'Allowed &mdash; seat has a cost' end || coalesce(' &middot; ' || app_private.disp_esc(pr.dat_seat_note), '')),
               (11,'Primary driver',  app_private.disp_esc(nullif(concat_ws(' · ', drv.name, drv.phone), ''))),
               (12,'Live tracking',   case when v_tracking then 'Driver app active with location on' else 'Driver app not active &mdash; do not assume GPS or HOS' end)
             ) x(o,k,v) where x.v is not null)
         || '</table>')
    || case when v_todo_html <> '' then app_private.disp_box('Close these before you hunt loads', v_todo_html
           || '<span style="font-size:13px">Home base is not the truck&rsquo;s live position. No booking until these are closed. Send the answers to LoadBoot so the profile is updated.</span>', 'stop')
         else app_private.disp_box('', '<b>The profile has no open gaps.</b> Confirm the truck&rsquo;s live position and hours with the carrier, then start.', 'ok') end
    || app_private.disp_box('Your first steps',
         '<b>1.</b> Reply to LoadBoot: &ldquo;I have reviewed the handoff and I am ready to manage this carrier.&rdquo;<br>'
      || '<b>2.</b> LoadBoot opens the private WhatsApp dispatch group (carrier, you, LoadBoot ops).<br>'
      || '<b>3.</b> Introduce yourself there: your name, that you dispatch with LoadBoot for this carrier, your hours, that there is no extra dispatcher fee to the carrier, and that the carrier approves every load.<br>'
      || '<b>4.</b> Call the carrier on your LoadBoot line and close the open items above.<br><b>5.</b> Start daily load pursuit.')
    || app_private.disp_box('Every load &mdash; the standard',
         'Open the carrier&rsquo;s latest availability each morning. Verify the broker (authority, identity, double-brokering signs). Work out deadhead + loaded miles, loaded RPM and all-in RPM against the carrier&rsquo;s floor. '
      || 'Send a decision card to the group: lane, dates, commodity/weight, miles, rate, RPMs, broker, facility limits, and your call &mdash; <b>BOOK / NEGOTIATE / PASS</b>. '
      || 'Carrier approves &rarr; rate confirmation checked against what was negotiated &rarr; logged in your workspace &rarr; LoadBoot approves &rarr; driver moves.')
    || app_private.disp_box('If the carrier goes quiet',
         'Group message &rarr; 2&ndash;3 calls at different times &rarr; driver (location/HOS only, never money or contracts) &rarr; post a status update in the group &rarr; keep posting loads marked &ldquo;Candidate &mdash; approval required&rdquo; for 2 days &rarr; then escalate to LoadBoot Operations. Never invent availability. Never book.')
    || app_private.disp_box('', '<b>What you tell the carrier about money:</b> there is no extra charge for a dedicated dispatcher. Their LoadBoot pricing stays exactly as it is. Your pay is LoadBoot&rsquo;s responsibility and is never added to their invoice.', 'ok')
    || app_private.disp_btn('Open this carrier in my workspace', 'https://loadboot.com/app/agent/#dashboard')
    || '<p style="margin:0 0 16px"><b>LoadBoot Dispatch</b><br><span style="color:#64748b;font-size:13px">' || v_contact || '</span></p>'
    || '<p style="color:#8ea2c3;font-size:12px;margin:0">Confidential operational use. Do not forward. Carrier bank and payout details are never part of your brief.</p></div>';
end $fn$;

create or replace function app_private.disp_assign_brief_email(p_assignment uuid) returns void
language plpgsql security definer set search_path to 'app_private', 'public' as $fn$
declare v_mail text; v_cname text; v_html text;
begin
  select u.email, o.name into v_mail, v_cname from app_private.dispatcher_assignments a
    join auth.users u on u.id = a.dispatcher_user_id join public.organizations o on o.id = a.carrier_org_id where a.id = p_assignment;
  if v_mail is null then return; end if;
  v_html := app_private.disp_assign_brief_html(p_assignment);
  if v_html is null then return; end if;
  perform app_private.sys_email(v_mail, 'dispatcher.assigned.brief', 'New carrier assigned: ' || coalesce(v_cname,'carrier') || ' — read before first contact', v_html,
    'You are now the dedicated dispatcher for ' || coalesce(v_cname,'a carrier') || '. Open this e-mail in HTML or your workspace for the full operating brief: https://loadboot.com/app/agent/#dashboard',
    'dispatcher.brief:' || p_assignment::text);
end $fn$;

-- ───────────────────────── 3. CARRIER INTRO (rewritten, no confirm) ─────────────────────────
create or replace function app_private.disp_assign_email_html(p_assignment uuid) returns text
language plpgsql stable security definer set search_path to 'app_private', 'public' as $fn$
declare a record; d record; c record; oc jsonb; v_line text; v_box text; v_hours text; v_first text; v_contact text := app_private.disp_contact()->>'email';
begin
  select * into a from app_private.dispatcher_assignments where id = p_assignment;
  if a.id is null then return null; end if;
  select dp.full_name, dp.skills into d from app_private.dispatcher_profiles dp where dp.user_id = a.dispatcher_user_id;
  select o.name, p.contact_name into c from public.organizations o left join public.profiles p on p.id = o.owner_user_id where o.id = a.carrier_org_id;
  oc := app_private.disp_official_contacts(a.dispatcher_user_id);
  v_line := app_private.disp_fmt_us(oc->>'line');              -- LoadBoot line only. The dispatcher's personal phone is never used.
  v_box  := coalesce(oc->>'mailbox', v_contact);               -- LoadBoot mailbox, else the shared dispatch address.
  v_hours := coalesce(nullif(d.skills->>'timezone',''), 'US Eastern');
  v_first := coalesce(nullif(split_part(coalesce(c.contact_name,''), ' ', 1),''), 'there');

  return '<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.65">'
    || app_private.disp_head('LoadBoot Dispatch', 'Your dedicated dispatcher is assigned')
    || '<p style="margin:0 0 14px">Hi ' || app_private.disp_esc(v_first) || ',</p>'
    || '<p style="margin:0 0 14px">' || app_private.disp_esc(coalesce(c.name,'Your company')) || ' now has a dedicated LoadBoot dispatcher. He is already assigned &mdash; <b>you do not need to confirm anything.</b></p>'
    || app_private.disp_strip('Your dispatcher', app_private.disp_esc(coalesce(nullif(d.full_name,''),'LoadBoot dispatcher')),
         case when v_line is not null then 'Call / text' end, '<span style="color:#FC5305">' || v_line || '</span>', 'Hours', app_private.disp_esc(v_hours))
    || app_private.disp_box('How to reach your dispatcher',
         case when v_line is not null then '<b>Phone / text:</b> ' || v_line || ' &mdash; the dispatcher&rsquo;s LoadBoot line<br>' else '' end
      || '<b>E-mail:</b> <a href="mailto:' || app_private.disp_esc(v_box) || '" style="color:#0883F7">' || app_private.disp_esc(v_box) || '</a><br>'
      || '<b>WhatsApp:</b> your private LoadBoot dispatch group')
    || app_private.disp_box('', '<b>No extra charge.</b> A dedicated dispatcher does not change your LoadBoot pricing. The dispatcher&rsquo;s pay is LoadBoot&rsquo;s responsibility and is never added to your invoice.', 'ok')
    || app_private.disp_box('What your dispatcher does for you', 'Finds loads that fit your truck, lanes and rate floor every day. Checks the broker before bringing you a load. Negotiates the rate. Sends you the full numbers &mdash; miles, deadhead, rate per mile &mdash; before anything is committed. Checks the rate confirmation. Follows the load until the paperwork is in.')
    || app_private.disp_box('What your dispatcher cannot do', 'Your truck cannot be booked without your OK &mdash; <b>you approve every load.</b> Your dispatcher never sees your bank details or payout information.')
    || app_private.disp_box('One thing that gets you loads faster', 'Keep your truck posted: <b>Loads &rarr; Post my truck</b> whenever you are empty or know your next free time. Your dispatcher starts from that post every morning.')
    || app_private.disp_btn('Open my carrier portal', 'https://loadboot.com/app/carrier/')
    || '<p style="margin:0 0 16px;font-size:13px;color:#64748b">Not the right fit? <a href="mailto:' || v_contact || '?subject=Change%20my%20dispatcher" style="color:#0883F7">Ask LoadBoot to change your dispatcher</a> &mdash; LoadBoot dispatch covers your truck in the meantime.</p>'
    || '<p style="margin:0 0 16px"><b>LoadBoot Dispatch</b><br><span style="color:#64748b;font-size:13px">' || v_contact || '</span></p>'
    || '<p style="color:#8ea2c3;font-size:12px;margin:0">You are receiving this because your company signed the LoadBoot Dispatch Service Agreement. This is a transactional notice about your account, not a marketing e-mail.</p></div>';
end $fn$;

revoke all on function app_private.disp_official_contacts(uuid), app_private.disp_trial_email(uuid,text), app_private.disp_assign_brief_html(uuid),
  app_private.disp_assign_brief_email(uuid), app_private.disp_assign_email_html(uuid) from public, anon, authenticated;

-- ───────────────────────── 4. ANCHOR PATCHES ─────────────────────────
do $patch$
declare
  v_def text; v_ack constant text := 'case when a.carrier_ack_at is not null then ''confirmed'' when coalesce(a.carrier_notified_at, a.assigned_at) < now() - interval ''72 hours'' then ''notified'' else ''pending'' end';
  procedure_missing text;
begin
  -- 4a. cc_dispatcher_decide: branded trial e-mail instead of the generic one (only on a real move INTO trial)
  v_def := pg_get_functiondef('public.cc_dispatcher_decide(uuid,text,text)'::regprocedure);
  if position('disp_trial_email' in v_def) = 0 then
    if position('''/app/agent/#dashboard'', v_new in (''trial'',''verified'',''active'',''suspended''));' in v_def) = 0 then raise exception '0361: decide anchor missing'; end if;
    v_def := replace(v_def, '''/app/agent/#dashboard'', v_new in (''trial'',''verified'',''active'',''suspended''));',
      '''/app/agent/#dashboard'', (v_new in (''verified'',''active'',''suspended'') or (v_new = ''trial'' and not (p_action = ''trial'' and v_old is distinct from ''trial''))));' || E'\n\n'
      || '  if p_action = ''trial'' and v_old is distinct from ''trial'' then' || E'\n'
      || '    begin perform app_private.disp_trial_email(p_user, p_note); exception when others then null; end;' || E'\n  end if;');
    execute v_def;
  end if;

  -- 4b. cc_dispatcher_assign: brief to the dispatcher, no "confirm" wording to the carrier
  v_def := pg_get_functiondef('public.cc_dispatcher_assign(uuid,uuid,jsonb)'::regprocedure);
  if position('disp_assign_brief_email' in v_def) = 0 then
    if position('First message in the shared thread should be yours.'', ''/app/agent/#dashboard'', true);' in v_def) = 0 then raise exception '0361: assign anchor 1 missing'; end if;
    if position('Open your dashboard to review and confirm.' in v_def) = 0 then raise exception '0361: assign anchor 2 missing'; end if;
    if position(''' is your LoadBoot dispatcher. Confirm: https://loadboot.com/app/carrier/?ack='' || v_id::text,' in v_def) = 0 then raise exception '0361: assign anchor 3 missing'; end if;
    v_def := replace(v_def, 'First message in the shared thread should be yours.'', ''/app/agent/#dashboard'', true);',
      'First message in the shared thread should be yours.'', ''/app/agent/#dashboard'', false);' || E'\n'
      || '  begin perform app_private.disp_assign_brief_email(v_id); exception when others then null; end;');
    v_def := replace(v_def, 'Open your dashboard to review and confirm.', 'Already assigned — there is nothing for you to confirm.');
    v_def := replace(v_def, ''' is your LoadBoot dispatcher. Confirm: https://loadboot.com/app/carrier/?ack='' || v_id::text,',
      ''' is your dedicated LoadBoot dispatcher. Already assigned - nothing to confirm. Portal: https://loadboot.com/app/carrier/'',');
    execute v_def;
  end if;

  -- 4c. no pending/notified state any more
  v_def := pg_get_functiondef('public.carrier_my_dispatcher()'::regprocedure);
  if position(v_ack in v_def) > 0 then execute replace(v_def, v_ack, '''confirmed''::text'); elsif position('''confirmed''::text' in v_def) = 0 then raise exception '0361: carrier_my_dispatcher anchor missing'; end if;
  select p.oid::regprocedure::text into procedure_missing from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'dispatcher_workspace_feed';
  if procedure_missing is null then raise exception '0361: dispatcher_workspace_feed not found'; end if;
  v_def := pg_get_functiondef(procedure_missing::regprocedure);
  if position(v_ack in v_def) > 0 then execute replace(v_def, v_ack, '''confirmed''::text'); elsif position('''confirmed''::text' in v_def) = 0 then raise exception '0361: workspace_feed anchor missing'; end if;
end $patch$;
