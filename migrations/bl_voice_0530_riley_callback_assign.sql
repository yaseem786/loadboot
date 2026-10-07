-- bl_voice_0530 — CC can hand a callback from the line to any dispatcher (7 Oct 2026).
--
-- Owner ask: Riley promised a person would call back (bl_voice_0506), the caller has no dispatcher (a new carrier),
-- and the owner cannot call himself. Until now the only action on CC → Riley → "Open callbacks from the line" was
-- Done; the first such hand-off (Phil, hotshot, no MC) had to be done in SQL.
--
--  * dialer_callbacks gets assigned_by / assigned_at (who handed it over, when).
--  * public.cc_riley_callback_dispatchers(): the pick-list. Dispatchers in trial / verified / active, not blocked,
--    with whether they have an active phone line (no line = the callback would never show anywhere) and how many
--    open callbacks they already hold.
--  * public.cc_riley_callback_assign(p_id, p_dispatcher, p_note): an OPEN callback goes to that dispatcher's dialer
--    (Callbacks tab), due now, with the brief staff wrote as its note; the dispatcher gets an in-app alert and the
--    e-mail dispatcher.callback.assigned (catalog row bl_disp_0529); disp_audit logs it. Re-assigning an open
--    callback moves it. Refuses: not staff, not open, dispatcher not working / blocked / without a line.
--  * cc_riley_calls returns assigned_callbacks: what CC handed out (assigned_at set) or Riley routed (reason riley)
--    and is still open or closed in the last 7 days, with the dispatcher and their latest call to that number since
--    (outcome, note, length, recording yes/no) — so the owner sees whether the call happened without asking.
-- Same permission as cc_riley_callback_done (comm.manage / dispatch.manage / settings.manage).
-- New public functions: revoke from public, anon (CLAUDE.md §4) — the anon SECURITY DEFINER surface does not move.

alter table app_private.dialer_callbacks add column if not exists assigned_by uuid;
alter table app_private.dialer_callbacks add column if not exists assigned_at timestamptz;
comment on column app_private.dialer_callbacks.assigned_at is 'bl_voice_0530: when staff handed this callback to a dispatcher from CC → Riley.';

create or replace function public.cc_riley_callback_dispatchers() returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $fn$
begin
  if not (public.has_global_permission('comm.manage') or public.has_global_permission('dispatch.manage') or public.has_global_permission('settings.manage')) then
    return jsonb_build_object('error','not authorized');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', d.user_id, 'name', coalesce(nullif(btrim(d.full_name),''), 'Dispatcher'), 'status', d.status,
      'has_line', exists (select 1 from app_private.dialer_lines l where l.dispatcher_user_id = d.user_id and l.status = 'active'),
      'open_callbacks', (select count(*) from app_private.dialer_callbacks k where k.dispatcher_user_id = d.user_id and k.status = 'open'),
      'last_call_at', (select max(c.created_at) from app_private.dialer_calls c where c.dispatcher_user_id = d.user_id))
      order by (exists (select 1 from app_private.dialer_lines l where l.dispatcher_user_id = d.user_id and l.status = 'active')) desc, d.full_name)
    from app_private.dispatcher_profiles d
    where d.status in ('trial','verified','active') and d.blocked_at is null), '[]'::jsonb);
end $fn$;
revoke execute on function public.cc_riley_callback_dispatchers() from public, anon;
grant execute on function public.cc_riley_callback_dispatchers() to authenticated;

create or replace function public.cc_riley_callback_assign(p_id uuid, p_dispatcher uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = app_private, public as $fn$
declare
  k app_private.dialer_callbacks; d app_private.dispatcher_profiles;
  v_note text; v_first text; v_who text; v_num text; v_body text;
begin
  if not (public.has_global_permission('comm.manage') or public.has_global_permission('dispatch.manage') or public.has_global_permission('settings.manage')) then
    return jsonb_build_object('error','not authorized');
  end if;
  select * into k from app_private.dialer_callbacks where id = p_id for update;
  if not found then return jsonb_build_object('error','callback not found'); end if;
  if k.status <> 'open' then return jsonb_build_object('error','this callback is already closed'); end if;
  select * into d from app_private.dispatcher_profiles where user_id = p_dispatcher;
  if not found or d.status not in ('trial','verified','active') then return jsonb_build_object('error','pick a dispatcher who is in trial, verified or active'); end if;
  if d.blocked_at is not null then return jsonb_build_object('error','this dispatcher is blocked'); end if;
  if not exists (select 1 from app_private.dialer_lines l where l.dispatcher_user_id = p_dispatcher and l.status = 'active') then
    return jsonb_build_object('error','this dispatcher has no phone line — the callback would not show anywhere');
  end if;
  if k.dispatcher_user_id = p_dispatcher then return jsonb_build_object('error','already with this dispatcher'); end if;

  v_note := left(coalesce(nullif(btrim(p_note),''), k.note), 2000);
  update app_private.dialer_callbacks
     set dispatcher_user_id = p_dispatcher, due_at = now(), note = v_note, assigned_by = auth.uid(), assigned_at = now()
   where id = p_id;

  v_first := initcap(split_part(coalesce(nullif(btrim(d.full_name),''), 'there'), ' ', 1));
  v_num := right(regexp_replace(coalesce(k.number,''), '[^0-9]', '', 'g'), 10);
  v_num := case when length(v_num) = 10 then '(' || substr(v_num,1,3) || ') ' || substr(v_num,4,3) || '-' || substr(v_num,7) else k.number end;
  v_who := coalesce(nullif(btrim(k.contact_name),''), v_num);
  -- disp_notify puts the body into the e-mail HTML as is: no angle brackets from a staff-typed note
  v_body := 'Hi ' || v_first || E',\n\nLoadBoot has assigned you a callback. It is in your dialer under Callbacks: '
    || v_who || case when v_who <> v_num then ' · ' || v_num else '' end || E'.\n\n'
    || case when v_note is not null then E'What you need to know:\n' || v_note || E'\n\n' else '' end
    || E'Please call as soon as you can. After the call, pick the outcome in "How did it go?" and write a few lines in Notes, so we can see what happened.\n\nThank you.';
  v_body := replace(replace(v_body, '<', '‹'), '>', '›');
  perform app_private.disp_notify(p_dispatcher, 'dispatcher', 'dispatcher.callback.assigned',
    'Callback assigned to you: ' || replace(replace(v_who, '<', '‹'), '>', '›'), v_body, '/app/agent/#today', true);
  perform app_private.disp_audit('dispatcher.callback.assign', 'dialer_callback', p_id::text, null,
    v_who || ' (' || coalesce(k.number,'') || ') callback assigned to ' || coalesce(d.full_name, 'dispatcher'),
    jsonb_build_object('dispatcher', p_dispatcher, 'previous_dispatcher', k.dispatcher_user_id, 'reason', k.reason, 'lc_call_id', k.lc_call_id));
  return jsonb_build_object('ok', true, 'dispatcher', coalesce(d.full_name, 'dispatcher'));
end $fn$;
revoke execute on function public.cc_riley_callback_assign(uuid, uuid, text) from public, anon;
grant execute on function public.cc_riley_callback_assign(uuid, uuid, text) to authenticated;

-- cc_riley_calls: what was handed out, and what came of it (anchor patch on the wa_callbacks list)
do $mig$
declare d text; n text;
  a constant text := $a$where dispatcher_user_id is null and status = 'open' order by created_at desc limit 40) k), '[]'::jsonb),$a$;
begin
  d := pg_get_functiondef('public.cc_riley_calls(integer)'::regprocedure);
  if position('assigned_callbacks' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'bl_voice_0530: cc_riley_calls anchor not found exactly once'; end if;
  n := replace(d, a, a || $b$
      'assigned_callbacks', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'number', k.number, 'reason', k.reason, 'status', k.status,
          'created_at', k.created_at, 'assigned_at', k.assigned_at, 'done_at', k.done_at, 'contact_name', k.contact_name, 'note', k.note,
          'lc_call_id', k.lc_call_id, 'dispatcher_id', k.dispatcher_user_id, 'dispatcher', coalesce(p.full_name, 'Dispatcher'),
          'last_call', (select jsonb_build_object('at', c.created_at, 'outcome', c.outcome, 'note', c.note, 'duration_sec', c.duration_sec,
                          'answered', c.answered_at is not null, 'has_recording', c.recording is not null)
                          from app_private.dialer_calls c
                         where c.dispatcher_user_id = k.dispatcher_user_id
                           and right(regexp_replace(k.number, '[^0-9]', '', 'g'), 10) in (right(regexp_replace(coalesce(c.to_number,''), '[^0-9]', '', 'g'), 10),
                                                                                         right(regexp_replace(coalesce(c.from_number,''), '[^0-9]', '', 'g'), 10))
                           and c.created_at >= coalesce(k.assigned_at, k.created_at)
                         order by c.created_at desc limit 1))
          order by coalesce(k.assigned_at, k.created_at) desc)
        from (select * from app_private.dialer_callbacks
               where dispatcher_user_id is not null and (assigned_at is not null or reason = 'riley')
                 and (status = 'open' or done_at > now() - interval '7 days')
               order by coalesce(assigned_at, created_at) desc limit 40) k
        left join app_private.dispatcher_profiles p on p.user_id = k.dispatcher_user_id), '[]'::jsonb),$b$);
  execute n;
end $mig$;

update app_private.email_catalog
   set trigger_source = 'public.cc_riley_callback_assign (CC → Riley → Assign) → app_private.disp_notify', updated_at = now()
 where key = 'dispatcher.callback.assigned';
