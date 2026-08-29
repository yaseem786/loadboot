-- bl_disp_0296 — dispatcher_log_booking: SOP min_rate is free text in the CC assign form ("$1.50/mi,
-- ~200 mi radius…"), but the rate-floor lookup cast it straight to numeric → 22P02 and the whole
-- Log-booking form failed for any truck without its own min_rpm. Found 28 Aug on staging while seeding
-- the test dispatcher. Read a number out of the SOP only when it IS a number (optionally "$1.50" or
-- "$1.50/mi"); otherwise fall through to the owner profile floor. Rewrites the one expression in place.
-- Staging first, then prod. Data fix alongside: SOPs on prod/staging now carry min_rate (numeric) +
-- min_rate_note (text) separately.
do $$
declare src text;
begin
  src := pg_get_functiondef('public.dispatcher_log_booking(jsonb)'::regprocedure);
  if position('(a.sop->>''min_rate'')::numeric' in src) = 0 then raise exception 'expected expression not found'; end if;
  src := replace(src, '(a.sop->>''min_rate'')::numeric',
    'nullif(substring(a.sop->>''min_rate'' from ''^\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:/\s*mi(?:le)?)?\s*$''), '''')::numeric');
  execute src;
end $$;
