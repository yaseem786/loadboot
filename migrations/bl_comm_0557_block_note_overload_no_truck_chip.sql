-- bl_comm_0557 — sys_email no longer errors on a switched-off catalog row; "no truck yet" is not "waiting for availability" (15 Oct 2026)
--
-- Yaseen 15 Oct ("haan 0557 laga do, aur chip bhi theek karo"):
--   1. app_private.email_block_note had two overloads: (text,text,uuid,text,text) and (text,text,uuid,text,text,text default null).
--      A 5-argument call with an untyped literal is ambiguous, so sys_email's "switched off in the catalog" branch RAISED
--      "function email_block_note(...) is not unique" instead of skipping quietly — any trigger/RPC sending that key would fail
--      with it. Found while testing bl_disp_0556 on staging; latent on prod (no catalog row was `off`). The 6-argument version is a
--      strict superset (same insert + code), nothing depends on the 5-argument one (pg_depend 0) → drop it.
--   2. disp_availability_gate.chip for a carrier with no active truck now reads "No truck added yet — the carrier adds a truck
--      first" instead of "Waiting for availability · last posted never" (CC Dispatcher 360, Carrier 360, dispatcher workspace all
--      render g.chip).
--   3. disp_trial_stats.effort.waiting_availability no longer counts no-truck carriers (they cannot post; bl_disp_0556 already
--      stopped their reminders). Same number feeds the daily trial e-mail tile and the Dispatcher 360 rules card.
--
-- Anchor-replaced (each anchor exactly once), apply STAGING first, then PROD. app_private only; no anon surface change.
--
-- STATUS 15 Oct 2026 ~22:30 UTC: parts 2+3 APPLIED on staging and prod (migration name bl_comm_0557_no_truck_chip).
-- Part 1 (the DROP) is NOT applied yet: the Supabase MCP holds a DROP for approval and it timed out unapproved, twice.
-- Run the one DROP line (staging, then prod) from the SQL editor or approve it in the next session; the file is idempotent.

drop function if exists app_private.email_block_note(text, text, uuid, text, text);

do $mig$
declare r record; v_def text; v_n int;
begin
  for r in
    select * from (values
      (1, 'app_private.disp_availability_gate(uuid)',
          '''chip'', case when not v_assigned or f.fresh then null else ''Waiting for availability',
          '''chip'', case when not v_assigned or f.fresh then null when f.reason = ''no_trucks'' then ''No truck added yet — the carrier adds a truck first'' else ''Waiting for availability'),
      (2, 'app_private.disp_trial_stats(uuid,timestamptz,timestamptz,timestamptz)',
          'and not (app_private.carrier_availability_fresh(a.carrier_org_id)).fresh),',
          'and (app_private.carrier_availability_fresh(a.carrier_org_id)).reason not in (''ok'', ''no_trucks'')),')
    ) t(ord, fn, anchor, repl) order by ord
  loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    v_n := (length(v_def) - length(replace(v_def, r.anchor, ''))) / length(r.anchor);
    if v_n <> 1 then raise exception 'bl_comm_0557 patch % on %: anchor found % times (expected 1)', r.ord, r.fn, v_n; end if;
    execute replace(v_def, r.anchor, r.repl);
  end loop;
end $mig$;
revoke all on function app_private.disp_availability_gate(uuid) from public, anon, authenticated;
