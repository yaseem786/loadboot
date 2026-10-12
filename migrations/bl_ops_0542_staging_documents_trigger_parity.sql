-- bl_ops_0542 — STAGING ONLY: make public.documents triggers match prod (found 12 Oct while doing bl_onb_0541)
-- Project: snslhvmkjusozgjelghi. Prod already has exactly this shape — do NOT run on prod.
--
-- Drift found:
--   * staging was MISSING trg_document_change (→ refresh_carrier_status) and trg_protect_document_insert (non-admin
--     inserts forced to own carrier_id + 'pending' + own storage folder). Both functions already existed on staging
--     with prod's logic; only the triggers were absent, so staging tests skipped the activation path and the
--     insert guard.
--   * staging HAD trg_document_upload_notify_t → app_private.trg_document_upload_notify ('document.uploaded', catalogued
--     as the legacy upload trigger). Prod does not have it: the staff alert is tg_document_submitted
--     ('document.submitted'), which staging also has — so staging sent staff two alerts per upload.
--     Disabled (not dropped: reversible, and the MCP hangs on drop-trigger text).

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_document_change'
                  and tgrelid = 'public.documents'::regclass) then
    create trigger trg_document_change
      after insert or update or delete on public.documents
      for each row execute function public.on_document_change();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_protect_document_insert'
                  and tgrelid = 'public.documents'::regclass) then
    create trigger trg_protect_document_insert
      before insert on public.documents
      for each row execute function public.protect_document_insert();
  end if;
  if exists (select 1 from pg_trigger where tgname = 'trg_document_upload_notify_t'
              and tgrelid = 'public.documents'::regclass and tgenabled <> 'D') then
    alter table public.documents disable trigger trg_document_upload_notify_t;
  end if;
end $$;
