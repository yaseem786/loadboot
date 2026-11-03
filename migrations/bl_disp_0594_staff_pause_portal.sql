-- bl_disp_0594 — a dispatcher LoadBoot paused or replaced no longer shows as the carrier's dispatcher (owner, 3 Nov 2026)
-- Before: a staff pause left the row at status='paused', and the carrier portal read every paused row as the carrier's own:
-- the card said "<dispatcher> · Your dedicated dispatcher · Paused by you" and offered Resume, although the carrier had been
-- told that dispatcher was no longer covering them. Resume would have re-activated the paused dispatcher. Assigning a new
-- dispatcher also left the old paused row open.
-- Now (a carrier's own pause is the one whose end_reason starts 'carrier: ', written by carrier_dispatcher_pause):
--   * carrier_dispatcher_desk / carrier_my_dispatcher return only active rows and the carrier's own paused rows, so a staff
--     pause shows the portal's normal "dispatcher on the way" state.
--   * carrier_dispatcher_pause refuses to resume a pause the carrier did not make.
--   * cc_dispatcher_assign ends any paused row on that carrier when a new dispatcher is assigned (no extra notifications:
--     the WhatsApp trigger fires only when leaving 'active').
--   * dispatcher_thread_list no longer labels a dispatcher "previous dispatcher" on their own earlier messages.

do $$
declare r record; d text; n int;
begin
  for r in select * from (values
    ('public.carrier_dispatcher_desk()', 'desk',
     $a$a.carrier_org_id = v_org and a.status in ('active','paused') order by a.assigned_at desc limit 1;$a$,
     $a$a.carrier_org_id = v_org and (a.status = 'active' or (a.status = 'paused' and coalesce(a.end_reason,'') like 'carrier: %')) order by a.assigned_at desc limit 1;$a$),
    ('public.carrier_my_dispatcher()', 'mine',
     $a$where a.status in ('active','paused') and app_private.disp_is_carrier_member(a.carrier_org_id)$a$,
     $a$where (a.status = 'active' or (a.status = 'paused' and coalesce(a.end_reason,'') like 'carrier: %')) and app_private.disp_is_carrier_member(a.carrier_org_id)$a$),
    ('public.carrier_dispatcher_pause(uuid,boolean,text)', 'pause',
     $a$if p_pause and coalesce(btrim(p_reason),'') = '' then$a$,
     $a$if not p_pause and v_a.status = 'paused' and coalesce(v_a.end_reason,'') not like 'carrier: %' then return jsonb_build_object('error','This pause was set by LoadBoot. Please message LoadBoot to resume.'); end if;
  if p_pause and coalesce(btrim(p_reason),'') = '' then$a$),
    ('public.cc_dispatcher_assign(uuid,uuid,jsonb)', 'assign',
     $a$update app_private.dispatcher_profiles set status = 'active', updated_at = now() where user_id = p_dispatcher and status = 'verified';$a$,
     $a$update app_private.dispatcher_assignments set status = 'ended', ended_at = now(), end_reason = coalesce(end_reason || ' · ', '') || 'Replaced by a new dispatcher', updated_at = now() where carrier_org_id = v_org and status = 'paused' and id <> v_id;   -- bl_disp_0594
  update app_private.dispatcher_profiles set status = 'active', updated_at = now() where user_id = p_dispatcher and status = 'verified';$a$),
    ('public.dispatcher_thread_list(uuid,integer)', 'list',
     $a$case when m.assignment_id <> p_assignment and m.sender_role = 'dispatcher' then$a$,
     $a$case when m.assignment_id <> p_assignment and m.sender_role = 'dispatcher' and m.sender_user is distinct from v_a.dispatcher_user_id then$a$)
  ) v(fn, tag, anchor, repl) loop
    d := pg_get_functiondef(r.fn::regprocedure);
    if position(r.repl in d) > 0 then continue; end if;
    n := (length(d) - length(replace(d, r.anchor, ''))) / length(r.anchor);
    if n <> 1 then raise exception 'bl_disp_0594: anchor % found % times in %', r.tag, n, r.fn; end if;
    execute replace(d, r.anchor, r.repl);
  end loop;
end $$;
