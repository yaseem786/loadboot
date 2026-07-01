# LoadBoot — Authenticated Persona & POD Browser Test Runbook

This runbook produces the final two evidence packs the Enterprise Foundation gate still needs:

1. **POD UI AND REVIEW** — a real proof-of-delivery upload (carrier + driver) and a real Command Center review (preview → reject-with-reason → resubmit → approve → invoice-prep).
2. **AUTHENTICATED PORTAL / MOBILE PERSONA** — 11 personas × 4 viewports = **44 executed combinations**, each proving *server-side* enforcement (a forbidden RPC is called directly and denied).

Everything is code-complete and proven at the backend layer already (`tests/security/pod_backend_matrix.sql`, `tests/finance/settlement_maker_checker_test.sql`). These browser steps are the parts that require a **real login**, which the assistant cannot perform because it never types passwords. You run them on your own machine.

> Use **staging test accounts only**. Never use production accounts for this proof.

---

## 0. Prerequisites

- Node 18+ and the repo checked out.
- The staging site deployed and reachable (Netlify preview or the staging domain).
- Chromium (the repo pins `playwright@1.56`). If Playwright's browser isn't present, run `npx playwright install chromium`.
- Staging values to hand:
  - `BASE_URL` — the staging site origin, e.g. `https://staging--loadboot.netlify.app`
  - `SUPABASE_URL` — `https://snslhvmkjusozgjelghi.supabase.co`
  - `SUPABASE_ANON_KEY` — the staging project's anon (publishable) key
- **11 staging Auth users**, one per persona, each already wired to the right role/permissions:
  `owner, dispatcher, compliance, finance_maker, finance_checker, marketing, carrier_owner, driver, broker, shipper, facility`.

Keep secrets out of Git. Copy `.env.example` to `.env` (already gitignored) and fill in the values, **or** pass them inline per command as shown below.

---

## 1. Generate a storage state (login) per persona

Run once per persona. Credentials come from the environment; only the resulting session file is written, under `tests/security/.auth/<persona>.json` (gitignored — never committed, never zipped).

```bash
PERSONA=carrier_owner \
PERSONA_EMAIL='carrier.owner@staging.example' \
PERSONA_PASSWORD='••••••••' \
BASE_URL='https://<staging>' \
npx playwright test tests/security/auth-setup.spec.js
```

Repeat for every persona name listed above. Tip: keep the emails/passwords in your local `.env` and just change `PERSONA=`.

---

## 2. Run the authenticated persona matrix (44 combinations)

```bash
PERSONAS_READY=1 \
BASE_URL='https://<staging>' \
SUPABASE_URL='https://snslhvmkjusozgjelghi.supabase.co' \
SUPABASE_ANON_KEY='<staging-anon-key>' \
npx playwright test tests/security/persona_matrix.spec.js --reporter=list,json,html
```

Each test asserts: correct portal opens, role-aware nav shows, a **permitted** RPC succeeds, a **forbidden** RPC called *directly* is denied by the backend, the mobile menu works, there is no horizontal overflow, the console is clean, and there is no production/staging leakage. A screenshot per combination is saved under `evidence/gate/persona/`.

Expected: **44 passed, 0 skipped**.

---

## 3. Run the POD browser workflow

```bash
PERSONAS_READY=1 \
BASE_URL='https://<staging>' \
SUPABASE_URL='https://snslhvmkjusozgjelghi.supabase.co' \
SUPABASE_ANON_KEY='<staging-anon-key>' \
npx playwright test tests/security/pod_workflow.spec.js --reporter=list,json,html
```

This drives a real carrier upload, a real driver (mobile) upload, and a real staff review (preview → reject-with-reason → approve → invoice-prep). Screenshots land in `evidence/gate/pod/`.

---

## 4. Collect the evidence (sanitized)

After a green run you will have:

- `evidence/gate/persona-playwright-results.json` — machine result (0 skips)
- `evidence/gate/playwright-report/` — HTML report
- `evidence/gate/persona/*.png` — 44 persona screenshots
- `evidence/gate/pod/*.png` — POD upload/review screenshots

**Do not** include `.auth/*.json`, `.env`, tokens, or any password in what you share. The verifier and packager exclude them by default.

---

## 5. Hand back to the assistant

Share only the sanitized result files (JSON + screenshots + HTML report). The assistant then runs:

```bash
python3 scripts/generate_gate_artifacts.py
python3 scripts/verify_handoff_package.py
```

Only when the verifier sees the POD evidence, the POD review evidence, **zero** skipped persona tests, and **44** executed persona/viewport combinations will it print the genuine `LOADBOOT ENTERPRISE FOUNDATION GATE: PASS 12 / 12`. Until then the gate stays honestly at 10/12.

---

### Safety notes

- Never commit passwords, storage-state files, tokens, or provider secrets.
- Never paste credentials into reports.
- Use staging accounts only; never production.
- If a login fails, re-run step 1 for that persona — do not edit application code or SQL.
