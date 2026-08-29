-- bl_disp_0298 — dispatcher Packet tab: WHITELIST document types.
-- Found 29 Aug on prod: the Packet tab listed every approved document, which for Warren's Courier included
-- the voided check (type bank_check). A dispatcher must never hold the carrier's bank details — brokers who
-- need pay instructions get the NOA (factored carriers) or are sent to LoadBoot. Broker setup needs exactly:
-- authority (MC certificate / SAFER), insurance (COI), w9, noa. Everything else (bank_check, rate_con, bol,
-- other, id documents) stays out of the dispatcher feed. Storage policy doc_read_assigned_dispatcher is
-- tightened the same way so a guessed path cannot be signed either. Staging first, then prod.
do $$
declare src text;
begin
  src := pg_get_functiondef('public.dispatcher_workspace_feed()'::regprocedure);
  if position('where dc.status = ''approved''' in src) = 0 then raise exception 'expected clause not found in dispatcher_workspace_feed'; end if;
  src := replace(src, 'where dc.status = ''approved''', 'where dc.status = ''approved'' and dc.type in (''authority'',''insurance'',''w9'',''noa'')');
  execute src;
end $$;

-- storage: the assigned-dispatcher read policy (bl_disp_0288) — restrict to the same four folders
do $$
declare pol record;
begin
  select * into pol from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'doc_read_assigned_dispatcher';
  if pol.policyname is not null then
    execute 'drop policy doc_read_assigned_dispatcher on storage.objects';
    execute 'create policy doc_read_assigned_dispatcher on storage.objects for select to authenticated using (' ||
      'bucket_id = ''documents'' and (storage.foldername(name))[2] in (''authority'',''insurance'',''w9'',''noa'') and (' || pol.qual || '))';
  end if;
end $$;
