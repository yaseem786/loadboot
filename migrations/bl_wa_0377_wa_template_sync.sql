-- bl_wa_0377 - LoadBoot stops guessing what Meta thinks of its templates and asks.
--
-- THE PROBLEM
--   bl_wa_0367 seeded the three Utility templates by hand with status 'pending', and cc_wa_template_set let a
--   staff member FLIP that status by hand. So the portal's idea of "approved" was only ever somebody's memory of
--   a Meta screen. Send on a template Meta has actually rejected and the message fails at Telnyx, after the
--   dispatcher has already typed it.
--
-- THE FIX
--   Telnyx is the account that owns the WABA, so Telnyx can be asked. GET /v2/whatsapp/message_templates
--   ?filter[waba_id]=... returns every template with its REAL status and, when Meta refused it, the reason.
--   The `telnyx-wa-templates` edge function fetches that list and hands it to cc_wa_templates_sync() below,
--   which writes it into app_private.wa_templates. One button in Command Center, no more hand-flipping.
--   cc_wa_template_set stays exactly as it was - it is still the manual override when something is odd.
--
-- WHAT IS KEPT AND WHAT IS OVERWRITTEN
--   Meta owns: status, category, language, body, rejection_reason, the raw components, the ids.
--   LoadBoot owns: var_labels (the plain-English labels the dispatcher sees above each box - Meta has no such
--   thing) and example_vars. Those survive a sync; everything else is replaced by what Meta says.
--
-- STATUSES
--   Meta really returns APPROVED, PENDING, IN_APPEAL, REJECTED, PENDING_DELETION, DELETED, DISABLED, PAUSED,
--   LIMIT_EXCEEDED. The old CHECK allowed four of them, so a sync would have failed on the rest. Widened below.
--   Only 'approved' is ever offered to a dispatcher (wa_inbox filters on it) - that is unchanged.
--
-- ALSO HERE: the fourth template, dispatcher_assigned, seeded as a DRAFT (status 'draft', never offered to
--   anyone) because the three existing ones all need a load id, so none of them can be used to say hello to a
--   carrier who has just been handed to a dispatcher. Submitting it to Meta is a button in Command Center.
-- Rollback: the new columns are additive; drop the two new functions and restore the old CHECK.

-- ---------------------------------------------------------------- table
alter table app_private.wa_templates add column if not exists meta_id           text;   -- Telnyx's record id
alter table app_private.wa_templates add column if not exists meta_template_id  text;   -- Meta's own template id
alter table app_private.wa_templates add column if not exists rejection_reason  text;
alter table app_private.wa_templates add column if not exists components        jsonb;  -- Meta's raw components
alter table app_private.wa_templates add column if not exists example_vars      jsonb;  -- sample values for Meta
alter table app_private.wa_templates add column if not exists synced_at         timestamptz;

alter table app_private.wa_templates drop constraint if exists wa_templates_status_check;
alter table app_private.wa_templates add  constraint wa_templates_status_check check (status in
  ('draft','pending','approved','rejected','paused','disabled','in_appeal','pending_deletion','deleted','limit_exceeded'));

-- ---------------------------------------------------------------- helper: how many {{n}} does a body use
create or replace function app_private.wa_tpl_vars(p_body text) returns int
language sql immutable as $$
  select coalesce(max((m[1])::int), 0)
    from regexp_matches(coalesce(p_body,''), '\{\{\s*([0-9]+)\s*\}\}', 'g') m
$$;

-- ---------------------------------------------------------------- what the edge function needs before it calls Telnyx
create or replace function public.cc_wa_templates_prep(p_name text default null) returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $$
declare cfg app_private.dialer_config; t app_private.wa_templates;
begin
  if not app_private.disp_is_staff() then raise exception 'staff only'; end if;
  select * into cfg from app_private.dialer_config where id = 1;
  if coalesce(cfg.wa_waba_id,'') = '' then
    return jsonb_build_object('error','No WhatsApp Business Account id is saved yet - put the WABA id in The line first.'); end if;
  if p_name is null then return jsonb_build_object('ok', true, 'waba_id', cfg.wa_waba_id); end if;
  select * into t from app_private.wa_templates where name = p_name;
  if t.name is null then return jsonb_build_object('error','No such template.'); end if;
  if t.status <> 'draft' then
    return jsonb_build_object('error', 'That template is already at Meta (' || t.status || ').'); end if;
  if coalesce(btrim(t.body),'') = '' then return jsonb_build_object('error','That template has no body text.'); end if;
  return jsonb_build_object('ok', true, 'waba_id', cfg.wa_waba_id,
    'template', jsonb_build_object('name', t.name, 'category', upper(t.category), 'language', t.language,
      'body', t.body, 'variables', t.variables,
      'example_vars', coalesce(t.example_vars, '[]'::jsonb)));
end $$;

-- ---------------------------------------------------------------- write Meta's answer in
-- p_rows is the `data` array from Telnyx, unchanged. Anything LoadBoot does not recognise is ignored, never guessed.
create or replace function public.cc_wa_templates_sync(p_rows jsonb, p_partial boolean default false) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare r jsonb; v_name text; v_body text; v_status text; v_seen text[] := '{}'; n_new int := 0; n_upd int := 0;
  v_changed jsonb := '[]'::jsonb; v_old text;
begin
  if not app_private.disp_is_staff() then raise exception 'staff only'; end if;
  if jsonb_typeof(p_rows) <> 'array' then return jsonb_build_object('error','Nothing came back from Meta.'); end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_name := nullif(btrim(coalesce(r->>'name','')),'');
    if v_name is null then continue; end if;
    -- the BODY component holds the text a dispatcher actually sends
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
       -- var_labels and example_vars are LoadBoot's and are deliberately untouched

    if v_old is null then n_new := n_new + 1; else n_upd := n_upd + 1; end if;
    if v_old is distinct from v_status then
      v_changed := v_changed || jsonb_build_object('name', v_name, 'from', v_old, 'to', v_status);
    end if;
  end loop;

  -- bl_wa_0377a (21 Sep 2026, after the first live run): a template TELNYX ONCE LISTED (it has a Telnyx record
  -- id) and has now stopped listing. Say so rather than silently keep calling it approved. A row LoadBoot seeded
  -- by hand, for a template created in Meta's own WhatsApp Manager, is NOT flagged - Telnyx never listed those
  -- and never will, so the flag would fire on every sync and mean nothing. Drafts are left alone too.
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
end $$;

-- ---------------------------------------------------------------- the fourth template, as a draft
-- The three live ones all need a load id, so none of them can open a conversation with a carrier who has just
-- been handed to a dispatcher and has never written to LoadBoot's WhatsApp number. This one can. It says who is
-- writing, which company he is dispatching for, and why the message arrived - which is what Meta looks for in a
-- Utility template. Nothing may be sent on it until Meta approves it; that is enforced by wa_send_prepare.
insert into app_private.wa_templates (name, category, language, body, variables, var_labels, example_vars, status, note)
values ('dispatcher_assigned','utility','en_US',
  'Hi {{1}}, this is {{2}} from LoadBoot Dispatch. I have been assigned as the dispatcher for {{3}}, and this number is where you can reach me about your loads, your truck and your paperwork. Reply here whenever you need me.',
  3, '["Contact first name","Dispatcher name","Carrier company name"]'::jsonb,
  '["Ali","Hamza Khan","Sunrise Carriers LLC"]'::jsonb,
  'draft', 'Drafted 21 Sep 2026 - not submitted to Meta yet')
on conflict (name) do nothing;

-- ---------------------------------------------------------------- grants
revoke all on function public.cc_wa_templates_prep(text) from public, anon;
revoke all on function public.cc_wa_templates_sync(jsonb, boolean) from public, anon;
grant execute on function public.cc_wa_templates_prep(text) to authenticated;
grant execute on function public.cc_wa_templates_sync(jsonb, boolean) to authenticated;
