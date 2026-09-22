-- ============================================================================
-- bl_inv_0405 — Investor-initiated changes + acknowledgements + language-aware docs.
--   • AMENDMENTS   — the investor proposes, in the portal, to change the commitment
--                    (up or down, never below what is funded), to stop funding here,
--                    or to resume. Staff accept/decline in CC. Acceptance applies the
--                    change, stamps terms_changed_at, and the current document becomes
--                    STALE: a new version must be published and signed by both.
--   • ACK          — the investor acknowledges each expense ("seen, fine") — or flags it.
--   • PARAMS       — a published document stores the inputs it was built from, so the
--                    portal can show a faithful translation in the investor's language
--                    while the signature stays bound to the published text's hash.
-- Additive only.
-- ============================================================================
alter table app_private.inv_agreements    add column if not exists terms_changed_at timestamptz;
alter table app_private.inv_agreement_docs add column if not exists params jsonb;
alter table app_private.inv_expenses      add column if not exists acknowledged_at timestamptz;

create table if not exists app_private.inv_amendments (
  id            uuid primary key default gen_random_uuid(),
  agreement_id  uuid not null references app_private.inv_agreements(id) on delete cascade,
  kind          text not null check (kind in ('commitment_change','stop_funding','resume_funding')),
  proposed_by   text not null check (proposed_by in ('investor','company')),
  proposed_user uuid,
  old_value     jsonb not null default '{}'::jsonb,
  new_value     jsonb not null default '{}'::jsonb,
  reason        text,
  status        text not null default 'proposed' check (status in ('proposed','accepted','declined','withdrawn')),
  decided_by    uuid, decided_at timestamptz, decision_note text,
  created_at    timestamptz not null default now()
);
alter table app_private.inv_amendments enable row level security;
create index if not exists inv_amendments_agr_idx on app_private.inv_amendments(agreement_id, status);

-- investor: propose
create or replace function public.inv_propose_amendment(p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare a app_private.inv_agreements; pos jsonb; v_kind text; v_new numeric; v_id uuid; v_funded numeric;
begin
  a := app_private.inv_guard((p->>'agreement_id')::uuid);
  if app_private.inv_my_investor() is distinct from a.investor_id then
    raise exception 'only the investor can propose here' using errcode='42501'; end if;
  if a.status in ('wound_down','closed') then raise exception 'this agreement is closed' using errcode='22023'; end if;
  if exists (select 1 from app_private.inv_amendments where agreement_id = a.id and status = 'proposed') then
    raise exception 'you already have a pending proposal — withdraw it first' using errcode='22023'; end if;
  v_kind := p->>'kind'; pos := app_private.inv_position(a.id); v_funded := (pos->>'funded')::numeric;
  if v_kind = 'commitment_change' then
    v_new := (p->>'new_cap')::numeric;
    if coalesce(v_new,0) <= 0 then raise exception 'enter the new commitment' using errcode='22023'; end if;
    if v_new < v_funded then raise exception 'the commitment cannot be below what is already funded' using errcode='22023'; end if;
    if v_new = a.commitment_cap then raise exception 'that is already the commitment' using errcode='22023'; end if;
  elsif v_kind = 'stop_funding' then
    if a.commitment_closed_at is not null then raise exception 'funding is already stopped' using errcode='22023'; end if;
    if v_funded <= 0 then raise exception 'nothing has been funded yet' using errcode='22023'; end if;
    v_new := v_funded;
  elsif v_kind = 'resume_funding' then
    if a.commitment_closed_at is null then raise exception 'funding is not stopped' using errcode='22023'; end if;
    v_new := (p->>'new_cap')::numeric;
    if coalesce(v_new,0) <= v_funded then raise exception 'the new commitment must be above what is funded' using errcode='22023'; end if;
  else raise exception 'unknown amendment kind' using errcode='22023'; end if;
  insert into app_private.inv_amendments (agreement_id, kind, proposed_by, proposed_user, old_value, new_value, reason)
  values (a.id, v_kind, 'investor', auth.uid(),
          jsonb_build_object('commitment_cap', a.commitment_cap, 'funded', v_funded, 'closed', a.commitment_closed_at is not null),
          jsonb_build_object('commitment_cap', v_new), nullif(btrim(p->>'reason'),''))
  returning id into v_id;
  perform app_private.log_audit('investor.amendment_proposed','investor', v_id::text, null,
    'Investor proposed: ' || v_kind, jsonb_build_object('agreement', a.id, 'new_cap', v_new));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.inv_withdraw_amendment(p_id uuid)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare m app_private.inv_amendments; a app_private.inv_agreements;
begin
  select * into m from app_private.inv_amendments where id = p_id;
  if not found then raise exception 'not found' using errcode='42704'; end if;
  a := app_private.inv_guard(m.agreement_id);
  if app_private.inv_my_investor() is distinct from a.investor_id then raise exception 'not authorized' using errcode='42501'; end if;
  if m.status <> 'proposed' then raise exception 'already decided' using errcode='22023'; end if;
  update app_private.inv_amendments set status = 'withdrawn', decided_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function app_private.inv_amendments_json(p_agreement uuid)
returns jsonb language sql stable security definer set search_path to 'app_private, public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'proposed_by', m.proposed_by, 'old_value', m.old_value,
           'new_value', m.new_value, 'reason', m.reason, 'status', m.status, 'decision_note', m.decision_note,
           'created_at', m.created_at, 'decided_at', m.decided_at) order by m.created_at desc), '[]'::jsonb)
  from app_private.inv_amendments m where m.agreement_id = p_agreement;
$$;

create or replace function public.inv_my_amendments(p_agreement uuid)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
begin
  perform app_private.inv_guard(p_agreement);
  return jsonb_build_object('ok', true, 'amendments', app_private.inv_amendments_json(p_agreement));
end $$;

-- staff: decide. Acceptance APPLIES the change and marks the terms as changed.
create or replace function public.cc_inv_decide_amendment(p_id uuid, p_accept boolean, p_note text)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare m app_private.inv_amendments; a app_private.inv_agreements; v_new numeric; v_funded numeric;
begin
  if not app_private.inv_can_manage() then raise exception 'not authorized' using errcode='42501'; end if;
  select * into m from app_private.inv_amendments where id = p_id;
  if not found then raise exception 'not found' using errcode='42704'; end if;
  if m.status <> 'proposed' then raise exception 'already decided' using errcode='22023'; end if;
  select * into a from app_private.inv_agreements where id = m.agreement_id;
  if not p_accept then
    update app_private.inv_amendments set status = 'declined', decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = p_id;
    perform app_private.log_audit('investor.amendment_declined','investor', p_id::text, null, 'Amendment declined', jsonb_build_object('note', p_note));
    return jsonb_build_object('ok', true, 'applied', false);
  end if;
  v_new := (m.new_value->>'commitment_cap')::numeric;
  v_funded := (app_private.inv_position(a.id)->>'funded')::numeric;
  if m.kind = 'stop_funding' then
    update app_private.inv_agreements
       set original_cap = coalesce(original_cap, commitment_cap), commitment_cap = v_funded,
           commitment_closed_at = now(), closed_reason = coalesce(m.reason, 'Investor chose to stop here'),
           status = case when status = 'active' then 'stopped_early' else status end, terms_changed_at = now()
     where id = a.id;
    update app_private.inv_requests set status = 'cancelled', responded_at = now()
     where agreement_id = a.id and status in ('pending','declared');
  elsif m.kind = 'resume_funding' then
    update app_private.inv_agreements
       set commitment_cap = v_new, commitment_closed_at = null, closed_reason = null,
           status = case when status = 'stopped_early' then 'active' else status end, terms_changed_at = now()
     where id = a.id;
  else -- commitment_change
    if v_new < v_funded then raise exception 'below funded amount' using errcode='22023'; end if;
    update app_private.inv_agreements
       set original_cap = coalesce(original_cap, commitment_cap), commitment_cap = v_new, terms_changed_at = now()
     where id = a.id;
    if v_new = v_funded and a.commitment_closed_at is null then
      update app_private.inv_agreements set commitment_closed_at = now(), closed_reason = coalesce(m.reason, 'Commitment set to the funded amount'),
        status = case when status = 'active' then 'stopped_early' else status end where id = a.id;
      update app_private.inv_requests set status = 'cancelled', responded_at = now() where agreement_id = a.id and status in ('pending','declared');
    end if;
  end if;
  update app_private.inv_amendments set status = 'accepted', decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = p_id;
  perform app_private.log_audit('investor.amendment_accepted','investor', p_id::text, null,
    'Amendment accepted: ' || m.kind, jsonb_build_object('agreement', a.id, 'new_cap', v_new, 'note', p_note));
  return jsonb_build_object('ok', true, 'applied', true, 'position', app_private.inv_position(a.id));
end $$;

-- investor: acknowledge an expense (seen, fine). A flag is the other answer.
create or replace function public.inv_ack_expense(p_expense uuid)
returns jsonb language plpgsql volatile security definer set search_path to 'app_private, public' as $$
declare e app_private.inv_expenses; a app_private.inv_agreements;
begin
  select * into e from app_private.inv_expenses where id = p_expense;
  if not found then raise exception 'not found' using errcode='42704'; end if;
  a := app_private.inv_guard(e.agreement_id);
  if app_private.inv_my_investor() is distinct from a.investor_id then raise exception 'not authorized' using errcode='42501'; end if;
  update app_private.inv_expenses set acknowledged_at = coalesce(acknowledged_at, now()) where id = p_expense;
  return jsonb_build_object('ok', true);
end $$;

-- publish stores the build inputs (params) so the portal can translate faithfully
create or replace function public.cc_inv_publish_doc(p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare v_agr uuid; v_ver int; v_id uuid; v_hash text; v_body text;
begin
  if not app_private.inv_can_manage() then raise exception 'not authorized' using errcode='42501'; end if;
  v_agr := (p->>'agreement_id')::uuid; v_body := p->>'body_md';
  if coalesce(btrim(v_body),'') = '' then raise exception 'document body is empty' using errcode='22023'; end if;
  v_hash := encode(extensions.digest(convert_to(v_body, 'UTF8'), 'sha256'), 'hex');
  update app_private.inv_agreement_docs set status = 'superseded' where agreement_id = v_agr and status = 'published';
  select coalesce(max(version),0) + 1 into v_ver from app_private.inv_agreement_docs where agreement_id = v_agr;
  insert into app_private.inv_agreement_docs (agreement_id, version, lang, title, body_md, body_hash, published_by, params)
  values (v_agr, v_ver, coalesce(nullif(p->>'lang',''),'en'), coalesce(nullif(p->>'title',''),'Investment Agreement'), v_body, v_hash, auth.uid(), p->'params')
  returning id into v_id;
  perform app_private.log_audit('investor.doc_published','investor', v_id::text, null,
    'Agreement document published', jsonb_build_object('agreement', v_agr, 'version', v_ver, 'hash', v_hash));
  return jsonb_build_object('ok', true, 'id', v_id, 'version', v_ver, 'hash', v_hash);
end $$;

create or replace function public.inv_current_doc(p_agreement uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare d app_private.inv_agreement_docs; a app_private.inv_agreements; v_sigs jsonb;
begin
  a := app_private.inv_guard(p_agreement);
  select * into d from app_private.inv_agreement_docs where agreement_id = p_agreement and status = 'published'
   order by version desc limit 1;
  if not found then return jsonb_build_object('ok', true, 'doc', null, 'terms_changed_at', a.terms_changed_at); end if;
  select coalesce(jsonb_agg(jsonb_build_object('party', s.party, 'signer_name', s.signer_name, 'signer_title', s.signer_title,
           'signed_at', s.signed_at, 'has_image', s.signature_png is not null, 'hash_matches', s.body_hash = d.body_hash)
           order by s.signed_at), '[]'::jsonb) into v_sigs from app_private.inv_signatures s where s.doc_id = d.id;
  return jsonb_build_object('ok', true, 'doc', jsonb_build_object('id', d.id, 'version', d.version, 'lang', d.lang,
    'title', d.title, 'body_md', d.body_md, 'hash', d.body_hash, 'published_at', d.published_at, 'signatures', v_sigs,
    'params', d.params,
    'stale', (a.terms_changed_at is not null and a.terms_changed_at > d.published_at),
    'fully_signed', (select count(*) = 2 from app_private.inv_signatures s where s.doc_id = d.id)),
    'terms_changed_at', a.terms_changed_at);
end $$;

-- staff: amendments + expense acknowledgements for the drawer
create or replace function public.cc_inv_amendments(p_agreement uuid)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
begin
  if not app_private.inv_is_staff() then raise exception 'not authorized' using errcode='42501'; end if;
  return jsonb_build_object('ok', true, 'amendments', app_private.inv_amendments_json(p_agreement),
    'acks', (select coalesce(jsonb_object_agg(id, acknowledged_at), '{}'::jsonb) from app_private.inv_expenses where agreement_id = p_agreement and acknowledged_at is not null),
    'terms_changed_at', (select terms_changed_at from app_private.inv_agreements where id = p_agreement));
end $$;

-- inv_ledger: expenses now carry acknowledged_at (full redefinition, copied from 0402 + one field)
create or replace function public.inv_ledger(p_agreement uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare a app_private.inv_agreements; v_rcpt jsonb; v_exp jsonb; v_pay jsonb; v_cat jsonb;
begin
  a := app_private.inv_guard(p_agreement);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'amount', r.amount, 'received_date', r.received_date, 'method', r.method,
           'reference', r.reference, 'proof_url', r.proof_url, 'note', r.note,
           'declared_at', r.declared_by_investor_at, 'confirmed_at', r.confirmed_by_staff_at,
           'rejected_reason', r.rejected_reason,
           'state', case when r.rejected_at is not null then 'rejected'
                         when r.reversal_of is not null then 'reversal'
                         when r.confirmed_by_staff_at is not null then 'confirmed'
                         else 'awaiting_confirmation' end
         ) order by r.received_date desc, r.created_at desc), '[]'::jsonb) into v_rcpt
    from app_private.inv_receipts r where r.agreement_id = a.id;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'date', e.expense_date, 'category', e.category, 'amount', e.amount,
           'vendor', e.vendor, 'description', e.description, 'receipt_url', e.receipt_url,
           'recurring', e.is_recurring, 'reversed', (e.reversal_of is not null),
           'acknowledged_at', e.acknowledged_at,
           'tranche', (select x.received_date from app_private.inv_receipts x where x.id = e.receipt_id)
         ) order by e.expense_date desc, e.created_at desc), '[]'::jsonb) into v_exp
    from app_private.inv_expenses e where e.agreement_id = a.id;
  select coalesce(jsonb_object_agg(cat, amt), '{}'::jsonb) into v_cat from (
    select category as cat, sum(case when reversal_of is null then amount else -amount end) as amt
      from app_private.inv_expenses where agreement_id = a.id group by category having sum(case when reversal_of is null then amount else -amount end) > 0) z;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'kind', p.kind, 'payback', p.payback_portion, 'share', p.share_portion, 'total', p.total,
           'paid_date', p.paid_date, 'method', p.method, 'reference', p.reference, 'proof_url', p.proof_url,
           'status', p.status, 'confirmed_at', p.confirmed_by_investor_at,
           'month', (select s.period_month from app_private.inv_statements s where s.id = p.statement_id)
         ) order by p.created_at desc), '[]'::jsonb) into v_pay
    from app_private.inv_payouts p where p.agreement_id = a.id;
  return jsonb_build_object('ok', true, 'position', app_private.inv_position(a.id),
    'receipts', v_rcpt, 'expenses', v_exp, 'by_category', v_cat, 'payouts', v_pay);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.inv_propose_amendment(jsonb)', 'public.inv_withdraw_amendment(uuid)', 'public.inv_my_amendments(uuid)',
    'public.cc_inv_decide_amendment(uuid,boolean,text)', 'public.inv_ack_expense(uuid)', 'public.cc_inv_amendments(uuid)',
    'public.cc_inv_publish_doc(jsonb)', 'public.inv_current_doc(uuid)', 'public.inv_ledger(uuid)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- 0405a — a signature is refused on a version published BEFORE the latest accepted change
-- (the UI hides the sign block too; this is the server-side guarantee).
create or replace function app_private.inv_sign(p_doc uuid, p_party text, p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare d app_private.inv_agreement_docs; a app_private.inv_agreements; v_id uuid; v_both boolean;
begin
  select * into d from app_private.inv_agreement_docs where id = p_doc;
  if not found or d.status <> 'published' then raise exception 'that document is not the current version' using errcode='22023'; end if;
  select * into a from app_private.inv_agreements where id = d.agreement_id;
  if a.terms_changed_at is not null and a.terms_changed_at > d.published_at then
    raise exception 'the terms changed after this version was published — a new version must be published first' using errcode='22023'; end if;
  if coalesce(btrim(p->>'signer_name'),'') = '' then raise exception 'type your full name to sign' using errcode='22023'; end if;
  if (p->>'hash') is distinct from d.body_hash then
    raise exception 'the document changed while you were reading it — reload and read it again' using errcode='22023'; end if;
  if coalesce((p->>'consent')::boolean, false) is not true then raise exception 'consent box not ticked' using errcode='22023'; end if;
  insert into app_private.inv_signatures (doc_id, party, signer_name, signer_title, user_id, body_hash, signature_png, consent_text, ip, user_agent)
  values (p_doc, p_party, btrim(p->>'signer_name'), nullif(p->>'signer_title',''), auth.uid(), d.body_hash,
          nullif(p->>'signature_png',''), coalesce(nullif(p->>'consent_text',''), 'I have read this agreement and sign it electronically.'),
          nullif(p->>'ip',''), nullif(p->>'user_agent',''))
  on conflict (doc_id, party) do nothing
  returning id into v_id;
  if v_id is null then raise exception 'already signed by this party' using errcode='22023'; end if;
  select count(*) = 2 into v_both from app_private.inv_signatures where doc_id = p_doc;
  if v_both then
    update app_private.inv_agreements set signed_date = coalesce(signed_date, current_date) where id = d.agreement_id;
  end if;
  perform app_private.log_audit('investor.doc_signed','investor', v_id::text, null,
    'Agreement signed (' || p_party || ')', jsonb_build_object('doc', p_doc, 'hash', d.body_hash, 'fully_signed', v_both));
  return jsonb_build_object('ok', true, 'id', v_id, 'fully_signed', v_both);
end $$;
