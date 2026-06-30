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

// ---- Wave 9 Carrier Pocket App (flag: carrier_pocket_enabled) — carrier-scoped, self-resolving ----
export const pocketOverview = () => rpc('cc_pocket_overview');
export const pocketTrips = (limit) => rpc('cc_pocket_trips', { p_limit: limit ?? 50 });
export const pocketInvoices = (limit) => rpc('cc_pocket_invoices', { p_limit: limit ?? 50 });
export const pocketCompliance = () => rpc('cc_pocket_compliance');
export const pocketConfirmTrip = (tripId) => rpc('cc_pocket_confirm_trip', { p_trip: tripId });

// ---- Wave 10 Advanced Ops & Intelligence ----
export const opsRadar = () => rpc('cc_ops_radar');
export const matchCarriers = (loadId) => rpc('cc_match_carriers_for_load', { p_load: loadId });
export const globalSearch = (q, limit) => rpc('cc_global_search', { p_q: q, p_limit: limit ?? 20 });

// ---- Enterprise Completion: Fleet & execution (flag: fleet_enabled) ----
export const fleetOverview = () => rpc('cc_fleet_overview');
export const listDrivers = (o = {}) => rpc('cc_list_drivers', { p_carrier: o.carrier ?? null, p_search: o.search ?? null, p_limit: o.limit ?? 200 });
export const upsertDriver = (o = {}) => rpc('cc_upsert_driver', { p_id: o.id ?? null, p_carrier: o.carrier, p_name: o.name, p_phone: o.phone ?? null, p_license_no: o.licenseNo ?? null, p_license_exp: o.licenseExp ?? null, p_medical_exp: o.medicalExp ?? null });
export const upsertTruck = (o = {}) => rpc('cc_upsert_truck', { p_id: o.id ?? null, p_carrier: o.carrier, p_unit: o.unit, p_plate: o.plate ?? null, p_vin: o.vin ?? null, p_equipment: o.equipment ?? null });
export const assignTripResources = (o = {}) => rpc('cc_assign_trip_resources', { p_trip: o.trip, p_driver: o.driver ?? null, p_truck: o.truck ?? null, p_trailer: o.trailer ?? null });
export const addAccessorial = (trip, kind, amount, note) => rpc('cc_add_accessorial', { p_trip: trip, p_kind: kind, p_amount: amount, p_note: note ?? null });
export const logException = (trip, kind, description) => rpc('cc_log_exception', { p_trip: trip, p_kind: kind, p_description: description });

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
export const systemHealth = () => rpc('cc_system_health');
export const invoiceDocument = (invoice) => rpc('cc_invoice_document', { p_invoice: invoice });
export const rateconDocument = (trip) => rpc('cc_ratecon_document', { p_trip: trip });
export const listDocumentFiles = (ownerType, ownerId) => rpc('cc_list_document_files', { p_owner_type: ownerType, p_owner_id: ownerId });
export const recordDocumentFile = (o = {}) => rpc('cc_record_document_file', { p_owner_type: o.ownerType, p_owner_id: o.ownerId, p_kind: o.kind ?? null, p_path: o.path, p_file_name: o.fileName, p_content_type: o.contentType ?? null, p_size: o.size ?? null });

// NOTE — deferred V1+ modules (NOT built yet, intentionally absent from the V1 RPC
// surface): web analytics, content/blog, page builder, fleet locations, smart matching,
// rate intelligence, settlements, messages, Search Console. They return one-by-one in
// later phases behind feature flags; do not re-add their RPC wrappers until then.

export default { rpc };
