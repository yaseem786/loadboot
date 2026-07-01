-- cun_pod_upload_hardening.sql
-- Server-side validation for carrier/driver POD uploads. The browser is NEVER trusted for carrier org,
-- object path, MIME type or size — the RPC re-derives the caller identity and re-checks everything.
--
-- Object-path contract:  {auth.uid()}/pod/{trip}/{immutable-name}
--   * first folder = auth.uid()  -> exactly what the Storage `doc_upload` RLS policy requires
--   * server also re-derives the trip and rejects any path outside this trip's prefix
-- No anonymous upload, no cross-carrier upload, no public bucket, no permanent public URL.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create or replace function public.cc_pocket_upload_pod(p_trip uuid, p_path text, p_file_name text default 'POD', p_content_type text default null, p_size bigint default null)
returns uuid
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; v_id uuid; v_status text;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  if not exists (select 1 from app_private.trips t where t.id=p_trip and t.carrier_id=v_org) then
    raise exception 'trip not found for your account' using errcode='42501';
  end if;
  -- trip state must permit POD submission
  select t.status into v_status from app_private.trips t where t.id=p_trip;
  if v_status not in ('delivered','invoiced') then
    raise exception 'trip state does not permit POD upload' using errcode='22023';
  end if;
  -- validate MIME against the private-bucket + review contract
  if p_content_type is null or p_content_type not in ('application/pdf','image/jpeg','image/png','image/webp') then
    raise exception 'unsupported file type' using errcode='22023';
  end if;
  -- validate size (0 < size <= 10 MB)
  if p_size is null or p_size <= 0 or p_size > 10485760 then
    raise exception 'file too large or empty' using errcode='22023';
  end if;
  -- validate the browser-supplied object path stays inside {uid}/pod/{trip}/...
  if p_path is null or p_path !~ ('^'||auth.uid()::text||'/pod/'||p_trip::text||'/[A-Za-z0-9._-]+$') then
    raise exception 'invalid object path' using errcode='22023';
  end if;
  insert into app_private.document_files(owner_type,owner_id,kind,path,file_name,content_type,size_bytes,uploaded_by,status)
    values ('trip', p_trip::text, 'pod', p_path, left(p_file_name,200), p_content_type, p_size, auth.uid(), 'pending')
    returning id into v_id;
  perform app_private.emit_event('pod.uploaded','trip',p_trip::text, jsonb_build_object('source','pocket','file',v_id));
  return v_id;
end; $$;
revoke execute on function public.cc_pocket_upload_pod(uuid,text,text,text,bigint) from anon, public;
grant  execute on function public.cc_pocket_upload_pod(uuid,text,text,text,bigint) to authenticated;
