# LoadBoot — evidence index

5 September 2026. Main `b44fbabe12ac1841b2b61c042eb042f760b8ae5f`. These records accompany the Phase 1 audit. Raw data is limited to metadata, source definitions and aggregates; no customer document contents or secret configuration is included. This is not a reproduction of the Git repository.

## What was actually verified

- All required Phase 0 documents/API and recent migration/history baseline were read; PR #168 was incorporated before final findings.
- Staging and production histories: 687 and 716 migrations, latest versions `20260904140509` and `20260904141312`. Histories were rechecked during continuation.
- Current production function snapshot contains 1,150 public/app_private functions. The earlier staging snapshot contains 1,138. Catalog comparisons are by name/signature/hash; name-only API matching is not full contract testing.
- Production aggregate reconfirmed zero non-demo available loads; 10 available demo loads; three non-demo booked, one delivered and one cancelled. Organization counts are status flags, not verified commercial identities.
- Staging-bound Python build: BUILD OK. Original unmodified JS: 149 files, zero syntax failures. Repository syntax script also passed. Import-reference checker produced a confirmed false positive for a dynamic import.
- Read-only production storage policies, bucket limits, cron schedule, function grants and selected current definitions were reviewed. No RPC invocation or database write was used as a test.
- Browser/Lighthouse and authenticated journeys: UNKNOWN. Chromium was missing; download failed with timeouts. Source screenshots are repository harness examples only.
- Final source checkout was clean. Audit reports, evidence and preview were created outside it.

## Archive contents

| File | Purpose / limits |
|---|---|
| `migrations-staging.json`, `migrations-production.json` | Full returned migration histories; differing counts do not prove drift |
| `catalog-staging.json`, `catalog-production.json` | Function signatures and definition hashes from initial current-state read |
| `final-production-snapshot.json` | Refreshed production catalog, aggregate load/org counts and storage policy expressions |
| `staging-security.json`, `production-security.json` | Every security advisor finding, with timestamp and exact object metadata |
| `staging-performance.json`, `production-performance.json` | Every performance advisor finding; not query-plan validation |
| `review-functions.json`, `more-functions.json` | Selected live definitions used for targeted findings; no functions invoked |
| `current-security.json` | Exact EXECUTE grants for the legacy email RPCs |
| `current-storage.json` | Bucket privacy/size/MIME metadata |
| `current-cron.json` | 40 active production job names and schedules; not successful-run proof |
| `current-sizes.json` | Database size metadata; not billing usage |
| `outreach-observation.json` | Whitelisted non-secret outreach settings/counter observations only |
| `rpc-drift.json` | Current API name comparison: 726 names, eight prod and 15 staging absent |
| `build.log`, `syntax.log`, `verification-results.json` | Build/syntax evidence and honest runtime limitations |
| `site-inventory.json`, `build-stats.json` | Generated page metadata and output sizes; not Lighthouse |
| `style-inventory.json` | 9,672 literal style candidates with file/line/value; not 9,672 confirmed violations |
| `view-inventory.json` | 97 source module candidates with heuristic state-word matches |
| `screen-and-security-inventory.md` | Readable per-view, per-public-page and advisor-object inventories; untested verdicts UNKNOWN |
| `attachment-comparison.json` | Six attachments compared with latest main: about_module.py and article_dates.py differ; main remained authoritative |
| `manifest.json` | SHA-256 and sizes of the selected evidence files |

## Coverage limits

Every listed advisor object is preserved; every exposed function has not been manually proven safe or unsafe. Every generated public page and scanned view is inventoried; every rendered screen and state has not been exercised. The UNKNOWN register in the main report is part of the audit result, not a claim that these gates passed.

No production tests, source fixes, migrations, deployment, auth/payment/DNS change, outgoing messages or calls were performed. Existing cron operation was observed, not triggered by this audit.
