-- bl_cc_0134 — Dispatch Service Agreement is a core requirement, not optional.
-- Was mandatory=false (showed "Optional" in the carrier compliance list). Flipping to
-- mandatory so it counts toward the "all mandatory valid" approval gate.
-- Safe: a signed/uploaded dispatch agreement creates a carrier_compliance row that reaches
-- 'pending' and is verified by staff -> 'valid', so approvals gate on it but are never
-- permanently blocked. Existing already-approved carriers keep their approval (the decision
-- already ran); this tightens FUTURE approvals only.
-- Applied to STAGING (snslhvmkjusozgjelghi). PROD after owner confirmation.
update app_private.compliance_requirements set mandatory = true where key = 'dispatch_agreement';
