-- bl_sec_0490 — "LOADBOOT TEST CARRIER (internal)" stays internal. Yaseen 28 Sep: "ye kisi or ko na dikhy,
-- bus internal ke liye."
--
-- It was is_demo = false, so it sat in the real world: disp_carrier_available (the list dispatcher
-- candidates pick a carrier from) only hides is_demo orgs, so real applicants could see and pick it.
-- Brokers did NOT see it (broker_visible = false), and it has no loads or trips.
--
-- is_demo = true moves it behind the symmetric demo isolation (CLAUDE.md §4): hidden from candidate
-- carrier lists, broker directories, KPIs, reminder/weekly mail, Riley dialling and WhatsApp auto-sends.
-- Its only member (hello@loadboot.com, not staff) now sees demo loads only when logged in as this carrier.
-- The existing assignment to the owner's own test dispatcher (Asim Latif) is untouched.
-- Checked: no organizations trigger fires on this change (welcome/partner triggers are INSERT-only or
-- broker/shipper-only; detach-drivers is status-only). Prod only — staging has no such org.
update public.organizations
   set is_demo = true
 where id = '409c9701-b4e3-4368-8daa-234180bac727' and name = 'LOADBOOT TEST CARRIER (internal)' and not is_demo;

select app_private.log_audit('org.mark_internal', 'organization', '409c9701-b4e3-4368-8daa-234180bac727',
  '409c9701-b4e3-4368-8daa-234180bac727'::uuid, 'LOADBOOT TEST CARRIER (internal) set is_demo=true (owner: internal only)',
  jsonb_build_object('migration', 'bl_sec_0490'), null);
