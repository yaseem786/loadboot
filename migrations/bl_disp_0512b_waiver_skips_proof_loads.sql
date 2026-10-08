-- bl_disp_0512b — an active trial capacity waiver also skips the 3-delivered-loads proof gate
-- for carriers within the waived count. Without a waiver, behaviour is unchanged.
do $$
declare d text;
  old_s text := 'if v_cur > 0 then select count(*) into v_del';
  new_s text := 'if v_cur > 0 and not exists (select 1 from app_private.dispatcher_capacity_waivers w where w.dispatcher_user_id = p_dispatcher and w.revoked_at is null and v_cur < w.max_carriers) then select count(*) into v_del';
begin
  select pg_get_functiondef('public.cc_dispatcher_assign(uuid,uuid,jsonb)'::regprocedure) into d;
  if position(new_s in d) > 0 then raise notice 'already patched'; return; end if;
  if position(old_s in d) = 0 then raise exception 'proof-load line not found — not patched'; end if;
  execute replace(d, old_s, new_s);
end $$;
