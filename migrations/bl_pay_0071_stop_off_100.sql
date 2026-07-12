-- bl_pay_0071 — stop-off rate $50 → $100 (industry: shipper pays $100–300/stop,
-- carrier share $50–150 — $100 = mid-range, broker can still override per load).
update app_private.rate_standards
   set value = '100', version = coalesce(version, 1) + 1
 where key = 'stop_off' and value = '50';
