-- bl_bp_0597 (owner, 3 Nov 2026; Lufka + Landstar cases)
--   1. A broker's submitted load only made an in-app staff row, so a same-day load could wait unseen (Lufka, 22 Oct).
--      Staff now also get an email through the catalog (ops.load.submitted). Demo orgs are skipped.
--   2. partner_trust_status now says whether this MC ever passed, so the broker portal can show the MC form and the
--      agent route to a broker who never cleared (Landstar, Kembo), instead of the "no longer shows authority" card.
-- Security: no new public function; anon surface unchanged.

insert into app_private.email_catalog
select (jsonb_populate_record(null::app_private.email_catalog, to_jsonb(c) || jsonb_build_object(
  'key','ops.load.submitted','name','Broker load awaiting review (staff)',
  'purpose','Tells staff a broker or agent submitted a load that needs review before it reaches carriers (bl_bp_0597).',
  'trigger_type','event','trigger_source','app_private.trg_partner_load_submit_notify',
  'cadence','per submitted load','cc_deep_link','#/partner-intake',
  'sends_total',0,'sends_30d',0,'sms_enabled',false,'sms_text',null,'created_at',now(),'updated_at',now()))).*
from app_private.email_catalog c where c.key = 'ops.signup.new'
on conflict (key) do nothing;

do $mig$
declare r record; d text;
begin
  for r in select * from (values
    ('app_private.trg_partner_load_submit_notify()',
     $a$  if v_agent and new.created_by is not null then$a$,
     $b$  begin   -- bl_bp_0597
    if not exists (select 1 from public.organizations o where o.id = new.broker_org and coalesce(o.is_demo, false)) then
      perform app_private.sys_email('dispatch@loadboot.com', 'ops.load.submitted',
        'Load awaiting review: ' || coalesce(new.origin,'—') || ' → ' || coalesce(new.destination,'—'),
        app_private.email_kit(jsonb_build_object(
          'eyebrow', jsonb_build_object('text', 'Needs review', 'tone', 'warning'),
          'title', coalesce(new.origin,'—') || ' → ' || coalesce(new.destination,'—'),
          'intro', coalesce(v_org,'A broker') || ' submitted this load. It does not reach carriers until it is reviewed.',
          'facts', jsonb_build_array(
            jsonb_build_object('k','Rate','v', coalesce('$' || new.rate::text, '—')),
            jsonb_build_object('k','Pickup','v', coalesce(left(new.pickup_date::text, 10), '—'))),
          'cta', jsonb_build_object('label','Review the load','url','https://loadboot.com/command-center/#/partner-intake'),
          'signoff', 'LoadBoot Operations')),
        null, 'opsloadsub:' || new.id::text);
    end if;
  exception when others then null; end;
  if v_agent and new.created_by is not null then$b$),
    ('public.partner_trust_status()',
     $a$'outcome', s.outcome, 'mc', s.mc_number,$a$,
     $b$'outcome', s.outcome, 'ever_passed', s.last_pass_at is not null, 'mc', s.mc_number,$b$)
  ) as x(fn, anchor, repl) loop
    d := pg_get_functiondef(r.fn::regprocedure);
    if position(r.anchor in d) = 0 then raise exception 'bl_bp_0597: anchor not found in %: %', r.fn, left(r.anchor, 70); end if;
    execute replace(d, r.anchor, r.repl);
  end loop;
end $mig$;
