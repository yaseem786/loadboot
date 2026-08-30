-- bl_fix_0305_dispatcher_storage_policy
-- 29 Aug 2026
--
-- The 28 Aug dispatcher-workspace storage policy `doc_read_assigned_dispatcher`
-- broke EVERY document read in the documents bucket, for everyone — carriers and
-- staff alike. Verified on production by selecting storage.objects as
-- `authenticated`:  permission denied for table organizations
--
-- Two faults in one policy:
--   1. Its EXISTS referenced public.organizations and app_private.dispatcher_assignments
--      DIRECTLY. RLS policy expressions run with the CALLER's privileges, and
--      `authenticated` has no grant on either table, so evaluating the policy threw —
--      and one throwing policy in the OR-chain kills the whole storage query. Every
--      "View" / "Download" in both portals died with it. This is why the document
--      drawer used to work and then silently stopped: it broke the moment this
--      policy landed.
--   2. It parsed storage.foldername(o.name) — the ORGANIZATION's name — where it meant
--      the object's path, so the dispatcher check could never match what it intended.
--
-- Fix: move the whole check into one SECURITY DEFINER helper (runs as postgres, so no
-- caller privileges are needed) and have the policy call only that. The helper also
-- compares the folder of the OBJECT's path, fixing fault 2.
-- Applied to staging, then production. Verified on production as authenticated:
-- 168 objects visible, no error.
create or replace function app_private.dispatcher_can_read_doc(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path to 'app_private, public'
as $$
  select exists (
    select 1
      from public.organizations o
      join app_private.dispatcher_assignments a on a.carrier_org_id = o.id
     where o.kind = 'carrier'
       and o.owner_user_id::text = (storage.foldername(p_object_name))[1]
       and a.dispatcher_user_id = auth.uid()
       and a.status = 'active'
  );
$$;
grant execute on function app_private.dispatcher_can_read_doc(text) to authenticated;

drop policy if exists doc_read_assigned_dispatcher on storage.objects;
create policy doc_read_assigned_dispatcher on storage.objects for select
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[2] = any (array['authority','insurance','w9','noa'])
  and app_private.dispatcher_can_read_doc(name)
);
