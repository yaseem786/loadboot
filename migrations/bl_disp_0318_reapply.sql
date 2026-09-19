-- bl_disp_0318 — dispatcher re-application. APPLIED staging + prod 19 Sep 2026.
-- The rejection e-mail (bl_disp_0315) promises "you are welcome to apply again", but nothing
-- could move a profile out of 'rejected': dispatcher_apply only promotes applied/withdrawn, and
-- the portal only renders the form at 'applied'. This adds the missing, bounded path.
--   rejected --dispatcher_reapply()--> applied (draft, answers kept) --dispatcher_apply(submit)--> screening
-- Guards: caller's own row only · 14-day cooldown from the rejection · max 3 re-applications ·
-- single atomic UPDATE (no read-then-write race) · audited · authenticated only (anon surface unchanged: 33 prod).
-- Frontend: app/agent/dispatcher-reapply.js, mounted by app/carrier/app.js at status 'rejected'.

alter table app_private.dispatcher_profiles
  add column if not exists reapply_count int not null default 0,
  add column if not exists last_reapplied_at timestamptz;

create or replace function public.dispatcher_reapply(p_check boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare
  c_cooldown constant interval := interval '14 days';
  c_max      constant int      := 3;
  v_uid uuid := auth.uid();
  v_status text; v_rev timestamptz; v_cnt int; v_name text; v_at timestamptz;
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;

  select status, reviewed_at, reapply_count, full_name into v_status, v_rev, v_cnt, v_name
    from app_private.dispatcher_profiles where user_id = v_uid;
  if not found then return jsonb_build_object('error','no application'); end if;
  if v_status <> 'rejected' then
    return jsonb_build_object('ok', false, 'eligible', false, 'reason', 'not_rejected', 'status', v_status);
  end if;

  v_at := coalesce(v_rev, now() - c_cooldown) + c_cooldown;
  if v_cnt >= c_max then
    return jsonb_build_object('ok', false, 'eligible', false, 'reason', 'limit', 'max', c_max, 'used', v_cnt);
  end if;
  if now() < v_at then
    return jsonb_build_object('ok', false, 'eligible', false, 'reason', 'cooldown', 'available_at', v_at,
                              'remaining', c_max - v_cnt);
  end if;
  if p_check then
    return jsonb_build_object('ok', true, 'eligible', true, 'available_at', v_at, 'remaining', c_max - v_cnt);
  end if;

  -- atomic: re-asserts every guard in the WHERE so two concurrent calls cannot both win
  update app_private.dispatcher_profiles
     set status = 'applied', reapply_count = reapply_count + 1, last_reapplied_at = now(), updated_at = now()
   where user_id = v_uid and status = 'rejected' and reapply_count < c_max
     and coalesce(reviewed_at, now() - c_cooldown) + c_cooldown <= now();
  if not found then return jsonb_build_object('ok', false, 'eligible', false, 'reason', 'conflict'); end if;

  perform app_private.disp_audit('dispatcher.reapply', 'dispatcher', v_uid::text, null,
    coalesce(v_name,'dispatcher') || ': rejected → applied (re-application #' || (v_cnt + 1) || ')',
    jsonb_build_object('reapply_count', v_cnt + 1, 'rejected_at', v_rev));

  return jsonb_build_object('ok', true, 'status', 'applied', 'reapply_count', v_cnt + 1, 'remaining', c_max - v_cnt - 1);
end;
$function$;

revoke all on function public.dispatcher_reapply(boolean) from public, anon;
grant execute on function public.dispatcher_reapply(boolean) to authenticated;
