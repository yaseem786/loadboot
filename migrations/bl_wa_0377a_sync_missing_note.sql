-- bl_wa_0377a - only complain about a template Telnyx USED to know.
-- Proven live 21 Sep 2026: a template created in Meta's WhatsApp Manager never appears in Telnyx's list, so the
-- blanket "Meta did not return this template" note would be stamped on the three original ones every single sync,
-- which is both noisy and wrong-headed (Meta has them; Telnyx's registry does not). Now the note is only written
-- for a template that HAS a Telnyx record id - i.e. one Telnyx listed before and has stopped listing, which is
-- the case actually worth flagging. Rows LoadBoot seeded by hand are left alone.
--
-- NOTE: this migration was first applied to staging ad hoc (no file). Recovered from the staging ledger and
-- written to disk on 21 Sep 2026 so production applies exactly the same statement.
create or replace function public.cc_wa_templates_sync(p_rows jsonb, p_partial boolean default false) returns jsonb
language plpgsql security definer set search_path = app_private, public as $fn$
declare r jsonb; v_name text; v_body text; v_status text; v_seen text[] := '{}'; n_new int := 0; n_upd int := 0;
  v_changed jsonb := '[]'::jsonb; v_old text;
begin
  if not app_private.disp_is_staff() then raise exception 'staff only'; end if;
  if jsonb_typeof(p_rows) <> 'array' then return jsonb_build_object('error','Nothing came back from Meta.'); end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_name := nullif(btrim(coalesce(r->>'name','')),'');
    if v_name is null then continue; end if;
    v_body := coalesce((select c->>'text' from jsonb_array_elements(case when jsonb_typeof(r->'components') = 'array'
                          then r->'components' else '[]'::jsonb end) c
                         where upper(coalesce(c->>'type','')) = 'BODY' limit 1), '');
    v_status := lower(coalesce(nullif(r->>'status',''), 'pending'));
    if v_status in ('in review','in_review','submitted') then v_status := 'pending'; end if;
    if v_status not in ('draft','pending','approved','rejected','paused','disabled','in_appeal','pending_deletion','deleted','limit_exceeded')
      then v_status := 'pending'; end if;
    v_seen := v_seen || v_name;
    select status into v_old from app_private.wa_templates where name = v_name;

    insert into app_private.wa_templates as w
      (name, category, language, body, variables, status, rejection_reason, components,
       meta_id, meta_template_id, synced_at, note)
    values (v_name, lower(coalesce(nullif(r->>'category',''),'utility')), coalesce(nullif(r->>'language',''),'en_US'),
       v_body, app_private.wa_tpl_vars(v_body), v_status, nullif(btrim(coalesce(r->>'rejection_reason','')),''),
       case when jsonb_typeof(r->'components') = 'array' then r->'components' else null end,
       nullif(r->>'id',''), nullif(r->>'template_id',''), now(), 'Read from Meta')
    on conflict (name) do update set
       category = excluded.category, language = excluded.language,
       body = case when excluded.body <> '' then excluded.body else w.body end,
       variables = case when excluded.body <> '' then excluded.variables else w.variables end,
       status = excluded.status, rejection_reason = excluded.rejection_reason,
       components = coalesce(excluded.components, w.components),
       meta_id = coalesce(excluded.meta_id, w.meta_id), meta_template_id = coalesce(excluded.meta_template_id, w.meta_template_id),
       synced_at = now(), note = 'Read from Meta', updated_at = now();

    if v_old is null then n_new := n_new + 1; else n_upd := n_upd + 1; end if;
    if v_old is distinct from v_status then
      v_changed := v_changed || jsonb_build_object('name', v_name, 'from', v_old, 'to', v_status);
    end if;
  end loop;

  -- a template TELNYX ONCE LISTED (it has a Telnyx record id) and has now stopped listing. Say so rather than
  -- silently keep calling it approved. A hand-seeded row Telnyx never knew about is not flagged - see the header.
  if not p_partial then
    update app_private.wa_templates set note = 'Telnyx stopped listing this template on ' || to_char(now(),'DD Mon YYYY'),
      synced_at = now(), updated_at = now()
     where status <> 'draft' and meta_id is not null and not (name = any(v_seen));
  end if;

  perform app_private.disp_audit('wa.templates_sync', 'wa_templates', null, null,
    'WhatsApp templates read from Meta (' || n_new || ' new, ' || n_upd || ' updated)',
    jsonb_build_object('new', n_new, 'updated', n_upd, 'changed', v_changed));

  return jsonb_build_object('ok', true, 'new', n_new, 'updated', n_upd, 'changed', v_changed,
    'templates', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'category', category, 'language', language,
        'body', body, 'variables', variables, 'var_labels', coalesce(var_labels,'[]'::jsonb), 'status', status,
        'rejection_reason', rejection_reason, 'note', note, 'synced_at', synced_at,
        'example_vars', coalesce(example_vars,'[]'::jsonb)) order by name)
      from app_private.wa_templates), '[]'::jsonb));
end $fn$;
