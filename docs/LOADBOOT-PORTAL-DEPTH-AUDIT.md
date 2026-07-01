# LOADBOOT — Portal-Depth Audit (Gate Deliverable 2)

**Date:** 2026-07-01 · **Method:** static crawl of every router + nav + view across all
surfaces, cross-checked against the live module registry. This covers the *structural*
depth (routes resolve, views exist, nav maps, permissions declared). The *runtime/persona*
depth (data loads per role, create/edit works live, mobile) requires authenticated logins
and is tracked separately as BLOCKED (owner chose to skip test accounts).

## Result: STRUCTURAL AUDIT CLEAN — 0 dead links, 0 missing views

### Command Center
- **50 routes**, **49 nav items**, **55 view files**, **55 view imports**.
- Every nav item resolves to a route. ✅
- Every route's render function is imported and its view file exists and parses. ✅
- **Orphan routes (deep-link only, intentional):** `/carrier` — the Carrier 360 detail
  view, reached by clicking a carrier row (`?id=…`), sets active nav to `/carriers`. Not a
  dead link. ✅
- **Dead links found:** none. **Missing views:** none. **Broken mappings:** none.

### Carrier Portal & Pocket App
- `app/carrier/` present, `app.js` parses. ✅
- `app/pocket/` present, `pocket.js` parses (entry is `pocket.js`, not `app.js`). ✅

### Partner Portal
- `app/partner/` present, `app.js` parses (broker/shipper/facility role-aware). ✅

### Developer Portal
- `app/developer/` present, `app.js` parses. ✅

### Public surfaces
- Marketing website builds (44 pages) with footer links to Carrier / Partner / Developer
  portals. ✅
- Hosted forms page `/forms/?f=<key>` builds in production, disabled in preview. ✅

## What this audit does NOT yet cover (honest)
Per Definition of Completion (#7–#15, #24–#30), the following need authenticated,
multi-persona runtime testing which is currently blocked on logins:
- per-role data-load / create-edit / row-click / detail / filter behavior
- mobile + accessibility passes
- error/empty/permission-denied state capture per page

These are the **evidence-pack** gate conditions and remain `BLOCKED` until test logins
exist or the owner runs the flows.

## Gate condition status
- **Portal-depth audit completed (structural):** `PASS`
- **Critical dead links / actions fixed:** `PASS` (none found)
- **Runtime/persona depth:** `BLOCKED` (auth)
