-- bl_audit_0366 — retention classes APPROVED by Yaseen on 22 Sep 2026 ("apni suggestion implement karo"), from
-- RETENTION-PROPOSAL-2026-09-20.md. Encodes the six classes, validates them in cc_erasure_decide, and gives staff a suggested
-- class + retain_until per inventory item from live facts (was this user ever paid? did their carrier org ever deliver a load?).
-- The suggestion is advisory; the staff decision is what counts. Nothing here deletes anything.
create table if not exists app_private.retention_classes (
  key text primary key, label text not null, rule text not null, years int, sort int not null
);
alter table app_private.retention_classes enable row level security;
revoke all on app_private.retention_classes from public, anon, authenticated;
insert into app_private.retention_classes(key,label,rule,years,sort) values
 ('A_money',      'Money records (settlements, invoices, BOL/POD on a paid load)', 'keep 7 years after the record date, then delete', 7, 1),
 ('B_tax',        'Tax identity (W-9)',                                         'keep 4 years after the last year a 1099 was filed; never paid => delete with the account', 4, 2),
 ('C_qualification','Carrier qualification (COI, authority, signed agreement)',  'hauled for us => keep 3 years after the last load; never hauled => delete with the account', 3, 3),
 ('D_unused',     'Never-used onboarding uploads',                              'delete with the account', 0, 4),
 ('E_marketing',  'Chat transcripts, leads, marketing',                         'delete with the account; keep only the suppression entry', 0, 5),
 ('F_audit_log',  'Security/audit log rows (no file contents)',                 'keep 2 years', 2, 6)
on conflict (key) do update set label=excluded.label, rule=excluded.rule, years=excluded.years, sort=excluded.sort;

create or replace function public.cc_retention_classes()
returns jsonb language sql stable security definer set search_path = app_private, public as $fn$
  select case when public.is_active_staff() then coalesce((select jsonb_agg(jsonb_build_object('key',key,'label',label,'rule',rule,'years',years) order by sort) from app_private.retention_classes), '[]'::jsonb) else '[]'::jsonb end
$fn$;
revoke all on function public.cc_retention_classes() from public, anon;
grant execute on function public.cc_retention_classes() to authenticated, service_role;

-- facts + suggestion per item (advisory)
create or replace function app_private.erasure_suggest(p_user uuid, p_item jsonb)
returns jsonb language plpgsql stable set search_path = app_private, public as $fn$
declare v_paid boolean; v_last_load date; v_last_paid date; kind text; src text; cls text; until date;
begin
  select bool_or(true), max(coalesce(s.paid_at, s.created_at))::date into v_paid, v_last_paid
    from app_private.fin_settlements s
    where s.status = 'paid' and s.carrier_id in (select o.id from public.organizations o where o.owner_user_id = p_user);
  v_paid := coalesce(v_paid, false) or exists (select 1 from public.settlements ps where ps.carrier_id = p_user and ps.paid_at is not null);
  select max(coalesce(t.delivered_at, t.created_at))::date into v_last_load
    from app_private.trips t where t.status in ('delivered','invoiced')
     and t.carrier_id in (select o.id from public.organizations o where o.owner_user_id = p_user);
  src := p_item->>'source'; kind := lower(coalesce(p_item->>'kind', p_item->>'type', ''));
  if kind in ('w9','w-9') then
    if v_paid then cls := 'B_tax'; until := (date_trunc('year', coalesce(v_last_paid, current_date)) + interval '5 years')::date; else cls := 'D_unused'; end if;
  elsif kind in ('coi','insurance','authority','noa','agreement','dispatch_agreement') then
    if v_last_load is not null then cls := 'C_qualification'; until := v_last_load + interval '3 years'; else cls := 'D_unused'; end if;
  elsif kind in ('bol','pod','invoice','settlement','rate_confirmation','ratecon') or src = 'agent_profile' and v_paid then
    cls := 'A_money'; until := coalesce(v_last_paid, current_date) + interval '7 years';
  elsif src in ('onboarding','onboarding_storage_prefix','onboarding_unparsed') then
    cls := case when v_last_load is not null then 'C_qualification' else 'D_unused' end; until := case when v_last_load is not null then v_last_load + interval '3 years' end;
  else
    cls := 'D_unused';
  end if;
  return jsonb_build_object('suggested_class', cls, 'suggested_decision', case when cls = 'D_unused' then 'remove' else 'hold' end,
                            'suggested_until', until, 'facts', jsonb_build_object('ever_paid', v_paid, 'last_paid', v_last_paid, 'last_delivered_load', v_last_load));
end $fn$;
revoke all on function app_private.erasure_suggest(uuid, jsonb) from public, anon, authenticated;

-- cc_erasure_items: add the suggestion; cc_erasure_decide: validate the class
create or replace function public.cc_erasure_items(p_request_id bigint)
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $fn$
declare v jsonb; u uuid;
begin
  if not (public.has_global_permission('carriers.approve') or public.has_global_permission('finance.approve')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select user_id into u from app_private.account_deletion_requests where id = p_request_id;
  select coalesce(jsonb_agg((jsonb_build_object('item_key', md5(e.item::text), 'item', e.item,
           'decision', d.decision, 'retention_class', d.retention_class, 'retain_until', d.retain_until,
           'removed_at', d.removed_at, 'removal_result', d.removal_result) || app_private.erasure_suggest(u, e.item)) order by e.ord), '[]'::jsonb)
    into v
  from app_private.account_erasure_inventories i
  cross join lateral jsonb_array_elements(i.items) with ordinality e(item, ord)
  left join app_private.erasure_item_decisions d on d.request_id = i.request_id and d.item_key = md5(e.item::text)
  where i.request_id = p_request_id;
  return jsonb_build_object('request_id', p_request_id, 'items', v, 'classes', public.cc_retention_classes());
end $fn$;

do $m$ declare d text; n text;
  anchor constant text := 'if p_decision = ''hold'' and (p_retention_class is null or p_retain_until is null or p_retain_until <= current_date) then';
  add constant text := 'if p_decision = ''hold'' and p_retention_class is not null and not exists (select 1 from app_private.retention_classes rc where rc.key = p_retention_class) then return jsonb_build_object(''error'',''unknown_retention_class''); end if;
  ';
begin
  d := pg_get_functiondef('public.cc_erasure_decide(bigint,text,text,text,date,text)'::regprocedure);
  if (length(d)-length(replace(d,anchor,'')))/length(anchor) <> 1 then raise exception 'bl_audit_0366: decide anchor not found once'; end if;
  n := replace(d, anchor, add || anchor); execute n;
end $m$;
