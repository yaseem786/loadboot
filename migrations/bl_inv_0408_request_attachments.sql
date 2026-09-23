-- bl_inv_0408 — attachments on capital requests (invoice / quote / screenshot the request is based on)
-- Additive. Files live in the private bucket investor-proofs under <agreement_id>/… (same as expense receipts);
-- a request stores [{ref:'storage:<agr>/<file>', name, note}] and both sides read it through signed URLs.
begin;

alter table app_private.inv_requests add column if not exists attachments jsonb not null default '[]'::jsonb;

-- keeps only well-formed entries whose ref sits inside this agreement's folder
create or replace function app_private.inv_clean_attachments(p_agr uuid, p_in jsonb)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'ref', x->>'ref', 'name', left(coalesce(x->>'name',''), 120), 'note', left(coalesce(x->>'note',''), 300))), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p_in) = 'array' then p_in else '[]'::jsonb end) x
   where x->>'ref' like 'storage:' || p_agr::text || '/%'
$$;

-- add attachments to an existing request (staff), appended, never replaced
create or replace function public.cc_inv_request_attach(p_request uuid, p_attachments jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare r app_private.inv_requests; v_att jsonb;
begin
  if not app_private.inv_can_manage() then raise exception 'not authorized' using errcode='42501'; end if;
  select * into r from app_private.inv_requests where id = p_request;
  if r.id is null then raise exception 'request not found' using errcode='22023'; end if;
  v_att := app_private.inv_clean_attachments(r.agreement_id, p_attachments);
  update app_private.inv_requests set attachments = attachments || v_att where id = p_request;
  perform app_private.log_audit('investor.request_attached','investor', p_request::text, null,
    'Attachment added to capital request', jsonb_build_object('count', jsonb_array_length(v_att)));
  return jsonb_build_object('ok', true, 'attachments', (select attachments from app_private.inv_requests where id = p_request));
end $$;
revoke all on function public.cc_inv_request_attach(uuid, jsonb) from public;
grant execute on function public.cc_inv_request_attach(uuid, jsonb) to authenticated;

-- cc_inv_request: accepts p->'attachments' (copied from 0401 + one field)
create or replace function public.cc_inv_request(p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare v_agr uuid; v_seq int; v_id uuid; v_pos jsonb; v_amt numeric; v_att jsonb;
begin
  if not app_private.inv_can_manage() then
    raise exception 'not authorized' using errcode='42501'; end if;
  v_agr := (p->>'agreement_id')::uuid;
  v_amt := round((p->>'amount')::numeric, 2);
  if v_amt is null or v_amt <= 0 then
    raise exception 'amount must be greater than zero' using errcode='22023'; end if;
  v_pos := app_private.inv_position(v_agr);
  if v_amt > (v_pos->>'unfunded')::numeric then
    raise exception 'that is more than the remaining commitment (%)', (v_pos->>'unfunded')
      using errcode='22023';
  end if;
  v_att := app_private.inv_clean_attachments(v_agr, p->'attachments');
  select coalesce(max(seq),0) + 1 into v_seq
    from app_private.inv_requests where agreement_id = v_agr;
  insert into app_private.inv_requests
    (agreement_id, seq, amount, reason, category, needed_by, requested_by, attachments)
  values (v_agr, v_seq, v_amt, btrim(p->>'reason'), nullif(p->>'category',''),
          nullif(p->>'needed_by','')::date, auth.uid(), v_att)
  returning id into v_id;
  perform app_private.log_audit('investor.capital_requested','investor', v_id::text, null,
    'Capital request raised', p);
  return jsonb_build_object('ok', true, 'id', v_id, 'seq', v_seq);
end $$;

-- inv_my_requests: investor reads attachments (copied from 0401 + one field)
create or replace function public.inv_my_requests(p_agreement uuid)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare a app_private.inv_agreements; v jsonb;
begin
  a := app_private.inv_guard(p_agreement);
  if app_private.inv_my_investor() = a.investor_id then
    update app_private.inv_requests set seen_at = now()
     where agreement_id = a.id and status = 'pending' and seen_at is null;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'seq', r.seq, 'amount', r.amount, 'reason', r.reason,
           'category', r.category, 'needed_by', r.needed_by, 'status', r.status,
           'requested_at', r.requested_at, 'responded_at', r.responded_at,
           'decline_reason', r.decline_reason, 'attachments', r.attachments,
           'funded', (select coalesce(sum(x.amount),0) from app_private.inv_receipts x
                       where x.request_id = r.id and x.confirmed_by_staff_at is not null)
         ) order by r.seq desc), '[]'::jsonb) into v
    from app_private.inv_requests r where r.agreement_id = a.id;
  return jsonb_build_object('ok', true, 'requests', v);
end $$;

-- cc_inv_detail: staff reads attachments (copied from 0402 + one field)
create or replace function public.cc_inv_detail(p_agreement uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare v jsonb; v_req jsonb; v_due jsonb; v_flags jsonb; a app_private.inv_agreements; i app_private.inv_investors;
begin
  if not app_private.inv_is_staff() then raise exception 'not authorized' using errcode='42501'; end if;
  select * into a from app_private.inv_agreements where id = p_agreement;
  select * into i from app_private.inv_investors where id = a.investor_id;
  v := public.inv_ledger(p_agreement);
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'seq', r.seq, 'amount', r.amount, 'reason', r.reason,
           'category', r.category, 'status', r.status, 'requested_at', r.requested_at, 'seen_at', r.seen_at, 'needed_by', r.needed_by, 'attachments', r.attachments)
           order by r.seq desc), '[]'::jsonb) into v_req from app_private.inv_requests r where r.agreement_id = p_agreement;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'month', s.period_month, 'payback', p.payback_portion,
           'share', p.share_portion, 'total', p.total) order by p.created_at desc), '[]'::jsonb) into v_due
    from app_private.inv_payouts p left join app_private.inv_statements s on s.id = p.statement_id
   where p.agreement_id = p_agreement and p.status = 'pending';
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'ref_id', f.ref_id, 'note', f.note, 'status', f.status,
           'answer', f.answer, 'raised_at', f.raised_at) order by f.raised_at desc), '[]'::jsonb) into v_flags
    from app_private.inv_flags f where f.agreement_id = p_agreement;
  return v || jsonb_build_object('requests', v_req, 'payouts_due', v_due, 'flags', v_flags,
    'investor', jsonb_build_object('id', i.id, 'name', i.name, 'lang', i.preferred_lang, 'linked', i.user_id is not null),
    'agreement', jsonb_build_object('id', a.id, 'investor_id', a.investor_id, 'title', a.title, 'status', a.status,
      'currency', a.currency, 'commitment_cap', a.commitment_cap, 'original_cap', a.original_cap,
      'payback_rate_pct', a.payback_rate_pct, 'permanent_share_pct', a.permanent_share_pct,
      'payback_basis', a.payback_basis, 'payback_fixed_amount', a.payback_fixed_amount, 'share_type', a.share_type,
      'equity_vesting_mode', a.equity_vesting_mode, 'profit_definition', a.profit_definition,
      'exit_treatment', a.exit_treatment, 'early_stop_terms', a.early_stop_terms, 'buyout_terms', a.buyout_terms,
      'early_stop_share_mode', a.early_stop_share_mode, 'loss_carry_forward', a.loss_carry_forward,
      'exit_participation_pct', a.exit_participation_pct, 'commitment_closed_at', a.commitment_closed_at,
      'closed_reason', a.closed_reason, 'wind_down', a.wind_down, 'signed_date', a.signed_date, 'doc_url', a.doc_url));
end $$;
commit;
