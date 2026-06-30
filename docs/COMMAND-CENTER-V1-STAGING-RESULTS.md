# Command Center V1 — Staging Backend Results (real, executed)

**Target:** staging `snslhvmkjusozgjelghi` (separate from production). **No production change.**
**Date:** 30 June 2026. Applied via Supabase MCP (direct DB port is unreachable from the build env;
MCP over HTTPS is the supported low-level path per STAGING-BOOTSTRAP.md).

> This is not a plan — every item below was executed against staging and the output is recorded.

---

## 1. Staging migration result — APPLIED ✅

A clean, reviewed V1 series (NOT the experimental 0021–0026). Ledger now:

```
cc_v1_0000_staging_app_baseline                 -- profiles/loads/documents/messages/settlements, RLS, RPCs, storage bucket
cc_v1_0015_organizations_and_rbac               -- orgs, memberships, roles, permissions, role_permissions,
                                                   user_role_assignments, staff_members, invitations, security_events (+seeds)
cc_v1_0016_permission_scope_helpers             -- is_active_staff, has_permission, can_access_carrier/document/load, get_my_staff_context
cc_v1_0017_audit_foundation                     -- append-only app_private.audit_logs + log_audit + get_audit_logs (audit.view)
cc_v1_0018_feature_flags_and_settings           -- feature_flags (default OFF) + typed/allowlisted settings + gated RPCs
cc_v1_0019_privileged_action_audit              -- admin_review_document/assign_role/revoke_role/set_staff_status + owner-hierarchy guards
cc_v1_0020_staff_directory_reads                -- get_staff_directory, get_roles_catalog (management-gated)
cc_v1_0029_drop_experimental_0021_0026_leftovers-- removed 30 orphaned experimental functions
cc_v1_0030_operator_surface                     -- cc_get_overview/list_carriers/get_carrier/set_carrier_status/list_documents/
                                                   list_loads/get_load/create_load/assign_load/set_load_status (RBAC-gated + audited)
```

Seed data: **6 carriers, 7 loads, 5 documents, 6 carrier orgs**, plus 2 synthetic staff (1 Owner, 1 Dispatcher).

## 2. Real workflow execution (simulated authenticated sessions, live on staging)

Each persona's session was simulated by setting the JWT `sub` claim and calling the real RPCs.

**Owner (Workflow 1 + 2) — all succeeded:**
| Step | Result |
|---|---|
| `cc_get_overview` | ok (pending=3, loads_available=4) |
| `cc_set_carrier_status` approve carrier | ok → active |
| `admin_review_document` approve | ok → approved |
| `cc_create_load` | ok (new load id) |
| `cc_assign_load` | ok → booked |
| `cc_set_load_status` → in_transit | ok → in_transit |
| `get_audit_logs` | ok — **7 audit rows visible** (every action above logged) |
| `get_staff_directory` | ok — 2 staff |

**RBAC / persona matrix (Workflow 3):**
| Persona | Action | Expected | Actual |
|---|---|---|---|
| Dispatcher | `cc_list_loads` | allow | ✅ ok (9 rows) |
| Dispatcher | `cc_create_load` | allow | ✅ ok |
| Dispatcher | `cc_set_carrier_status` (approve) | deny | ✅ denied: not authorized |
| Dispatcher | `admin_review_document` | deny | ✅ denied: not authorized |
| Dispatcher | `get_staff_directory` | deny | ✅ denied: not authorized |
| Dispatcher | `get_audit_logs` | deny | ✅ denied: not authorized |
| Carrier (non-staff) | `is_active_staff` | false | ✅ false |
| Carrier | `cc_get_overview` | deny | ✅ denied: not authorized |
| Anonymous | `cc_list_carriers` / overview | deny | ✅ denied: not authorized |

→ Workflows 1, 2, 3 are genuinely functional and access-controlled **at the data layer** (the layer the
frontend is a thin client over). Audit events are created and visible to the privileged role only.

## 3. Security advisors (staging) — reviewed

Only **INFO**-level `rls_enabled_no_policy` on `app_private` tables — **by design**: those tables are
deny-by-default (RLS on, zero policies, no API-role grants) and reached only through SECURITY DEFINER
RPCs. Same posture as production. SECURITY DEFINER-exposed RPC warnings are the intended secured surface.

## 4. Frontend wiring (code)

`app/shared/api.js` rewired to the exact V1 RPC surface (`cc_get_overview`, `cc_list_carriers`,
`cc_get_carrier`, `cc_set_carrier_status`, `cc_list_documents`, `cc_list_loads`, `cc_get_load`,
`cc_create_load`, `cc_assign_load`, `cc_set_load_status`) plus the already-matching RBAC/audit/flags/
privileged RPCs. Deferred experimental module wrappers removed.

---

## 5. Known remaining limitations (honest)

1. **Frontend trim + build not finished this pass.** The shell/router still reference deferred views
   (analytics, content, builder, fleet, intelligence, finance, messages, search). For a clean V1 build
   they must be removed from the router/nav (the V1 nav is: Overview, Carriers, Loads, Dispatch,
   Documents, Staff & Roles, Audit, Feature Flags, Settings + Login). Backend for those modules is
   intentionally absent.
2. **No Netlify Deploy Preview produced from here.** `git push` to `github.com/yaseem786/loadboot`
   returns **403** from this build environment, so a Git-based deploy preview cannot be *originated*
   here. Per the delivery rule, the owner command is below.
3. **Staff browser login** needs a real Supabase Auth user. I do not create accounts / enter passwords.
   The synthetic Owner/Dispatcher used above are profile+RBAC rows for data-layer proof only.

## 6. Exact owner action to get a real staging Deploy Preview URL

The Netlify site `loadboot` is already connected to the GitHub repo. A **preview/branch** build runs in
preview context → it targets **staging** (build_site.py enforces preview⇒staging only). Steps:

```bash
# 1) On a machine with push access to github.com/yaseem786/loadboot:
git checkout -b preview/command-center-v1
git add -A && git commit -m "Command Center V1: staging backend wiring + api surface"
git push -u origin preview/command-center-v1
# 2) Open a PR for that branch. Netlify auto-builds a Deploy Preview (preview context ⇒ staging project).
#    Ensure the Netlify env has LOADBOOT_STAGING_ANON_KEY set (preview build refuses to run without it).
# 3) Set the staging Owner: sign in once via the preview's Command Center login with a real staff email,
#    then (owner SQL on staging):
#      insert into app_private.staff_members(user_id,status) values ('<your-auth-uuid>','active');
#      -- map to internal org + owner role (see cc_v1_0015 backfill pattern)
```

Once you share the Deploy Preview URL, I will drive the browser smoke test (render, RBAC hiding,
console errors, mobile/desktop) and verify each workflow against staging read-only.

## 7. What is NOT built yet (deferred, per scope)
Live GPS/ELD, Stripe payouts, Twilio/SMS, Search Console, full CMS/page builder, advanced analytics,
rate intelligence, AI matching, native apps. These return one-by-one behind feature flags after V1 is
visible and tested.
