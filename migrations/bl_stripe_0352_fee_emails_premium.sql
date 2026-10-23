-- bl_stripe_0352 (22 Oct 2026) — dispatch-fee emails rebuilt on the ONE body kit (app_private.email_kit, CLAUDE.md §10)
-- + an automatic reminder ladder. Owner asked for Amazon-standard invoice mail with a PDF and reminders.
--
--   issued   fee.invoice_due            on send (delivery / approval / Stripe sync)    T  billing  no unsub
--   due_7    fee.invoice_reminder       7 days before due                               O  billing  unsub ok
--   due_0    fee.invoice_reminder       on the due date                                 O  billing  unsub ok
--   over_3   fee.invoice_overdue        3 days after due                                O  billing  unsub ok
--   over_10  fee.invoice_final          10 days after due (+ staff alert)               O  billing  unsub ok
--   autopay  fee.invoice_autopay_notice 3 days before due, auto-pay carriers only        T  billing  no unsub
--   paid     fee.invoice_paid           when Stripe confirms (webhook) — receipt + PDF   T  billing  no unsub
-- Stops: invoice not 'sent' any more (paid / void / draft). Max 4 reminders per invoice (one per stage, idempotent).
-- Dates are shown in US Central.

create or replace function app_private.fee_invoice_email(p_invoice uuid, p_stage text)
returns void language plpgsql security definer
set search_path to 'app_private, public'
as $$
declare
  i record; v_owner uuid; v_email text; v_lane text; v_deliv text; v_due text; v_amt text; v_gross text;
  v_pay text; v_pdf text; v_portal text := 'https://loadboot.com/app/carrier/#finance';
  v_key text; v_subj text; v_body text; v_idem text; k jsonb; v_auto record; v_n_title text; v_n_body text; v_tone text;
begin
  select * into i from app_private.fin_invoices where id = p_invoice;
  if i.id is null then return; end if;
  if p_stage <> 'paid' and i.status <> 'sent' then return; end if;
  if p_stage = 'paid' and i.status <> 'paid' then return; end if;

  select o.owner_user_id, u.email into v_owner, v_email
    from public.organizations o left join auth.users u on u.id = o.owner_user_id where o.id = i.carrier_id;
  select coalesce(l.origin,'?') || ' → ' || coalesce(l.destination,'?') into v_lane from public.loads l where l.id = i.load_id;
  select to_char(coalesce(t.delivered_at, i.issued_at) at time zone 'America/Chicago', 'Mon DD, YYYY') into v_deliv
    from app_private.trips t where t.id = i.trip_id;
  v_lane  := coalesce(v_lane, 'your delivered load');
  v_deliv := coalesce(v_deliv, to_char(i.issued_at at time zone 'America/Chicago', 'Mon DD, YYYY'));
  v_due   := to_char(coalesce(i.due_at, current_date + 30), 'Mon DD, YYYY');
  v_amt   := '$' || to_char(i.fee, 'FM999,990.00');
  v_gross := '$' || to_char(i.gross, 'FM999,990.00');
  v_pay   := coalesce(i.hosted_url, v_portal);
  v_pdf   := i.pdf_url;
  select * into v_auto from app_private.lb_stripe_customers c where c.org_id = i.carrier_id and c.autopay_enabled;

  if p_stage = 'issued' then
    v_key := 'fee.invoice_due';
    v_subj := 'Invoice ' || i.invoice_no || ' — ' || v_amt || ' due ' || v_due || ' · LoadBoot';
    k := jsonb_build_object(
      'eyebrow', jsonb_build_object('text', 'Invoice ' || i.invoice_no, 'tone', 'info'),
      'title', 'Your dispatch fee invoice is ready',
      'intro', 'Your load ' || v_lane || ' was delivered. Thank you for hauling with LoadBoot. Here is your invoice for LoadBoot''s flat 5% service fee.',
      'facts', jsonb_build_array(
        jsonb_build_object('k','Invoice','v',i.invoice_no), jsonb_build_object('k','Load','v',v_lane),
        jsonb_build_object('k','Delivered','v',v_deliv), jsonb_build_object('k','Load gross','v',v_gross),
        jsonb_build_object('k','Service fee (' || coalesce(i.fee_pct,5) || '%)','v',v_amt),
        jsonb_build_object('k','Amount due','v',v_amt), jsonb_build_object('k','Due date','v',v_due)),
      'card', case when i.hosted_url is not null then
          jsonb_build_object('tone','info','title','Pay your way','items', jsonb_build_array(
            'Card (Visa, Mastercard, Amex, Discover)', 'US bank account (ACH)',
            'Secure checkout by Stripe — LoadBoot never sees your card or bank details'))
        else jsonb_build_object('tone','info','title','How to pay','items', jsonb_build_array(
            'Open LoadBoot → Finance → this invoice → Pay now', 'Send a bank transfer with memo ' || i.invoice_no,
            'Attach the receipt — we confirm it, usually the same business day')) end,
      'step', case when v_auto.org_id is not null
          then jsonb_build_object('title','Nothing to do — auto-pay is on','text','We will collect ' || v_amt || ' from your bank account ending ' || coalesce(v_auto.bank_last4,'****') || ' on ' || v_due || '. You can also pay early.')
          else jsonb_build_object('title','Pay before ' || v_due,'text','It takes under a minute. Your invoice is marked PAID automatically.') end,
      'cta', jsonb_build_object('label', 'Pay ' || v_amt || ' now', 'url', v_pay),
      'secondary', case when v_pdf is not null then jsonb_build_object('label','Download PDF invoice','url',v_pdf)
                        else jsonb_build_object('label','View in LoadBoot','url',v_portal) end,
      'note', 'This fee is separate from your freight payment. If you factor, your factoring company still collects the full freight amount — this fee is paid from your own account. Questions about this invoice? Just reply to this email.');
    v_idem := 'feeinv2:' || i.invoice_no || ':' || coalesce(i.stripe_invoice_id, 'manual');
    v_n_title := '🧾 Invoice ' || i.invoice_no || ' — ' || v_amt || ' due ' || v_due; v_tone := 'info';

  elsif p_stage in ('due_7','due_0','over_3','over_10') then
    v_key := case p_stage when 'over_3' then 'fee.invoice_overdue' when 'over_10' then 'fee.invoice_final' else 'fee.invoice_reminder' end;
    v_subj := case p_stage
      when 'due_7'  then 'Reminder: invoice ' || i.invoice_no || ' (' || v_amt || ') is due ' || v_due
      when 'due_0'  then 'Invoice ' || i.invoice_no || ' (' || v_amt || ') is due today'
      when 'over_3' then 'Past due: invoice ' || i.invoice_no || ' (' || v_amt || ')'
      else 'Final notice: invoice ' || i.invoice_no || ' (' || v_amt || ') is 10 days past due' end;
    k := jsonb_build_object(
      'eyebrow', jsonb_build_object('text', case p_stage when 'due_7' then 'Friendly reminder' when 'due_0' then 'Due today'
                                                   when 'over_3' then 'Past due' else 'Final notice' end,
                                    'tone', case p_stage when 'over_3' then 'warning' when 'over_10' then 'danger' else 'info' end),
      'title', case p_stage
        when 'due_7'  then 'Invoice ' || i.invoice_no || ' is due in 7 days'
        when 'due_0'  then 'Invoice ' || i.invoice_no || ' is due today'
        when 'over_3' then 'Invoice ' || i.invoice_no || ' is past due'
        else 'Final notice for invoice ' || i.invoice_no end,
      'intro', case p_stage
        when 'due_7'  then 'A quick heads-up: your LoadBoot service fee for ' || v_lane || ' is due on ' || v_due || '.'
        when 'due_0'  then 'Your LoadBoot service fee for ' || v_lane || ' is due today. Paying takes under a minute.'
        when 'over_3' then 'We have not received payment for your LoadBoot service fee for ' || v_lane || ', which was due on ' || v_due || '. Please pay today.'
        else 'Your LoadBoot service fee for ' || v_lane || ' was due on ' || v_due || ' and is still unpaid. Please pay today, or reply to this email if something about this invoice is wrong — we will sort it out with you.' end,
      'facts', jsonb_build_array(jsonb_build_object('k','Invoice','v',i.invoice_no), jsonb_build_object('k','Load','v',v_lane),
                                 jsonb_build_object('k','Amount due','v',v_amt), jsonb_build_object('k','Due date','v',v_due)),
      'cta', jsonb_build_object('label', 'Pay ' || v_amt || ' now', 'url', v_pay),
      'secondary', case when v_pdf is not null then jsonb_build_object('label','Download PDF invoice','url',v_pdf)
                        else jsonb_build_object('label','View in LoadBoot','url',v_portal) end,
      'note', 'Already paid? Thank you — you can ignore this email; bank payments can take a few days to show.');
    v_idem := 'feerem:' || i.invoice_no || ':' || p_stage;
    v_n_title := case p_stage when 'over_10' then '⚠ Final notice — invoice ' when 'over_3' then '⚠ Past due — invoice ' else '🧾 Reminder — invoice ' end || i.invoice_no || ' · ' || v_amt;
    v_tone := case p_stage when 'over_10' then 'urgent' when 'over_3' then 'warning' else 'info' end;

  elsif p_stage = 'autopay' then
    v_key := 'fee.invoice_autopay_notice';
    v_subj := 'Invoice ' || i.invoice_no || ' (' || v_amt || ') will be paid automatically on ' || v_due;
    k := jsonb_build_object(
      'eyebrow', jsonb_build_object('text','Auto-pay','tone','info'),
      'title', 'Auto-pay will cover invoice ' || i.invoice_no,
      'intro', 'On ' || v_due || ' we will collect ' || v_amt || ' from your bank account ending ' || coalesce(v_auto.bank_last4,'****') || ' for your load ' || v_lane || '. Nothing for you to do.',
      'facts', jsonb_build_array(jsonb_build_object('k','Invoice','v',i.invoice_no), jsonb_build_object('k','Amount','v',v_amt), jsonb_build_object('k','Collection date','v',v_due)),
      'secondary', case when v_pdf is not null then jsonb_build_object('label','Download PDF invoice','url',v_pdf) else null end,
      'note', 'Want to stop auto-pay? Turn it off any time in LoadBoot → Account → Payments.');
    v_idem := 'feerem:' || i.invoice_no || ':autopay';
    v_n_title := '🏦 Auto-pay on ' || v_due || ' — invoice ' || i.invoice_no; v_tone := 'info';

  elsif p_stage = 'paid' then
    v_key := 'fee.invoice_paid';
    v_subj := 'Receipt: invoice ' || i.invoice_no || ' paid — thank you';
    k := jsonb_build_object(
      'eyebrow', jsonb_build_object('text','Paid','tone','success'),
      'title', 'Payment received — thank you',
      'intro', 'We received your LoadBoot service fee for ' || v_lane || '. Nothing further is owed on this load.',
      'facts', jsonb_build_array(jsonb_build_object('k','Invoice','v',i.invoice_no), jsonb_build_object('k','Amount paid','v',v_amt),
                                 jsonb_build_object('k','Paid on','v',to_char(coalesce(i.paid_at, now()) at time zone 'America/Chicago','Mon DD, YYYY'))),
      'cta', case when v_pdf is not null then jsonb_build_object('label','Download receipt (PDF)','url',v_pdf) else null end,
      'secondary', jsonb_build_object('label','View in LoadBoot','url',v_portal),
      'note', 'Keep this email for your records.');
    v_idem := 'feepaid2:' || i.invoice_no;
    v_n_title := '✅ Invoice ' || i.invoice_no || ' paid'; v_tone := 'success';
  else
    return;
  end if;

  v_body := app_private.email_kit(k);

  begin
    insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
    select v_owner, 'in_app', v_key, jsonb_build_object('title', v_n_title, 'body', v_subj, 'tone', v_tone, 'url', '/app/carrier/#finance'), 'sent', now()
    where v_owner is not null
      and not exists (select 1 from app_private.notifications n where n.recipient_user = v_owner and n.template_key = v_key
                       and n.payload->>'title' = v_n_title and n.created_at > now() - interval '20 hours');
  exception when others then null; end;

  if v_email is not null then
    begin
      perform app_private.sys_email(v_email, v_key, v_subj, v_body, null, v_idem);
    exception when others then raise warning 'fee email % % failed: %', i.invoice_no, p_stage, sqlerrm; end;
  end if;

  if p_stage = 'over_10' then
    begin
      insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
      values ('staff', 'in_app', 'fee.invoice_final', jsonb_build_object('title', '⚠ Fee invoice ' || i.invoice_no || ' is 10 days past due',
        'body', (select name from public.organizations where id = i.carrier_id) || ' · ' || v_amt || ' · due ' || v_due, 'tone', 'warning', 'url', '/app/command-center/#/finance'), 'sent', now());
    exception when others then null; end;
  end if;
end; $$;
revoke all on function app_private.fee_invoice_email(uuid, text) from public;

-- the single entry point everything already calls (delivery trigger, approve RPC, Stripe sync)
create or replace function app_private.fee_invoice_notify(p_invoice uuid)
returns void language plpgsql security definer
set search_path to 'app_private, public'
as $$ begin perform app_private.fee_invoice_email(p_invoice, 'issued'); end; $$;
revoke all on function app_private.fee_invoice_notify(uuid) from public;

-- daily ladder
create or replace function app_private.fee_invoice_reminders_tick()
returns jsonb language plpgsql security definer
set search_path to 'app_private, public'
as $$
declare r record; v_today date := (now() at time zone 'America/Chicago')::date; v_stage text; n int := 0;
begin
  for r in
    select i.id, i.due_at, exists (select 1 from app_private.lb_stripe_customers c where c.org_id = i.carrier_id and c.autopay_enabled) auto
      from app_private.fin_invoices i
     where i.status = 'sent' and i.due_at is not null and i.fee > 0
       and not exists (select 1 from public.organizations o where o.id = i.carrier_id and coalesce(o.is_demo, false))
  loop
    v_stage := case
      when r.auto and r.due_at - v_today = 3 then 'autopay'
      when r.auto then null
      when r.due_at - v_today = 7  then 'due_7'
      when r.due_at - v_today = 0  then 'due_0'
      when v_today - r.due_at = 3  then 'over_3'
      when v_today - r.due_at = 10 then 'over_10'
      else null end;
    if v_stage is not null then perform app_private.fee_invoice_email(r.id, v_stage); n := n + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'sent', n, 'day', v_today);
end; $$;
revoke all on function app_private.fee_invoice_reminders_tick() from public;

-- receipt on payment: swap the hand-written email inside mark_paid for the kit
do $mig$
declare d text; a int; b int;
begin
  d := pg_get_functiondef('public.cc_fee_invoice_mark_paid(text,timestamptz,text,text)'::regprocedure);
  if position('bl_stripe_0352' in d) > 0 then return; end if;
  a := position('    if v_email is not null then' in d);
  b := position('  exception when others then null; end;' in substr(d, a));
  if a = 0 or b = 0 then raise exception 'bl_stripe_0352: mark_paid anchor not found'; end if;
  d := substr(d, 1, a - 1) || '    perform app_private.fee_invoice_email(i.id, ''paid'');  -- bl_stripe_0352' || E'\n' || substr(d, a + b - 1);
  execute d;
end $mig$;

-- catalog (CLAUDE.md §6)
insert into app_private.email_catalog(key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note, stop_condition, preference_group, unsub_allowed, cc_deep_link, status, send_mode)
values
 ('fee.invoice_reminder', 'Fee invoice reminder', 'Reminds the carrier 7 days before and on the due date of a LoadBoot service-fee invoice', 'O', 'carrier', 'cron', 'app_private.fee_invoice_reminders_tick (cron lb-fee-reminders, daily)', 'due-7 and due-0', 'max 2 per invoice', 'invoice paid, void or back to draft', 'billing', true, '#/finance', 'live', 'live'),
 ('fee.invoice_overdue', 'Fee invoice past due', 'Tells the carrier the service-fee invoice is 3 days past due', 'O', 'carrier', 'cron', 'app_private.fee_invoice_reminders_tick', 'due+3', 'once per invoice', 'invoice paid, void or back to draft', 'billing', true, '#/finance', 'live', 'live'),
 ('fee.invoice_final', 'Fee invoice final notice', 'Final notice 10 days past due; also alerts staff in CC', 'O', 'carrier', 'cron', 'app_private.fee_invoice_reminders_tick', 'due+10', 'once per invoice', 'invoice paid, void or back to draft', 'billing', true, '#/finance', 'live', 'live'),
 ('fee.invoice_autopay_notice', 'Fee auto-pay notice', 'Tells an auto-pay carrier the fee will be collected from their bank on the due date', 'T', 'carrier', 'cron', 'app_private.fee_invoice_reminders_tick', 'due-3 (auto-pay only)', 'once per invoice', 'invoice paid, void, or auto-pay turned off', 'billing', false, '#/finance', 'live', 'live')
on conflict (key) do update set name = excluded.name, purpose = excluded.purpose, trigger_source = excluded.trigger_source, cadence = excluded.cadence,
  cap_note = excluded.cap_note, stop_condition = excluded.stop_condition, status = 'live', updated_at = now();
update app_private.email_catalog set trigger_source = 'app_private.fee_invoice_email (delivery trigger / approve / Stripe sync)', updated_at = now() where key = 'fee.invoice_due';
update app_private.email_catalog set status = 'live', trigger_source = 'public.cc_fee_invoice_mark_paid (Stripe webhook invoice.paid) → app_private.fee_invoice_email', updated_at = now() where key = 'fee.invoice_paid';
