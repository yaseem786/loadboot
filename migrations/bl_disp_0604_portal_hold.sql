-- bl_disp_0604 — Dispatcher portal hold (owner decision, 13 Nov 2026)
-- WHY: a dispatcher asked a carrier for the verification code sent to the carrier's FMCSA phone (to open a
-- third-party account in the carrier's name). The owner wanted the dispatcher's PORTAL locked with the reason
-- and a WhatsApp button to regain access — while everything else keeps running: the carrier assignment stays
-- active, the trial window, LoadBoot line and mailbox are untouched (suspend / block do far more than this).
-- The portal reads the hold from dispatcher_my_status() (it returns the whole profile row) and shows a
-- full-screen lock (app/agent/portal-hold.js). Staff toggle it with cc_dispatcher_portal_hold().

alter table app_private.dispatcher_profiles
  add column if not exists portal_hold_at     timestamptz,
  add column if not exists portal_hold_reason text,
  add column if not exists portal_hold_by     uuid;

create or replace function public.cc_dispatcher_portal_hold(p_user uuid, p_on boolean, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = app_private, public
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_name   text;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error', 'not authorized'); end if;
  if p_on and v_reason is null then
    return jsonb_build_object('error', 'A reason is required — the dispatcher sees it on the lock screen.');
  end if;
  update app_private.dispatcher_profiles
     set portal_hold_at     = case when p_on then now()     else null end,
         portal_hold_reason = case when p_on then v_reason  else null end,
         portal_hold_by     = case when p_on then auth.uid() else null end,
         updated_at         = now()
   where user_id = p_user
  returning full_name into v_name;
  if not found then return jsonb_build_object('error', 'no such dispatcher'); end if;
  perform app_private.disp_audit(
    case when p_on then 'dispatcher.portal_hold.on' else 'dispatcher.portal_hold.off' end,
    'dispatcher', p_user::text, null,
    coalesce(v_name, 'dispatcher') || case when p_on then ' — portal on hold: ' || v_reason else ' — portal hold lifted' end,
    jsonb_build_object('reason', v_reason));
  return jsonb_build_object('ok', true, 'on', p_on);
end $$;

-- anon-executable SECURITY DEFINER surface must not grow (CLAUDE.md §4): revoke the default grant explicitly.
revoke execute on function public.cc_dispatcher_portal_hold(uuid, boolean, text) from public, anon;
grant  execute on function public.cc_dispatcher_portal_hold(uuid, boolean, text) to authenticated;
