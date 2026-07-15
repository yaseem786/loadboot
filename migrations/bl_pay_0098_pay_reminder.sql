-- bl_pay_0098 — pay_request_reminder(kind, ref): carrier's gentle "🔔 Request payment" nudge
-- (before the 3-day dispute) → broker owner in-app + email, once per 24h per item, blocked if
-- already sent/received. Applied staging 2026-07-14; copy def from staging for PROD.

-- bl_pay_0099 (staging 2026-07-14): pay_mark_sent now notifies + emails the PAYEE the moment the
-- payer submits ("$X on the way — lands by DATE"). Copy def from staging for PROD.
