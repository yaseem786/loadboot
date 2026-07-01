-- cum_pocket_pod_status.sql
-- Carrier-facing read of a carrier's OWN PODs for one of their trips: status, review note and versions.
-- Self-scoping: the carrier org is resolved server-side via app_private.my_carrier_org(); the trip must
-- belong to that org, so cross-carrier reads are impossible. Powers the "review status / rejection reason
-- / resubmit" states in the Carrier Portal and Driver Pocket app.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create or replace function public.cc_pocket_trip_pods(p_trip uuid)
returns table(id uuid, file_name text, status text, review_note text, invoice_prepared boolean, created_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_org uuid;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  if not exists (select 1 from app_private.trips t where t.id=p_trip and t.carrier_id=v_org) then
    raise exception 'trip not found for your account' using errcode='42501';
  end if;
  return query
    select d.id, d.file_name, coalesce(d.status,'pending')::text, d.review_note, coalesce(d.invoice_prepared,false), d.created_at
    from app_private.document_files d
    where d.owner_type='trip' and d.owner_id=p_trip::text and d.kind='pod'
    order by d.created_at desc;
end; $$;
revoke execute on function public.cc_pocket_trip_pods(uuid) from anon, public;
grant  execute on function public.cc_pocket_trip_pods(uuid) to authenticated;
