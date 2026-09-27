# AI Brain control — `bl_brain_0472` (27 Sep 2026)

Owner ask: *"CC mein API ka poora system — jo jo AI karay gi, kab karay gi, kitna data use kar rahi hai har action
mein real time, har permission ke saath toggle on/off, aur nayi permission add karne ka engine, jahan se max control
API pe rakh sakoon."*

Screen: **CC → Home → AI Brain** (`#/brain`, `app/command-center/views/brain.js`). `settings.manage` only — every RPC
re-checks server-side.

## What the switches actually do (enforcement is in Postgres, not the page, not the model)

| Kind | Key shape | Off means | Where it bites |
|---|---|---|---|
| **source** — WHEN it runs | `source.chat`, `source.email`, `source.wa`, `source.onboarding`, `source.dispatch`, `source.sales`, `source.sweep`, `source.voice`, `source.test` | every job from that door is filed `skipped` (no POST, no spend) | `app_private.brain_enqueue` |
| **tool** — WHAT it may do | `tool.kb_search`, `tool.get_facts`, `tool.account_lookup`, `tool.note`, `tool.escalate`, `tool.report_finding` (+ 9 planned write tools) | not offered to the model AND refused by name if it asks anyway | `brain_enqueue` (filter) + `brain_tool_exec` (gate) |
| **rule** — owner policy | `rule.<name>` | line disappears from the prompt | `brain_perm_block()` → cached system block |

Per row: `enabled`, `mode` (tool: `auto` executes / `prep` records only; rule: `deny` = "NEVER …" / `allow` = "ALLOWED …"),
`risk`, `status` (`live` / `planned` = row exists, code does not — cannot be switched on), `sources` (tool: only these
sources may use it), `max_per_job`, `max_per_day` (tool: calls; source: jobs), `usd_cap_daily` (source), `note`.
`builtin` rows (seeded) can be switched but not deleted. **A tool not in the registry is denied** (fail-closed).

Every change → `app_private.brain_permission_log` (who, before, after, reason). Shown on the **Change log** tab.
`brain_actions.outcome` = `executed | prepared | denied | error` + `ms`; that is what the Live feed shows per call.

## Tabs

- **Live** — kill switch, spent today vs cap (bar), jobs/tokens/cache-hit/avg secs/escalations, jobs in flight with a
  timer, spend by source, 14-day USD bars, the last 40 tool calls (tool · outcome · bytes · ms · ago). Polls every 5 s.
- **Permissions** — the three groups above with live numbers per row (today / 7 d / denied / prepared / data / avg /
  last used for tools; jobs / USD / tokens / skipped / failed for sources). Edit = drawer. **+ New permission**.
- **Jobs** — filter by source/status; click a row for the full record (question, context, reply, every tool call's
  payload + result, findings filed).
- **Findings** — `brain_findings` inbox (bug / kb_gap / portal / growth / seo / ads / process): accept / done / dismiss.
- **Facts** — `brain_facts` (what the brain treats as TRUE). `site.*` rows are the Market-rates mirror, read-only here.
- **Settings** — model, gate model, daily cap, tool budget, timeout, spot-check date, effort + max tokens per route,
  price table. `fn_url`/`auth_key` are wiring (SQL only) — shown, not editable.
- **Try a question** (header) — one real test job through the queue (`source.test` must be on; costs cents).

## RPCs (all `public`, `settings.manage`, revoked from `public, anon`)

`cc_brain_overview()`, `cc_brain_perm_set(key, patch)`, `cc_brain_perm_add(kind, name, label, description, patch)`,
`cc_brain_perm_delete(key)`, `cc_brain_config_set(patch)`, `cc_brain_jobs(limit, source, status)`, `cc_brain_job(id)`,
`cc_brain_findings(status, limit)`, `cc_brain_finding_set(id, status)`, `cc_brain_facts()`, `cc_brain_fact_set(key,
value, note)` (value null = delete), `cc_brain_test(question, lang)`, `cc_brain_perm_log(limit)`. `cc_brain_set` (0470)
now routes through `cc_brain_config_set` so it logs too.

## Rule for every future brain section (CLAUDE.md §9)

A migration that teaches the brain a new tool **adds or flips its `brain_permissions` row in the same file**
(`status='live'`, the mode the owner agreed, sane caps) — exactly like every email gets an `email_catalog` row. A new
source likewise. The 9 planned write tools already have rows (`send_email`, `send_whatsapp`, `set_doc_verdict`,
`approve_application`, … all `prep`, high risk, off): the owner sets their mode and caps BEFORE the code ships.

## Staging evidence (snslhvmkjusozgjelghi, 27 Sep 2026)

- Migration applied; secdef assertion passed (35 names unchanged). `brain_rpc` still service_role-only.
- Gate tests (`brain_tool_exec` / `brain_enqueue`): unknown tool → denied · tool off → denied · `prep` → prepared,
  not executed · per-job cap (escalate 1/job) → denied · `sources=['chat']` → denied for test · `brain_tools_allowed`
  drops `send_email` (planned) and unknown names · source off → job `skipped`, no POST · source USD cap 0 → `capped`.
- CC RPCs as a `settings.manage` user: overview (27 permissions), add rule → appears in `brain_perm_block()`, set,
  planned tool cannot be switched on, builtin cannot be deleted, delete custom, config set + validation, fact set /
  delete / `site.*` refused, jobs, job, log, facts (16), findings; no JWT → `not authorized`.
- **Anthropic call still blocked**: jobs 8–10 failed with *"Your credit balance is too low"* (same as job 7, after
  the owner added credit). The key in staging secrets is probably from a different Anthropic org/workspace than the
  one the credit went to. Pipeline itself is fine: enqueue → pg_net 202 → function → Anthropic → `brain_rpc('fail')`
  in 0.9 s. Nothing goes to prod until `brain_gate_report()` shows `done` rows with `cache_read > 0`.

## Not done / next

- Prod: 0470 + 0472 + `brain` function wait for the gate (blocked on the key/credit above), then secdef 36 names.
- §3 live chat on Claude flips `source.chat` (this screen already shows the Gemini `lc-brain` job count meanwhile).
