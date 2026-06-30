# LoadBoot — Status update for ChatGPT (Command Center V1 live preview)

**Date:** 30 June 2026. For continuation/next-order planning. Production NOT changed today.

## Headline
Command Center V1 is **built, deployed to a real Netlify Deploy Preview, and live-tested end-to-end
against the staging backend.** All required workflows PASS in a real browser. PR is open, **NOT merged,
NOT promoted to production.**

- Preview URL: `https://deploy-preview-2--loadboot.netlify.app/app/command-center/`
- GitHub PR #2, branch `preview/command-center-v1`.
- Target: **staging** project `snslhvmkjusozgjelghi` only. Zero production references; zero production
  network calls; no service-role key in the bundle.

## What was done
1. **Real staging backend** rebuilt with a clean, reviewed migration series (NOT the experimental
   0021–0026): baseline → 0015–0020 (orgs/RBAC, permission helpers, audit, feature flags, privileged
   RPCs, staff directory) → 0029 cleanup of experimental leftovers → 0030 reviewed operator surface →
   0031 staging-only Owner provisioning. Seeded demo carriers/loads/documents.
2. **Frontend trimmed to the 10 V1 screens** (Login, Overview, Carriers, Loads, Dispatch, Documents,
   Staff & Roles, Audit, Feature Flags, Settings); deferred modules (analytics, content, builder, fleet,
   rate intelligence, finance, messages, search) removed from nav/router/imports/bundle. Every screen
   wired to the reviewed staging RPCs. Premium enterprise UI.
3. **Live browser smoke test (real Owner login):** all PASS —
   - Overview shows real counts; Carriers list + detail; **carrier approve** (pending→active, persisted,
     audited); **load create** (audited); **document review** (audited); RBAC personas enforced
     (dispatcher denied approve/audit; carrier & anon denied); desktop + mobile; zero page console errors.

## Bug found AND fixed by the live test (important)
The live test caught a defect the SQL-only test missed: staging still had the legacy
`trg_protect_profile` trigger, which silently reverted any status change made by staff whose profile
role isn't literally `admin`. **Production already removes this via migration 0012B; staging was missing
that step.** Applied the same reviewed contract to staging (`cc_v1_0032`, mirrors 0012B) — carrier/status
changes now persist. Net: staging now matches production's reviewed profile-write contract.

## Production status (unchanged today)
- **loadboot.com** = marketing website + the **Carrier Portal** (already live from earlier, RPC-secured,
  0012B postconditions active). **The Command Center is NOT on production** — only on the preview/staging.
- Production database `quickfreights-portal` untouched today.

## Open / next-decision items
1. **Merge gate:** PR #2 is intentionally not merged. Before merge: add `cc_v1_0032` to the
   source-controlled `migrations/cc-v1-staging/` set (follow-up), and the earlier pre-merge follow-up
   (source SQL + reverted unrelated `build_site.py` marketing beacons).
2. **Command Center → production:** when approved, the path is the reviewed series applied to the
   production project (it already has the base + 0012B), then promote the frontend on its own
   surface/subdomain (shared production backend, separate deploy surface).
3. **Housekeeping:** two leftover Netlify sites (`inquisitive-kheer-10ae89`, `eloquent-haupia-1654c8`)
   are being deleted by the owner; `loadboot` (loadboot.com) stays.

## Question for ChatGPT
Given the Command Center V1 preview is live and all workflows pass against staging, what is the next
order: (a) finalize/merge the PR with the pre-merge follow-ups, (b) plan the production rollout of the
Command Center on a separate subdomain against the shared production backend, or (c) extend V1 with the
next module behind a feature flag? Please give exact next steps.
