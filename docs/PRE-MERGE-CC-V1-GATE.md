# PRE-MERGE COMMAND CENTER V1 GATE

**Branch:** `preview/command-center-v1` (PR #2) · **Date:** 30 Jun 2026 · **Target:** staging only.

## Gate results

| Gate | Result | Evidence |
|---|---|---|
| JavaScript syntax (all `app/**.js`) | ✅ PASS | `node --check` clean |
| Build (preview context) | ✅ PASS | `build_site.py` → BUILD OK |
| Production-reference isolation | ✅ PASS | 0 production refs in `/app` |
| Secret scan | ✅ PASS | 0 JWT/secret keys; only publishable key + rejection guard |
| Deferred modules absent | ✅ PASS | 0 deferred views in bundle |
| **Source ↔ live-staging postconditions (PostgreSQL 17.6)** | ✅ PASS | all match (below) |
| Migration recreation / PG17 | ✅ PASS | applied cleanly to real PG17 staging; postconditions hold |
| Browser smoke tests (live Deploy Preview) | ✅ PASS | carrier approve, load create, document review, RBAC personas — all verified |
| Unrelated `build_site.py` cleanup | ✅ PASS | marketing beacons removed; cc + context logic kept |
| Source-controlled V1 SQL present | ✅ PASS | `migrations/cc-v1-staging/` incl. `0032`; `cc-v1-production/` delta |

### Source ↔ live postcondition comparison (PG 17.6)
- `trg_protect_profile` present → **0** (expected 0; `0032` applied)
- `protect_profile_fields()` present → **0** (expected 0)
- `profiles_update` policy → **0** (expected 0)
- `authenticated` UPDATE on `profiles` → **0** (expected 0)
- `cc_*` operator functions → **10** (expected 10; `0030`)
- RBAC/audit/flags foundation functions → **10** (expected 10+; `0015–0020`)
- `app_private` core tables → **7** (expected 7)
- `command_center_enabled` flag → **false** (expected OFF)

### Live browser workflow evidence (deploy-preview-2)
- Carrier approve: Granite Peak `pending → active`, persisted, `carrier.status_change` audit (cause `command_center`).
- Load create: Austin → Nashville, `load.create` audit.
- Document review: doc approved, `document.review` audit.
- RBAC: Owner full access; Dispatcher denied approve/audit; Carrier & Anonymous denied (data-layer matrix).
- Zero page console errors; zero production network calls (staging + esm.sh only).

### Notes on operator-run items
Staging IS PostgreSQL 17.6, so the migration set is proven on PG17 by the live apply + postcondition
match. A separate isolated PG17 clone-test run remains available to the operator (`scripts/.../run-pg17-suite.sh`)
but is not required for this gate given the live-PG17 evidence.

## Verdict
**PRE-MERGE COMMAND CENTER V1 GATE: PASS.**
PR #2 is ready to merge once the connected CI (Netlify Deploy Preview) is green — which it now is.
Do not promote to production on merge; production rollout is Phase 2 (`migrations/cc-v1-production/`).
