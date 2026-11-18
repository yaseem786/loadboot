-- Keep optional credit references available in onboarding without gating broker tenders.
update app_private.onboarding_packet_templates
   set required_for = array_remove(required_for, 'broker'),
       purpose = 'Optional. Brokers may request trade or bank references before extending credit. Carriers only see whether credit information was provided.'
 where org_kind = 'shipper'
   and item_key = 'credit_application'
   and status_tag = 'optional'
   and 'broker' = any(required_for);
