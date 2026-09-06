-- bl_cmp_0325b — cc_list_documents returns ai_verdict so the CC Document queue can show the AI pre-check (audit F31 step 5)
-- 2026-09-05 · Claude. Return type changes → DROP + CREATE; grants re-applied exactly as before
-- (postgres, authenticated, service_role — verified identical on prod and staging, body md5 4839e34b…).
-- Sort: pending queue shows AI-rejected documents first, then newest.
drop function if exists public.cc_list_documents(text, integer);
CREATE FUNCTION public.cc_list_documents(p_status text DEFAULT 'pending', p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, carrier_id uuid, company text, type text, file_name text, file_path text, status text,
               created_at timestamptz, ai_verdict jsonb)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'app_private, public'
AS $function$
declare v_limit int := least(greatest(coalesce(p_limit,100),1),500);
begin
  if not public.has_global_permission('documents.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query
    select d.id, d.carrier_id, pr.company, d.type, d.file_name, d.file_path, d.status, d.created_at, d.ai_verdict
      from public.documents d join public.profiles pr on pr.id = d.carrier_id
     where (p_status is null or d.status = p_status)
     order by case when d.status = 'pending' and d.ai_verdict->>'verdict' = 'reject' then 0
                   when d.status = 'pending' and d.ai_verdict->>'verdict' = 'warning' then 1 else 2 end,
              d.created_at desc
     limit v_limit;
end;
$function$;
revoke all on function public.cc_list_documents(text, integer) from public, anon;
grant execute on function public.cc_list_documents(text, integer) to authenticated, service_role;
