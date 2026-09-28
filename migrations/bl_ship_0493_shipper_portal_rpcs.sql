-- bl_ship_0493 — portal + Command Center plumbing for the two-lane shipper onboarding. Run after 0491/0492. Staging first.
--   1. org_onboarding_complete / cc_onboarding_review_item / cc_partner_overview read the lane gates for shippers
--      (system items — email, agreements, facilities — have no packet row, so the old tag count could never finish).
--   2. cc_shipper_brokers(): the Brokers tab — verified brokers only, or a polite "none live yet" answer.
--   3. cc_shipper_post_load: a tender may name the broker the SHIPPER chose (must be verified).
--   4. cc_assign_shipment: staff can no longer hand a shipper's freight to a broker — the shipper chooses.
--   5. cc_shipper_verification(p_org): staff view for Shipper 360 — every section's answers, trust signals, call-back, stage.

create or replace function app_private._bl0493_patch(p_fn regprocedure, p_old text, p_new text)
returns void language plpgsql as $$
declare d text; n int;
begin
  d := pg_get_functiondef(p_fn);
  n := (length(d) - length(replace(d, p_old, ''))) / greatest(length(p_old), 1);
  if n <> 1 then raise exception 'bl_ship_0493 patch: anchor found % times in % — refusing', n, p_fn; end if;
  execute replace(d, p_old, p_new);
end $$;

-- ───────────── 1. completion reads the lane gates for shippers ─────────────
create or replace function app_private.org_onboarding_complete(p_org uuid)
returns boolean language sql stable security definer set search_path to 'app_private', 'public' as $$
  select case when (select kind from public.organizations where id = p_org) = 'shipper'
    -- bl_ship_0491: a shipper is "complete" when at least one lane is open
    then coalesce((app_private.shipper_lane_gate(p_org, 'direct')->>'ok')::boolean, false)
      or coalesce((app_private.shipper_lane_gate(p_org, 'broker')->>'ok')::boolean, false)
    else (select count(*) = 0
            from public.organizations o
            join app_private.onboarding_packet_templates t on t.org_kind = o.kind
            left join app_private.org_onboarding_items i on i.org_id = o.id and i.item_key = t.item_key
           where o.id = p_org and app_private.packet_tag_mandatory(t.status_tag)
             and coalesce(i.status,'pending') not in ('verified','waived'))
  end
$$;

select app_private._bl0493_patch('public.cc_onboarding_review_item(uuid,text,text,text)'::regprocedure,
$a$  ) into v_complete;$a$,
$b$  ) into v_complete;
  if (select kind from public.organizations where id = p_org) = 'shipper' then v_complete := app_private.org_onboarding_complete(p_org); end if;  -- bl_ship_0491$b$);

select app_private._bl0493_patch('public.cc_partner_overview()'::regprocedure,
$a$    'onboarded', v_pending = 0, 'onboarding_pending', v_pending)$a$,
$b$    'onboarded', case when r.kind = 'shipper' then coalesce((app_private.shipper_lane_gate(r.org_id, 'direct')->>'ok')::boolean, false) else v_pending = 0 end,
    'onboarding_pending', v_pending)
    || case when r.kind = 'shipper' then jsonb_build_object('shipper_stage', app_private.shipper_stage(r.org_id),
         'direct_ok', coalesce((app_private.shipper_lane_gate(r.org_id, 'direct')->>'ok')::boolean, false),
         'broker_ok', coalesce((app_private.shipper_lane_gate(r.org_id, 'broker')->>'ok')::boolean, false)) else '{}'::jsonb end$b$);

-- ───────────── 2. Brokers tab ─────────────
create or replace function public.cc_shipper_brokers()
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare v_org uuid; v_list jsonb;
begin
  v_org := app_private.my_shipper_org();
  if v_org is null then raise exception 'not a shipper account' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'name', o.name, 'mc', o.mc_number, 'dot', o.dot_number, 'logo', o.logo_path,
           'bond_verified_at', (select i.reviewed_at from app_private.org_onboarding_items i where i.org_id = o.id and i.item_key = 'bmc84_bond'),
           'loads_posted', (select count(*) from app_private.partner_loads pl where pl.broker_org = o.id),
           'loads_delivered', (select count(*) from app_private.partner_loads pl where pl.broker_org = o.id and pl.status = 'delivered')
         ) order by o.name), '[]'::jsonb)
    into v_list
    from public.organizations o where o.id in (select app_private.verified_broker_orgs());
  return jsonb_build_object(
    'available', jsonb_array_length(v_list) > 0,
    'lane_open', coalesce((app_private.shipper_lane_gate(v_org, 'broker')->>'ok')::boolean, false),
    'brokers', v_list,
    'message', case when jsonb_array_length(v_list) = 0 then
      'We are onboarding licensed, bonded freight brokers on LoadBoot right now. Every broker here is checked against FMCSA broker authority and the $75,000 BMC-84/85 bond before you ever see them. Please check back in 2–3 days — or post this load straight to verified carriers today.' end);
end $$;

-- ───────────── 3. tender to the broker the shipper chose ─────────────
select app_private._bl0493_patch('public.cc_shipper_post_load(jsonb)'::regprocedure,
$a$    returning id into v_id;$a$,
$b$    returning id into v_id;
  -- bl_ship_0491: the SHIPPER may name the broker; it must be a verified broker. Otherwise any verified broker may claim it.
  if nullif(p->>'broker_org','') is not null then
    if (p->>'broker_org')::uuid not in (select app_private.verified_broker_orgs()) then
      raise exception 'That broker is not verified on LoadBoot. Pick one from the Brokers tab.' using errcode = '22023'; end if;
    update app_private.partner_shipments set assigned_broker = (p->>'broker_org')::uuid, status = 'assigned', lane = 'broker',
           accepted_by = auth.uid(), accepted_at = now(), updated_at = now() where id = v_id;
  end if;$b$);

-- ───────────── 4. staff never allocate a shipper's freight ─────────────
select app_private._bl0493_patch('public.cc_assign_shipment(uuid,uuid)'::regprocedure,
$a$    raise exception 'not authorized' using errcode='42501'; end if;$a$,
$b$    raise exception 'not authorized' using errcode='42501'; end if;
  -- bl_ship_0491: LoadBoot never chooses which broker gets a shipper's freight (FMCSA 2023 guidance on allocating traffic).
  raise exception 'The shipper chooses the broker for its own freight. LoadBoot staff can decline (block) a shipment, but not assign it.' using errcode = '42501';$b$);

-- ───────────── 5. staff view ─────────────
create or replace function public.cc_shipper_verification(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare t app_private.shipper_trust; cond jsonb;
begin
  if not public.has_global_permission('partners.manage') then raise exception 'not authorized' using errcode = '42501'; end if;
  if not exists (select 1 from public.organizations where id = p_org and kind = 'shipper') then raise exception 'not a shipper' using errcode = '22023'; end if;
  select * into t from app_private.shipper_trust where org_id = p_org;
  cond := app_private.shipper_conditions(p_org);
  return jsonb_build_object(
    'stage', app_private.shipper_stage(p_org), 'tier', app_private.shipper_tier(p_org),
    'direct', app_private.shipper_lane_gate(p_org, 'direct'), 'broker', app_private.shipper_lane_gate(p_org, 'broker'),
    'graduated', app_private.shipper_graduated(p_org),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('key', tp.item_key, 'label', tp.label, 'section', tp.section, 'type', tp.item_type,
                'active', tp.condition is null or coalesce((cond->>tp.condition)::boolean, false),
                'status', app_private.shipper_item_status(p_org, tp.item_key), 'data', i.data, 'ref', i.ref, 'note', i.note,
                'file_path', i.file_path, 'submitted_at', i.submitted_at, 'reviewed_at', i.reviewed_at) order by tp.sort), '[]'::jsonb)
              from app_private.onboarding_packet_templates tp
              left join app_private.org_onboarding_items i on i.org_id = p_org and i.item_key = tp.item_key
             where tp.org_kind = 'shipper' and tp.item_type <> 'legacy'),
    'trust', jsonb_build_object('domain', t.domain, 'free_mail', t.free_mail, 'mx', t.mx, 'site_ok', t.site_ok, 'site_title', t.site_title,
       'site_url', t.site_url, 'name_match', t.name_match, 'domain_created_at', t.domain_created_at, 'mx_class', t.mx_class, 'dmarc', t.dmarc,
       'name_collision', t.name_collision, 'sec_names', t.risk_signals->'sec_names', 'needs_human', t.needs_human, 'reasons', to_jsonb(t.needs_human_reasons),
       'hold_reason', t.hold_reason, 'shared_doc_orgs', to_jsonb(t.shared_doc_orgs)),
    'callback', jsonb_build_object('status', t.callback_status, 'phone', t.callback_phone, 'source', t.callback_source,
       'source_url', t.callback_source_url, 'at', t.callback_at),
    'signatures', (select coalesce(jsonb_agg(jsonb_build_object('kind', s.kind, 'version', s.version, 'signer', s.signer_name, 'title', s.signer_title,
       'signed_at', s.signed_at, 'ip', s.ip) order by s.signed_at), '[]'::jsonb) from app_private.agreement_signatures s where s.org_id = p_org),
    'facilities', (select coalesce(jsonb_agg(to_jsonb(f) - 'org_id' order by f.created_at), '[]'::jsonb) from app_private.shipper_facilities f where f.org_id = p_org and f.archived_at is null));
end $$;

do $$ declare f text; begin
  foreach f in array array['public.cc_shipper_brokers()', 'public.cc_shipper_verification(uuid)'] loop
    execute 'revoke execute on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
end $$;

drop function app_private._bl0493_patch(regprocedure, text, text);
