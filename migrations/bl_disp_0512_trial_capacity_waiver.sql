-- bl_disp_0512 — per-dispatcher trial capacity waiver (owner decision, 8 Oct 2026)
-- Default policy stays: a trial dispatcher holds ONE carrier (disp_capacity_policy.trial_max_carriers).
-- A row here lets the owner allow a specific trial dispatcher more, with a recorded reason.
-- Additive + reversible: drop the table and re-run the replace in reverse to roll back.

create table if not exists app_private.dispatcher_capacity_waivers (
  dispatcher_user_id uuid primary key,
  max_carriers int not null check (max_carriers between 1 and 3),
  reason text not null,
  waived_by uuid,
  waived_at timestamptz not null default now(),
  revoked_at timestamptz
);
revoke all on app_private.dispatcher_capacity_waivers from public, anon, authenticated;

do $$
declare d text; n text;
  old_s text := 'if v_dstatus = ''trial'' and v_cur >= (pol->>''trial_max_carriers'')::int then';
  new_s text := 'if v_dstatus = ''trial'' and v_cur >= coalesce((select w.max_carriers from app_private.dispatcher_capacity_waivers w where w.dispatcher_user_id = p_dispatcher and w.revoked_at is null), (pol->>''trial_max_carriers'')::int) then';
begin
  select pg_get_functiondef('public.cc_dispatcher_assign(uuid,uuid,jsonb)'::regprocedure) into d;
  if position(new_s in d) > 0 then raise notice 'already patched'; return; end if;
  if position(old_s in d) = 0 then raise exception 'trial capacity line not found — not patched'; end if;
  n := replace(d, old_s, new_s);
  execute n;
end $$;
