-- bl_audit_0353 — live-chat onboarding document reconciliation, PHASE 2a (RELINK only).
-- Design: docs/audit-2026-09/DESIGN-LC-ORPHAN-RECONCILIATION-2026-09-19.md (Yaseen's decision 2, 19 Sep: relink for staff review).
-- One path per call, dry-run by default, every call logged. Never deletes anything. Removal (decision 3, 7 days) is NOT here:
-- it must go through the Storage API and is a separate package.
-- Staff-only via app_private.lc_cc_ok(). NOT anon-executable: anon SECURITY DEFINER NAMES must be unchanged after apply.

create table if not exists app_private.lc_doc_recon_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  action text not null,
  path text not null,
  visitor_key text,
  dry_run boolean not null,
  result text not null
);
alter table app_private.lc_doc_recon_log enable row level security;
revoke all on app_private.lc_doc_recon_log from public, anon, authenticated;

create or replace function public.cc_lc_doc_relink(p_path text, p_dry_run boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_private, public
as $fn$
declare
  v_key text; v_created timestamptz; v_ob uuid; v_n int; v_result text; v_entry jsonb;
begin
  if not app_private.lc_cc_ok() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_path is null or p_path not like 'lc-onboarding/%/%' then
    return jsonb_build_object('ok', false, 'error', 'bad_path');
  end if;
  p_dry_run := coalesce(p_dry_run, true);
  v_key := split_part(p_path, '/', 2);

  select so.created_at into v_created from storage.objects so
   where so.bucket_id = 'documents' and so.name = p_path;
  if not found then v_result := 'no_object';
  elsif v_created >= now() - interval '1 hour' then v_result := 'too_fresh';
  elsif exists (select 1 from app_private.lc_onboarding o
                cross join lateral jsonb_array_elements(case when jsonb_typeof(o.docs)='array' then o.docs else '[]'::jsonb end) e(doc)
                where e.doc->>'path' = p_path) then v_result := 'already_linked';
  else
    select o.id, jsonb_array_length(case when jsonb_typeof(o.docs)='array' then o.docs else '[]'::jsonb end)
      into v_ob, v_n from app_private.lc_onboarding o where o.visitor_key = v_key for update;
    if v_ob is null then v_result := 'no_ob_row';
    elsif v_n >= 40 then v_result := 'doc_limit';
    else
      v_entry := jsonb_build_object('t','unknown','f', split_part(p_path,'/',3), 'path', p_path,
                                    'verdict','recovered','ts', to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
      if p_dry_run then v_result := 'would_relink';
      else
        update app_private.lc_onboarding o
           set docs = (case when jsonb_typeof(o.docs)='array' then o.docs else '[]'::jsonb end) || jsonb_build_array(v_entry),
               updated_at = now()
         where o.id = v_ob;
        v_result := 'relinked';
      end if;
    end if;
  end if;

  insert into app_private.lc_doc_recon_log(actor, action, path, visitor_key, dry_run, result)
  values (auth.uid(), 'relink', p_path, v_key, p_dry_run, v_result);

  return jsonb_build_object('ok', v_result in ('would_relink','relinked'), 'result', v_result,
                            'path', p_path, 'visitor_key', v_key, 'dry_run', p_dry_run, 'entry', v_entry);
end
$fn$;

revoke all on function public.cc_lc_doc_relink(text, boolean) from public, anon;
grant execute on function public.cc_lc_doc_relink(text, boolean) to authenticated, service_role;
