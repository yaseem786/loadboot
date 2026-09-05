# Real-screen capture harness (5 Sep 2026)

Captures the live Partner Portal (app/partner) at 2× device pixels on STAGING demo accounts and writes
`shots/pl-*.webp` used by `partner_landing_module.py` (free-load-board-for-brokers.html, shipper-solutions.html).

Demo accounts (staging `snslhvmkjusozgjelghi`, password `LbDemo!2026`):
- `ops@atlasfreight-demo.com` — Atlas Brokerage LLC (broker, MC 700100 screened pass, identity verified, agreement accepted, 2 loads live)
- `marcus@freightagents-demo.com` — Marcus Reed (broker agent, declared Atlas, waiting for code)
- `ops@acmemfg-demo.com` — Acme Manufacturing Co. (shipper, business confirmed, 1 shipment submitted)

How it runs: `portal.mjs` serves a local copy of `app/` (env-config → staging, supabaseUrl pointed at a local
`/sb/*` relay because Chromium cannot use the sandbox egress proxy; `@supabase/supabase-js` bundled locally with
esbuild; Manrope/Inter served from `@fontsource`). Run with
`NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node --use-env-proxy capture.mjs broker a|b`, `capture2.mjs shipper|agent`,
`capture3.mjs`, `wizard2.mjs`. Convert PNG → webp (quality 88, max 2400px wide) into `shots/`.
