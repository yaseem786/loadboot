-- bl_bp_0312b — the two in-product texts that still promised a "10-minute packet" before posting.
-- String surgery on the live definitions (same guard pattern as 0312): exact anchor or abort.

-- 1. cc_partner_register: the welcome in-app notice (3-arg version on prod, 2-arg on staging; both patched if present)
do $$
declare r record; v_def text; v_old text; v_new text; v_n int := 0;
begin
  v_old := $q$'Your ' || p_kind || ' account is created. Finish the guided onboarding (about 10 minutes) — once our team verifies your packet, load posting unlocks automatically.',$q$;
  v_new := $q$case when p_kind = 'broker'
      then 'Your broker account is created. Screen your MC against FMCSA (seconds, no uploads), accept the Master Broker Agreement, and post your first load — the verification packet comes later and lifts your limits.'
      else 'Your ' || p_kind || ' account is created. Finish the guided onboarding (about 10 minutes) — once our team verifies your packet, load posting unlocks automatically.' end,$q$;
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'cc_partner_register' loop
    v_def := pg_get_functiondef(r.oid);
    if position('Screen your MC against FMCSA' in v_def) > 0 then continue; end if;
    if position(v_old in v_def) = 0 then raise notice 'cc_partner_register(%): anchor not found — skipped', r.oid; continue; end if;
    execute replace(v_def, v_old, v_new); v_n := v_n + 1;
  end loop;
  raise notice 'cc_partner_register patched: %', v_n;
end $$;

-- 2. trg_partner_org_welcome: the welcome EMAIL's broker 3-step
do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app_private' and p.proname = 'trg_partner_org_welcome';
  if v_def is null then raise notice 'trg_partner_org_welcome missing — skipped'; return; end if;
  if position('Screen your MC' in v_def) > 0 then raise notice 'already patched'; return; end if;
  v_old := $q$'<span style="color:#334155">1️⃣ Complete your broker packet (authority, bond, agreement — 10 minutes)<br>2️⃣ Post your first load — the full wizard with multi-stop, scheduling and your rate card<br>3️⃣ Verified carriers request to book — you approve, GPS tracking and paperwork run themselves</span>'$q$;
  v_new := $q$'<span style="color:#334155">1️⃣ Screen your MC — we read your broker authority live from FMCSA (seconds, nothing to upload) and you accept one master agreement<br>2️⃣ Post your first load — the full wizard with multi-stop, scheduling and your rate card<br>3️⃣ Verified carriers request to book — you approve within 30 minutes, GPS tracking and paperwork run themselves. The verification packet comes later and lifts your posting limit.</span>'$q$;
  if position(v_old in v_def) = 0 then raise exception 'trg_partner_org_welcome: anchor not found — refusing to patch blind'; end if;
  execute replace(v_def, v_old, v_new);
  raise notice 'trg_partner_org_welcome patched';
end $$;
