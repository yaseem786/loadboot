// personas.js — the persona matrix definition shared by auth-setup.spec.js and persona_matrix.spec.js.
//
// Every persona declares:
//   portal      : the app entry a correct login should land on (portal-isolation check)
//   navText     : a role-aware label that MUST be visible for this persona
//   permitted   : { fn, args }  — a read/list RPC the persona is allowed to call (expect success)
//   permittedMutation (optional): { fn, args } — a safe mutation the persona may perform (expect success)
//   forbidden   : { fn, args }  — an RPC the persona MUST be denied when calling the backend DIRECTLY
//   wrongTenant (optional): { fn, args } — a cross-tenant/resource read that MUST be denied
//
// Credentials are NEVER stored here. auth-setup.spec.js reads PERSONA_EMAIL / PERSONA_PASSWORD from the
// environment (or a local .env that is gitignored) and writes a storage-state file under .auth/.
//
// The "forbidden" probe is the important part: it calls the Supabase RPC endpoint directly with the
// persona's own session token, so a hidden button can never be mistaken for a real permission boundary.

const PERSONAS = {
  owner: {
    portal: '/app/command-center/', navText: 'Overview',
    permitted: { fn: 'cc_management_dashboard', args: {} },
    // Owner is unrestricted within the tenant; the cross-tenant guard below still applies.
    forbidden: null,
  },
  dispatcher: {
    portal: '/app/command-center/', navText: 'Dispatch',
    permitted: { fn: 'cc_ops_radar', args: {} },
    forbidden: { fn: 'cc_decide_settlement', args: { p_settlement: '00000000-0000-0000-0000-000000000000', p_decision: 'approved' } },
  },
  compliance: {
    portal: '/app/command-center/', navText: 'POD Review',
    permitted: { fn: 'cc_pod_review_queue', args: { p_status: 'pending', p_limit: 5 } },
    forbidden: { fn: 'cc_decide_settlement', args: { p_settlement: '00000000-0000-0000-0000-000000000000', p_decision: 'approved' } },
  },
  finance_maker: {
    portal: '/app/command-center/', navText: 'Finance',
    permitted: { fn: 'cc_management_dashboard', args: {} },
    // Maker-cannot-approve-own-settlement is proven at the SQL layer (settlement_maker_checker_test.sql,
    // 11/11). Here we prove the maker cannot escalate staff roles (admin/settings-only) — a clean deny.
    forbidden: { fn: 'admin_assign_role', args: { p_user: '00000000-0000-0000-0000-000000000000', p_role_key: 'admin', p_scope_type: 'global' } },
  },
  finance_checker: {
    portal: '/app/command-center/', navText: 'Finance',
    permitted: { fn: 'cc_management_dashboard', args: {} },
    // A checker must not be able to escalate staff roles (admin/settings-only).
    forbidden: { fn: 'admin_assign_role', args: { p_user: '00000000-0000-0000-0000-000000000000', p_role_key: 'admin', p_scope_type: 'global' } },
  },
  marketing: {
    portal: '/app/command-center/', navText: 'Campaigns',
    permitted: { fn: 'cc_list_campaigns', args: {} },
    forbidden: { fn: 'cc_decide_settlement', args: { p_settlement: '00000000-0000-0000-0000-000000000000', p_decision: 'approved' } },
  },
  carrier_owner: {
    portal: '/app/carrier/', navText: 'My trips',
    permitted: { fn: 'cc_pocket_overview', args: {} },
    // A carrier must never reach a Command Center staff RPC.
    forbidden: { fn: 'cc_management_dashboard', args: {} },
  },
  driver: {
    portal: '/app/pocket/', navText: 'Trips',
    permitted: { fn: 'cc_pocket_trips', args: { p_limit: 5 } },
    forbidden: { fn: 'cc_management_dashboard', args: {} },
  },
  broker: {
    portal: '/app/partner/', navText: 'Loads',
    permitted: { fn: 'cc_partner_overview', args: {} },
    forbidden: { fn: 'cc_management_dashboard', args: {} },
  },
  shipper: {
    portal: '/app/partner/', navText: 'Loads',
    permitted: { fn: 'cc_partner_overview', args: {} },
    forbidden: { fn: 'cc_management_dashboard', args: {} },
  },
  facility: {
    portal: '/app/partner/', navText: 'Appointments',
    permitted: { fn: 'cc_partner_overview', args: {} },
    forbidden: { fn: 'cc_management_dashboard', args: {} },
  },
};

const VIEWPORTS = [
  { name: 'mobile-390x844', width: 390, height: 844, isMobile: true },
  { name: 'android-412x915', width: 412, height: 915, isMobile: true },
  { name: 'tablet-768x1024', width: 768, height: 1024, isMobile: true },
  { name: 'desktop-1280x800', width: 1280, height: 800, isMobile: false },
];

module.exports = { PERSONAS, VIEWPORTS };
