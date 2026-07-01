-- cul_pod_review_workflow.sql
-- Proof-of-delivery review workflow for the Command Center.
-- Adds review state to app_private.document_files and the reviewer-only RPCs that back the
-- "Documents -> POD Review Queue" screen. All public RPCs are SECURITY DEFINER, deny-by-default
-- (anon/public revoked, authenticated granted) and gated on app_private.can_review_pod().
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

-- 1) review state on the document row (immutable original bytes; status/versioning is metadata)
alter table app_private.document_files add column if not exists status           text;
alter table app_private.document_files add column if not exists review_note      text;
alter table app_private.document_files add column if not exists reviewed_at      timestamptz;
alter table app_private.document_files add column if not exists reviewed_by       uuid;
alter table app_private.document_files add column if not exists invoice_prepared boolean not null default false;

-- 2) who may review a POD: dispatch / finance / compliance managers
create or replace function app_private.can_review_pod()
returns boolean
language sql stable security definer set search_path to 'app_private, public'
as $$
  select public.has_global_permission('dispatch.manage')
      or public.has_global_permission('finance.manage')
      or public.has_global_permission('compliance.manage');
$$;

-- 3) queue of PODs for review (v1 shape; enriched later by cuo_pod_queue_enrich)
create or replace function public.cc_pod_review_queue(p_status text default 'pending', p_limit integer default 100)
returns table(id uuid, trip_id text, kind text, file_name text, status text, review_note text, uploaded_by uuid, created_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
begin
  if not app_private.can_review_pod() then raise exception 'not authorized' using errcode='42501'; end if;
  return query select d.id, d.owner_id, d.kind, d.file_name, d.status, d.review_note, d.uploaded_by, d.created_at
    from app_private.document_files d
    where d.kind='pod' and d.owner_type='trip' and (p_status is null or d.status=p_status)
    order by d.created_at desc limit least(greatest(coalesce(p_limit,100),1),500);
end; $$;
revoke execute on function public.cc_pod_review_queue(text,integer) from anon, public;
grant  execute on function public.cc_pod_review_queue(text,integer) to authenticated;

-- 4) resolve a short-lived signed-preview reference for a POD (bucket + path only; the browser mints
--    the actual signed URL against private Storage, which staff may read via is_admin()).
create or replace function public.cc_pod_signed_ref(p_doc uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v record;
begin
  if not app_private.can_review_pod() then raise exception 'not authorized' using errcode='42501'; end if;
  select path, file_name, content_type into v from app_private.document_files where id=p_doc and kind='pod';
  if v.path is null then raise exception 'pod not found' using errcode='22023'; end if;
  return jsonb_build_object('bucket','documents','path',v.path,'file_name',v.file_name,'content_type',v.content_type);
end; $$;
revoke execute on function public.cc_pod_signed_ref(uuid) from anon, public;
grant  execute on function public.cc_pod_signed_ref(uuid) to authenticated;

-- 5) approve/reject a POD. Rejection requires a reason. Row-locked + idempotent. Approval emits
--    invoice.prep_requested exactly once (guarded by invoice_prepared). Every decision is audited.
create or replace function public.cc_review_pod(p_doc uuid, p_decision text, p_reason text default null)
returns text
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v record;
begin
  if not app_private.can_review_pod() then raise exception 'not authorized' using errcode='42501'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'decision must be approved or rejected' using errcode='22023'; end if;
  select * into v from app_private.document_files where id=p_doc and kind='pod' for update;
  if v.id is null then raise exception 'pod not found' using errcode='22023'; end if;
  if p_decision='rejected' and coalesce(btrim(p_reason),'')='' then raise exception 'a rejection reason is required' using errcode='22023'; end if;
  if v.status=p_decision then return p_decision; end if; -- idempotent
  update app_private.document_files set status=p_decision, review_note=p_reason, reviewed_at=now(), reviewed_by=auth.uid() where id=p_doc;
  perform app_private.emit_event('pod.reviewed','trip', v.owner_id, jsonb_build_object('document',p_doc,'decision',p_decision,'reason',left(coalesce(p_reason,''),200)));
  perform app_private.log_audit('pod.review','document_file',p_doc::text,null, format('POD %s',p_decision), jsonb_build_object('decision',p_decision,'reason_present',coalesce(btrim(p_reason),'')<>''));
  if p_decision='approved' and not v.invoice_prepared then
    update app_private.document_files set invoice_prepared=true where id=p_doc;
    perform app_private.emit_event('invoice.prep_requested','trip', v.owner_id, jsonb_build_object('document',p_doc,'reason','pod_approved'));
  end if;
  return p_decision;
end; $$;
revoke execute on function public.cc_review_pod(uuid,text,text) from anon, public;
grant  execute on function public.cc_review_pod(uuid,text,text) to authenticated;
