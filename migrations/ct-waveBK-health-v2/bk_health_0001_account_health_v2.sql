-- ct-waveBK · Account Health v2 — grouped factor model (Amazon Seller Central style)
-- Carrier branch rebuilt into 5 weighted groups (reliability 35 / communication 20 /
-- compliance 20 / conduct 15 / financial 10) with per-item value/target/basis/improve,
-- new-carrier grace tier "building" (<5 delivered loads AND account <30 days old:
-- performance groups observed but NOT deducted). Broker/shipper branches unchanged.
-- Backward compatible: keeps score/tier/deductions/delivered_trips/window_days keys;
-- adds groups[] + grace. CREATE OR REPLACE preserves existing ACL (authenticated-only).

create or replace function public.cc_account_health(p_org uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path to 'app_private', 'public'
as $function$
declare
  v_org uuid; v_kind text; v_self uuid;
  v_score int := 100; f jsonb := '[]'::jsonb; grps jsonb := '[]'::jsonb;
  items jsonb; gd int; d int; pct numeric;
  W constant interval := interval '180 days';
  v_del int := 0; v_ontime int := 0; v_sched int := 0; v_cancel int := 0; v_tracked int := 0;
  v_exc int := 0; v_ok boolean := true; v_expired int := 0; v_expiring int := 0;
  v_viol int := 0; v_vn int := 0; v_emg int := 0; v_over int := 0;
  v_age int := 9999; v_grace boolean := false;
  n1 int; n2 int; n3 int;
begin
  v_self := app_private.my_carrier_org();
  if v_self is null then v_self := app_private.my_partner_org('broker'); end if;
  if v_self is null then v_self := app_private.my_partner_org('shipper'); end if;
  v_org := coalesce(p_org, v_self);
  if v_org is null then raise exception 'account required' using errcode='42501'; end if;
  if v_org <> coalesce(v_self, '00000000-0000-0000-0000-000000000000'::uuid) and not public.is_active_staff() then
    raise exception 'not authorized' using errcode='42501'; end if;
  select kind, coalesce(extract(day from now() - created_at)::int, 9999)
    into v_kind, v_age from public.organizations where id = v_org;
  if v_kind is null then raise exception 'unknown organization' using errcode='22023'; end if;

  if v_kind = 'carrier' then
    select count(*) filter (where status in ('delivered','invoiced')),
           count(*) filter (where status in ('delivered','invoiced') and scheduled_delivery is not null and delivered_at <= scheduled_delivery),
           count(*) filter (where status in ('delivered','invoiced') and scheduled_delivery is not null),
           count(*) filter (where status = 'cancelled'),
           count(*) filter (where status in ('delivered','invoiced') and (last_loc_at is not null or tracking_method is not null))
      into v_del, v_ontime, v_sched, v_cancel, v_tracked
      from app_private.trips where carrier_id = v_org and created_at > now() - W;
    v_grace := (v_del < 5 and v_age < 30);

    ------------------------------------------------------------------
    -- G1 · Service reliability (35)
    ------------------------------------------------------------------
    items := '[]'::jsonb; gd := 0;
    if v_sched >= 3 then
      pct := round(v_ontime::numeric / v_sched * 100);
      d := case when pct >= 95 then 0 else least(round((95 - pct) / 4)::int, 20) end;
      if v_grace then d := 0; end if;
      items := items || jsonb_build_object('key','ontime','label','On-time delivery','value', pct || '%','target','>= 95%','deducted',d,
        'basis', v_ontime || ' of ' || v_sched || ' scheduled deliveries on time (180-day window)',
        'improve','Deliver inside the scheduled window. Rolling window — every new on-time load replaces an older late one.');
      gd := gd + d;
    else
      items := items || jsonb_build_object('key','ontime','label','On-time delivery','value', case when v_sched = 0 then 'no data yet' else v_ontime || ' of ' || v_sched end,'target','>= 95%','deducted',0,
        'basis','Not graded until 3+ scheduled deliveries — small samples are unfair.',
        'improve','Run loads with Arrive/Depart check-ins; grading starts at 3 scheduled deliveries.');
    end if;
    d := least(v_cancel * 5, 15); if v_grace then d := 0; end if;
    items := items || jsonb_build_object('key','cancels','label','Carrier cancellations','value', v_cancel,'target','0','deducted',d,
      'basis', v_cancel || ' cancellation(s) in the last 180 days',
      'improve','Only accept loads you can run. Cancellations age out of the window automatically.');
    gd := gd + d;
    grps := grps || jsonb_build_object('key','reliability','label','Service reliability','weight',35,'deducted',least(gd,35),'earned',35 - least(gd,35),'items',items);
    v_score := v_score - least(gd,35);

    ------------------------------------------------------------------
    -- G2 · Communication & tracking (20)
    ------------------------------------------------------------------
    items := '[]'::jsonb; gd := 0;
    if v_del >= 3 then
      pct := round(v_tracked::numeric / v_del * 100);
      d := case when pct >= 90 then 0 else least(round((90 - pct) / 7)::int, 12) end;
      if v_grace then d := 0; end if;
      items := items || jsonb_build_object('key','tracking','label','Tracking coverage','value', pct || '%','target','>= 90%','deducted',d,
        'basis', v_tracked || ' of ' || v_del || ' delivered trips had live tracking / location updates',
        'improve','Keep tracking on for every trip — enable location sharing or post status check-ins.');
      gd := gd + d;
    else
      items := items || jsonb_build_object('key','tracking','label','Tracking coverage','value','no data yet','target','>= 90%','deducted',0,
        'basis','Not graded until 3+ delivered trips.','improve','Keep tracking on from your first load.');
    end if;
    select count(*) into v_exc from app_private.trip_exceptions e join app_private.trips t on t.id = e.trip_id
      where t.carrier_id = v_org and e.status = 'open';
    d := least(v_exc * 3, 8);
    items := items || jsonb_build_object('key','exceptions','label','Open trip exceptions','value', v_exc,'target','0','deducted',d,
      'basis', v_exc || ' unresolved exception(s) (detention, POD, issues)',
      'improve','Resolve open exceptions with your dispatcher — clears the moment each one is closed.');
    gd := gd + d;
    grps := grps || jsonb_build_object('key','communication','label','Communication & tracking','weight',20,'deducted',least(gd,20),'earned',20 - least(gd,20),'items',items);
    v_score := v_score - least(gd,20);

    ------------------------------------------------------------------
    -- G3 · Compliance & documents (20)
    ------------------------------------------------------------------
    items := '[]'::jsonb; gd := 0;
    begin v_ok := app_private.carrier_mandatory_ok(v_org); exception when others then v_ok := true; end;
    d := case when v_ok then 0 else 12 end;
    items := items || jsonb_build_object('key','mandatory','label','Mandatory documents current','value', case when v_ok then 'yes' else 'no' end,'target','yes','deducted',d,
      'basis', case when v_ok then 'All required documents are verified and current' else 'Authority / insurance / required documents not current' end,
      'improve','Upload and get verified: authority, insurance/COI, W-9 and required onboarding documents. Clears immediately on verification.');
    gd := gd + d;
    select count(*) filter (where expiry_date < current_date),
           count(*) filter (where expiry_date >= current_date and expiry_date < current_date + 30)
      into v_expired, v_expiring
      from app_private.carrier_compliance where carrier_id = v_org and status = 'verified' and expiry_date is not null;
    d := least(v_expired * 4, 8);
    items := items || jsonb_build_object('key','expiry','label','Expired documents','value', v_expired,'target','0','deducted',d,
      'basis', v_expired || ' verified document(s) past expiry' || case when v_expiring > 0 then ' · ' || v_expiring || ' expiring within 30 days' else '' end,
      'improve','Replace documents before they expire — you get an expiring-soon warning 30 days ahead.');
    gd := gd + d;
    grps := grps || jsonb_build_object('key','compliance','label','Compliance & documents','weight',20,'deducted',least(gd,20),'earned',20 - least(gd,20),'items',items,'expiring_soon',v_expiring);
    v_score := v_score - least(gd,20);

    ------------------------------------------------------------------
    -- G4 · Conduct — staff warnings & violations (15)
    ------------------------------------------------------------------
    items := '[]'::jsonb; gd := 0;
    select coalesce(sum(points),0), count(*) into v_viol, v_vn from app_private.account_violations
      where org_id = v_org and resolved_at is null
        and created_at > now() - (case when points <= 5 then interval '90 days'
                                       when points <= 15 then interval '180 days'
                                       else interval '365 days' end);
    begin
      select count(*) into v_emg from app_private.trip_emergency_requests
        where carrier_id = v_org and status in ('denied','rejected') and created_at > now() - W;
    exception when others then v_emg := 0; end;
    gd := least(v_viol + v_emg * 2, 15);
    items := items || jsonb_build_object('key','violations','label','Warnings & violations','value', v_vn || ' open (' || v_viol || ' pts)' || case when v_emg > 0 then ' · ' || v_emg || ' denied emergency claim(s)' else '' end,'target','0','deducted',gd,
      'basis', v_vn || ' unresolved item(s) issued by LoadBoot staff',
      'improve','Fix the cited issue. Strikes auto-clear if not repeated — warnings 90 days, violations 180, critical 365 — or ask your dispatcher to resolve once corrected.');
    grps := grps || jsonb_build_object('key','conduct','label','Conduct & policy','weight',15,'deducted',gd,'earned',15 - gd,'items',items);
    v_score := v_score - gd;

    ------------------------------------------------------------------
    -- G5 · Financial conduct (10)
    ------------------------------------------------------------------
    items := '[]'::jsonb; gd := 0;
    begin
      select count(*) into v_over from app_private.partner_invoices
        where partner_org = v_org and coalesce(status,'') not in ('paid','void','cancelled') and due_date is not null and due_date < current_date;
    exception when others then v_over := 0; end;
    gd := least(v_over * 5, 10);
    items := items || jsonb_build_object('key','fees','label','Platform dues on time','value', case when v_over = 0 then 'clear' else v_over || ' overdue' end,'target','0 overdue','deducted',gd,
      'basis', case when v_over = 0 then 'No overdue LoadBoot invoices' else v_over || ' invoice(s) past due date' end,
      'improve','Pay dispatch-fee invoices by the due date; clears as soon as payment is recorded.');
    grps := grps || jsonb_build_object('key','financial','label','Financial conduct','weight',10,'deducted',gd,'earned',10 - gd,'items',items);
    v_score := v_score - gd;

    -- legacy flat deductions list (kept for existing UIs)
    select coalesce(jsonb_agg(jsonb_build_object('label', i->>'label', 'deducted', (i->>'deducted')::int, 'basis', i->>'basis', 'improve', i->>'improve')), '[]'::jsonb)
      into f from jsonb_array_elements(grps) g2, jsonb_array_elements(g2->'items') i
      where (i->>'deducted')::int > 0;

  elsif v_kind = 'broker' then
    n1 := 0;
    begin select count(*) into n1 from app_private.load_document_checklist c
        join app_private.partner_loads pl on pl.id = c.subject_id and c.subject_type = 'partner_load'
        where pl.broker_org = v_org and c.required_from = 'broker' and c.status = 'rejected';
    exception when others then n1 := 0; end;
    d := least(n1 * 4, 16);
    if d > 0 then f := f || jsonb_build_object('label','Rejected broker documents','deducted',d,'basis', n1 || ' broker-side document(s) rejected by dispatch review','improve','Re-upload correct versions of the rejected documents; the deduction clears when they pass review.'); end if;
    v_score := v_score - d;
    n2 := 0;
    begin select count(*) into n2 from app_private.update_requests ur
        join app_private.partner_loads pl on pl.id = ur.subject_id
        where pl.broker_org = v_org and ur.status = 'open' and ur.created_at < now() - interval '48 hours';
    exception when others then n2 := 0; end;
    d := least(n2 * 5, 15);
    if d > 0 then f := f || jsonb_build_object('label','Unanswered update requests','deducted',d,'basis', n2 || ' dispatch request(s) open beyond 48h','improve','Respond to open dispatch update requests within 48 hours; clears as soon as you answer them.'); end if;
    v_score := v_score - d;
    n3 := 0;
    begin select count(*) into n3 from app_private.partner_shipments s
        where s.assigned_broker = v_org and s.status = 'assigned' and s.updated_at < now() - interval '48 hours';
    exception when others then n3 := 0; end;
    d := least(n3 * 5, 15);
    if d > 0 then f := f || jsonb_build_object('label','Shipper requests awaiting quote','deducted',d,'basis', n3 || ' assigned request(s) unquoted beyond 48h','improve','Quote assigned shipper requests within 48 hours; clears when you send the quote.'); end if;
    v_score := v_score - d;
    -- broker violations (kept from v1)
    select coalesce(sum(points),0), count(*) into v_viol, v_vn from app_private.account_violations
      where org_id = v_org and resolved_at is null
        and created_at > now() - (case when points <= 5 then interval '90 days' when points <= 15 then interval '180 days' else interval '365 days' end);
    d := least(v_viol, 60);
    if d > 0 then f := f || jsonb_build_object('label','Open warnings / violations','deducted',d,'basis', v_vn || ' unresolved item(s) issued by LoadBoot staff','improve','Fix the cited issue; strikes auto-clear over time if not repeated.'); end if;
    v_score := v_score - d;
  elsif v_kind = 'shipper' then
    n1 := 0;
    begin select count(*) into n1 from app_private.partner_shipments s
        where s.shipper_org = v_org and coalesce(s.status,'') not in ('closed','declined','tendered')
          and (coalesce(trim(s.facility_notes),'') = '' or coalesce(trim(s.dock_hours),'') = '');
    exception when others then n1 := 0; end;
    d := least(n1 * 3, 12);
    if d > 0 then f := f || jsonb_build_object('label','Incomplete shipment requests','deducted',d,'basis', n1 || ' open request(s) missing facility notes or dock hours a broker needs','improve','Add facility notes and dock hours to your open shipment requests; clears when each request is complete.'); end if;
    v_score := v_score - d;
    select coalesce(sum(points),0), count(*) into v_viol, v_vn from app_private.account_violations
      where org_id = v_org and resolved_at is null
        and created_at > now() - (case when points <= 5 then interval '90 days' when points <= 15 then interval '180 days' else interval '365 days' end);
    d := least(v_viol, 60);
    if d > 0 then f := f || jsonb_build_object('label','Open warnings / violations','deducted',d,'basis', v_vn || ' unresolved item(s) issued by LoadBoot staff','improve','Fix the cited issue; strikes auto-clear over time if not repeated.'); end if;
    v_score := v_score - d;
  end if;

  v_score := greatest(v_score, 0);
  return jsonb_build_object('org', v_org, 'kind', v_kind, 'score', v_score,
    'tier', case when v_kind = 'carrier' and v_grace then 'building'
                 when v_score >= 90 then 'healthy'
                 when v_score >= 70 then 'at_risk'
                 else 'critical' end,
    'grace', v_grace,
    'deductions', f, 'groups', grps, 'delivered_trips', coalesce(v_del, 0), 'window_days', 180,
    'basis', 'Score = 100 minus itemized deductions across five weighted areas: Service reliability (35), Communication & tracking (20), Compliance & documents (20), Conduct & policy (15), Financial conduct (10). Performance is a 180-day rolling window; staff strikes auto-recover (warnings 90d, violations 180d, critical 365d) if not repeated; compliance and exceptions clear the moment they are fixed. New carriers (< 5 delivered loads and < 30 days) are in a Building grace period: performance is observed but not deducted.');
end; $function$;
