-- bl_rem_0503 — CC Carrier 360 "Next reminder" card crashed with
--   record "v_tpl" is not assigned yet (55000)
-- for every carrier that owes nothing (awaiting review / active + posted / declined).
-- cc_reminder_carrier only ran the comm_templates SELECT when v_key was not null, then
-- read v_tpl.subject unconditionally. Fix: always run the SELECT (no row when v_key is
-- null), so v_tpl is assigned with NULL fields. Patched in place, loud if the anchor moved.
do $$
declare v_def text; v_old text := $o$  if v_key is not null then
    select * into v_tpl from app_private.comm_templates where key = 'carrier.reminder.' || v_key;
  end if;$o$;
  v_new text := $n$  -- bl_rem_0503: always assign v_tpl (no row when v_key is null)
  select * into v_tpl from app_private.comm_templates where v_key is not null and key = 'carrier.reminder.' || v_key;$n$;
begin
  v_def := pg_get_functiondef('public.cc_reminder_carrier(uuid)'::regprocedure);
  if position('bl_rem_0503' in v_def) > 0 then raise notice 'bl_rem_0503 already applied'; return; end if;
  if position(v_old in v_def) = 0 then raise exception 'bl_rem_0503: anchor not found in cc_reminder_carrier'; end if;
  execute replace(v_def, v_old, v_new);
end $$;
