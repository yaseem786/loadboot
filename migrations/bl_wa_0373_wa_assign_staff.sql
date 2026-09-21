-- bl_wa_0373 — a conversation can be handed to a STAFF member by name, not only to a dispatcher.
--   * "Unassigned" always meant "Command Center answers this", which is right for brokers, shippers and strangers
--     — but it says nobody is looking. Now Command Center can put its own name on one: owner = a staff member.
--   * cc_wa_overview returns staff as well as dispatchers, so the owner dropdown can offer both.
--   * A staff owner is not bound by the carrier rule (staff may answer anything); a dispatcher still is.
-- APPLIED ON STAGING 21 Sep 2026. The two function bodies are exactly what is live there.
create or replace function public.cc_wa_assign(p_id uuid, p_user uuid default null) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare t app_private.wa_threads; v_kind text;
begin
  if not app_private.disp_is_staff() then raise exception 'staff only'; end if;
  if p_user is not null then
    if app_private.disp_is_staff_user(p_user) then v_kind := 'staff';
    elsif exists (select 1 from app_private.dispatcher_profiles where user_id = p_user and status in ('trial','verified','active')) then v_kind := 'dispatcher';
    else return jsonb_build_object('error','That person is neither active staff nor an active dispatcher.'); end if;
  end if;
  update app_private.wa_threads set owner_user_id = p_user, updated_at = now() where id = p_id returning * into t;
  if t.id is null then return jsonb_build_object('error','That conversation does not exist.'); end if;
  perform app_private.disp_audit('wa.assign', 'wa_thread', t.id::text, null,
    case when p_user is null then 'WhatsApp conversation returned to Command Center' else 'WhatsApp conversation assigned to ' || v_kind end,
    jsonb_build_object('thread', t.id, 'owner', p_user, 'owner_kind', v_kind, 'number', t.counterparty));
  return jsonb_build_object('ok', true, 'thread', app_private.wa_thread_json(t));
end $$;

-- cc_wa_overview additionally returns 'staff' (active staff_members with their profile name); everything else
-- is bl_wa_0369's version. See the deployed definition on staging for the full body.
