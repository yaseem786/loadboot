-- ENTERPRISE COMPLETION WAVE 4 — FINANCE DEPTH.
-- Invoice/settlement adjustments (advance/deduction/accessorial/quick-pay), disputes (open ->
-- resolve, finance.approve), accounting/CSV export, and carrier statements. RBAC-gated, audited.
-- Applied to STAGING + PRODUCTION as ledger name ec4_finance_depth_0001.
create table if not exists app_private.fin_adjustments (id uuid primary key default gen_random_uuid(), invoice_id uuid references app_private.fin_invoices(id) on delete cascade, settlement_id uuid references app_private.fin_settlements(id) on delete cascade, kind text not null check (kind in ('advance','deduction','accessorial','quickpay_fee','credit','other')), amount numeric not null default 0, note text, created_by uuid, created_at timestamptz not null default now());
create index if not exists fin_adjustments_inv_idx on app_private.fin_adjustments(invoice_id);
create table if not exists app_private.fin_disputes (id uuid primary key default gen_random_uuid(), invoice_id uuid not null references app_private.fin_invoices(id) on delete cascade, reason text not null, status text not null default 'open' check (status in ('open','resolved','rejected')), resolution text, created_by uuid, created_at timestamptz not null default now(), resolved_at timestamptz, resolved_by uuid);
alter table app_private.fin_adjustments enable row level security; alter table app_private.fin_disputes enable row level security;
revoke all on all tables in schema app_private from public, anon, authenticated;
-- RPCs: cc_add_adjustment / cc_open_dispute / cc_resolve_dispute / cc_export_finance / cc_carrier_statement
-- (full bodies as applied; see session record / production schema).
