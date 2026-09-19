-- STAGING FIRST. Patches each environment's own source; preserves production copy fixes.
DO $patch$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO STRICT src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='lc_identify';
  IF md5(src) NOT IN ('86e673dc215dbe040f215fcd1df0f859','ab257eff9c8ec496adbdafe6f7717d2e') THEN RAISE EXCEPTION 'Source drift: lc_identify'; END IF;
  src := replace(src, $old$where id = p_id and (visitor_key = p_visitor_key or (auth.uid() is not null and user_id = auth.uid()));$old$, $new$where id = p_id and ((user_id is not null and user_id = auth.uid())
      or (user_id is null and visitor_key = p_visitor_key
          and coalesce(length(p_visitor_key),0) between 16 and 64
          and p_visitor_key not like 'novkey%'));$new$);
  EXECUTE src;
END $patch$;

DO $patch$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO STRICT src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='lc_ob_doc_log';
  IF md5(src) NOT IN ('85938450a638e994e47f2e405a5ceec9') THEN RAISE EXCEPTION 'Source drift: lc_ob_doc_log'; END IF;
  src := replace(src, $old$  if p_visitor_key is null or length(p_visitor_key) < 8 then return jsonb_build_object('error','bad key'); end if;$old$, $new$  if coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'not authorized' using errcode='42501';
  end if;
  -- Trusted edge calls this only after caller-scoped preflight. Keep link integrity here too.
  if p_visitor_key is null or p_visitor_key !~ '^[A-Za-z0-9_-]{16,64}$' or p_visitor_key like 'novkey%' then
    return jsonb_build_object('error','bad key'); end if;
  if not exists(select 1 from app_private.lc_onboarding where visitor_key=p_visitor_key) then
    return jsonb_build_object('error','not found'); end if;
  if p_conversation_id is not null and not exists(select 1 from app_private.lc_conversations
      where id=p_conversation_id and visitor_key=p_visitor_key) then
    return jsonb_build_object('error','not found'); end if;$new$);
  EXECUTE src;
END $patch$;

DO $patch$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO STRICT src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='lc_chat_request_call';
  IF md5(src) NOT IN ('61ffb15ce0475c59a2eb178801488465') THEN RAISE EXCEPTION 'Source drift: lc_chat_request_call'; END IF;
  src := replace(src, $old$elsif v_conv.visitor_key is distinct from p_visitor_key then$old$, $new$elsif coalesce(length(p_visitor_key),0) not between 16 and 64 or p_visitor_key like 'novkey%' or v_conv.visitor_key is distinct from p_visitor_key then$new$);
  src := replace(src, $old$if v_role not in ('carrier','broker','shipper') then$old$, $new$if v_role is null or v_role not in ('carrier','broker','shipper') then$new$);
  EXECUTE src;
END $patch$;

DO $patch$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO STRICT src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='lc_request_call';
  IF md5(src) NOT IN ('b90eb1899a3056e162d96e59caad8b90','f64f0526f4264cb808ff0a5f82549be5') THEN RAISE EXCEPTION 'Source drift: lc_request_call'; END IF;
  src := replace(src, $old$coalesce(length(trim(p_visitor_key)),0) not between 16 and 64$old$, $new$coalesce(length(p_visitor_key),0) not between 16 and 64 or p_visitor_key like 'novkey%'$new$);
  src := replace(src, $old$if p_role not in ('carrier','broker','shipper') then$old$, $new$if p_role is null or p_role not in ('carrier','broker','shipper') then$new$);
  EXECUTE src;
END $patch$;

CREATE OR REPLACE FUNCTION public.lc_ob_upload_check(p_visitor_key text, p_conversation_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'app_private', 'public'
AS $body$
DECLARE o app_private.lc_onboarding;
BEGIN
  IF p_visitor_key IS NULL OR p_visitor_key !~ '^[A-Za-z0-9_-]{16,64}$' OR p_visitor_key LIKE 'novkey%' THEN
    RETURN jsonb_build_object('error','not authorized'); END IF;
  SELECT * INTO o FROM app_private.lc_onboarding WHERE visitor_key=p_visitor_key;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','not authorized'); END IF;
  IF coalesce(jsonb_array_length(o.docs),0)>=40 THEN RETURN jsonb_build_object('error','limit'); END IF;
  IF o.conversation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app_private.lc_conversations c
    WHERE c.id=o.conversation_id AND c.visitor_key=p_visitor_key AND (c.user_id IS NULL OR c.user_id=auth.uid())) THEN
    RETURN jsonb_build_object('error','not authorized'); END IF;
  IF p_conversation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app_private.lc_conversations c
    WHERE c.id=p_conversation_id AND c.visitor_key=p_visitor_key AND (c.user_id IS NULL OR c.user_id=auth.uid())) THEN
    RETURN jsonb_build_object('error','not authorized'); END IF;
  RETURN jsonb_build_object('ok',true);
END $body$;
REVOKE ALL ON FUNCTION public.lc_ob_upload_check(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lc_ob_upload_check(text,uuid) TO anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.lc_ob_doc_log(text,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lc_ob_doc_log(text,uuid,jsonb,text) TO service_role;
