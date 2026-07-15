-- bl_pay_0098 — pay_request_reminder(kind, ref): carrier's gentle "🔔 Request payment" nudge
-- (before the 3-day dispute) → broker owner in-app + email, once per 24h per item, blocked if
-- already sent/received. Applied staging 2026-07-14; copy def from staging for PROD.

-- bl_pay_0099 (staging 2026-07-14): pay_mark_sent now notifies + emails the PAYEE the moment the
-- payer submits ("$X on the way — lands by DATE"). Copy def from staging for PROD.

-- bl_pay_0100 (staging 2026-07-14): pay_due_items rows now carry pay_by (deadline) =
-- due_since + carrier's factoring terms_days_broker (default net-30); platform_fee uses invoice due_at.
-- Also receipt_path now included on transfer join (payee can view the payer's receipt).
-- Copy def from staging for PROD.
