-- cc_v1_0032 — profile write contract (0012B-compatible). STAGING ONLY.
-- WHY: staging was bootstrapped from the app baseline, which (re)creates the legacy
-- trg_protect_profile trigger + protect_profile_fields() denylist. That trigger silently
-- reverts any status/role change made by a caller whose profile.role is not literally
-- 'admin' — so Command Center staff (RBAC owners/dispatchers, profile.role='carrier')
-- could not persist a carrier status change. PRODUCTION already removed this via migration
-- 0012B; this brings staging to the SAME reviewed contract. Production does NOT need this
-- file (its 0012B postconditions are already active) — see PRODUCTION-SOURCE-OF-TRUTH.md.
--
-- AFTER this: profiles are writable ONLY via secured SECURITY DEFINER RPCs
-- (cc_set_carrier_status / admin_set_carrier_status / update_my_carrier_profile /
-- submit_for_review) and trusted owner/service-role SQL. No API role (public/anon/
-- authenticated) can UPDATE profiles directly. Idempotent.
--
-- PRECONDITIONS (assert before running):
--   P1  trg_protect_profile currently EXISTS on public.profiles (the bug source), OR the
--       contract is already in place (idempotent no-op).
--   P2  the secured carrier RPCs exist (cc_set_carrier_status, update_my_carrier_profile)
--       so carriers/staff retain a write path after the direct path is removed.
do $pre$
begin
  if not exists (select 1 from pg_proc where proname='cc_set_carrier_status'
                 and pronamespace='public'::regnamespace) then
    raise exception 'PRECONDITION P2 FAILED: cc_set_carrier_status missing — apply 0030 first';
  end if;
end $pre$;

-- CONTRACT (mirrors migrations/0012b_profile_direct_update_contract.sql)
revoke update on public.profiles from public, anon, authenticated;
drop policy   if exists profiles_update on public.profiles;
drop trigger  if exists trg_protect_profile on public.profiles;
drop function if exists public.protect_profile_fields();

-- POSTCONDITIONS (assert after; fail loudly if the contract did not take)
do $post$
begin
  if exists (select 1 from pg_trigger where tgname='trg_protect_profile' and not tgisinternal) then
    raise exception 'POSTCONDITION FAILED: trg_protect_profile still present';
  end if;
  if exists (select 1 from pg_proc where proname='protect_profile_fields'
             and pronamespace='public'::regnamespace) then
    raise exception 'POSTCONDITION FAILED: protect_profile_fields() still present';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and policyname='profiles_update') then
    raise exception 'POSTCONDITION FAILED: profiles_update policy still present';
  end if;
  if has_table_privilege('authenticated','public.profiles','update')
     or has_table_privilege('anon','public.profiles','update') then
    raise exception 'POSTCONDITION FAILED: an API role still holds UPDATE on profiles';
  end if;
end $post$;

-- ===== DOWN (reviewed) =====
-- Restores the legacy expand-window behaviour for a staging rollback ONLY (never run on
-- production). Mirrors migrations/down/0012b.down.sql intent:
--   create or replace function public.protect_profile_fields() returns trigger
--     language plpgsql security definer set search_path to 'public' as $$
--     begin if not public.is_admin() then new.role:=old.role; new.status:=old.status; end if; return new; end; $$;
--   revoke execute on function public.protect_profile_fields() from public, anon, authenticated;
--   create trigger trg_protect_profile before update on public.profiles
--     for each row execute function public.protect_profile_fields();
--   create policy profiles_update on public.profiles for update using (id=auth.uid() or is_admin());
--   grant update on public.profiles to authenticated;
--
-- ===== TEST (proves the fix; STAGING) =====
-- As a Command Center Owner whose profile.role <> 'admin', cc_set_carrier_status(<pending
-- carrier>,'active') must PERSIST (status='active' after the call) and write a
-- carrier.status_change audit row with cause='command_center'. Before this migration the
-- status reverted to 'pending'; after it, it persists. (Verified live on 30 Jun 2026:
-- Granite Peak Trucking pending->active persisted via the deploy-preview browser.)
