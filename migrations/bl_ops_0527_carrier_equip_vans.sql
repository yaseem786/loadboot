-- bl_ops_0527 — carrier onboarding rejected Cargo Van / Sprinter Van ("invalid equipment_type").
--
-- The carrier onboarding wizard (app/carrier/app.js, EQUIP) offers 12 equipment types, including 'Cargo Van' and
-- 'Sprinter Van'. public.update_my_carrier_profile only allowed 10 — the two vans were missing — so any carrier who
-- ticked either one could not save the "Operation & equipment" step (raise 'invalid equipment_type'). Reported live
-- by a carrier on 6 Oct 2026. Everything downstream already knows both vans (app_private.disp_equip_norm /
-- disp_equip_class -> 'van' / disp_equip_label), so this only widens the gate to match the UI.
--
-- Patched by replacing one anchor in the live definition (not retyped). ACL is unchanged by CREATE OR REPLACE
-- (authenticated + service_role; not anon). Re-runnable: a no-op once the vans are on the list.

do $$
declare
  v_fn  constant regprocedure := 'public.update_my_carrier_profile(text,text,text,text,text,text,text,integer,text[],numeric,integer,text,boolean,boolean,text,text,text,text,text)'::regprocedure;
  v_old constant text := $q$'Tanker','Car Hauler'];$q$;
  v_new constant text := $q$'Tanker','Car Hauler','Cargo Van','Sprinter Van'];$q$;
  src text;
begin
  src := pg_get_functiondef(v_fn);
  if position($q$'Sprinter Van'$q$ in src) > 0 then raise notice 'bl_ops_0527: already applied'; return; end if;
  if position(v_old in src) = 0 then raise exception 'bl_ops_0527: allowed_equip anchor not found'; end if;
  execute replace(src, v_old, v_new);
end $$;
