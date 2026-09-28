-- bl_ship_0497 — what a broker sees about the shipper behind a tender (broker inbox → shipper_badge).
-- Brokers extend credit, so they get: verification stage, identity + independent call-back, payment terms,
-- whether credit references were given, and signed platform terms. Never the EIN, bank or reference details.
create or replace function app_private.shipper_badge(p_org uuid)
returns jsonb language sql stable security definer set search_path to 'app_private, public' as $$
  select jsonb_build_object('tier', app_private.shipper_tier(p_org), 'domain', t.domain, 'site_title', t.site_title, 'site_url', t.site_url, 'site_ok', t.site_ok,
                            'verified_at', t.verified_at, 'verified_by', t.verified_by, 'company', o.name,
                            -- bl_ship_0491
                            'stage', app_private.shipper_stage(p_org),
                            'identity_verified', coalesce((app_private.shipper_lane_gate(p_org, 'identity')->>'ok')::boolean, false),
                            'callback_confirmed', t.callback_status = 'confirmed',
                            'payment_terms', (select i.data->>'terms' from app_private.org_onboarding_items i where i.org_id = p_org and i.item_key = 'payment_terms' and i.status = 'verified'),
                            'credit_refs', exists (select 1 from app_private.org_onboarding_items i where i.org_id = p_org and i.item_key = 'credit_application' and i.status in ('verified','waived')),
                            'platform_terms', app_private.shipper_item_status(p_org, 'platform_terms') = 'verified')
    from public.organizations o left join app_private.shipper_trust t on t.org_id = o.id where o.id = p_org;
$$;
