-- bl_sec_0513 — a read-only staff login (the QA bot, bl_sec_0510, global role 'auditor' = 16 *.view permissions)
-- could still WRITE through eleven older CC RPCs, because they check only public.is_active_staff() and never a
-- permission. Found 30 Sep in the qa-bot smoke test. Worst case: cc_review_accessorial let it approve an
-- accessorial claim with an amount (money to a carrier + a notification); cc_org_set_docket let it change an MC/DOT.
-- Owner 30 Sep: "karo ye". Staging first, then prod.
--
-- Fix: app_private.is_staff_writer() = active staff AND holds at least one non-.view permission, evaluated through
-- public.has_global_permission() so deny grants, expiry and allow grants behave exactly as everywhere else.
-- Each RPC's staff check is swapped by replacing ONE anchor string in its live definition (no retyping; staging and
-- prod bodies differ for three of them). cc_review_accessorial additionally needs finance.approve to APPROVE
-- (reject stays writer-only: cc_support_decide_claim, gated on dispatch.manage/carriers.approve, calls it for both).
-- cc_retry_webhook_delivery keeps integrations.view and adds the writer check.
-- cc_org_set_docket / cc_packet_set_dates get the gate staging already has (compliance.manage or partners.manage,
-- from the staging-only bl_audit_0343 that never reached prod), so the two environments stop drifting; on staging
-- they are skipped. The owner's prod role holds both permissions and finance.approve (checked 30 Sep).
-- Left alone on purpose: cc_mark_my_notification (own inbox), cc_offers_expire (only expires offers already past
-- expiry_at), cc_book_requests_queue / cc_email_loads (reads).
-- Who is affected: prod has 2 active staff (owner = writer, qa-bot = view-only); staging 13, all writers.
-- No public function is created, so the anon SECDEF surface (36 prod / 35 staging) cannot move.

create or replace function app_private.is_staff_writer()
returns boolean
language sql
stable
security definer
set search_path = app_private, public
as $$
  select public.is_active_staff()
     and exists (select 1 from app_private.permissions p
                  where p.key not like '%.view' and public.has_global_permission(p.key));
$$;
revoke execute on function app_private.is_staff_writer() from public, anon, authenticated;

do $patch$
declare
  r record; v_oid oid; src text; v_hits int;
begin
  for r in select * from (values
    ('cc_decide_book_request',   'v_staff := public.is_active_staff();',
                                 'v_staff := app_private.is_staff_writer();'),
    ('cc_email_broker_verify',   'if not coalesce(public.is_active_staff(), false) then',
                                 'if not coalesce(app_private.is_staff_writer(), false) then'),
    ('cc_load_checklist_set',    'if not public.is_active_staff() then', 'if not app_private.is_staff_writer() then'),
    ('cc_org_set_docket', 'if not public.is_active_staff() then',
      'if not coalesce(public.has_global_permission(''compliance.manage'') or public.has_global_permission(''partners.manage''), false) then'),
    ('cc_packet_set_dates', 'if not public.is_active_staff() then',
      'if not coalesce(public.has_global_permission(''compliance.manage'') or public.has_global_permission(''partners.manage''), false) then'),
    ('cc_post_chat',             'if not public.is_active_staff() then', 'if not app_private.is_staff_writer() then'),
    ('cc_record_document_file',  'if not public.is_active_staff() then', 'if not app_private.is_staff_writer() then'),
    ('cc_task_start',            'if not public.is_active_staff() then', 'if not app_private.is_staff_writer() then'),
    ('cc_admin_note',            'if not public.is_active_staff() then', 'if not app_private.is_staff_writer() then'),
    ('cc_review_accessorial',    'if not public.is_active_staff() then', 'if not app_private.is_staff_writer() then'),
    ('cc_review_accessorial',    'then raise exception ''action must be approve or reject'' using errcode=''22023''; end if;',
                                 'then raise exception ''action must be approve or reject'' using errcode=''22023''; end if;
  if p_action = ''approve'' and not public.has_global_permission(''finance.approve'') then raise exception ''approving a claim needs finance.approve'' using errcode=''42501''; end if;'),
    ('cc_retry_webhook_delivery', 'if not public.has_global_permission(''integrations.view'') then',
                                  'if not (public.has_global_permission(''integrations.view'') and app_private.is_staff_writer()) then')
  ) t(fn, old_s, new_s)
  loop
    select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    src := pg_get_functiondef(v_oid);
    if position(r.new_s in src) > 0
       or (r.fn in ('cc_org_set_docket', 'cc_packet_set_dates') and src ~* 'has_global_permission\(''compliance\.manage''\)') then
      raise notice '%: already patched', r.fn;
      continue;
    end if;
    v_hits := (length(src) - length(replace(src, r.old_s, ''))) / length(r.old_s);
    if v_hits <> 1 then raise exception '%: anchor found % times (need exactly 1): %', r.fn, v_hits, r.old_s; end if;
    execute replace(src, r.old_s, r.new_s);
  end loop;
end $patch$;

select app_private.log_audit('security.rpc_gate', 'function', 'app_private.is_staff_writer', null::uuid,
  'Eleven staff-only CC RPCs now require a writer or a manage permission; approving an accessorial claim needs finance.approve',
  jsonb_build_object('migration', 'bl_sec_0513'), null);
