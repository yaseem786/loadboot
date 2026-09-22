-- bl_wa_0396 — three things, all additive and reversible.
--
-- 1. A MARKETING template must never reach a dispatcher.
--    Meta re-categorised `dispatcher_assigned` from utility to marketing on 21 Sep 2026. It is still
--    "approved", so wa_inbox kept offering it and wa_send_prepare would have let it go out. Two problems
--    with that: marketing templates are ALWAYS charged (utility ones are free inside the 24-hour customer
--    service window), and Meta's US marketing pause means it would most likely not be delivered to a US
--    carrier anyway. So it is removed from the list the dispatcher sees, and the send path refuses it
--    outright — the list is a convenience, the refusal is the rule.
--
-- 2. `callback_request` can never be synced, and this records why.
--    Every other template carries a meta_id and a synced_at, because it was submitted through Command
--    Center and therefore Telnyx owns the record. callback_request has neither: it was created directly in
--    Meta's WhatsApp Manager on 20 Sep 2026. cc_wa_templates_sync reads Telnyx's list, and Telnyx does not
--    list templates it did not create — the edge function says exactly this in its own refusal text. So no
--    amount of pressing "Sync from Meta" will ever mark it approved.
--    Meta does not allow a deleted template's name to be reused for 30 days, so the replacement is a NEW
--    name, `callback_request_v2`, seeded here as a draft with example values ready. Command Center's Submit
--    button sends it through Telnyx; from then on it syncs like the others. The old row is disabled rather
--    than deleted so the history stays readable.
--
-- 3. The dispatcher sees the message, not just the name (frontend; no SQL needed beyond the category).
--    wa_inbox now returns each template's category alongside its body so the picker can show what will
--    actually be sent and label it honestly.
--
-- Nothing here touches wa_threads, wa_messages, any log, or a single delivered message.

begin;

-- ---------------------------------------------------------------- 1. hide, then refuse
do $mig$
declare src text; out_src text;
begin
  -- wa_inbox: drop marketing from the offered list, and carry the category through
  src := pg_get_functiondef('public.wa_inbox()'::regprocedure);
  out_src := replace(src,
    'from app_private.wa_templates where status = ''approved'')',
    'from app_private.wa_templates where status = ''approved'' and coalesce(category,'''') <> ''marketing'')');
  if out_src = src then raise exception 'bl_wa_0396: wa_inbox approved-template filter not found'; end if;
  src := out_src;
  out_src := replace(src,
    '''var_labels'', coalesce(var_labels,''[]''::jsonb), ''language'', language) order by name)',
    '''var_labels'', coalesce(var_labels,''[]''::jsonb), ''language'', language, ''category'', category) order by name)');
  if out_src = src then raise exception 'bl_wa_0396: wa_inbox template payload shape not found'; end if;
  execute out_src;

  -- wa_send_prepare: a marketing template is refused whoever asks and however they ask
  src := pg_get_functiondef('public.wa_send_prepare(jsonb)'::regprocedure);
  out_src := replace(src,
    'return jsonb_build_object(''ok'', false, ''error'',''That template is '' || tpl.status || '' at Meta - it cannot be sent yet.''); end if;',
    'return jsonb_build_object(''ok'', false, ''error'',''That template is '' || tpl.status || '' at Meta - it cannot be sent yet.''); end if;'
    || E'\n    if coalesce(tpl.category,'''') = ''marketing'' then'
    || E'\n      return jsonb_build_object(''ok'', false, ''error'','
    || E'\n        ''Meta classes this template as marketing, so LoadBoot does not send it from here. Use a utility template, or call them.''); end if;');
  if out_src = src then raise exception 'bl_wa_0396: wa_send_prepare status guard not found'; end if;
  execute out_src;
end
$mig$;

-- ---------------------------------------------------------------- 2. callback_request → v2
update app_private.wa_templates
   set status = 'disabled',
       note = 'Created directly in Meta WhatsApp Manager on 20 Sep 2026, so Telnyx never lists it and Sync '
              || 'from Meta can never reach it. Replaced by callback_request_v2 (bl_wa_0396, 22 Sep 2026). '
              || 'Meta blocks reuse of a deleted template name for 30 days, hence the new name.',
       updated_at = now()
 where name = 'callback_request' and meta_id is null;

insert into app_private.wa_templates
  (name, category, language, body, variables, var_labels, status, note, example_vars, updated_at)
select 'callback_request_v2', 'utility', 'en_US', t.body, t.variables, t.var_labels, 'draft',
       'Draft of callback_request under a name Telnyx can own (bl_wa_0396). Press Submit in Command Center.',
       '["Chris","Dana","LB-10482","+1 815 365 1168"]'::jsonb, now()
  from app_private.wa_templates t
 where t.name = 'callback_request'
on conflict (name) do nothing;

commit;
