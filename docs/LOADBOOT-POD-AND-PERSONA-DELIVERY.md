# LOADBOOT — POD Workflow & Persona Test System — Delivery (v7)

**Generated:** 2026-07-01 · Production `rwscphuhpjoudvljvmdk` · Staging `snslhvmkjusozgjelghi`
**Gate:** `LOADBOOT ENTERPRISE FOUNDATION GATE: FAIL — PASS 10 / PARTIAL 0 / BLOCKED 2 / FAIL 0 of 12` (honest).

This round completed all **code, backend hardening and tests** for the two remaining Foundation conditions.
The only remaining work is the two **browser** proofs, which require a real login and site egress and are
therefore owner-executed. Nothing below is reclassified as "polish".

## A. POD carrier/driver experience (built)

| Surface | File | What it does |
|---|---|---|
| Driver Pocket (mobile PWA) | `app/pocket/pocket.js` + `pocket.css` | "Proof of delivery" on delivered/invoiced trips → file **or camera** picker → validate type (PDF/JPG/PNG/WEBP) + size (≤10 MB) → preview → remove/replace → upload state → success → **network-failure retry** → shows existing version, review status, **rejection reason**, **resubmit** |
| Carrier Portal (desktop/mobile) | `app/carrier/app.js` + `carrier.css` | Same, plus **drag-and-drop** dropzone on desktop |
| Command Center review | `app/command-center/views/podReview.js` | POD Review Queue (pending/approved/rejected) with carrier + route + delivery context, **signed private preview** (2-min TTL), **Approve**, **Reject** (reason required) |

Wiring: route + nav in `app/command-center/app.js` / `views/shell.js`; API wrappers in `app/shared/api.js`;
private-bucket upload helper in `app/shared/storage.js`.

## B. POD storage & backend contract (hardened, applied staging + prod)

Object-path contract: **`{auth.uid()}/pod/{trip}/{immutable-name}`** — the first folder equals `auth.uid()`
(exactly what the Storage `doc_upload` RLS policy requires), and the server **re-derives both the uid and the
trip**, so the browser cannot forge either. Private `documents` bucket only; no public URL is ever created;
staff read via a short-lived signed URL (they are `is_admin()`).

Migrations (source-controlled, applied to both databases):

- `cul_pod_review_workflow.sql` — review state columns + `can_review_pod()` + `cc_pod_review_queue` +
  `cc_pod_signed_ref` + `cc_review_pod` (reject-needs-reason, row-locked, idempotent, one invoice-prep event).
- `cum_pocket_pod_status.sql` — `cc_pocket_trip_pods` (carrier reads only its own PODs).
- `cun_pod_upload_hardening.sql` — server-side validation of trip state, MIME, size and object path in
  `cc_pocket_upload_pod`.
- `cuo_pod_queue_enrich.sql` — enrich the review queue with carrier / route / delivery date.
- `cup_register_pod_module.sql` — register the module in the platform catalog.

## C. POD backend security matrix — 21/21 PASS (staging)

`tests/security/pod_backend_matrix.sql`, run via JWT-claim simulation. Covers directive-D checks
1, 3, 5–11, 13–18, 20: valid carrier upload; cross-carrier / anonymous / unsupported-MIME / oversized /
invalid-state / traversal-path / wrong-trip-path **denied**; duplicate = distinct immutable version;
cross-carrier POD read **denied**; reviewer signed-preview allowed while non-reviewer **denied**;
non-reviewer approve **denied**; reject without/blank reason **denied**; reject-with-reason surfaces to the
carrier; resubmission is a new immutable version while the old stays rejected; authorized approve →
`invoice.prep_requested` **exactly once** (idempotent re-approve).

## D. Authenticated persona test system (built + strengthened)

`tests/security/persona_matrix.spec.js` was upgraded from nav-visibility-only to **server-side enforcement**:
for 11 personas × 4 viewports (390×844, 412×915, 768×1024, 1280×800 = **44 combinations**) it opens the
correct portal, checks role-aware nav, runs a **permitted** RPC (expects success), and calls a **forbidden**
RPC **directly** against PostgREST with the persona's own token (expects a server-side denial), plus
mobile-menu, no-horizontal-overflow, clean-console, no env-leakage and a screenshot.

Supporting files: `personas.js` (matrix definition), `auth-setup.spec.js` (storage-state generator, reads
credentials from env, writes only gitignored `.auth/*.json`), `pod_workflow.spec.js` (browser POD flow),
`PERSONA-TEST-RUNBOOK.md`, `.env.example`, `playwright.config.js`, `.auth/.gitkeep` + `.gitignore`.

The suite **skips cleanly** without `PERSONAS_READY=1` + storage-states, so local release gates show expected
skips rather than failures.

## E. Local release gates (all green here)

- JavaScript syntax: all `app/**/*.js` pass `node --check`.
- Duplicate-export scan: clean.
- Production build: `python3 build_site.py` OK; **zero staging references** in the production-context build;
  the preview build targets **staging only** (zero production references in app config).
- POD backend matrix: 21/21 PASS (staging).
- Gate artifacts regenerate with `SOURCE-OF-TRUTH CONSISTENCY GATE: PASS`.
- Package verifier: `PACKAGE-WIDE REPRODUCIBLE VERIFICATION: PASS` (integrity), correctly reporting the two
  NOT-RUN browser gates and **refusing** any 12/12 claim until the real browser evidence exists.

## F. Owner steps to reach genuine 12/12

Follow `tests/security/PERSONA-TEST-RUNBOOK.md`: push the branch → Netlify staging preview → generate the
per-persona storage-states → run the persona matrix (44 passed, 0 skipped) and the POD workflow spec → drop
the sanitized `persona-playwright-results.json` + screenshots into `evidence/gate/` → re-run the generator and
verifier. Only then does the gate flip to a genuine `PASS 12 / 12`.

## G. What the assistant did NOT do (by rule)

No passwords typed; no secrets/tokens handled in plaintext; no GitHub push; no `.github/workflows` edits; no
device-file deletions; and **no reclassification** of the two browser conditions as optional. Marketing Studio,
Workflow Builder, Plugin Marketplace and other feature waves were **not** started.
