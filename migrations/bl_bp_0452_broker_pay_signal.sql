-- bl_bp_0452 — BROKER PAY-BEHAVIOUR SIGNAL TO CARRIERS (BROKER-AGENT-AUDIT §7 item 6).
-- Design: claude/BROKER-PAY-SIGNAL-2026-09-26.md
--
-- One definition of "how fast does this broker pay", computed from LoadBoot's own settlement
-- records: pay_transfers kind='freight', status='received' (carrier-confirmed), measured from
-- trips.delivered_at (the invoice anchor we have) to received_at, trailing 12 months, demo orgs
-- excluded. A number is shown only when paid_n >= 3 AND >= 2 distinct carriers were paid, so a
-- broker paying its own affiliated carrier fast does not earn the chip.
--
-- Surfaces (both read the same function, no drift):
--   * cc_pocket_available_loads  → details.broker_pay on every board card (no return-type change)
--   * cc_carrier_view_poster     → 'pay' key; the old avg_days_to_pay (which measured
--                                  receipt-upload → carrier-confirm, i.e. carrier speed, and
--                                  counted claims/fees/disputes) now derives from the same stats.
-- Both patched by anchor replace on the live definition (staging and prod differ on
-- cc_pocket_available_loads by an unrelated is_demo line; this applies on top of either).
-- No new public function: the anon-executable SECURITY DEFINER surface is unchanged by this file
-- (read 36 prod / 35 staging on 26 Sep after bl_comm_0447 added newsletter_request + newsletter_confirm).
-- Applied 26 Sep 2026 to staging + prod under the history name bl_bp_0450_broker_pay_signal, renamed to
-- 0452 in supabase_migrations.schema_migrations the same session: 0450/0451 were taken by the parallel
-- directory-label and packet-definition sessions.

create or replace function app_private.broker_pay_stats(p_org uuid)
 returns jsonb
 language sql stable
 set search_path to 'app_private, public'
as $$
  with x as (
    select pt.payee_org,
           extract(epoch from pt.received_at - t.delivered_at) / 86400 as d,
           pt.received_at
      from app_private.pay_transfers pt
      join app_private.trips t on t.id = pt.ref_id
      join public.loads l on l.id = t.load_id
      join public.organizations b on b.id = l.broker_org
      join public.organizations c on c.id = pt.payee_org
     where pt.kind = 'freight' and pt.status = 'received' and pt.received_at is not null
       and t.delivered_at is not null and l.broker_org = p_org
       and coalesce(b.is_demo, false) = false and coalesce(c.is_demo, false) = false
       and pt.received_at >= now() - interval '12 months')
  select jsonb_build_object(
    'paid_n', count(*),
    'carriers_n', count(distinct payee_org),
    'median_days', round((percentile_cont(0.5) within group (order by d))::numeric, 1),
    'within_30_pct', round(100.0 * count(*) filter (where d <= 30) / nullif(count(*), 0)),
    'last_paid_at', max(received_at),
    'eligible', (count(*) >= 3 and count(distinct payee_org) >= 2),
    'anchor', 'delivered_to_received', 'window_months', 12)
  from x
$$;
revoke execute on function app_private.broker_pay_stats(uuid) from public, anon;
grant execute on function app_private.broker_pay_stats(uuid) to authenticated, service_role;

do $mig$
declare src text; out_src text;
begin
  -- 1. board cards: details.broker_pay
  src := pg_get_functiondef('public.cc_pocket_available_loads(integer)'::regprocedure);
  if src not like '%broker_pay_stats%' then
    out_src := replace(src,
      '(coalesce(l.details,''{}''::jsonb) - ''load_source'')',
      '(coalesce(l.details,''{}''::jsonb) - ''load_source'')'
      || E'\n        || case when l.broker_org is not null then jsonb_build_object(''broker_pay'', app_private.broker_pay_stats(l.broker_org)) else ''{}''::jsonb end');
    if out_src = src then raise exception 'bl_bp_0452: cc_pocket_available_loads load_source anchor not found'; end if;
    execute out_src;
  end if;

  -- 2. poster panel: one source of truth for pay speed
  src := pg_get_functiondef('public.cc_carrier_view_poster(uuid)'::regprocedure);
  if src not like '%broker_pay_stats%' then
    out_src := replace(src, 'v_dtp numeric; v_dtp_n int;', 'v_dtp numeric; v_dtp_n int; v_pay jsonb;');
    if out_src = src then raise exception 'bl_bp_0452: cc_carrier_view_poster declare anchor not found'; end if;
    src := out_src;
    out_src := replace(src,
      E'  select round(avg(extract(epoch from pt.received_at - pt.created_at) / 86400)::numeric, 1), count(*)\n'
      || E'    into v_dtp, v_dtp_n\n'
      || E'    from app_private.pay_transfers pt\n'
      || E'   where pt.payer_org = v_broker and pt.received_at is not null;',
      E'  v_pay := app_private.broker_pay_stats(v_broker);\n'
      || E'  v_dtp := case when (v_pay->>''eligible'')::boolean then (v_pay->>''median_days'')::numeric end;\n'
      || E'  v_dtp_n := coalesce((v_pay->>''paid_n'')::int, 0);');
    if out_src = src then raise exception 'bl_bp_0452: cc_carrier_view_poster days-to-pay select not found'; end if;
    src := out_src;
    out_src := replace(src,
      '''avg_days_to_pay'', v_dtp, ''paid_transfers'', coalesce(v_dtp_n, 0),',
      '''avg_days_to_pay'', v_dtp, ''paid_transfers'', coalesce(v_dtp_n, 0), ''pay'', v_pay,');
    if out_src = src then raise exception 'bl_bp_0452: cc_carrier_view_poster return anchor not found'; end if;
    execute out_src;
  end if;
end
$mig$;
