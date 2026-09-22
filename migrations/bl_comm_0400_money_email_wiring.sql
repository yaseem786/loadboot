-- ============================================================================
-- bl_comm_0400 — Pack B (Money): wire the 4 planned billing emails.
--   tx.invoice_ready · tx.payment_update · tx.settlement_ready
--   tx.invoice_dispute_update
--
-- SCHEMA RE-VERIFIED 22 Sep 2026 against BOTH databases, because
-- claude/EMAIL-WIRING-PLAN-0399.md section 3 was wrong twice (the same way
-- section 7 was wrong for Pack A):
--
--   plan said                       | what is actually there
--   --------------------------------|------------------------------------------
--   fin_invoices.status -> 'issued' | no such value. CHECK is draft|sent|paid|void
--   status -> 'failed' / 'partial'  | no such values. After 'sent' the only
--                                   | transitions are 'paid' and 'void'
--   "staff records a dispute note"  | there is a real table, app_private.fin_disputes
--                                   | (open|resolved|rejected), fired by
--                                   | cc_open_dispute / cc_resolve_dispute
--   (not mentioned at all)          | fin_adjustments holds the itemisation, and
--                                   | gross ALREADY includes every adjustment
--                                   | (apply_accessorial_to_invoice does
--                                   | gross = gross + amount), so the receipt must
--                                   | show linehaul = gross - adjustments
--
-- STAGING/PROD DRIFT (real, not from this migration): staging fin_invoices has
-- stripe_invoice_id, stripe_status, hosted_url, pdf_url, approved_at/by, sent_at,
-- void_reason and the whole cc_fee_invoice_* Stripe layer. PRODUCTION HAS NONE OF
-- THEM. fin_mail_ctx therefore reads the row through to_jsonb(), so a column that
-- does not exist on prod reads as null instead of failing to compile.
--
-- OVERLAP DECISION (owner, 22 Sep 2026): the tx.* money emails address the BROKER
-- side — the party that owes the gross. The carrier's 5% dispatch-fee bill stays
-- with the already-live fee.invoice_due / fee.invoice_paid path (staging only).
-- Nothing here touches those, so there is no double-send.
-- tx.invoice_dispute_update is the one exception: it goes to BOTH sides.
--
-- Every key here is switched to send_mode='test' — real mail only after the owner
-- flips it to Live in Command Center -> CRM & outreach -> Email catalog.
--
-- No new tables, no new UI, no cron. All four are event-driven, once per event,
-- de-duplicated by sys_email on the idempotency key.
-- ============================================================================

-- ---------------------------------------------------------------- helpers --

create or replace function app_private.fin_money(p numeric)
returns text
language sql immutable
as $$
  select '$' || to_char(coalesce(p, 0), 'FM999,999,990.00');
$$;

comment on function app_private.fin_money(numeric) is
  'bl_comm_0400 — money for a customer-facing email.';

create or replace function app_private.fin_mail(
  p_to text, p_key text, p_subject text, p_html text, p_idem text)
returns boolean
language plpgsql
security definer
set search_path to 'app_private', 'public'
as $$
begin
  if coalesce(btrim(coalesce(p_to, '')), '') = '' then return false; end if;
  begin
    perform app_private.sys_email(p_to, p_key, p_subject, p_html, null, p_idem);
  exception when others then
    return false;
  end;
  return true;
end $$;

comment on function app_private.fin_mail(text,text,text,text,text) is
  'bl_comm_0400 — one billing email to one address. Never raises, so a mail problem can never fail an invoice, a settlement or a dispute.';

create or replace function app_private.fin_mail_html(p_head text, p_sub text, p_body text)
returns text
language sql immutable
as $$
  select '<div style="font-family:Inter,Arial,sans-serif;color:#10223B">'
      || '<h2 style="margin:0 0 4px">' || p_head || '</h2>'
      || '<p style="font-weight:600;margin:0 0 14px;color:#555">' || coalesce(p_sub,'') || '</p>'
      || coalesce(p_body,'')
      || '<p style="margin-top:22px;color:#888;font-size:12px;border-top:1px solid #eee;padding-top:10px">'
      || 'LoadBoot &middot; hello@loadboot.com &middot; loadboot.com</p></div>';
$$;

comment on function app_private.fin_mail_html(text,text,text) is
  'bl_comm_0400 — shared letterhead. Sender identity is required by CAN-SPAM and by the Stripe receipt anatomy the plan follows.';

-- Invoice context. Read through to_jsonb so the Stripe columns that exist on
-- staging but not on production read as null instead of breaking the build.
create or replace function app_private.fin_mail_ctx(p_invoice uuid)
returns jsonb
language sql stable
set search_path to 'app_private', 'public'
as $$
  select jsonb_build_object(
    'invoice',       i.id,
    'invoice_no',    i.invoice_no,
    'status',        i.status,
    'gross',         i.gross,
    'fee',           i.fee,
    'fee_pct',       i.fee_pct,
    'net',           i.net,
    'due_at',        i.due_at,
    'issued_at',     i.issued_at,
    'paid_at',       i.paid_at,
    'trip',          i.trip_id,
    'load',          i.load_id,
    'hosted_url',    jj.j->>'hosted_url',
    'void_reason',   jj.j->>'void_reason',
    'lane',          coalesce(l.origin,'?') || ' -> ' || coalesce(l.destination,'?'),
    'carrier_org',   i.carrier_id,
    'broker_org',    l.broker_org,
    'carrier_email', cp.email,
    'broker_email',  bp.email,
    'adjustments',   coalesce(a.rows, '[]'::jsonb),
    'adj_total',     coalesce(a.total, 0),
    'demo',          coalesce(cg.is_demo,false) or coalesce(bg.is_demo,false)
  )
  from app_private.fin_invoices i
  cross join lateral (select to_jsonb(i) as j) jj
  left join public.loads         l  on l.id  = i.load_id
  left join public.organizations cg on cg.id = i.carrier_id
  left join public.profiles      cp on cp.id = cg.owner_user_id
  left join public.organizations bg on bg.id = l.broker_org
  left join public.profiles      bp on bp.id = bg.owner_user_id
  left join lateral (
    select jsonb_agg(jsonb_build_object('kind', x.kind, 'amount', x.amount, 'note', x.note)
                     order by x.created_at) as rows,
           sum(coalesce(x.amount,0)) as total
      from app_private.fin_adjustments x
     where x.invoice_id = i.id
  ) a on true
  where i.id = p_invoice;
$$;

comment on function app_private.fin_mail_ctx(uuid) is
  'bl_comm_0400 — one invoice: parties, lane, itemisation, Stripe link where those columns exist. demo=true means never mail. gross already includes every adjustment.';

create or replace function app_private.fin_settlement_ctx(p_settlement uuid)
returns jsonb
language sql stable
set search_path to 'app_private', 'public'
as $$
  select jsonb_build_object(
    'settlement',    s.id,
    'settlement_no', s.settlement_no,
    'status',        s.status,
    'period_start',  s.period_start,
    'period_end',    s.period_end,
    'gross',         s.gross,
    'fee',           s.fee,
    'net',           s.net,
    'approved_at',   s.approved_at,
    'paid_at',       s.paid_at,
    'carrier_org',   s.carrier_id,
    'carrier_email', cp.email,
    'invoices',      coalesce(v.rows, '[]'::jsonb),
    'invoice_count', coalesce(v.n, 0),
    'demo',          coalesce(cg.is_demo,false)
  )
  from app_private.fin_settlements s
  left join public.organizations cg on cg.id = s.carrier_id
  left join public.profiles      cp on cp.id = cg.owner_user_id
  left join lateral (
    select jsonb_agg(jsonb_build_object(
             'invoice_no', i.invoice_no,
             'lane', coalesce(l.origin,'?') || ' -> ' || coalesce(l.destination,'?'),
             'net', i.net) order by i.created_at) as rows,
           count(*) as n
      from app_private.fin_invoices i
      left join public.loads l on l.id = i.load_id
     where i.settlement_id = s.id
  ) v on true
  where s.id = p_settlement;
$$;

comment on function app_private.fin_settlement_ctx(uuid) is
  'bl_comm_0400 — one settlement: carrier, period, totals and the invoices rolled into it (fin_invoices.settlement_id).';

-- Itemised money table, Stripe receipt anatomy.
-- gross already includes the adjustments, so linehaul is derived, never added.
create or replace function app_private.fin_lines_html(c jsonb)
returns text
language sql stable
set search_path to 'app_private', 'public'
as $$
  select '<table style="border-collapse:collapse;font-size:14px;margin:10px 0">'
      || '<tr><td style="padding:4px 20px 4px 0;color:#666">Linehaul</td><td><b>'
      || app_private.fin_money((c->>'gross')::numeric - coalesce((c->>'adj_total')::numeric,0))
      || '</b></td></tr>'
      || coalesce((
           select string_agg(
             '<tr><td style="padding:4px 20px 4px 0;color:#666">'
             || coalesce(nullif(btrim(coalesce(e->>'note','')),''),
                         coalesce(e->>'kind','adjustment'))
             || '</td><td><b>' || app_private.fin_money((e->>'amount')::numeric)
             || '</b></td></tr>', '')
           from jsonb_array_elements(c->'adjustments') e), '')
      || '<tr><td style="padding:9px 20px 4px 0;border-top:1px solid #ddd"><b>Total due</b></td>'
      || '<td style="padding:9px 0 4px;border-top:1px solid #ddd"><b>'
      || app_private.fin_money((c->>'gross')::numeric) || '</b></td></tr></table>';
$$;

comment on function app_private.fin_lines_html(jsonb) is
  'bl_comm_0400 — itemised invoice lines. Linehaul is gross minus fin_adjustments, because apply_accessorial_to_invoice already folded every accessorial into gross.';

-- ------------------------------------------------------- event senders ----

-- Invoice issued / paid / voided ---------------------------------------------
-- tx.invoice_ready  : status -> 'sent'   (NOT 'issued' — that value does not exist)
-- tx.payment_update : status -> 'paid' or 'void', or paid_at first set
create or replace function app_private.trg_comm_fin_invoice()
returns trigger
language plpgsql
security definer
set search_path to 'app_private', 'public'
as $$
declare c jsonb; v_to text; v_pay text; v_due text; v_method text;
begin
  c := app_private.fin_mail_ctx(new.id);
  if c is null then return new; end if;
  if coalesce((c->>'demo')::boolean,false) then return new; end if;

  v_to := c->>'broker_email';
  if coalesce(btrim(coalesce(v_to,'')),'') = '' then return new; end if;

  ----------------------------------------------------------- invoice ready --
  if new.status = 'sent' and old.status is distinct from 'sent' then
    v_due := case when c->>'due_at' is null
                  then 'no due date is recorded on this invoice'
                  else 'due ' || to_char((c->>'due_at')::date, 'Mon DD, YYYY') end;

    v_pay := case when c->>'hosted_url' is not null
      then '<p style="margin:18px 0"><a href="' || (c->>'hosted_url')
        || '" style="background:#0883F7;color:#fff;padding:11px 22px;border-radius:8px;'
        || 'text-decoration:none;font-weight:600;display:inline-block">Pay invoice</a></p>'
        || '<p style="color:#666;font-size:13px">Card or bank transfer (ACH) - it posts to'
        || ' this invoice automatically.</p>'
      else '<p style="color:#666;font-size:13px">Pay by transfer using memo <b>'
        || coalesce(c->>'invoice_no','') || '</b> and reply to this email with the'
        || ' remittance. There is no online payment link on this invoice.</p>' end;

    perform app_private.fin_mail(v_to, 'tx.invoice_ready',
      'Invoice ' || coalesce(c->>'invoice_no','') || ' - ' || (c->>'lane'),
      app_private.fin_mail_html(
        'Invoice ' || coalesce(c->>'invoice_no',''),
        (c->>'lane') || '  &middot;  ' || v_due,
        '<p>This load has been invoiced. Here is what it is made of:</p>'
        || app_private.fin_lines_html(c)
        || v_pay
        || '<p style="color:#666;font-size:13px">If a line on this invoice is wrong,'
        || ' reply to this email and we will open a dispute against invoice <b>'
        || coalesce(c->>'invoice_no','') || '</b> - do not pay the disputed amount'
        || ' until it is resolved.</p>'),
      'invready:' || new.id::text);
    return new;
  end if;

  ---------------------------------------------------------- payment update --
  if new.status = 'paid'
     and (old.status is distinct from 'paid' or (old.paid_at is null and new.paid_at is not null))
  then
    v_method := case when c->>'hosted_url' is not null
                     then 'through the payment link on the invoice'
                     else 'recorded by LoadBoot - the payment method is not stored on this invoice' end;

    perform app_private.fin_mail(v_to, 'tx.payment_update',
      'Payment received - invoice ' || coalesce(c->>'invoice_no',''),
      app_private.fin_mail_html(
        'Payment received',
        'Invoice ' || coalesce(c->>'invoice_no','') || '  &middot;  ' || (c->>'lane'),
        '<p>We have marked this invoice <b>PAID</b>.</p>'
        || '<table style="border-collapse:collapse;font-size:14px;margin:10px 0">'
        || '<tr><td style="padding:4px 20px 4px 0;color:#666">Amount</td><td><b>'
        || app_private.fin_money((c->>'gross')::numeric) || '</b></td></tr>'
        || '<tr><td style="padding:4px 20px 4px 0;color:#666">Received</td><td><b>'
        || to_char(coalesce(new.paid_at, now()),'Mon DD, YYYY HH24:MI') || ' UTC'
        || '</b></td></tr>'
        || '<tr><td style="padding:4px 20px 4px 0;color:#666">Reference</td><td><b>'
        || coalesce(c->>'invoice_no','') || '</b></td></tr>'
        || '<tr><td style="padding:4px 20px 4px 0;color:#666">Method</td><td>'
        || v_method || '</td></tr></table>'
        || '<p style="color:#666;font-size:13px">Keep this as your receipt. If you think'
        || ' this was marked paid in error, reply to this email.</p>'),
      'invpay:' || new.id::text || ':paid');
    return new;
  end if;

  if new.status = 'void' and old.status is distinct from 'void' then
    perform app_private.fin_mail(v_to, 'tx.payment_update',
      'Invoice ' || coalesce(c->>'invoice_no','') || ' has been voided',
      app_private.fin_mail_html(
        'Invoice voided',
        'Invoice ' || coalesce(c->>'invoice_no','') || '  &middot;  ' || (c->>'lane'),
        '<p>This invoice has been <b>VOIDED</b> and nothing is owed on it.</p>'
        || '<p><b>Reason:</b> '
        || coalesce(nullif(btrim(coalesce(c->>'void_reason','')),''), 'no reason recorded')
        || '</p><p style="color:#666;font-size:13px">If a corrected invoice is needed for'
        || ' this load it will arrive separately.</p>'),
      'invpay:' || new.id::text || ':void');
    return new;
  end if;

  return new;
end $$;

drop trigger if exists comm_fin_invoice on app_private.fin_invoices;
create trigger comm_fin_invoice
  after update on app_private.fin_invoices
  for each row execute function app_private.trg_comm_fin_invoice();

-- Settlement approved / paid --------------------------------------------------
create or replace function app_private.trg_comm_fin_settlement()
returns trigger
language plpgsql
security definer
set search_path to 'app_private', 'public'
as $$
declare c jsonb; v_to text; v_period text; v_loads text;
begin
  if new.status not in ('approved','paid') then return new; end if;
  if new.status is not distinct from old.status then return new; end if;

  c := app_private.fin_settlement_ctx(new.id);
  if c is null then return new; end if;
  if coalesce((c->>'demo')::boolean,false) then return new; end if;

  v_to := c->>'carrier_email';
  if coalesce(btrim(coalesce(v_to,'')),'') = '' then return new; end if;

  v_period := case when c->>'period_start' is null or c->>'period_end' is null
                   then 'period not recorded'
                   else to_char((c->>'period_start')::date,'Mon DD') || ' - '
                        || to_char((c->>'period_end')::date,'Mon DD, YYYY') end;

  v_loads := coalesce((
    select string_agg('<tr><td style="padding:4px 20px 4px 0;color:#666">'
             || coalesce(e->>'invoice_no','') || '</td>'
             || '<td style="padding:4px 20px 4px 0;color:#666">' || coalesce(e->>'lane','') || '</td>'
             || '<td><b>' || app_private.fin_money((e->>'net')::numeric) || '</b></td></tr>', '')
      from jsonb_array_elements(c->'invoices') e), '');

  if new.status = 'approved' then
    perform app_private.fin_mail(v_to, 'tx.settlement_ready',
      'Settlement ' || coalesce(c->>'settlement_no','') || ' is ready - '
        || app_private.fin_money((c->>'net')::numeric),
      app_private.fin_mail_html(
        'Settlement ' || coalesce(c->>'settlement_no','') || ' approved',
        v_period || '  &middot;  ' || coalesce(c->>'invoice_count','0') || ' load(s)',
        '<p>Your settlement for this period has been approved.</p>'
        || case when v_loads = '' then ''
                else '<table style="border-collapse:collapse;font-size:14px;margin:10px 0">'
                     || v_loads || '</table>' end
        || '<table style="border-collapse:collapse;font-size:14px;margin:10px 0">'
        || '<tr><td style="padding:4px 20px 4px 0;color:#666">Gross</td><td><b>'
        || app_private.fin_money((c->>'gross')::numeric) || '</b></td></tr>'
        || '<tr><td style="padding:4px 20px 4px 0;color:#666">LoadBoot fee</td><td><b>-'
        || app_private.fin_money((c->>'fee')::numeric) || '</b></td></tr>'
        || '<tr><td style="padding:9px 20px 4px 0;border-top:1px solid #ddd"><b>Net to you</b></td>'
        || '<td style="padding:9px 0 4px;border-top:1px solid #ddd"><b>'
        || app_private.fin_money((c->>'net')::numeric) || '</b></td></tr></table>'
        || '<p style="color:#666;font-size:13px">A pay date is not recorded on this'
        || ' settlement yet - we will confirm it separately, and you will get a second'
        || ' email the moment it is paid. If a load is missing from this list, reply to'
        || ' this email before it is paid out.</p>'),
      'setl:' || new.id::text || ':a');
  else
    perform app_private.fin_mail(v_to, 'tx.settlement_ready',
      'Settlement ' || coalesce(c->>'settlement_no','') || ' has been paid - '
        || app_private.fin_money((c->>'net')::numeric),
      app_private.fin_mail_html(
        'Settlement ' || coalesce(c->>'settlement_no','') || ' paid',
        v_period || '  &middot;  ' || coalesce(c->>'invoice_count','0') || ' load(s)',
        '<p>This settlement has been marked <b>PAID</b>.</p>'
        || '<table style="border-collapse:collapse;font-size:14px;margin:10px 0">'
        || '<tr><td style="padding:4px 20px 4px 0;color:#666">Net paid</td><td><b>'
        || app_private.fin_money((c->>'net')::numeric) || '</b></td></tr>'
        || '<tr><td style="padding:4px 20px 4px 0;color:#666">Marked paid</td><td><b>'
        || to_char(coalesce(new.paid_at, now()),'Mon DD, YYYY HH24:MI') || ' UTC'
        || '</b></td></tr>'
        || '<tr><td style="padding:4px 20px 4px 0;color:#666">Reference</td><td><b>'
        || coalesce(c->>'settlement_no','') || '</b></td></tr></table>'
        || '<p style="color:#666;font-size:13px">Keep this as your remittance advice.'
        || ' LoadBoot does not record which bank account it landed in, so check your own'
        || ' statement to confirm the funds arrived.</p>'),
      'setl:' || new.id::text || ':p');
  end if;

  return new;
end $$;

drop trigger if exists comm_fin_settlement on app_private.fin_settlements;
create trigger comm_fin_settlement
  after update on app_private.fin_settlements
  for each row execute function app_private.trg_comm_fin_settlement();

-- Dispute opened / resolved / rejected ---------------------------------------
-- Both sides: the carrier's net and the broker's gross are both held by it.
create or replace function app_private.trg_comm_fin_dispute()
returns trigger
language plpgsql
security definer
set search_path to 'app_private', 'public'
as $$
declare c jsonb; v_head text; v_body text; v_sub text; v_idem text;
begin
  if tg_op = 'UPDATE' then
    if new.status is not distinct from old.status then return new; end if;
    if new.status not in ('resolved','rejected') then return new; end if;
  end if;

  c := app_private.fin_mail_ctx(new.invoice_id);
  if c is null then return new; end if;
  if coalesce((c->>'demo')::boolean,false) then return new; end if;

  if tg_op = 'INSERT' then
    v_idem := 'disp:' || new.id::text || ':open';
    v_head := 'A dispute was opened on invoice ' || coalesce(c->>'invoice_no','');
    v_sub  := (c->>'lane') || '  &middot;  '
              || app_private.fin_money((c->>'gross')::numeric) || ' on hold';
    v_body := '<p><b>What changed:</b> this invoice is now in dispute, so nothing should'
           || ' be paid or settled against it until it is closed.</p>'
           || '<p><b>Reason given:</b> '
           || coalesce(nullif(btrim(coalesce(new.reason,'')),''), 'no reason recorded')
           || '</p>'
           || app_private.fin_lines_html(c)
           || '<p><b>What we need:</b> reply to this email with anything that supports'
           || ' your side - rate confirmation, POD, lumper or detention receipts, or the'
           || ' corrected figure you believe is right.</p>'
           || '<p style="color:#666;font-size:13px">Reply to hello@loadboot.com. A LoadBoot'
           || ' staff member handles this and both sides get the outcome by email.</p>';
  else
    v_idem := 'disp:' || new.id::text || ':' || new.status;
    v_head := 'Dispute on invoice ' || coalesce(c->>'invoice_no','') || ' - ' || new.status;
    v_sub  := (c->>'lane') || '  &middot;  '
              || app_private.fin_money((c->>'gross')::numeric);
    v_body := '<p><b>What changed:</b> the dispute on this invoice has been <b>'
           || upper(new.status) || '</b>.</p>'
           || '<p><b>Original reason:</b> '
           || coalesce(nullif(btrim(coalesce(new.reason,'')),''), 'no reason recorded')
           || '</p>'
           || '<p><b>Outcome:</b> '
           || coalesce(nullif(btrim(coalesce(new.resolution,'')),''),
                       'no resolution text was recorded')
           || '</p>'
           || case when new.status = 'resolved'
                   then '<p><b>What is needed now:</b> the invoice is released. Any corrected'
                        || ' figure arrives as a separate invoice or credit note.</p>'
                   else '<p><b>What is needed now:</b> the dispute was rejected and the'
                        || ' invoice stands as issued. Reply to this email if you disagree.</p>' end
           || '<p style="color:#666;font-size:13px">Reply to hello@loadboot.com.</p>';
  end if;

  perform app_private.fin_mail(c->>'carrier_email', 'tx.invoice_dispute_update',
    v_head, app_private.fin_mail_html(v_head, v_sub, v_body), v_idem || ':c');
  perform app_private.fin_mail(c->>'broker_email', 'tx.invoice_dispute_update',
    v_head, app_private.fin_mail_html(v_head, v_sub, v_body), v_idem || ':b');

  return new;
end $$;

drop trigger if exists comm_fin_dispute on app_private.fin_disputes;
create trigger comm_fin_dispute
  after insert or update on app_private.fin_disputes
  for each row execute function app_private.trg_comm_fin_dispute();

-- --------------------------------------------------------- catalog rows ----
-- status planned -> live, honest cadence/cap/stop, and every one starts in TEST.

update app_private.email_catalog c set
  status           = 'live',
  send_mode        = 'test',
  send_mode_note   = 'bl_comm_0400 - wired 22 Sep 2026, starts in Test until the owner flips it to Live',
  send_mode_at     = now(),
  cc_deep_link     = '#/finance',
  class            = 'T',
  trigger_type     = 'event',
  trigger_source   = v.trigger_source,
  cadence          = v.cadence,
  cap_note         = v.cap_note,
  stop_condition   = v.stop_condition,
  audience_role    = v.audience_role,
  preference_group = 'billing',
  unsub_allowed    = true,
  owner_note       = v.owner_note,
  updated_at       = now()
from (values
 ('tx.invoice_ready',
  'app_private.trg_comm_fin_invoice() on fin_invoices - status -> ''sent''',
  'when an invoice is issued to the broker',
  'once per invoice (idem invready:<invoice id>)',
  'n/a - single event',
  'broker',
  'Broker side only. The carrier''s 5% dispatch-fee bill stays on fee.invoice_due, so the two cannot double-send. Body follows the Stripe receipt anatomy: sender identity, invoice no, lane, itemised lines, total, due date, pay route, dispute route. Linehaul is derived as gross minus fin_adjustments because gross already includes every accessorial.'),
 ('tx.payment_update',
  'app_private.trg_comm_fin_invoice() on fin_invoices - status -> ''paid'' or ''void''',
  'when payment is recorded, or the invoice is voided',
  'once per outcome (idem invpay:<invoice id>:paid|void)',
  'n/a - single event per outcome',
  'broker',
  'The plan doc said this fires on ''failed'' / ''partial''. Those statuses do not exist - the CHECK is draft|sent|paid|void, so the only post-sent outcomes are paid and void, and that is what this sends. The payment method is only named when a Stripe hosted link exists on the row; otherwise the email says the method is not stored rather than guessing.'),
 ('tx.settlement_ready',
  'app_private.trg_comm_fin_settlement() on fin_settlements - status -> ''approved'' then ''paid''',
  'on approval, and again when the settlement is marked paid',
  '2 per settlement, one per stage (idem setl:<id>:a and setl:<id>:p)',
  'n/a - one send per stage',
  'carrier',
  'Carrier side. Lists the invoices rolled into the settlement (fin_invoices.settlement_id) with gross, LoadBoot fee and net. There is no expected-pay-date column on fin_settlements, so the approval email says the pay date is not recorded yet instead of inventing one.'),
 ('tx.invoice_dispute_update',
  'app_private.trg_comm_fin_dispute() on fin_disputes - insert, then status -> resolved|rejected',
  'when a dispute is opened and again when it is closed',
  '2 per dispute per side (idem disp:<id>:open|resolved|rejected plus :c / :b)',
  'the dispute is resolved or rejected',
  'carrier,broker',
  'Both sides - the carrier''s net and the broker''s gross are both held by a dispute. fin_disputes is a real table (cc_open_dispute / cc_resolve_dispute), not the free-text staff note the plan doc described. Every body states what changed, what is needed and who to reply to.')
) as v(key, trigger_source, cadence, cap_note, stop_condition, audience_role, owner_note)
where c.key = v.key;

select app_private.email_catalog_sync();
