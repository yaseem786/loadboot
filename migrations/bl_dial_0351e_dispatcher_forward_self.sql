-- bl_dial_0351e — the dispatcher sets their OWN "ring my mobile" forward number from the dock.
-- US / Canada numbers only (+1, premium + Caribbean blocked by dial_blocked) so a forward can never bill an international rate.
-- A LoadBoot line can't be the target (call loop). Empty = off → the unanswered chain skips the mobile step at once (no wait).
-- dialer_bootstrap now returns line.forward_number so the dock can show it. STAGING first.

do $$
declare s text;
begin
  s := pg_get_functiondef('public.dialer_bootstrap()'::regprocedure);
  if position('forward_number' in s) = 0 then
    if position($o$'number', ln.phone_e164, 'label', ln.label)$o$ in s) = 0 then raise exception 'bl_dial_0351e: expected text not found in bootstrap'; end if;
    s := replace(s, $o$'number', ln.phone_e164, 'label', ln.label)$o$, $n$'number', ln.phone_e164, 'label', ln.label, 'forward_number', ln.forward_number)$n$);
    execute s;
  end if;
end $$;

create or replace function public.dialer_forward_set(p_number text) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); ln app_private.dialer_lines; e text; why text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Sign in first.'); end if;
  select * into ln from app_private.dialer_lines where dispatcher_user_id = v_uid and status = 'active';
  if ln.id is null then return jsonb_build_object('ok', false, 'error', 'No phone line is assigned to you yet.'); end if;
  if nullif(btrim(coalesce(p_number,'')), '') is null then
    update app_private.dialer_lines set forward_number = null where id = ln.id;
    return jsonb_build_object('ok', true, 'forward_number', null);
  end if;
  e := app_private.dial_e164(p_number);
  if e is null or e !~ '^\+1[2-9][0-9]{9}$' then
    return jsonb_build_object('ok', false, 'error', 'Only a US or Canada mobile number works here (10 digits).');
  end if;
  why := app_private.dial_blocked(e, false);
  if why is not null then return jsonb_build_object('ok', false, 'error', why); end if;
  if exists (select 1 from app_private.dialer_lines where phone_e164 = e) then
    return jsonb_build_object('ok', false, 'error', 'That is a LoadBoot line — use your own mobile number.');
  end if;
  update app_private.dialer_lines set forward_number = e where id = ln.id;
  return jsonb_build_object('ok', true, 'forward_number', e);
end $$;

revoke all on function public.dialer_forward_set(text) from public, anon;
grant execute on function public.dialer_forward_set(text) to authenticated;
