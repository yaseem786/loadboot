-- bl_wa_0489 — "Hide from dispatchers" for WhatsApp templates: one click in Command Center takes an approved
-- template out of every dispatcher's picker, one click puts it back. Staff still see and can send it.
--
-- WHY: the owner wants control over which approved templates dispatchers may send (same idea as bl_wa_0487,
-- which hides a single message). Meta's approval says a template CAN go out; this says who at LoadBoot may send it.
--
-- WHAT CHANGES:
--   · wa_templates gets hidden_from_dispatcher / hidden_at / hidden_by.
--   · wa_inbox          — a dispatcher's template list leaves hidden templates out (staff still get them all).
--   · wa_send_prepare   — the server refuses a hidden template from a dispatcher, so a stale screen or a
--                         hand-made request cannot send it either. Fail-closed: only 'staff' passes.
--   · cc_wa_overview    — the CC template rows carry 'hidden' / 'hidden_at' so the toggle shows its state.
--   · NEW public.cc_wa_template_hide(p_name text, p_hidden boolean) — staff only; authenticated only (never anon).
--
-- Existing functions are patched by ANCHOR on their live definition (pg_get_functiondef + one replace), and
-- each anchor is asserted, so staging and prod keep whatever else they carry.

alter table app_private.wa_templates
  add column if not exists hidden_from_dispatcher boolean not null default false,
  add column if not exists hidden_at timestamptz,
  add column if not exists hidden_by uuid;

do $mig$
declare d text; n text;
begin
  -- 1. wa_inbox: dispatchers do not get hidden templates
  d := pg_get_functiondef('public.wa_inbox()'::regprocedure);
  n := replace(d, $a$where status = 'approved' and coalesce(category,'') <> 'marketing')$a$,
                  $a$where status = 'approved' and coalesce(category,'') <> 'marketing' and (v_role = 'staff' or not hidden_from_dispatcher))$a$);
  if n = d then raise exception 'bl_wa_0489: wa_inbox anchor not found'; end if;
  execute n;

  -- 2. wa_send_prepare: the server refuses a hidden template from anyone who is not staff
  d := pg_get_functiondef('public.wa_send_prepare(jsonb)'::regprocedure);
  n := replace(d, $a$if tpl.name is null then return jsonb_build_object('ok', false, 'error','That template does not exist.'); end if;$a$,
                  $a$if tpl.name is null then return jsonb_build_object('ok', false, 'error','That template does not exist.'); end if;
    if v_role <> 'staff' and tpl.hidden_from_dispatcher then
      return jsonb_build_object('ok', false, 'error','Command Center has switched this template off for dispatchers. Pick another template, or call them.'); end if;$a$);
  if n = d then raise exception 'bl_wa_0489: wa_send_prepare anchor not found'; end if;
  execute n;

  -- 3. cc_wa_overview: staff see which templates are hidden
  d := pg_get_functiondef('public.cc_wa_overview(jsonb)'::regprocedure);
  n := replace(d, $a$'status', status, 'note', note) order by name)$a$,
                  $a$'status', status, 'note', note, 'hidden', coalesce(hidden_from_dispatcher, false), 'hidden_at', hidden_at) order by name)$a$);
  if n = d then raise exception 'bl_wa_0489: cc_wa_overview anchor not found'; end if;
  execute n;
end $mig$;

create or replace function public.cc_wa_template_hide(p_name text, p_hidden boolean default true) returns jsonb
language plpgsql security definer set search_path = app_private, public, pg_temp as $$
declare w app_private.wa_templates; v_on boolean := coalesce(p_hidden, true);
begin
  if not app_private.disp_is_staff() then raise exception 'staff only'; end if;
  update app_private.wa_templates
     set hidden_from_dispatcher = v_on,
         hidden_at = case when v_on then now() end,
         hidden_by = case when v_on then auth.uid() end
   where name = p_name returning * into w;
  if w.name is null then return jsonb_build_object('error', 'That template does not exist.'); end if;
  return jsonb_build_object('ok', true, 'name', w.name, 'hidden', w.hidden_from_dispatcher);
end $$;
revoke all on function public.cc_wa_template_hide(text, boolean) from public, anon;
grant execute on function public.cc_wa_template_hide(text, boolean) to authenticated;
