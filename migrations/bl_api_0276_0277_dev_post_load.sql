-- bl_api_0276 + bl_api_0277 — applied to PROD 2026-08-25.
-- NOT applied to staging: staging lacks the partner-load engine these depend on.
--
-- Why this exists
-- ---------------------------------------------------------------------------
-- The dev-api edge function was read-only: partners could pull loads OUT, but
-- there was no way for a broker's TMS or a syndication network (LoadBoard
-- Network, AscendTMS PostEverywhere, NextLOAD) to push loads IN. For a board
-- with no broker supply that is exactly backwards — the inbound path is the
-- whole point.
--
-- Design
-- ---------------------------------------------------------------------------
-- Rather than duplicate cc_partner_submit_load's validation (onboarding gate,
-- hazmat declaration, past-pickup guard, rate-card readiness, idempotency,
-- event emit) and let the two drift, dev_post_load resolves the API key's owner,
-- installs that user as the transaction-local JWT subject so
-- app_private.my_partner_org('broker') resolves normally, and calls the existing
-- function unchanged. One engine, one set of rules, whether a load arrives from
-- the partner portal or from a partner's TMS.
--
-- 0276 delegated to cc_partner_post_load, which does NOT carry accessorials, so
-- enforce_load_ready() rejected every posting for missing detention / layover /
-- TONU / lumper terms. No broker TMS sends those fields — DAT and Truckstop
-- postings do not carry them — so as written, no syndicated load could ever have
-- landed. 0277 is the fix and supersedes it: delegate to cc_partner_submit_load
-- and backfill any missing rate-card field from app_private.rate_standards
-- (LoadBoot's own published terms, the same ones on the public policy pages).
-- The carrier still sees written terms. A partner that sends its own keeps them.
--
-- hazmat is deliberately NOT defaulted — a hazmat load posted as non-hazmat is a
-- safety problem, so the caller must declare it.

create or replace function public.dev_post_load(p_user uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'app_private', 'public'
as $function$
declare
  v_std   jsonb;
  v_acc   jsonb;
  v_body  jsonb;
  v_out   jsonb;
begin
  if p_user is null then
    raise exception 'p_user is required' using errcode = '22023';
  end if;
  if coalesce(trim(p->>'origin'), '') = '' or coalesce(trim(p->>'destination'), '') = '' then
    raise exception 'origin and destination are required' using errcode = '22023';
  end if;

  -- Act as the key owner so org resolution and every posting guard in
  -- cc_partner_submit_load apply exactly as they do in the partner portal.
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text,
    true   -- transaction-local
  );

  -- LoadBoot's published standard terms, as a jsonb object.
  select jsonb_object_agg(key, value) into v_std from app_private.rate_standards;
  v_std := coalesce(v_std, '{}'::jsonb);

  -- Partner-supplied accessorials win; we only fill what is missing.
  v_acc := v_std || coalesce(p->'accessorials', '{}'::jsonb);

  -- A posting needs FCFS, an appointment, or a pickup window. Partner feeds
  -- rarely say — default to FCFS, which is what an unqualified posting means.
  if not (v_acc ? 'fcfs')
     and not coalesce((p->>'appointment_required')::boolean, false)
     and coalesce(trim(p->>'pickup_window'), '') = '' then
    v_acc := v_acc || jsonb_build_object('fcfs', true);
  end if;

  v_body := p
    || jsonb_build_object('accessorials', v_acc)
    || jsonb_build_object('source_type', 'partner_api');

  v_out := public.cc_partner_submit_load(v_body);

  return jsonb_build_object('ok', true, 'result', v_out);
end
$function$;

revoke all on function public.dev_post_load(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.dev_post_load(uuid, jsonb) to service_role;

comment on function public.dev_post_load(uuid, jsonb) is
  'Inbound load posting for the developer API. Fills missing rate-card terms from app_private.rate_standards so a partner TMS feed can post without them, then delegates to cc_partner_submit_load so portal and API share one validation path. service_role only — bl_api_0277.';
