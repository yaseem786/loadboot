-- cwc_broker_docs.sql
-- Increment 54 — BROKER DOCUMENTS, APPROVALS AND UPDATE-REQUEST WORKFLOWS (additive; extends the Inc 44
-- load_document_checklist base). Partner scope remains BROKER-ONLY per owner instruction.
--
-- What it adds:
--   * Checklist submission lane for brokers: cc_partner_checklist_submit — a broker marks ITS OWN broker-side
--     checklist item as received with a document reference + note (self-scoped; carrier items untouchable).
--   * Staff review with reasons: cc_load_checklist_review — verified/rejected; rejection REQUIRES a reason the
--     broker can see; reviewer + time recorded (no silent rejections).
--   * Update-request workflow: staff ask a broker for corrected/updated info on a partner load / org / load /
--     checklist item (cc_request_update) → broker sees it (cc_partner_update_requests), responds
--     (cc_partner_respond_update) → staff resolve/cancel (cc_resolve_update_request). Every step emits an
--     event + audit row. Nothing auto-approves.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

-- Additive checklist columns (submission + review provenance)
alter table app_private.load_document_checklist add column if not exists submitted_ref text;
alter table app_private.load_document_checklist add column if not exists submitted_note text;
alter table app_private.load_document_checklist add column if not exists submitted_at timestamptz;
alter table app_private.load_document_checklist add column if not exists submitted_by uuid;
alter table app_private.load_document_checklist add column if not exists review_reason text;
alter table app_private.load_document_checklist add column if not exists reviewed_by uuid;
alter table app_private.load_document_checklist add column if not exists reviewed_at timestamptz;

create table if not exists app_private.update_requests (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('partner_load','partner_org','load','checklist_item')),
  subject_id uuid not null,
  partner_org uuid not null,
  request text not null,
  status text not null default 'open' check (status in ('open','responded','resolved','cancelled')),
  due_at timestamptz,
  requested_by uuid,
  response text,
  responded_by uuid,
  responded_at timestamptz,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists update_requests_partner_idx on app_private.update_requests(partner_org, status);

-- BROKER: submit my own broker-side checklist item (document reference + note). Carrier items are not mine.
create or replace function public.cc_partner_checklist_submit(p_item uuid, p_ref text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; c record; v_owner uuid;
begin
  v_org := app_private.my_partner_org('broker');
  if v_org is null then raise exception 'not a broker account' using errcode='42501'; end if;
  select * into c from app_private.load_document_checklist where id=p_item;
  if c.id is null then raise exception 'checklist item not found' using errcode='22023'; end if;
  if c.required_from <> 'broker' then raise exception 'not a broker document' using errcode='42501'; end if;
  v_owner := case c.subject_type
    when 'partner_load' then (select broker_org from app_private.partner_loads where id=c.subject_id)
    when 'load' then (select broker_org from public.loads where id=c.subject_id)
  end;
  if v_owner is null or v_owner <> v_org then raise exception 'not authorized' using errcode='42501'; end if;
  if c.status in ('verified','waived') then raise exception 'item already %', c.status using errcode='22023'; end if;
  update app_private.load_document_checklist
     set status='received', submitted_ref=p_ref, submitted_note=p_note,
         submitted_at=now(), submitted_by=auth.uid(), review_reason=null, updated_at=now()
   where id=p_item;
  perform app_private.log_audit('partner.checklist.submit', c.subject_type, c.subject_id::text, null,
    format('broker submitted %s', c.doc_key), jsonb_build_object('item',p_item,'doc_key',c.doc_key,'ref',p_ref));
  perform app_private.emit_event('booking.document_submitted', c.subject_type, c.subject_id::text,
    jsonb_build_object('doc_key',c.doc_key,'by','broker'));
  return jsonb_build_object('ok',true,'status','received');
end; $$;
revoke execute on function public.cc_partner_checklist_submit(uuid, text, text) from anon, public;
grant  execute on function public.cc_partner_checklist_submit(uuid, text, text) to authenticated;

-- STAFF: review a submitted item. Rejection REQUIRES a visible reason.
create or replace function public.cc_load_checklist_review(p_item uuid, p_verdict text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare c record;
begin
  if not public.has_global_permission('dispatch.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_verdict not in ('verified','rejected') then raise exception 'verdict must be verified or rejected' using errcode='22023'; end if;
  if p_verdict='rejected' and coalesce(trim(p_reason),'')='' then
    raise exception 'a rejection reason is required — the partner must know what to fix' using errcode='22023'; end if;
  select * into c from app_private.load_document_checklist where id=p_item;
  if c.id is null then raise exception 'checklist item not found' using errcode='22023'; end if;
  update app_private.load_document_checklist
     set status = case when p_verdict='verified' then 'verified' else 'rejected' end,
         review_reason = p_reason, reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
   where id=p_item;
  perform app_private.log_audit('dispatch.checklist.review', c.subject_type, c.subject_id::text, null,
    format('%s: %s%s', c.doc_key, p_verdict, coalesce(' — '||p_reason,'')),
    jsonb_build_object('item',p_item,'verdict',p_verdict,'reason',p_reason));
  perform app_private.emit_event(case when p_verdict='verified' then 'booking.document_verified' else 'booking.document_rejected' end,
    c.subject_type, c.subject_id::text, jsonb_build_object('doc_key',c.doc_key,'reason',p_reason));
  return jsonb_build_object('ok',true,'status',p_verdict);
end; $$;
revoke execute on function public.cc_load_checklist_review(uuid, text, text) from anon, public;
grant  execute on function public.cc_load_checklist_review(uuid, text, text) to authenticated;

-- STAFF: ask a broker for corrected/updated information.
create or replace function public.cc_request_update(p_subject_type text, p_subject_id uuid, p_partner uuid, p_request text, p_due timestamptz default null)
returns uuid language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_id uuid;
begin
  if not public.has_global_permission('dispatch.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_subject_type not in ('partner_load','partner_org','load','checklist_item') then raise exception 'invalid subject type' using errcode='22023'; end if;
  if coalesce(trim(p_request),'')='' then raise exception 'request text required' using errcode='22023'; end if;
  if not exists (select 1 from public.organizations where id=p_partner and kind in ('broker','partner')) then
    raise exception 'partner org not found' using errcode='22023'; end if;
  insert into app_private.update_requests(subject_type, subject_id, partner_org, request, due_at, requested_by)
    values (p_subject_type, p_subject_id, p_partner, p_request, p_due, auth.uid()) returning id into v_id;
  perform app_private.log_audit('partner.update.requested', p_subject_type, p_subject_id::text, null, p_request,
    jsonb_build_object('partner',p_partner,'due',p_due));
  perform app_private.emit_event('partner.update_requested', p_subject_type, p_subject_id::text,
    jsonb_build_object('partner',p_partner,'request',p_request,'due',p_due));
  return v_id;
end; $$;
revoke execute on function public.cc_request_update(text, uuid, uuid, text, timestamptz) from anon, public;
grant  execute on function public.cc_request_update(text, uuid, uuid, text, timestamptz) to authenticated;

-- STAFF: list update requests.
create or replace function public.cc_update_requests(p_status text default 'open', p_limit integer default 100)
returns table(id uuid, subject_type text, subject_id uuid, partner_org uuid, partner_name text,
  request text, status text, due_at timestamptz, response text, responded_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
begin
  if not public.has_global_permission('dispatch.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query
    select u.id, u.subject_type, u.subject_id, u.partner_org, o.name, u.request, u.status, u.due_at,
           u.response, u.responded_at, u.created_at
    from app_private.update_requests u
    left join public.organizations o on o.id=u.partner_org
    where (p_status is null or u.status=p_status)
    order by (u.status='open') desc, u.created_at desc
    limit least(greatest(coalesce(p_limit,100),1),500);
end; $$;
revoke execute on function public.cc_update_requests(text, integer) from anon, public;
grant  execute on function public.cc_update_requests(text, integer) to authenticated;

-- BROKER: my update requests (self-scoped).
create or replace function public.cc_partner_update_requests(p_status text default null)
returns table(id uuid, subject_type text, subject_id uuid, request text, status text,
  due_at timestamptz, response text, responded_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_org uuid;
begin
  v_org := app_private.my_partner_org('broker');
  if v_org is null then raise exception 'not a broker account' using errcode='42501'; end if;
  return query
    select u.id, u.subject_type, u.subject_id, u.request, u.status, u.due_at, u.response, u.responded_at, u.created_at
    from app_private.update_requests u
    where u.partner_org = v_org and (p_status is null or u.status=p_status)
    order by (u.status='open') desc, u.created_at desc limit 200;
end; $$;
revoke execute on function public.cc_partner_update_requests(text) from anon, public;
grant  execute on function public.cc_partner_update_requests(text) to authenticated;

-- BROKER: respond to my open update request.
create or replace function public.cc_partner_respond_update(p_id uuid, p_response text)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; u record;
begin
  v_org := app_private.my_partner_org('broker');
  if v_org is null then raise exception 'not a broker account' using errcode='42501'; end if;
  if coalesce(trim(p_response),'')='' then raise exception 'response required' using errcode='22023'; end if;
  update app_private.update_requests
     set status='responded', response=p_response, responded_by=auth.uid(), responded_at=now()
   where id=p_id and partner_org=v_org and status='open'
   returning * into u;
  if u.id is null then raise exception 'request not found or not open' using errcode='22023'; end if;
  perform app_private.log_audit('partner.update.responded', u.subject_type, u.subject_id::text, null, p_response,
    jsonb_build_object('request_id',p_id));
  perform app_private.emit_event('partner.update_responded', u.subject_type, u.subject_id::text,
    jsonb_build_object('request_id',p_id));
  return jsonb_build_object('ok',true,'status','responded');
end; $$;
revoke execute on function public.cc_partner_respond_update(uuid, text) from anon, public;
grant  execute on function public.cc_partner_respond_update(uuid, text) to authenticated;

-- STAFF: resolve or cancel a request.
create or replace function public.cc_resolve_update_request(p_id uuid, p_action text default 'resolve')
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare u record;
begin
  if not public.has_global_permission('dispatch.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_action not in ('resolve','cancel') then raise exception 'action must be resolve or cancel' using errcode='22023'; end if;
  update app_private.update_requests
     set status = case when p_action='resolve' then 'resolved' else 'cancelled' end,
         resolved_by=auth.uid(), resolved_at=now()
   where id=p_id and status in ('open','responded')
   returning * into u;
  if u.id is null then raise exception 'request not found or already closed' using errcode='22023'; end if;
  perform app_private.log_audit('partner.update.'||p_action, u.subject_type, u.subject_id::text, null, null,
    jsonb_build_object('request_id',p_id));
  return jsonb_build_object('ok',true,'status', case when p_action='resolve' then 'resolved' else 'cancelled' end);
end; $$;
revoke execute on function public.cc_resolve_update_request(uuid, text) from anon, public;
grant  execute on function public.cc_resolve_update_request(uuid, text) to authenticated;

-- Extend cc_load_checklist to expose submission + review provenance (drop needed: return-type change).
drop function if exists public.cc_load_checklist(text, uuid);
create or replace function public.cc_load_checklist(p_subject_type text, p_subject_id uuid)
returns table(id uuid, doc_key text, label text, required_from text, status text, due_at timestamptz, updated_at timestamptz,
  submitted_ref text, submitted_note text, submitted_at timestamptz, review_reason text)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_org uuid;
begin
  if not public.is_active_staff() then
    v_org := app_private.my_partner_org('broker');
    if v_org is null or p_subject_type <> 'partner_load'
       or not exists (select 1 from app_private.partner_loads pl where pl.id=p_subject_id and pl.broker_org=v_org)
      then raise exception 'not authorized' using errcode='42501'; end if;
  end if;
  return query select c.id,c.doc_key,c.label,c.required_from,c.status,c.due_at,c.updated_at,
      c.submitted_ref, c.submitted_note, c.submitted_at, c.review_reason
    from app_private.load_document_checklist c
    where c.subject_type=p_subject_type and c.subject_id=p_subject_id order by c.required_from, c.label;
end; $$;
revoke execute on function public.cc_load_checklist(text, uuid) from anon, public;
grant  execute on function public.cc_load_checklist(text, uuid) to authenticated;
