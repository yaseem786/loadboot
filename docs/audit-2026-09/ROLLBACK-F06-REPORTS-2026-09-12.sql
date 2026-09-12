-- Only for a promotion where BOTH reports and opened_at were absent beforehand.
-- Wrap in BEGIN/COMMIT after explicit approval. Refuses drift and engagement-data loss.
DO $rollback$
BEGIN
 IF md5(pg_get_functiondef('public.cc_outreach_audience(integer)'::regprocedure)) <> 'ec52b049ffac878ad22571d8e46bc41c' OR
    md5(pg_get_functiondef('public.cc_outreach_log_page(text,text,integer,text,integer,integer)'::regprocedure)) <> 'e7c8099698133d28de3c9c8601a777a2' THEN
   RAISE EXCEPTION 'Report definitions changed; refuse rollback';
 END IF;
 IF EXISTS(SELECT 1 FROM app_private.outreach_contacts WHERE opened_at IS NOT NULL) THEN
   RAISE EXCEPTION 'New engagement data exists; preserve opened_at and review rollback';
 END IF;
END $rollback$;
DROP FUNCTION public.cc_outreach_audience(integer);
DROP FUNCTION public.cc_outreach_log_page(text,text,integer,text,integer,integer);
ALTER TABLE app_private.outreach_contacts DROP COLUMN opened_at;

