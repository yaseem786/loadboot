-- bl_doc_0570 — block duplicate document uploads
-- Same carrier + same document type + byte-identical file (storage eTag + size) that is
-- still pending or approved → the insert is refused with a plain-language message.
-- Covers the carrier portal (carrierUploadDocument shows error.message) and staff uploads.
-- Rejected / superseded files can be re-uploaded (a corrected re-submission is fine).

create or replace function app_private.tg_document_dedupe()
returns trigger language plpgsql security definer
set search_path = public, app_private, storage, pg_temp as $$
declare v_etag text; v_size text; d record;
begin
  if new.file_path is null or new.carrier_id is null then return new; end if;
  select o.metadata->>'eTag', o.metadata->>'size' into v_etag, v_size
    from storage.objects o where o.bucket_id = 'documents' and o.name = new.file_path limit 1;
  if v_etag is null or v_size is null then return new; end if;

  select x.file_name, x.status, x.created_at into d
    from public.documents x
    join storage.objects o on o.bucket_id = 'documents' and o.name = x.file_path
   where x.carrier_id = new.carrier_id
     and x.type = new.type
     and x.status in ('pending','approved')
     and x.file_path <> new.file_path
     and o.metadata->>'eTag' = v_etag
     and o.metadata->>'size' = v_size
   order by x.created_at desc limit 1;

  if found then
    raise exception using errcode = 'P0001',
      message = format('Duplicate file — you already uploaded this exact file ("%s") on %s and it is %s. No need to upload it again; if you meant to send a different document, please choose that file.',
                       d.file_name, to_char(d.created_at at time zone 'America/New_York', 'Mon DD, YYYY'),
                       case d.status when 'approved' then 'already approved' else 'waiting for review' end);
  end if;
  return new;
end $$;

drop trigger if exists trg_zz_document_dedupe on public.documents;
-- "zz" so it fires after trg_protect_document_insert has set carrier_id = auth.uid()
create trigger trg_zz_document_dedupe before insert on public.documents
  for each row execute function app_private.tg_document_dedupe();
