-- bl_ob_0532 — Home "compliance item(s) need attention" counted a VALID document (8 Oct 2026)
--
-- Reported by SPRINT SHIFT LOGISTICS (approved 7 Oct): Home showed a red "documents" card, tapping it
-- opened a screen with nothing to upload. Root cause, proved on prod:
--   cc_carrier_dashboard counted a row in carrier_compliance as a gap when
--       status not in ('valid','pending')  OR  (status = 'valid' and expiry_date <= today + 30)
--   His COI is VALID and expires 2026-10-17 (9 days) → "1 compliance item(s) need attention", tone urgent,
--   route /documents. Nothing was missing: app_private.carrier_mandatory_ok(org) = true.
--   Second bug in the same count: it looked at carrier_compliance rows only, so a mandatory requirement
--   with NO row (never uploaded) was never counted, and an optional requirement with a rejected row was.
--
-- Fix (one source of truth = app_private.compliance_requirements + the carrier_mandatory_ok rules):
--   * only ACTIVE, MANDATORY, APPLICABLE requirements (hazmat / bank conditions) count — optional ones never;
--   * missing / rejected / expired  → one gap PER requirement, tone urgent, route /documents/<doc_type>
--     (the carrier app turns that into a deep link onto the exact row);
--   * valid but expiring within 30 days → a separate 'warning' gap ("expires in N days — upload the renewal");
--   * pending / in review → nothing for the carrier to do, no gap.
--   Payload gains 'requirement_key' + 'doc_type'. The old summary key 'compliance' is gone.
-- Patched by anchor replace (CLAUDE.md §3): the rest of the function is untouched.
-- Reversible: re-run the previous definition (bl_drv_0344 / bl_ob_0233 era) — nothing else changed.

begin;

do $$
declare v_src text; v_new text; v_a text; v_b text; v_c text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cc_carrier_dashboard';
  if v_src is null then raise exception 'cc_carrier_dashboard not found'; end if;

  -- 1. declare a loop record
  v_a := E'  v_trucks int; v_drivers int; v_comp_gaps int;\n';
  v_new := replace(v_src, v_a, E'  v_trucks int; v_drivers int; v_comp_gaps int := 0; r record;   -- bl_ob_0532\n');
  if v_new = v_src then raise exception 'bl_ob_0532: declare anchor not found — aborting'; end if;

  -- 2. drop the old count (valid-but-expiring was a "gap")
  v_b := E'  select count(*) into v_comp_gaps from app_private.carrier_compliance\n'
      || E'    where carrier_id = v_org\n'
      || E'      and (coalesce(status,\'\') not in (\'valid\',\'pending\')\n'
      || E'           or (status = \'valid\' and expiry_date is not null and expiry_date <= current_date + 30));\n';
  v_src := v_new;
  v_new := replace(v_src, v_b, E'  -- bl_ob_0532: compliance gaps are counted per mandatory requirement below\n');
  if v_new = v_src then raise exception 'bl_ob_0532: count anchor not found — aborting'; end if;

  -- 3. per-requirement gaps, mandatory + applicable only
  v_c := E'  if v_comp_gaps > 0 then\n'
      || E'    v_gaps := v_gaps || jsonb_build_object(\'key\',\'compliance\',\'label\', v_comp_gaps||\' compliance item(s) need attention\',\'route\',\'/documents\',\'tone\',\'urgent\'); end if;\n';
  v_src := v_new;
  v_new := replace(v_src, v_c,
       E'  -- bl_ob_0532: one gap per mandatory, applicable requirement that is missing / rejected / expired;\n'
    || E'  -- a valid one expiring within 30 days is a separate, non-urgent reminder. Optional never counts.\n'
    || E'  for r in\n'
    || E'    select q.key, q.name, q.doc_type, coalesce(c.status, \'missing\') as status, c.expiry_date\n'
    || E'      from app_private.compliance_requirements q\n'
    || E'      left join app_private.carrier_compliance c on c.requirement_key = q.key and c.carrier_id = v_org\n'
    || E'     where q.active and q.mandatory\n'
    || E'       and (q.condition_key is null\n'
    || E'            or (q.condition_key = \'hazmat\' and app_private.carrier_is_hazmat(v_org))\n'
    || E'            or (q.condition_key = \'bank\'   and app_private.carrier_has_bank(v_org)))\n'
    || E'     order by q.key\n'
    || E'  loop\n'
    || E'    if r.status = \'valid\' and (r.expiry_date is null or r.expiry_date >= current_date) then\n'
    || E'      if r.expiry_date is not null and r.expiry_date <= current_date + 30 then\n'
    || E'        v_gaps := v_gaps || jsonb_build_object(\'key\', \'doc_expiring:\' || r.key, \'requirement_key\', r.key, \'doc_type\', coalesce(r.doc_type, r.key),\n'
    || E'          \'label\', r.name || \' expires in \' || (r.expiry_date - current_date) || \' day(s) — upload the renewal\',\n'
    || E'          \'route\', \'/documents/\' || coalesce(r.doc_type, r.key), \'tone\', \'warning\');\n'
    || E'      end if;\n'
    || E'    elsif r.status in (\'pending\', \'in_review\', \'review\', \'submitted\') then\n'
    || E'      null;   -- in review: nothing for the carrier to do\n'
    || E'    else\n'
    || E'      v_comp_gaps := v_comp_gaps + 1;\n'
    || E'      v_gaps := v_gaps || jsonb_build_object(\'key\', \'doc:\' || r.key, \'requirement_key\', r.key, \'doc_type\', coalesce(r.doc_type, r.key),\n'
    || E'        \'label\', r.name || case when r.status = \'rejected\' then \' was rejected — fix it and resubmit\'\n'
    || E'                                 when r.status = \'expired\' or (r.status = \'valid\' and r.expiry_date < current_date) then \' has expired — upload a current one\'\n'
    || E'                                 else \' is missing\' end,\n'
    || E'        \'route\', \'/documents/\' || coalesce(r.doc_type, r.key), \'tone\', \'urgent\');\n'
    || E'    end if;\n'
    || E'  end loop;\n');
  if v_new = v_src then raise exception 'bl_ob_0532: gap anchor not found — aborting'; end if;

  execute v_new;
end $$;

-- grants unchanged by create or replace, but say it anyway (CLAUDE.md §4)
revoke execute on function public.cc_carrier_dashboard() from public, anon;
grant  execute on function public.cc_carrier_dashboard() to authenticated, service_role;

-- guard: the anon-executable SECURITY DEFINER surface must not have grown
do $$
declare n int;
begin
  if has_function_privilege('anon', 'public.cc_carrier_dashboard()', 'execute') then
    raise exception 'bl_ob_0532: cc_carrier_dashboard must not be anon-executable';
  end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
  raise notice 'bl_ob_0532: anon SECURITY DEFINER surface in public = % (expect 36 prod / 35 staging)', n;
end $$;

commit;
