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

// NOTE — deferred V1+ modules (NOT built yet, intentionally absent from the V1 RPC
// surface): web analytics, content/blog, page builder, fleet locations, smart matching,
// rate intelligence, settlements, messages, Search Console. They return one-by-one in
// later phases behind feature flags; do not re-add their RPC wrappers until then.

export default { rpc };
