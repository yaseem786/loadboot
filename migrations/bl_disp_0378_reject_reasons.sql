-- bl_disp_0378 — structured rejection reasons for dispatcher applicants.
-- APPLIED staging 21 Sep 2026. PRODUCTION: owner applies (rwscphuhpjoudvljvmdk).
--
-- Why: the rejection reason lived only in review_note (free text). A re-applicant (bl_disp_0318)
-- got a blank form and could submit the identical answers again — which is what kept happening.
-- The portal now gates the re-application on the reason, so the reason needs a machine-readable form.
-- Reading path: dispatcher_my_status returns to_jsonb(dispatcher_profiles) minus reviewed_by, so
-- the new column reaches the portal with NO change to that function.
-- cc_dispatcher_decide is deliberately left alone (no new parameter, no overload ambiguity, no
-- deploy-order hazard): CC calls this setter first, then decide('reject', note) as before.
-- Anon surface untouched: authenticated-only, revoked from anon/public (staging 32 after apply).
--
-- Frontend: app/agent/dispatcher-gaps.js (catalog + gate), app/carrier/app.js (portal),
--           app/command-center/views/dispatchers.js + dispatcher-360.js (reject dialog).

alter table app_private.dispatcher_profiles
  add column if not exists reject_reasons text[];

comment on column app_private.dispatcher_profiles.reject_reasons is
  'bl_disp_0378 — reason codes staff ticked when rejecting. Catalog lives in app/agent/dispatcher-gaps.js (REASONS); the portal turns each into a gate the re-application must clear.';

create or replace function public.cc_dispatcher_set_reject_reasons(p_user uuid, p_reasons text[])
returns jsonb
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare
  c_codes constant text[] := array['no_own_board','no_booking_proof','experience','english','availability','no_cv','no_id','inconsistent','other'];
  v_ok text[]; v_name text;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select array(select x from unnest(coalesce(p_reasons, '{}'::text[])) x where x = any (c_codes)) into v_ok;
  update app_private.dispatcher_profiles
     set reject_reasons = nullif(v_ok, '{}'::text[]), updated_at = now()
   where user_id = p_user
  returning full_name into v_name;
  if not found then return jsonb_build_object('error','not a dispatcher'); end if;
  perform app_private.disp_audit('dispatcher.reject_reasons', 'dispatcher', p_user::text, null,
    coalesce(v_name,'dispatcher') || ': reject reasons set (' || coalesce(array_to_string(v_ok, ', '), 'cleared') || ')',
    jsonb_build_object('reasons', v_ok));
  return jsonb_build_object('ok', true, 'reasons', v_ok);
end;
$function$;

revoke all on function public.cc_dispatcher_set_reject_reasons(uuid, text[]) from public, anon;
grant execute on function public.cc_dispatcher_set_reject_reasons(uuid, text[]) to authenticated;
