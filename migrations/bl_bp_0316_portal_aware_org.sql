-- bl_bp_0316 — The portal you are standing in decides which of your organisations an RPC talks about.
--
-- Yaseen, 4 Sep: the broker portal's Documents tab kept showing the CARRIER packet (Signed Carrier Agreement,
-- COI, reefer breakdown, hazmat…). Cause: cc_my_onboarding_packet / cc_onboarding_submit_item /
-- cc_accept_agreement / cc_current_agreement (and six more) resolve "my org" through app_private.my_any_org(),
-- which is carrier-first unless the signup carried partner_kind metadata. A user who owns a carrier org AND a
-- broker org, signed up before that metadata existed, therefore gets the carrier packet inside the broker portal.
--
-- Fix: every portal already sends an `x-lb-app` header on each request (shared/supabaseClient.js). From this
-- build the header names the portal — `partner/<build>`, `carrier/<build>`, `command-center/<build>` — and
-- my_any_org() reads it: inside the partner portal the partner org wins, inside the carrier portal the carrier
-- org wins. No header / an old header → exactly the previous behaviour, so nothing else changes.
-- One patch covers all ten callers of my_any_org() (packet, agreements, ratings, webhooks).

create or replace function app_private.request_portal()
returns text language sql stable as $$
  select nullif(lower(split_part(coalesce(
           nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-lb-app', ''), '/', 1)), '');
$$;
comment on function app_private.request_portal() is 'bl_bp_0316 — portal name from the x-lb-app request header (partner | carrier | command-center), null when absent';

create or replace function app_private.my_any_org()
returns uuid language sql stable security definer set search_path to 'app_private, public' as $$
  select case
    when app_private.request_portal() = 'partner'
      then coalesce(app_private.my_partner_org('broker'), app_private.my_partner_org('shipper'), app_private.my_carrier_org())
    when app_private.request_portal() = 'carrier'
      then coalesce(app_private.my_carrier_org(), app_private.my_partner_org('broker'), app_private.my_partner_org('shipper'))
    when app_private.is_partner_signup(auth.uid())
      then coalesce(app_private.my_partner_org('broker'), app_private.my_partner_org('shipper'), app_private.my_carrier_org())
    else coalesce(app_private.my_carrier_org(), app_private.my_partner_org('broker'), app_private.my_partner_org('shipper')) end;
$$;
