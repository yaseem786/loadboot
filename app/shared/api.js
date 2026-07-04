// api.js — thin, typed wrappers over the server RPCs (migrations 0016–0019).
// Every call is authorized server-side; these wrappers only shape arguments and
// normalize errors. No business logic lives here.
import { getClient } from './supabaseClient.js';

async function rpc(name, args) {
  const sb = await getClient();
  const { data, error } = await sb.rpc(name, args || {});
  if (error) {
    const e = new Error(error.message || ('rpc ' + name + ' failed'));
    e.code = error.code; e.details = error.details; e.rpc = name;
    throw e;
  }
  return data;
}

// ---- staff context / permissions ----
export const getMyStaffContext = () => rpc('get_my_staff_context');

// ---- staff directory / roles catalog (read) ----
export const getStaffDirectory = () => rpc('get_staff_directory');
export const getRolesCatalog = () => rpc('get_roles_catalog');

// ---- audit ----
export const getAuditLogs = (opts = {}) => rpc('get_audit_logs', {
  p_limit: opts.limit ?? 50,
  p_before_id: opts.beforeId ?? null,
  p_action: opts.action ?? null,
  p_target_type: opts.targetType ?? null,
  p_target_org_id: opts.targetOrgId ?? null,
});

// ---- feature flags ----
export const isFlagEnabled = (key) => rpc('is_flag_enabled', { p_key: key });
export const getFeatureFlags = () => rpc('get_feature_flags');
export const setFeatureFlag = (key, enabled, opts = {}) =>
  rpc('set_feature_flag', {
    p_key: key, p_enabled: enabled,
    p_reason: opts.reason ?? null, p_expires_at: opts.expiresAt ?? null,
  });

// ---- typed settings ----
export const getSetting = (key) => rpc('get_setting', { p_key: key });
export const setSetting = (key, value) => rpc('set_setting', { p_key: key, p_value: value });

// ---- Command Center V1 operator reads (migration cc_v1_0030_operator_surface) ----
// Reviewed, RBAC-gated, audited RPC surface. The deferred experimental modules
// (web analytics, content/blog, page builder, fleet, matching, settlements, messages,
// search insights) are intentionally NOT wired in V1 — see COMMAND-CENTER scope.
export const getOverviewStats = () => rpc('cc_get_overview');
export const getCarriersDirectory = (o = {}) => rpc('cc_list_carriers', {
  p_search: o.search ?? null, p_status: o.status ?? null, p_limit: o.limit ?? 100,
});
export const getCarrierDetail = (id) => rpc('cc_get_carrier', { p_carrier: id });
export const getLoadsList = (o = {}) => rpc('cc_list_loads', {
  p_search: o.search ?? null, p_status: o.status ?? null, p_limit: o.limit ?? 200,
});
export const getLoadDetail = (id) => rpc('cc_get_load', { p_load: id });
export const getDocumentsQueue = (o = {}) => rpc('cc_list_documents', {
  p_status: o.status ?? 'pending', p_limit: o.limit ?? 100,
});
export const setCarrierStatus = (carrierId, status, note) =>
  rpc('cc_set_carrier_status', { p_carrier: carrierId, p_status: status, p_note: note ?? null });
export const createLoad = (o = {}) => rpc('cc_create_load', {
  p_origin: o.origin, p_destination: o.destination, p_equipment: o.equipment ?? null,
  p_rate: o.rate ?? null, p_miles: o.miles ?? null, p_commodity: o.commodity ?? null,
  p_pickup_date: o.pickupDate ?? null,
});

// ---- Load Intake (Inc 43) — normalized source model ----
export const LOAD_SOURCE_TYPES = [['partner_portal','Partner portal'],['staff_entered','Staff entered'],['licensed_integration','Licensed integration'],['official_api','Official API'],['uploaded_document','Uploaded document'],['imported','Imported (CSV)'],['unverified_external','Unverified external'],['quote_converted','Quote converted'],['recurring_lane','Recurring lane'],['duplicated','Duplicated'],['api_client','API client']];
export const createLoadSourced = (o = {}) => rpc('cc_create_load_sourced', { p: o });
export const loadIntakeList = (o = {}) => rpc('cc_load_intake_list', { p_source: o.source ?? null, p_verification: o.verification ?? null, p_status: o.status ?? null, p_limit: o.limit ?? 200 });
export const loadSetVerification = (id, verification, confidence) => rpc('cc_load_set_verification', { p_load: id, p_verification: verification, p_confidence: confidence ?? null });
// Matching engine (Inc 45/46) — Stage A eligibility + Stage B explainable ranking.
export const matchEligibility = (loadId) => rpc('cc_match_eligibility', { p_load: loadId });
export const matchRank = (loadId) => rpc('cc_match_rank', { p_load: loadId });
// Offers (Inc 47) — waves, expiry, carrier response.
export const offerSend = (loadId, carriers, rate, expiryMinutes) => rpc('cc_offer_send', { p_load: loadId, p_carriers: carriers, p_rate: rate ?? null, p_expiry_minutes: expiryMinutes ?? 60 });
export const loadOffers = (loadId) => rpc('cc_load_offers', { p_load: loadId });
export const carrierOffers = (limit) => rpc('cc_carrier_offers', { p_limit: limit ?? 50 });
export const offerRespond = (offerId, action, o = {}) => rpc('cc_offer_respond', { p_offer: offerId, p_action: action, p_reason: o.reason ?? null, p_counter: o.counter ?? null, p_message: o.message ?? null });
export const offersExpire = () => rpc('cc_offers_expire');
// Transactional booking (Inc 48/49) — accept books atomically; booking status = trip + checklist in one read.
export const bookingStatus = (loadId) => rpc('cc_booking_status', { p_load: loadId });
// Tracking + Control Tower (Inc 50/51) — consent-first, source-labeled locations.
export const tripSetTracking = (tripId, method) => rpc('cc_trip_set_tracking', { p_trip: tripId, p_method: method });
export const tripCheckin = (tripId, o = {}) => rpc('cc_trip_checkin', { p_trip: tripId, p_lat: o.lat ?? null, p_lng: o.lng ?? null, p_note: o.note ?? null, p_source: o.source ?? 'manual_checkin' });
export const controlTower = (limit) => rpc('cc_control_tower', { p_limit: limit ?? 100 });
export const partnerLoadStatus = (partnerLoadId) => rpc('cc_partner_load_status', { p_partner_load: partnerLoadId });
// AI Load Pilot — explainable take/negotiate/skip + carrier push ranking (deadhead + preferences aware).
export const loadAdvisor = (loadId, overrides) => rpc('cc_load_advisor', { p_load: loadId, p_overrides: overrides ?? {} });
export const setDispatchPrefs = (o) => rpc('cc_set_dispatch_prefs', { p: o ?? {} });
export const getDispatchPrefs = () => rpc('cc_get_dispatch_prefs');
// AI Load Pilot — fleet level: reverse advisor (best open loads for one carrier) + one-click greedy dispatch plan.
export const carrierBestLoads = (carrierId, limit) => rpc('cc_carrier_best_loads', { p_carrier: carrierId ?? null, p_limit: limit ?? 10 });
export const dispatchPlan = (maxLoads) => rpc('cc_dispatch_plan', { p_max_loads: maxLoads ?? 20 });
// Detention / dwell automation (Inc 52-53): real arrive/depart stamps; scan auto-drafts detention for review.
// WEB-2 — multi-level referral engine (flag: referral_program; production OFF until owner+legal approve).
export const myReferral = () => rpc('cc_my_referral');
export const claimReferral = (code) => rpc('cc_claim_referral', { p_code: code });
export const myReferralEarnings = (limit) => rpc('cc_my_referral_earnings', { p_limit: limit ?? 100 });
export const referralAccrue = () => rpc('cc_referral_accrue');
export const referralOverview = () => rpc('cc_referral_overview');
export const referralMarkPaid = (code) => rpc('cc_referral_mark_paid', { p_referrer_code: code });
// cww — referral payout requests (self-service payout with bank details; staff decide; decision recorded only)
export const referralRequestPayout = (details) => rpc('cc_referral_request_payout', { p_details: details });
export const myPayoutRequests = () => rpc('cc_my_payout_requests');
export const referralPayoutQueue = (status) => rpc('cc_referral_payout_queue', { p_status: status || 'open' });
// cxa — canonical industry rate standards (versioned, staff-editable; agreements auto-recorded at post)
// cxd — bank payment profiles (default rail; staff-verified; masked reads; transfers recorded-only)
// cxj — carrier services list (LIVE input to the auto-matching engine)
export const setMyServices = (arr) => rpc('cc_set_my_services', { p_services: arr });
export const myServices = () => rpc('cc_my_services');
// cxh — Amazon-style account health (live, itemized; violations ledger staff-issued)
export const accountHealth = (org) => rpc('cc_account_health', { p_org: org ?? null });
// Mutual rating engine — trip-verified ratings (carrier↔broker/shipper).
export const rateCounterparty = (trip, stars, comment) => rpc('cc_rate_counterparty', { p_trip: trip, p_stars: stars, p_comment: comment ?? null });
export const myRating = () => rpc('cc_my_rating');
export const orgRating = (org) => rpc('cc_org_rating', { p_org: org });
export const partnerRateableTrips = (limit = 20) => rpc('cc_partner_rateable_trips', { p_limit: limit });
// Post-a-Truck / Auto-Match v1
export const postTruck = (o) => rpc('cc_post_truck', { p: o ?? {} });
export const myTruckPostings = () => rpc('cc_my_truck_postings');
export const truckPostingMatches = (id) => rpc('cc_truck_posting_matches', { p_posting: id });
export const updateTruckPosting = (id, action) => rpc('cc_update_truck_posting', { p_id: id, p_action: action });
export const scanTruckMatches = () => rpc('cc_scan_truck_matches');
// Expense tracker v1
export const expenseAdd = (o) => rpc('cc_expense_add', { p: o ?? {} });
export const expenseList = (month) => rpc('cc_expense_list', { p_month: month ?? null });
export const expenseDelete = (id) => rpc('cc_expense_delete', { p_id: id });
// IFTA + maintenance v1
export const iftaSet = (q, st, mi, gal) => rpc('cc_ifta_set', { p_quarter: q, p_state: st, p_miles: mi, p_gallons: gal ?? null });
export const iftaSummary = (q) => rpc('cc_ifta_summary', { p_quarter: q });
export const truckSetMaintenance = (id, service, insp) => rpc('cc_truck_set_maintenance', { p_truck: id, p_service: service ?? null, p_inspection: insp ?? null });
export const fleetMaintenance = () => rpc('cc_fleet_maintenance');
export const accountHealthBoard = (limit = 100) => rpc('cc_account_health_board', { p_limit: limit });
export const issueViolation = (org, kind, severity, note) => rpc('cc_issue_violation', { p_org: org, p_kind: kind, p_severity: severity, p_note: note });
export const resolveViolation = (id, note) => rpc('cc_resolve_violation', { p_id: id, p_note: note ?? null });
// cxf — shipper<->broker bridge pipeline (request -> assign -> quote; CC controls + sees all)
export const assignShipment = (id, broker) => rpc('cc_assign_shipment', { p_id: id, p_broker: broker });
export const brokerShipmentInbox = () => rpc('cc_broker_shipment_inbox');
export const brokerQuoteShipment = (id, amount, note) => rpc('cc_broker_quote_shipment', { p_id: id, p_amount: amount, p_note: note ?? null });
export const deliveryDocPack = (trip) => rpc('cc_delivery_doc_pack', { p_trip: trip });
export const prebookCheck = (load, carrier) => rpc('cc_prebook_check', { p_load: load, p_carrier: carrier ?? null });
export const dispatchSheet = (trip) => rpc('cc_dispatch_sheet', { p_trip: trip });
// cxp — D4 rate confirmations (auto on booking; immutable; carrier acknowledges once)
export const myRateConfirmation = (trip) => rpc('cc_my_rate_confirmation', { p_trip: trip });
export const acknowledgeRC = (trip) => rpc('cc_acknowledge_rate_confirmation', { p_trip: trip });
// cxo — D3 master agreements (versioned; publish needs legal confirmation; accept once)
export const currentAgreement = (kind) => rpc('cc_current_agreement', { p_kind: kind });
export const acceptAgreement = (kind) => rpc('cc_accept_agreement', { p_kind: kind });
export const publishAgreement = (kind, version, legalOk) => rpc('cc_publish_agreement', { p_kind: kind, p_version: version, p_legal_ok: legalOk });
// cxn — D2 onboarding packets (per-role LEGAL/REQUIRED templates; CC verification)
export const myOnboardingPacket = () => rpc('cc_my_onboarding_packet');
export const onboardingSubmitItem = (key, ref, note) => rpc('cc_onboarding_submit_item', { p_key: key, p_ref: ref, p_note: note ?? null });
export const onboardingReviewItem = (org, key, action, note) => rpc('cc_onboarding_review_item', { p_org: org, p_key: key, p_action: action, p_note: note ?? null });
export const onboardingBoard = (kind) => rpc('cc_onboarding_board', { p_kind: kind ?? null });
export const shipperPostLoad = (p) => rpc('cc_shipper_post_load', { p });
export const brokerClaimShipment = (id) => rpc('cc_broker_claim_shipment', { p_id: id });
export const brokerTenderShipment = (id, rate, acc) => rpc('cc_broker_tender_shipment', { p_id: id, p_rate: rate, p_accessorials: acc });
export const shipperMyShipments = () => rpc('cc_shipper_my_shipments');
export const shipmentPipeline = () => rpc('cc_shipment_pipeline');
// cxe — bridge trust signals (identity-safe, entitlement-gated)
export const brokerViewCarrier = (carrier) => rpc('cc_broker_view_carrier', { p_carrier: carrier });
export const carrierViewPoster = (load) => rpc('cc_carrier_view_poster', { p_load: load });
export const setMyPaymentProfile = (p) => rpc('cc_set_my_payment_profile', { p });
export const myPaymentProfile = () => rpc('cc_my_payment_profile');
export const paymentProfilesQueue = (status) => rpc('cc_payment_profiles_queue', { p_status: status || 'unverified' });
export const verifyPaymentProfile = (org, ok) => rpc('cc_verify_payment_profile', { p_org: org, p_ok: ok });
export const carrierPaymentProfile = (org) => rpc('cc_carrier_payment_profile', { p_org: org });
export const trustProfile = (org) => rpc('cc_trust_profile', { p_org: org });
export const myTrustProfile = () => rpc('cc_my_trust_profile');
export const myApprovedPartners = () => rpc('cc_my_approved_partners');
export const marketingIntel = (days = 30) => rpc('cc_marketing_intel', { p_days: days });
export const rateStandards = () => rpc('cc_rate_standards');
export const setRateStandard = (k, v) => rpc('cc_set_rate_standard', { p_key: k, p_value: v });
export const referralPayoutDecide = (id, action, note) => rpc('cc_referral_payout_decide', { p_id: id, p_action: action, p_note: note ?? null });
// Inc 64 — Business Intelligence: staff-gated executive summary + trend series over real tables.
export const biExecutiveSummary = (from, to) => rpc('cc_bi_executive_summary', { p_from: from ?? null, p_to: to ?? null });
export const biTimeseries = (metric, days = 30) => rpc('cc_bi_timeseries', { p_metric: metric, p_days: days });
// Inc 66 — saved reports & snapshots (staff-only, self-scoped).
export const reportsList = () => rpc('cc_reports');
export const reportSave = (def) => rpc('cc_report_save', { p: def });
export const reportDelete = (id) => rpc('cc_report_delete', { p_id: id });
export const reportRun = (id) => rpc('cc_report_run', { p_id: id });
export const reportSnapshots = (id, limit = 20) => rpc('cc_report_snapshots', { p_id: id, p_limit: limit });
// Inc 67 — carrier performance scorecard (deterministic, explainable). Carrier self / staff any carrier.
export const carrierScorecard = (carrier, days = 90) => rpc('cc_carrier_scorecard', { p_carrier: carrier ?? null, p_days: days });
export const carrierScorecardRanking = (days = 90, limit = 25) => rpc('cc_carrier_scorecard_ranking', { p_days: days, p_limit: limit });
// Inc 68 — broker SLA & on-time analytics. Broker self / staff any broker.
export const brokerSla = (partner, days = 90) => rpc('cc_broker_sla', { p_partner: partner ?? null, p_days: days });
export const brokerSlaRanking = (days = 90, limit = 25) => rpc('cc_broker_sla_ranking', { p_days: days, p_limit: limit });
// Inc 70 — notification backbone: unified per-user in-app feed + staff broadcast.
export const myNotifications = (limit = 50) => rpc('cc_my_notifications', { p_limit: limit });
export const markMyNotification = (id) => rpc('cc_mark_my_notification', { p_id: id });
export const notifyBroadcast = (payload) => rpc('cc_notify_broadcast', { p: payload });
// Inc 71 — saved-report digest cadence (owner sets; service-role cron runs cc_digest_run_due).
export const reportSetSchedule = (id, schedule) => rpc('cc_report_set_schedule', { p_id: id, p_schedule: schedule });
// Carrier Portal A1 — dashboard aggregate (account status + setup gaps + notifications + KPIs + active trips).
export const carrierDashboard = () => rpc('cc_carrier_dashboard');
// Carrier Portal A2 — decision-complete load detail (accessorials/windows/terms; broker identity hidden).
export const carrierLoadDetail = (loadId) => rpc('cc_load_detail', { p_load: loadId });
// Carrier Portal A3 — emergency / delivery-reschedule request (proof + reason + defined category); staff review.
export const tripEmergencyRequest = (payload) => rpc('cc_trip_emergency_request', { p: payload });
export const tripMyEmergencies = (limit = 50) => rpc('cc_trip_my_emergencies', { p_limit: limit });
export const emergencyReview = (id, approve, note) => rpc('cc_emergency_review', { p_id: id, p_approve: approve, p_note: note ?? null });
export const emergencyQueue = (status = 'open', limit = 100) => rpc('cc_emergency_queue', { p_status: status, p_limit: limit });
// Carrier Portal A4 (Fleet) — equipment service / maintenance log (self-scoped).
export const fleetServiceAdd = (payload) => rpc('cc_fleet_service_add', { p: payload });
export const fleetServiceList = (truckId = null, limit = 100) => rpc('cc_fleet_service_list', { p_truck: truckId, p_limit: limit });
export const fleetServiceDelete = (id) => rpc('cc_fleet_service_delete', { p_id: id });
// Carrier Portal A5 (Finance) — employee payroll / salary management (self-scoped).
export const payrollAdd = (payload) => rpc('cc_payroll_add', { p: payload });
export const payrollList = (from = null, to = null) => rpc('cc_payroll_list', { p_from: from, p_to: to });
export const payrollMarkPaid = (id, paid = true) => rpc('cc_payroll_mark_paid', { p_id: id, p_paid: paid });
export const payrollDelete = (id) => rpc('cc_payroll_delete', { p_id: id });
// Inc 63 — workflow builder: validated step-graphs, versioned publish, simulation (no side effects) + guarded live runs.
export const workflowSave = (o) => rpc('cc_workflow_save', { p: o });
export const workflowSetStatus = (id, action) => rpc('cc_workflow_set_status', { p_id: id, p_action: action });
export const workflowsList = (status) => rpc('cc_workflows', { p_status: status ?? null });
export const workflowRun = (id, event, mode) => rpc('cc_workflow_run', { p_id: id, p_event: event ?? {}, p_mode: mode ?? 'simulation' });
export const workflowRuns = (id, limit) => rpc('cc_workflow_runs', { p_id: id, p_limit: limit ?? 30 });
// Inc 56 — finance lifecycle: receivables/payables aging, invoice-prep pipeline, reconciliation.
export const financeReceivables = () => rpc('cc_finance_receivables');
export const financePayables = () => rpc('cc_finance_payables');
export const invoicePrepQueue = (limit) => rpc('cc_invoice_prep_queue', { p_limit: limit ?? 50 });
export const financeReconcile = (from, to) => rpc('cc_finance_reconcile', { p_from: from ?? null, p_to: to ?? null });
// Inc 55 — carrier P&L + expenses (honest labels; est_profit is an ESTIMATE).
export const carrierPnl = (from, to, carrierId) => rpc('cc_carrier_pnl', { p_from: from ?? null, p_to: to ?? null, p_carrier: carrierId ?? null });
export const carrierAddExpense = (o) => rpc('cc_carrier_add_expense', { p: o });
export const carrierExpenses = (from, to, limit) => rpc('cc_carrier_expenses', { p_from: from ?? null, p_to: to ?? null, p_limit: limit ?? 200 });
export const carrierDeleteExpense = (id) => rpc('cc_carrier_delete_expense', { p_id: id });
// Inc 54 — broker documents + update-request workflows.
export const partnerChecklistSubmit = (itemId, ref, note) => rpc('cc_partner_checklist_submit', { p_item: itemId, p_ref: ref, p_note: note ?? null });
export const loadChecklistReview = (itemId, verdict, reason) => rpc('cc_load_checklist_review', { p_item: itemId, p_verdict: verdict, p_reason: reason ?? null });
export const requestUpdate = (subjectType, subjectId, partnerOrg, request, due) => rpc('cc_request_update', { p_subject_type: subjectType, p_subject_id: subjectId, p_partner: partnerOrg, p_request: request, p_due: due ?? null });
export const updateRequests = (status, limit) => rpc('cc_update_requests', { p_status: status ?? 'open', p_limit: limit ?? 100 });
export const partnerUpdateRequests = (status) => rpc('cc_partner_update_requests', { p_status: status ?? null });
export const partnerRespondUpdate = (id, response) => rpc('cc_partner_respond_update', { p_id: id, p_response: response });
export const resolveUpdateRequest = (id, action) => rpc('cc_resolve_update_request', { p_id: id, p_action: action ?? 'resolve' });
export const tripArrive = (tripId, stop, freeMinutes) => rpc('cc_trip_arrive', { p_trip: tripId, p_stop: stop, p_free_minutes: freeMinutes ?? 120 });
export const tripDepart = (tripId, stop) => rpc('cc_trip_depart', { p_trip: tripId, p_stop: stop });
export const detentionScan = (ratePerHour) => rpc('cc_detention_scan', { p_rate_per_hour: ratePerHour ?? 50 });
export const exceptionCenter = (status, limit) => rpc('cc_exception_center', { p_status: status ?? 'open', p_limit: limit ?? 100 });

// ---- privileged actions ----
export const reviewDocument = (documentId, decision, note) =>
  rpc('admin_review_document', { p_document: documentId, p_decision: decision, p_note: note ?? null });

export const assignRole = (o) => rpc('admin_assign_role', {
  p_user: o.userId, p_role_key: o.roleKey, p_scope_type: o.scopeType,
  p_org: o.org ?? null, p_carrier_org: o.carrierOrg ?? null, p_load: o.load ?? null,
});
export const revokeRole = (assignmentId) => rpc('admin_revoke_role', { p_assignment: assignmentId });
export const setStaffStatus = (userId, status) =>
  rpc('admin_set_staff_status', { p_user: userId, p_status: status });
export const revokeStaffSessions = (userId) =>
  rpc('admin_revoke_staff_sessions', { p_user: userId });

// ---- loads write control (V1 dispatch) ----
export const assignLoad = (loadId, carrierId) => rpc('cc_assign_load', { p_load: loadId, p_carrier: carrierId });
export const setLoadStatus = (loadId, status) => rpc('cc_set_load_status', { p_load: loadId, p_status: status });

// ---- Automation Core (ac_v1) — tasks board + operational health (flag: automation_core_enabled) ----
export const listTasks = (o = {}) => rpc('cc_list_tasks', { p_status: o.status ?? 'open', p_limit: o.limit ?? 100 });
export const completeTask = (taskId) => rpc('cc_complete_task', { p_task: taskId });
export const automationHealth = () => rpc('cc_automation_health');

// ---- Wave 1 CRM (flag: crm_enabled) ----
export const crmOverview = () => rpc('cc_crm_overview');
export const crmListLeads = (o = {}) => rpc('cc_crm_list_leads', { p_stage: o.stage ?? null, p_search: o.search ?? null, p_limit: o.limit ?? 200 });
export const crmGetLead = (id) => rpc('cc_crm_get_lead', { p_lead: id });
export const crmCreateLead = (o = {}) => rpc('cc_crm_create_lead', { p_title: o.title, p_company: o.company ?? null, p_source: o.source ?? null, p_value: o.value ?? null });
export const crmSetLeadStage = (id, stageKey) => rpc('cc_crm_set_lead_stage', { p_lead: id, p_stage_key: stageKey });
export const crmAddActivity = (id, kind, body) => rpc('cc_crm_add_activity', { p_lead: id, p_kind: kind, p_body: body, p_due_at: null });

// ---- Wave 2 Carrier Onboarding & Compliance (flag: compliance_enabled) ----
export const complianceOverview = () => rpc('cc_compliance_overview');
export const listOnboarding = (o = {}) => rpc('cc_list_onboarding', { p_stage: o.stage ?? null, p_search: o.search ?? null, p_limit: o.limit ?? 200 });
export const getCarrierCompliance = (carrierId) => rpc('cc_get_carrier_compliance', { p_carrier: carrierId });
export const startOnboarding = (carrierId) => rpc('cc_start_onboarding', { p_carrier: carrierId });
export const setCompliance = (o = {}) => rpc('cc_set_compliance', { p_carrier: o.carrier, p_requirement_key: o.requirement, p_status: o.status, p_expiry: o.expiry ?? null, p_note: o.note ?? null });
export const decideOnboarding = (carrierId, decision, note) => rpc('cc_decide_onboarding', { p_carrier: carrierId, p_decision: decision, p_note: note ?? null });
export const scanExpiring = (days) => rpc('cc_scan_expiring', { p_days: days ?? 30 });

// ---- Wave 3 Loads / Dispatch / Trips (flag: dispatch_enabled) ----
export const dispatchOverview = () => rpc('cc_dispatch_overview');
export const listTrips = (o = {}) => rpc('cc_list_trips', { p_status: o.status ?? null, p_search: o.search ?? null, p_limit: o.limit ?? 200 });
export const getTrip = (tripId) => rpc('cc_get_trip', { p_trip: tripId });
export const createTrip = (o = {}) => rpc('cc_create_trip', {
  p_load: o.load, p_carrier: o.carrier ?? null, p_driver_name: o.driverName ?? null,
  p_driver_phone: o.driverPhone ?? null, p_truck: o.truck ?? null,
  p_scheduled_pickup: o.scheduledPickup ?? null, p_scheduled_delivery: o.scheduledDelivery ?? null,
});
export const advanceTrip = (tripId, status, note, location) => rpc('cc_advance_trip', { p_trip: tripId, p_status: status, p_note: note ?? null, p_location: location ?? null });
export const addTripNote = (tripId, note, location) => rpc('cc_add_trip_note', { p_trip: tripId, p_note: note, p_location: location ?? null });

// ---- Wave 4 Communications (flag: comms_enabled) ----
export const commOverview = () => rpc('cc_comm_overview');
export const listThreads = (o = {}) => rpc('cc_list_threads', { p_status: o.status ?? null, p_search: o.search ?? null, p_limit: o.limit ?? 200 });
export const getThread = (id) => rpc('cc_get_thread', { p_thread: id });
export const createThread = (o = {}) => rpc('cc_create_thread', { p_subject: o.subject, p_body: o.body ?? null, p_related_type: o.relatedType ?? 'none', p_related_id: o.relatedId ?? null, p_channel: o.channel ?? 'in_app' });
export const postMessage = (id, body, channel) => rpc('cc_post_message', { p_thread: id, p_body: body, p_channel: channel ?? null });
export const setThreadStatus = (id, status) => rpc('cc_set_thread_status', { p_thread: id, p_status: status });
export const listNotifications = (o = {}) => rpc('cc_list_notifications', { p_status: o.status ?? null, p_limit: o.limit ?? 100 });
export const markNotification = (id, status) => rpc('cc_mark_notification', { p_id: id, p_status: status });
export const listTemplates = () => rpc('cc_list_templates');

// ---- Wave 5 Finance (flag: finance_enabled) ----
export const financeOverview = () => rpc('cc_finance_overview');
export const financeAnalytics = () => rpc('cc_finance_analytics');
// Platform module registry (Phase 0 — module-factory foundation)
export const listModules = () => rpc('cc_list_modules');
export const moduleSummary = () => rpc('cc_module_summary');
// Observability / system health (Phase 1)
export const systemHealth = () => rpc('cc_system_health');
// Campaign Manager (Phase 3C)
export const cmpList = () => rpc('cc_cmp_list');
export const cmpSave = (o = {}) => rpc('cc_cmp_save', { p_id: o.id ?? null, p_name: o.name, p_objective: o.objective ?? null, p_audience: o.audienceId ?? null, p_template: o.templateKey ?? null, p_channels: o.channels ?? ['push'], p_subject: o.subject ?? null, p_body: o.body ?? null, p_scheduled_at: o.scheduledAt ?? null, p_status: o.status ?? 'draft' });
export const cmpSetStatus = (id, status) => rpc('cc_cmp_set_status', { p_id: id, p_status: status });
export const cmpMarkSent = (id, count) => rpc('cc_cmp_mark_sent', { p_id: id, p_count: count });
// ---- Unified Delivery Engine (cvb/cvc/cvd) — preview → confirm → enqueue → claim → mark ----
// Dry-run: returns { campaign, channel, audience_total, after_consent, suppressed, final_recipients, sample, excluded_no_consent }.
export const campaignAudiencePreview = (campaignId) => rpc('cc_campaign_audience_preview', { p_campaign: campaignId });
// Confirm-count guarded enqueue. confirmCount MUST equal the preview's final_recipients or the server refuses.
export const campaignEnqueue = (campaignId, confirmCount) => rpc('cc_campaign_enqueue', { p_campaign: campaignId, p_confirm_count: confirmCount });
// Maker-checker approval — approve (or revoke). The approver cannot be the campaign's creator.
export const campaignApprove = (campaignId, approve = true) => rpc('cc_campaign_approve', { p_campaign: campaignId, p_approve: approve });
// A/B testing — content variants with a deterministic weighted audience split.
export const campaignVariants = (campaignId) => rpc('cc_campaign_variants', { p_campaign: campaignId });
export const campaignSetVariant = (campaignId, o = {}) => rpc('cc_campaign_set_variant', { p_campaign: campaignId, p_label: o.label, p_subject: o.subject ?? null, p_body_html: o.bodyHtml ?? null, p_body_text: o.bodyText ?? null, p_weight: o.weight ?? 1 });
export const campaignDeleteVariant = (id) => rpc('cc_campaign_delete_variant', { p_id: id });
export const campaignVariantAnalytics = (campaignId) => rpc('cc_campaign_variant_analytics', { p_campaign: campaignId });
// Worker claim of due queued rows (atomic).
export const deliveryClaim = (o = {}) => rpc('cc_delivery_claim', { p_limit: o.limit ?? 50, p_channel: o.channel ?? 'email' });
// Record a provider outcome (sent|delivered|bounced|complained|failed|...); bounce/complaint auto-suppresses.
export const deliveryMark = (id, status, o = {}) => rpc('cc_delivery_mark', { p_id: id, p_status: status, p_reason: o.reason ?? null, p_provider: o.provider ?? null, p_dedupe: o.dedupe ?? null });
// Manual suppression (email|sms).
export const suppress = (channel, address, reason) => rpc('cc_suppress', { p_channel: channel, p_address: address, p_reason: reason ?? 'manual' });
// Dashboards.
export const deliveryHealth = () => rpc('cc_delivery_health');
// Reliability: backlog across message deliveries, webhook deliveries and the domain-event log.
export const pipelineHealth = () => rpc('cc_pipeline_health');
// Event-triggered automations (autoresponders): list + upsert.
export const commTriggers = () => rpc('cc_comm_triggers');
export const setCommTrigger = (o = {}) => rpc('cc_set_comm_trigger', { p_event: o.event, p_channel: o.channel ?? 'email', p_template_key: o.templateKey ?? null, p_subject: o.subject ?? null, p_active: o.active ?? false });
// Per-campaign delivery analytics (counts + rates).
export const campaignAnalytics = (campaignId) => rpc('cc_campaign_analytics', { p_campaign: campaignId });
// Attribution: web conversions (form submissions/leads) tied to this campaign via its utm_campaign tag.
export const campaignAttribution = (campaignId) => rpc('cc_campaign_attribution', { p_campaign: campaignId });
// Enqueue a single transactional message through the unified ledger (idempotent, suppression-checked).
export const enqueueTransactional = (o = {}) => rpc('cc_enqueue_transactional', { p_channel: o.channel ?? 'email', p_email: o.email, p_template_key: o.templateKey ?? null, p_subject: o.subject ?? null, p_idem: o.idem ?? null, p_meta: o.meta ?? {}, p_scheduled_at: o.scheduledAt ?? null });
// Promote due scheduled deliveries to queued (worker/operator tick).
export const deliveryReleaseDue = (channel) => rpc('cc_delivery_release_due', { p_channel: channel ?? null });
export const deliveryList = (o = {}) => rpc('cc_delivery_list', { p_status: o.status ?? null, p_limit: o.limit ?? 100 });
export const suppressionsList = (o = {}) => rpc('cc_suppressions_list', { p_channel: o.channel ?? null, p_limit: o.limit ?? 200 });
// Audience / Segment Builder (Phase 3B)
export const audienceEstimate = (type) => rpc('cc_audience_estimate', { p_type: type });
export const listAudiences = () => rpc('cc_list_audiences');
export const saveAudience = (o = {}) => rpc('cc_save_audience', { p_name: o.name, p_type: o.type, p_filters: o.filters ?? {} });
export const deleteAudience = (id) => rpc('cc_delete_audience', { p_id: id });
export const AUDIENCE_TYPES = [['all_carriers', 'All carriers'], ['active_carriers', 'Active carriers'], ['pending_carriers', 'Pending carriers'], ['onboarding_pending', 'Onboarding — awaiting review'], ['carrier_owners', 'Carrier owners'], ['drivers', 'Drivers'], ['leads', 'Website leads'], ['newsletter', 'Newsletter subscribers'], ['form_submitters', 'Website form leads'], ['all_staff', 'All staff']];
// Template Studio (Phase 3A — marketing + transactional templates, variable allowlist)
export const studioListTemplates = () => rpc('cc_studio_list_templates');
export const studioSaveTemplate = (t = {}) => rpc('cc_studio_save_template', { p_key: t.key, p_name: t.name, p_category: t.category, p_channels: t.channels, p_subject: t.subject, p_preview: t.preview, p_body_html: t.bodyHtml, p_body_text: t.bodyText, p_status: t.status });
export const studioSetTemplateStatus = (key, status) => rpc('cc_studio_set_template_status', { p_key: key, p_status: status });
// Server-truth template render with {{variable}} substitution → { subject, html, text, unresolved }.
export const renderTemplate = (key, vars = {}) => rpc('cc_render_template', { p_key: key, p_vars: vars });
export const TEMPLATE_VARIABLES = ['first_name', 'company_name', 'carrier_name', 'load_reference', 'pickup_city', 'delivery_city', 'appointment_time', 'document_type', 'document_expiry', 'invoice_number', 'settlement_number', 'support_reference', 'action_url'];
// Outbound webhooks admin (Phase 1 — delivery visibility + dead-letter retry)
export const listWebhookEndpoints = () => rpc('cc_list_webhook_endpoints');
export const listWebhookDeliveries = (o = {}) => rpc('cc_list_webhook_deliveries', { p_status: o.status ?? null, p_limit: o.limit ?? 100 });
export const retryWebhookDelivery = (id) => rpc('cc_retry_webhook_delivery', { p_id: id });
// Push pending domain events into the webhook delivery queue now.
export const webhooksFlush = () => rpc('cc_webhooks_flush');
// Catalog of subscribable domain events (for endpoint editors + the developer portal).
export const eventCatalog = () => rpc('cc_event_catalog');
export const listInvoices = (o = {}) => rpc('cc_list_invoices', { p_status: o.status ?? null, p_search: o.search ?? null, p_limit: o.limit ?? 200 });
export const getInvoice = (id) => rpc('cc_get_invoice', { p_invoice: id });
export const createInvoice = (tripId, dueDays) => rpc('cc_create_invoice', { p_trip: tripId, p_due_days: dueDays ?? 15 });
export const setInvoiceStatus = (id, status) => rpc('cc_set_invoice_status', { p_invoice: id, p_status: status });
export const listSettlements = (o = {}) => rpc('cc_list_settlements', { p_status: o.status ?? null, p_limit: o.limit ?? 200 });
export const createSettlement = (o = {}) => rpc('cc_create_settlement', { p_carrier: o.carrier, p_period_start: o.periodStart ?? null, p_period_end: o.periodEnd ?? null });
export const decideSettlement = (id, decision) => rpc('cc_decide_settlement', { p_settlement: id, p_decision: decision });

// ---- Wave 6 Analytics (flag: analytics_enabled) ----
export const analyticsOverview = () => rpc('cc_analytics_overview');
export const analyticsRevenue = (days) => rpc('cc_analytics_revenue', { p_days: days ?? 14 });
export const analyticsOps = () => rpc('cc_analytics_ops');
export const analyticsCarriers = (limit) => rpc('cc_analytics_carriers', { p_limit: limit ?? 8 });

// ---- Wave 7 Content / Marketing (flag: content_enabled) ----
export const contentOverview = () => rpc('cc_content_overview');
export const listPosts = (o = {}) => rpc('cc_list_posts', { p_status: o.status ?? null, p_search: o.search ?? null, p_limit: o.limit ?? 200 });
export const getPost = (id) => rpc('cc_get_post', { p_id: id });
export const upsertPost = (o = {}) => rpc('cc_upsert_post', { p_id: o.id ?? null, p_title: o.title, p_slug: o.slug, p_excerpt: o.excerpt ?? null, p_body: o.body ?? null, p_tags: o.tags ?? [] });
export const setPostStatus = (id, status) => rpc('cc_set_post_status', { p_id: id, p_status: status });
export const listPages = () => rpc('cc_list_pages');
export const upsertPage = (key, title, body) => rpc('cc_upsert_page', { p_key: key, p_title: title, p_body: body });

// ---- Wave 8 Integrations / Webhooks (flag: integrations_enabled) ----
export const integrationsOverview = () => rpc('cc_integrations_overview');
export const listIntegrations = () => rpc('cc_list_integrations');
export const listEndpoints = () => rpc('cc_list_endpoints');
export const createEndpoint = (o = {}) => rpc('cc_create_endpoint', { p_name: o.name, p_url: o.url, p_event_types: o.eventTypes ?? [] });
export const setEndpointActive = (id, active) => rpc('cc_set_endpoint_active', { p_id: id, p_active: active });
export const testEndpoint = (id) => rpc('cc_test_endpoint', { p_id: id });
export const listDeliveries = (o = {}) => rpc('cc_list_deliveries', { p_status: o.status ?? null, p_limit: o.limit ?? 100 });

// ---- Wave 9 carrier self-service RPCs (cc_pocket_* server functions; used by the Carrier Portal) ----
export const pocketOverview = () => rpc('cc_pocket_overview');
export const pocketTrips = (limit) => rpc('cc_pocket_trips', { p_limit: limit ?? 50 });
export const pocketInvoices = (limit) => rpc('cc_pocket_invoices', { p_limit: limit ?? 50 });
export const pocketCompliance = () => rpc('cc_pocket_compliance');
export const pocketConfirmTrip = (tripId) => rpc('cc_pocket_confirm_trip', { p_trip: tripId });
export const pocketRaiseIssue = (subject, body) => rpc('cc_pocket_raise_issue', { p_subject: subject, p_body: body ?? null });
export const pocketMyIssues = (limit) => rpc('cc_pocket_my_issues', { p_limit: limit ?? 30 });
// Available loads for carriers to browse (public opportunities feed).
export const publicLoadOpportunities = (limit) => rpc('get_public_load_opportunities', { p_limit: limit ?? 18 });
// Phase 2B — carrier self-book a load (full detail + race-safe claim → trip).
export const pocketAvailableLoads = (limit) => rpc('cc_pocket_available_loads', { p_limit: limit ?? 24 });
export const pocketBookLoad = (loadId) => rpc('cc_pocket_book_load', { p_load: loadId });
export const requestBookLoad = (load, note) => rpc('cc_request_book_load', { p_load: load, p_note: note ?? null });
export const myBookRequests = (limit) => rpc('cc_my_book_requests', { p_limit: limit ?? 50 });
export const bookRequestsQueue = (status) => rpc('cc_book_requests_queue', { p_status: status ?? 'pending' });
export const decideBookRequest = (id, action, note) => rpc('cc_decide_book_request', { p_id: id, p_action: action, p_note: note ?? null });
// Carrier notification inbox (Phase 5)
export const pocketNotifications = (limit) => rpc('cc_pocket_notifications', { p_limit: limit ?? 50 });
export const pocketMarkNotificationRead = (id) => rpc('cc_pocket_mark_notification_read', { p_id: id });
// Communication preferences / consent (Phase 3H)
export const pocketGetPreferences = () => rpc('cc_pocket_get_preferences');
export const pocketSavePreferences = (p) => rpc('cc_pocket_save_preferences', { p });
export const consentSummary = () => rpc('cc_consent_summary');
// Carrier onboarding wizard (Phase 2A) — save/resume profile + submit for review.
export const pocketGetProfile = () => rpc('cc_pocket_get_profile');
export const pocketSubmitOnboarding = () => rpc('cc_pocket_submit_onboarding');
export const pocketSaveProfile = (p = {}) => rpc('update_my_carrier_profile', {
  p_company: p.company ?? null, p_contact_name: p.contactName ?? null, p_phone: p.phone ?? null,
  p_mc: p.mc ?? null, p_dot: p.dot ?? null, p_truck_count: p.truckCount ?? null,
  p_home_base: p.homeBase ?? null, p_radius_miles: p.radiusMiles ?? null,
  p_equipment_types: p.equipmentTypes ?? null, p_min_rpm: p.minRpm ?? null,
  p_max_deadhead: p.maxDeadhead ?? null, p_avoid_states: p.avoidStates ?? null,
  p_weekend_ok: p.weekendOk ?? null, p_hazmat: p.hazmat ?? null,
  p_contact_method: p.contactMethod ?? null, p_whatsapp: p.whatsapp ?? null,
  p_factoring_status: p.factoringStatus ?? null, p_factoring_company: p.factoringCompany ?? null,
});
// Carrier document self-service (legacy `documents` table; RLS-scoped to the carrier,
// trigger sets carrier_id=auth.uid() + status='pending' for staff review).
export const carrierUploadDocument = async ({ type, fileName, filePath }) => {
  const { getClient } = await import('./supabaseClient.js');
  const sb = await getClient();
  const { error } = await sb.from('documents').insert({ type, file_name: fileName, file_path: filePath });
  if (error) throw new Error(error.message || 'Could not save the document.');
  return true;
};
export const carrierListDocuments = async () => {
  const { getClient } = await import('./supabaseClient.js');
  const sb = await getClient();
  const { data, error } = await sb.from('documents').select('id,type,file_name,file_path,status,created_at').order('created_at', { ascending: false }).limit(100);
  if (error) throw new Error(error.message || 'Could not load documents.');
  return data || [];
};
// Phase 6 — carrier self-service
export const pocketReportIssue = (trip, kind, note) => rpc('cc_pocket_report_issue', { p_trip: trip, p_kind: kind, p_note: note ?? null });
export const pocketDisputeInvoice = (invoice, reason) => rpc('cc_pocket_dispute_invoice', { p_invoice: invoice, p_reason: reason });
export const pocketUploadPod = (o = {}) => rpc('cc_pocket_upload_pod', { p_trip: o.trip, p_path: o.path, p_file_name: o.fileName ?? 'POD', p_content_type: o.contentType ?? null, p_size: o.size ?? null });
// carrier-facing: list this carrier's own PODs for a trip (status, review note, versions) — migration cum_pocket_pod_status
export const pocketTripPods = (trip) => rpc('cc_pocket_trip_pods', { p_trip: trip });
// carrier-facing fleet self-service (own drivers + trucks) — migration cuq_carrier_self_fleet
export const pocketDrivers = () => rpc('cc_pocket_drivers');
export const pocketUpsertDriver = (o = {}) => rpc('cc_pocket_upsert_driver', { p_id: o.id ?? null, p_name: o.name, p_phone: o.phone ?? null, p_email: o.email ?? null, p_license_no: o.licenseNo ?? null, p_license_state: o.licenseState ?? null, p_license_exp: o.licenseExp ?? null, p_medical_exp: o.medicalExp ?? null });
export const pocketTrucks = () => rpc('cc_pocket_trucks');
export const pocketUpsertTruck = (o = {}) => rpc('cc_pocket_upsert_truck', { p_id: o.id ?? null, p_unit_no: o.unitNo, p_plate: o.plate ?? null, p_vin: o.vin ?? null, p_equipment: o.equipment ?? null });
// carrier team (existing members) — migration cus_carrier_team
export const pocketTeam = () => rpc('cc_pocket_team');
export const pocketSetMember = (o = {}) => rpc('cc_pocket_set_member', { p_user: o.user, p_role: o.role ?? null, p_status: o.status ?? null });
// carrier assigns own driver/truck to own trip — migration cut_carrier_assign_trip
export const pocketAssignTrip = (o = {}) => rpc('cc_pocket_assign_trip', { p_trip: o.trip, p_driver: o.driver ?? null, p_truck: o.truck ?? null });
// carrier self-service account statement — migration cuv_carrier_self_statement
export const pocketStatement = () => rpc('cc_pocket_statement');
// carrier fleet compliance alerts (expiring license/medical) — migration cuw_carrier_fleet_alerts
export const pocketFleetAlerts = () => rpc('cc_pocket_fleet_alerts');
// carrier/driver advance own trip forward (in_transit / delivered) — migration cux_carrier_advance_trip
export const pocketAdvanceTrip = (trip, status) => rpc('cc_pocket_advance_trip', { p_trip: trip, p_status: status });
// carrier trip event history/timeline — migration cuz_carrier_trip_timeline
export const pocketTripTimeline = (trip) => rpc('cc_pocket_trip_timeline', { p_trip: trip });
// carrier's own reported exceptions with resolution status — migration cva_carrier_my_exceptions
export const pocketMyExceptions = (limit) => rpc('cc_pocket_my_exceptions', { p_limit: limit ?? 50 });
// Phase 5 — web push (any authenticated user)
export const savePushSubscription = (o = {}) => rpc('cc_save_push_subscription', { p_endpoint: o.endpoint, p_p256dh: o.p256dh, p_auth: o.auth, p_label: o.label ?? null, p_ua: o.ua ?? null });
export const revokePushSubscription = (endpoint) => rpc('cc_revoke_push_subscription', { p_endpoint: endpoint });
export const VAPID_PUBLIC_KEY = 'BMCVidsbziyvOFCZflK-uYgKxDR8DQizN6Z1ds2i1qGp2EqyT4M82wHoxiH5-hWIcQR6Sp3_P-Z20v5Yfp88x2c';
export const sendPush = async (o = {}) => {
  const { getClient } = await import('./supabaseClient.js');
  const sb = await getClient();
  const { data, error } = await sb.functions.invoke('push-send', { body: { title: o.title, body: o.body, url: o.url ?? '/', audience: o.audience ?? null, user_ids: o.userIds ?? null, org: o.org ?? null } });
  if (error) throw new Error((error && error.message) || 'Push failed');
  if (data && data.error) throw new Error(data.error);
  return data;
};

// ---- Wave 10 Advanced Ops & Intelligence ----
export const opsRadar = () => rpc('cc_ops_radar');
export const matchCarriers = (loadId) => rpc('cc_match_carriers_for_load', { p_load: loadId });
export const globalSearch = (q, limit) => rpc('cc_global_search', { p_q: q, p_limit: limit ?? 20 });

// ---- Enterprise Completion: Fleet & execution (flag: fleet_enabled) ----
export const fleetOverview = () => rpc('cc_fleet_overview');
export const listDrivers = (o = {}) => rpc('cc_list_drivers', { p_carrier: o.carrier ?? null, p_search: o.search ?? null, p_limit: o.limit ?? 200 });
export const fleetExpiryBoard = (days) => rpc('cc_fleet_expiry_board', { p_days: days ?? 45 });
export const contactsDirectory = (o = {}) => rpc('cc_contacts_directory', { p_search: o.search ?? null, p_kind: o.kind ?? null, p_limit: o.limit ?? 200 });
export const warnDriverExpiry = (driver, kind) => rpc('cc_warn_driver_expiry', { p_driver: driver, p_kind: kind });
export const listPermissionsFor = (userId) => rpc('cc_list_permissions_for', { p_user: userId });
export const setUserPermission = (userId, perm, effect) => rpc('cc_set_user_permission', { p_user: userId, p_perm: perm, p_effect: effect });
export const inviteStaff = (email, roleKey) => rpc('cc_invite_staff', { p_email: email, p_role_key: roleKey });
export const listStaffInvites = () => rpc('cc_list_staff_invites');
export const revokeStaffInvite = (id) => rpc('cc_revoke_staff_invite', { p_id: id });
export const claimStaffInvite = () => rpc('cc_claim_staff_invite');
export const upsertDriver = (o = {}) => rpc('cc_upsert_driver', { p_id: o.id ?? null, p_carrier: o.carrier, p_name: o.name, p_phone: o.phone ?? null, p_license_no: o.licenseNo ?? null, p_license_exp: o.licenseExp ?? null, p_medical_exp: o.medicalExp ?? null });
export const upsertTruck = (o = {}) => rpc('cc_upsert_truck', { p_id: o.id ?? null, p_carrier: o.carrier, p_unit: o.unit, p_plate: o.plate ?? null, p_vin: o.vin ?? null, p_equipment: o.equipment ?? null });
export const assignTripResources = (o = {}) => rpc('cc_assign_trip_resources', { p_trip: o.trip, p_driver: o.driver ?? null, p_truck: o.truck ?? null, p_trailer: o.trailer ?? null });
export const addAccessorial = (trip, kind, amount, note) => rpc('cc_add_accessorial', { p_trip: trip, p_kind: kind, p_amount: amount, p_note: note ?? null });
export const logException = (trip, kind, description) => rpc('cc_log_exception', { p_trip: trip, p_kind: kind, p_description: description });
// staff exception queue (carrier-reported trip exceptions) — migration cuu_staff_exception_queue
export const listExceptions = (o = {}) => rpc('cc_list_exceptions', { p_status: o.status ?? 'open', p_limit: o.limit ?? 100 });
export const resolveException = (o = {}) => rpc('cc_resolve_exception', { p_id: o.id, p_note: o.note ?? null });

// ---- EC: Compliance external data ----
export const upsertCarrierSafety = (o = {}) => rpc('cc_upsert_carrier_safety', { p_carrier: o.carrier, p_dot: o.dot ?? null, p_mc: o.mc ?? null, p_authority: o.authority ?? null, p_rating: o.rating ?? null, p_power_units: o.powerUnits ?? null, p_oos: o.oos ?? null });
export const safetyScorecard = (carrier) => rpc('cc_safety_scorecard', { p_carrier: carrier });

// ---- EC: Finance depth ----
export const addAdjustment = (o = {}) => rpc('cc_add_adjustment', { p_invoice: o.invoice ?? null, p_settlement: o.settlement ?? null, p_kind: o.kind, p_amount: o.amount, p_note: o.note ?? null });
export const openDispute = (invoice, reason) => rpc('cc_open_dispute', { p_invoice: invoice, p_reason: reason });
export const resolveDispute = (dispute, decision, resolution) => rpc('cc_resolve_dispute', { p_dispute: dispute, p_decision: decision, p_resolution: resolution ?? null });
export const exportFinance = (kind) => rpc('cc_export_finance', { p_kind: kind ?? 'invoices' });
export const carrierStatement = (carrier) => rpc('cc_carrier_statement', { p_carrier: carrier });

// ---- EC: Tracking ----
export const pocketSetConsent = (trip, consent) => rpc('cc_pocket_set_consent', { p_trip: trip, p_consent: consent });
export const pocketPostLocation = (trip, lat, lng, label) => rpc('cc_pocket_post_location', { p_trip: trip, p_lat: lat, p_lng: lng, p_label: label ?? null });
export const tripLocations = (trip, limit) => rpc('cc_trip_locations', { p_trip: trip, p_limit: limit ?? 50 });

// ---- EC: Intelligence + Documents ----
export const laneHistory = (limit) => rpc('cc_lane_history', { p_limit: limit ?? 30 });
export const managementDashboard = () => rpc('cc_management_dashboard');
export const invoiceDocument = (invoice) => rpc('cc_invoice_document', { p_invoice: invoice });
export const rateconDocument = (trip) => rpc('cc_ratecon_document', { p_trip: trip });
export const listDocumentFiles = (ownerType, ownerId) => rpc('cc_list_document_files', { p_owner_type: ownerType, p_owner_id: ownerId });
export const recordDocumentFile = (o = {}) => rpc('cc_record_document_file', { p_owner_type: o.ownerType, p_owner_id: o.ownerId, p_kind: o.kind ?? null, p_path: o.path, p_file_name: o.fileName, p_content_type: o.contentType ?? null, p_size: o.size ?? null });

// ---- POD review workflow (migration cul_pod_review_workflow) ----
export const podReviewQueue = (o = {}) => rpc('cc_pod_review_queue', { p_status: o.status ?? 'pending', p_limit: o.limit ?? 100 });
export const podSignedRef = (docId) => rpc('cc_pod_signed_ref', { p_doc: docId });
export const reviewPod = (o = {}) => rpc('cc_review_pod', { p_doc: o.doc, p_decision: o.decision, p_reason: o.reason ?? null });

// ---- Control Tower Wave A: first-party Web Analytics (flag: web_analytics_enabled) ----
export const webLive = (minutes = 5) => rpc('cc_web_live', { p_minutes: minutes });
export const webOverview = (days = 7) => rpc('cc_web_overview', { p_days: days });
export const webPages = (days = 7, limit = 25) => rpc('cc_web_pages', { p_days: days, p_limit: limit });
export const webReferrers = (days = 7, limit = 25) => rpc('cc_web_referrers', { p_days: days, p_limit: limit });
export const webAiReferrals = (days = 30) => rpc('cc_web_ai_referrals', { p_days: days });

// ---- Wave A: Forms inbox -> leads (flag: forms_enabled) ----
export const formsOverview = () => rpc('cc_forms_overview');
export const listForms = (o = {}) => rpc('cc_list_forms', { p_status: o.status ?? null, p_search: o.search ?? null, p_limit: o.limit ?? 200 });
export const getForm = (id) => rpc('cc_get_form', { p_id: id });
export const convertFormToLead = (id) => rpc('cc_convert_form_to_lead', { p_id: id });
export const setFormStatus = (id, status, assignee) => rpc('cc_set_form_status', { p_id: id, p_status: status, p_assignee: assignee ?? null });

// ---- Wave A: SEO control center (flag: seo_enabled) ----
export const seoOverview = () => rpc('cc_seo_overview');
export const listKeywords = (o = {}) => rpc('cc_list_keywords', { p_search: o.search ?? null, p_limit: o.limit ?? 200 });
export const upsertKeyword = (o = {}) => rpc('cc_upsert_keyword', { p_id: o.id ?? null, p_keyword: o.keyword, p_target_page: o.targetPage ?? null, p_position: o.position ?? null, p_priority: o.priority ?? null, p_intent: o.intent ?? null, p_notes: o.notes ?? null });
export const listRedirects = (limit = 300) => rpc('cc_list_redirects', { p_limit: limit });
export const createRedirect = (o = {}) => rpc('cc_create_redirect', { p_source: o.source, p_destination: o.destination, p_type: o.type ?? 301, p_reason: o.reason ?? null });
export const toggleRedirect = (id, active) => rpc('cc_toggle_redirect', { p_id: id, p_active: active });

// ---- Wave A: integration status shells (GA4 / Search Console / Resend / Twilio / Maps / FMCSA) ----
export const integrationStatus = () => rpc('cc_integration_status');
export const setIntegrationStatus = (provider, status, config) => rpc('cc_set_integration_status', { p_provider: provider, p_status: status, p_config: config ?? null });

// ---- Control Tower Wave B: entity 360 (flag: entity360_enabled) ----
export const carrier360 = (org) => rpc('cc_carrier_360', { p_org: org });
export const entityAudit = (o = {}) => rpc('cc_entity_audit', { p_target_type: o.targetType ?? null, p_target_id: o.targetId ?? null, p_org: o.org ?? null, p_limit: o.limit ?? 60 });

// ---- Wave C: Brokers & Shippers (flag: partners_enabled) ----
export const partnersOverview = () => rpc('cc_partners_overview');
export const listPartners = (o = {}) => rpc('cc_list_partners', { p_kind: o.kind ?? null, p_search: o.search ?? null, p_limit: o.limit ?? 200 });
export const getPartner = (id) => rpc('cc_get_partner', { p_id: id });
export const upsertPartner = (o = {}) => rpc('cc_upsert_partner', { p_id: o.id ?? null, p_kind: o.kind, p_name: o.name, p_mc: o.mc ?? null, p_contact_name: o.contactName ?? null, p_email: o.email ?? null, p_phone: o.phone ?? null, p_billing_terms: o.billingTerms ?? null, p_credit_limit: o.creditLimit ?? null, p_notes: o.notes ?? null });
export const setPartnerStatus = (id, status) => rpc('cc_set_partner_status', { p_id: id, p_status: status });

// ---- Wave D: Support / tickets (flag: support_enabled) ----
export const supportOverview = () => rpc('cc_support_overview');
export const listTickets = (o = {}) => rpc('cc_list_tickets', { p_status: o.status ?? null, p_search: o.search ?? null, p_limit: o.limit ?? 200 });
export const getTicket = (id) => rpc('cc_get_ticket', { p_id: id });
export const createTicket = (o = {}) => rpc('cc_create_ticket', { p_subject: o.subject, p_body: o.body ?? null, p_requester_name: o.requesterName ?? null, p_requester_email: o.requesterEmail ?? null, p_priority: o.priority ?? 'normal', p_category: o.category ?? null, p_related_type: o.relatedType ?? null, p_related_id: o.relatedId ?? null });
export const setTicketStatus = (id, status, assignee) => rpc('cc_set_ticket_status', { p_id: id, p_status: status, p_assignee: assignee ?? null });

// ---- Wave E: Reports center (flag: reports_enabled) ----
export const report = (kind, days = 30) => rpc('cc_report', { p_kind: kind, p_days: days });

// ---- Wave F: Automations management (flag: automations_admin_enabled) ----
export const listRules = () => rpc('cc_list_rules');
export const setRuleEnabled = (key, enabled) => rpc('cc_set_rule_enabled', { p_key: key, p_enabled: enabled });

// ---- Wave I: Action Center (personalized prioritized home) ----
export const actionCenter = () => rpc('cc_action_center');

// ---- Wave J: Live operations map ----
export const opsMap = () => rpc('cc_ops_map');

// ---- Phase 3/4: real Google Analytics 4 + Search Console (edge functions) ----
export const ga4Insights = async (days = 28) => {
  const { getClient } = await import('./supabaseClient.js');
  const sb = await getClient();
  const { data, error } = await sb.functions.invoke('ga4-insights', { body: { days } });
  if (error) throw new Error((error && error.message) || 'GA4 request failed');
  return data;
};
export const gscInsights = async (days = 28) => {
  const { getClient } = await import('./supabaseClient.js');
  const sb = await getClient();
  const { data, error } = await sb.functions.invoke('gsc-insights', { body: { days } });
  if (error) throw new Error((error && error.message) || 'Search Console request failed');
  return data;
};

// ---- Wave L: Announcements & Broadcast (flag: announcements_enabled) ----
export const createAnnouncement = (o = {}) => rpc('cc_create_announcement', { p_title: o.title, p_body: o.body ?? null, p_kind: o.kind ?? 'info', p_audience: o.audience ?? 'all_carriers', p_target_org: o.targetOrg ?? null, p_expires_at: o.expiresAt ?? null });
export const listAnnouncements = (limit = 100) => rpc('cc_list_announcements', { p_limit: limit });
export const setAnnouncementActive = (id, active) => rpc('cc_set_announcement_active', { p_id: id, p_active: active });
export const pocketAnnouncements = () => rpc('cc_pocket_announcements');

// ---- Wave L: Campaign manager (flag: campaigns_enabled) ----
export const createCampaign = (o = {}) => rpc('cc_create_campaign', { p_name: o.name, p_source: o.source ?? null, p_medium: o.medium ?? null, p_campaign: o.campaign, p_landing: o.landing ?? '/' });
export const listCampaigns = (limit = 100) => rpc('cc_list_campaigns', { p_limit: limit });
export const setCampaignActive = (id, active) => rpc('cc_set_campaign_active', { p_id: id, p_active: active });

// ---- Live integration: AI assist (Gemini) + transactional email (Resend) ----
export const aiAssist = async (task, ctx = {}) => {
  const { getClient } = await import('./supabaseClient.js');
  const sb = await getClient();
  const { data, error } = await sb.functions.invoke('ai-assist', { body: { task, ...ctx } });
  if (error) throw new Error((error && error.message) || 'AI request failed');
  if (data && data.error) throw new Error(data.error);
  return data;
};
export const sendEmail = async (o = {}) => {
  const { getClient } = await import('./supabaseClient.js');
  const sb = await getClient();
  const { data, error } = await sb.functions.invoke('send-email', { body: { to: o.to, subject: o.subject, text: o.text, html: o.html ?? null } });
  if (error) throw new Error((error && error.message) || 'Email failed');
  if (data && data.error) throw new Error(data.error);
  return data;
};

// ---- Live integration: FMCSA carrier verification (edge function fmcsa-verify) ----
export const fmcsaVerify = async (o = {}) => {
  const { getClient } = await import('./supabaseClient.js');
  const sb = await getClient();
  const { data, error } = await sb.functions.invoke('fmcsa-verify', { body: { carrier_org: o.carrierOrg ?? null, dot: o.dot ?? null, mc: o.mc ?? null } });
  if (error) { const e = new Error((error && error.message) || 'FMCSA verification failed'); e.fn = 'fmcsa-verify'; throw e; }
  if (data && data.error) throw new Error(data.error);
  return data;
};

// ---- Wave G: staff scoped access (carrier-org selector for admin_assign_role) ----
export const listCarrierOrgs = () => rpc('cc_list_carrier_orgs');

// ---- Wave H: staff team chat (flag: team_chat_enabled) ----
export const postChat = (body, name) => rpc('cc_post_chat', { p_body: body, p_name: name ?? null });
export const listChat = (after = 0, limit = 100) => rpc('cc_list_chat', { p_after: after, p_limit: limit });

// ---- ct-waveBG: Partner Portal (broker / shipper / facility self-service) ----
// Self-scoping like the carrier pocket API: the server resolves the partner org from
// the session (my_partner_org), so a partner only ever sees/writes its own records.
export const partnerRegister = (kind, company) => rpc('cc_partner_register', { p_kind: kind, p_company: company });
export const partnerOverview = () => rpc('cc_partner_overview');
// broker
export const partnerPostLoad = (o = {}) => rpc('cc_partner_post_load', { p_origin: o.origin, p_destination: o.destination, p_equipment: o.equipment ?? null, p_rate: o.rate ?? null, p_miles: o.miles ?? null, p_pickup: o.pickup ?? null, p_weight: o.weight ?? null, p_commodity: o.commodity ?? null, p_notes: o.notes ?? null, p_idempotency_key: o.idempotencyKey ?? null });
export const partnerMyLoads = (limit) => rpc('cc_partner_my_loads', { p_limit: limit ?? 50 });
// Load Wizard (Inc 44) — richer broker submission with duplicate detection + document checklist.
export const partnerSubmitLoad = (o = {}) => rpc('cc_partner_submit_load', { p: o });
export const loadChecklist = (subjectType, subjectId) => rpc('cc_load_checklist', { p_subject_type: subjectType, p_subject_id: subjectId });
export const loadChecklistSet = (id, status) => rpc('cc_load_checklist_set', { p_id: id, p_status: status });
// shipper
export const partnerRequestShipment = (o = {}) => rpc('cc_partner_request_shipment', { p_origin: o.origin, p_destination: o.destination, p_ready: o.ready ?? null, p_equipment: o.equipment ?? null, p_weight: o.weight ?? null, p_commodity: o.commodity ?? null, p_pieces: o.pieces ?? null, p_accessorials: o.accessorials ?? null, p_notes: o.notes ?? null, p_facility_notes: o.facility_notes ?? null, p_dock_hours: o.dock_hours ?? null, p_appointment_required: o.appointment_required ?? false });
export const partnerMyShipments = (limit) => rpc('cc_partner_my_shipments', { p_limit: limit ?? 50 });
// facility
export const partnerCreateAppointment = (o = {}) => rpc('cc_partner_create_appointment', { p_direction: o.direction ?? 'inbound', p_window_start: o.windowStart, p_window_end: o.windowEnd ?? null, p_dock: o.dock ?? null, p_carrier_name: o.carrierName ?? null, p_reference: o.reference ?? null, p_notes: o.notes ?? null });
export const partnerAppointments = (limit) => rpc('cc_partner_appointments', { p_limit: limit ?? 100 });
export const partnerSetAppointmentStatus = (id, status) => rpc('cc_partner_set_appointment_status', { p_id: id, p_status: status });

// ---- ct-waveBG: Partner Intake (staff side, Command Center) — RBAC: partners.view/manage ----
export const partnerIntakeOverview = () => rpc('cc_partner_intake_overview');
export const listPartnerLoads = (o = {}) => rpc('cc_list_partner_loads', { p_status: o.status ?? null, p_limit: o.limit ?? 100 });
export const decidePartnerLoad = (id, action) => rpc('cc_decide_partner_load', { p_id: id, p_action: action });
export const listPartnerShipments = (o = {}) => rpc('cc_list_partner_shipments', { p_status: o.status ?? null, p_limit: o.limit ?? 100 });
export const decidePartnerShipment = (id, action) => rpc('cc_decide_partner_shipment', { p_id: id, p_action: action });
export const listPartnerAppointmentsAll = (limit) => rpc('cc_list_partner_appointments_all', { p_limit: limit ?? 200 });
// partner invoicing (cte)
export const createPartnerInvoice = (o = {}) => rpc('cc_create_partner_invoice', { p_partner_org: o.org, p_amount: o.amount, p_description: o.description ?? null, p_due: o.due ?? null });
export const listPartnerInvoicesAll = (o = {}) => rpc('cc_list_partner_invoices_all', { p_status: o.status ?? null, p_limit: o.limit ?? 200 });
export const setPartnerInvoiceStatus = (id, status) => rpc('cc_set_partner_invoice_status', { p_id: id, p_status: status });
export const partnerMyInvoices = (limit) => rpc('cc_partner_my_invoices', { p_limit: limit ?? 100 });
export const listPartnerOrgs = () => rpc('cc_list_partner_orgs');
export const partnerNotifications = (limit) => rpc('cc_partner_notifications', { p_limit: limit ?? 50 });
export const partnerMarkNotificationRead = (id) => rpc('cc_partner_mark_notification_read', { p_id: id });
export const partnerGetProfile = () => rpc('cc_partner_get_profile');
export const partnerUpdateProfile = (o = {}) => rpc('cc_partner_update_profile', { p_company: o.company, p_contact_name: o.contactName ?? null, p_phone: o.phone ?? null, p_email: o.email ?? null, p_address: o.address ?? null });
// developer API keys (ctj)
export const createApiKey = (name, scopes) => rpc('cc_create_api_key', { p_name: name, p_scopes: scopes ?? ['read'] });
export const listApiKeys = () => rpc('cc_list_api_keys');
export const revokeApiKey = (id) => rpc('cc_revoke_api_key', { p_id: id });
// manual payments (ctn) — no gateway required
export const getPaymentInstructions = () => rpc('cc_get_payment_instructions');
export const setPaymentInstructions = (text) => rpc('cc_set_payment_instructions', { p_text: text });
export const partnerSubmitInvoicePayment = (id, proofPath, expectedDate, ref, note) => rpc('cc_partner_submit_invoice_payment', { p_id: id, p_proof_path: proofPath ?? null, p_expected_date: expectedDate ?? null, p_ref: ref ?? null, p_note: note ?? null });
// carrier verification center (cua) — real FMCSA-backed
export const recordCarrierVerification = (carrier, result) => rpc('cc_record_carrier_verification', { p_carrier: carrier, p_result: result });
export const listCarrierVerifications = (o = {}) => rpc('cc_list_carrier_verifications', { p_carrier: o.carrier ?? null, p_limit: o.limit ?? 100 });
export const verificationQueue = (limit) => rpc('cc_verification_queue', { p_limit: limit ?? 100 });
// marketing brand kit (cub)
export const getBrandKit = () => rpc('cc_get_brand_kit');
export const setBrandKit = (data) => rpc('cc_set_brand_kit', { p_data: data });
// plugin framework (cuc)
// form builder (cud)
export const saveCustomForm = (o = {}) => rpc('cc_save_custom_form', { p_key: o.key, p_title: o.title, p_description: o.description ?? null, p_fields: o.fields ?? [], p_thank_you: o.thankYou ?? null, p_redirect: o.redirect ?? null, p_status: o.status ?? 'draft' });
export const listCustomForms = () => rpc('cc_list_custom_forms');
export const listPlugins = () => rpc('cc_list_plugins');
export const listInstalledPlugins = () => rpc('cc_list_installed_plugins');
export const installPlugin = (id, config) => rpc('cc_install_plugin', { p_plugin: id, p_config: config ?? {} });
export const setPluginEnabled = (id, enabled) => rpc('cc_set_plugin_enabled', { p_id: id, p_enabled: enabled });
export const uninstallPlugin = (id) => rpc('cc_uninstall_plugin', { p_id: id });

// NOTE — deferred modules (NOT built yet, intentionally absent from the RPC surface):
// content/blog page builder, fleet live locations, smart matching UI, live ELD sync.
// They return one-by-one in later phases behind feature flags.

export default { rpc };

// #31 — self-scoped profile avatar
export const setMyAvatar = (path) => rpc('cc_set_my_avatar', { p_path: path });
export const myAvatar = () => rpc('cc_my_avatar');

// #54 — automation: sweep lapsing compliance docs and auto-warn carriers (idempotent)
export const runComplianceExpirySweep = (days) => rpc('cc_run_compliance_expiry_sweep', { p_days: days ?? 30 });

// #54 — automation: auto-expire stale (undecided) booking requests
export const runStaleBookreqSweep = (days) => rpc('cc_run_stale_bookreq_sweep', { p_days: days ?? 5 });
