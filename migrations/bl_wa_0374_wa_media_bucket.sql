-- bl_wa_0374 — the private bucket that outgoing WhatsApp attachments pass through.
-- Telnyx has to FETCH a file to send it, so an attachment cannot go straight from the browser to WhatsApp: it is
-- uploaded here first, and the edge function hands Telnyx a short-lived signed link. The bucket is PRIVATE —
-- a carrier's rate confirmation is never a public URL.
-- 16 MB cap: comfortably inside Meta's media limits for images, audio and video (documents may be larger at Meta,
-- but a dispatch document that big is a mistake, not a message).
insert into storage.buckets (id, name, public, file_size_limit)
values ('wa-media', 'wa-media', false, 16777216)
on conflict (id) do update set public = false, file_size_limit = 16777216;

drop policy if exists "wa media insert" on storage.objects;
create policy "wa media insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'wa-media' and app_private.wa_actor(auth.uid()) is not null);

drop policy if exists "wa media read" on storage.objects;
create policy "wa media read" on storage.objects for select to authenticated
  using (bucket_id = 'wa-media' and app_private.wa_actor(auth.uid()) is not null);

drop policy if exists "wa media staff write" on storage.objects;
create policy "wa media staff write" on storage.objects for update to authenticated
  using (bucket_id = 'wa-media' and app_private.disp_is_staff()) with check (bucket_id = 'wa-media');
drop policy if exists "wa media staff delete" on storage.objects;
create policy "wa media staff delete" on storage.objects for delete to authenticated
  using (bucket_id = 'wa-media' and app_private.disp_is_staff());
