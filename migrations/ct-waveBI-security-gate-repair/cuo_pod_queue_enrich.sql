-- cuo_pod_queue_enrich.sql
-- Enrich the POD review queue with load context (carrier name, route, delivery date, reviewed_at)
-- so reviewers see what they are approving without extra round-trips. RBAC is unchanged
-- (app_private.can_review_pod()). Return type changes, so the old function is dropped first.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

drop function if exists public.cc_pod_review_queue(text,integer);
create or replace function public.cc_pod_review_queue(p_status text default 'pending', p_limit integer default 100)
returns table(
  id uuid, trip_id text, kind text, file_name text, status text, review_note text,
  uploaded_by uuid, created_at timestamptz,
  carrier_name text, origin text, destination text, delivery_date date, reviewed_at timestamptz
)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
begin
  if not app_private.can_review_pod() then raise exception 'not authorized' using errcode='42501'; end if;
  return query
    select d.id, d.owner_id, d.kind, d.file_name, d.status, d.review_note, d.uploaded_by, d.created_at,
           o.name, l.origin, l.destination, l.delivery_date, d.reviewed_at
    from app_private.document_files d
    left join app_private.trips t on t.id = (case when d.owner_id ~ '^[0-9a-f-]{36}$' then d.owner_id::uuid else null end)
    left join public.loads l on l.id = t.load_id
    left join public.organizations o on o.id = t.carrier_id
    where d.kind='pod' and d.owner_type='trip' and (p_status is null or d.status=p_status)
    order by d.created_at desc
    limit least(greatest(coalesce(p_limit,100),1),500);
end; $$;
revoke execute on function public.cc_pod_review_queue(text,integer) from anon, public;
grant  execute on function public.cc_pod_review_queue(text,integer) to authenticated;
