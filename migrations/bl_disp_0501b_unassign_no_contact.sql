-- bl_disp_0501b — ending an assignment (29 Sep 2026, Yaseen)
-- 1) Dispatcher "assignment ended" e-mail: an explicit red "No further contact" box (no call / text / WhatsApp /
--    e-mail to the carrier, owner or driver) + for a trial dispatcher left with no carrier, a "Your next step" box
--    (choose your next carrier; trial dates adjusted). Plain-text part says the same.
-- 2) Carrier "change to your dispatcher" e-mail is NOT sent while the carrier is held from dispatchers (bl_disp_0501):
--    that e-mail promises a new dispatcher within N business days, which a held carrier will not get.
-- Both functions are patched in place and the patch refuses loudly if an anchor is missing or not unique.
do $mig$
declare d text; d2 text; a1 text; a2 text; a3 text;
begin
  -- (1) dispatcher e-mail
  d := pg_get_functiondef('app_private.disp_unassign_email(uuid,text,text)'::regprocedure);
  if position('No further contact with' in d) = 0 then
    a1 := $x$    || app_private.disp_btn('Open my workspace', 'https://loadboot.com/app/agent/#dashboard')$x$;
    a2 := $x$Do not contact this carrier, its driver or any broker about this account from now on.$x$;
    if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 or (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 then
      raise exception 'bl_disp_0501b: disp_unassign_email anchors changed — not patched';
    end if;
    d2 := replace(d, a1, $x$    || case when not v_paused then app_private.disp_box('No further contact with ' || app_private.disp_esc(coalesce(v_cname,'this carrier')),
         'Do <b>not</b> call, text, WhatsApp or e-mail <b>' || app_private.disp_esc(coalesce(v_cname,'this carrier')) || '</b>, its owner or its driver from now on &mdash; not from your LoadBoot line and not from any personal number or account. '
      || 'If they contact you, reply only <i>&ldquo;Please contact LoadBoot directly&rdquo;</i> and tell LoadBoot the same day. The contact rule you accepted still applies after an assignment ends.', 'stop') else '' end
    || case when not v_paused and d.status = 'trial' and coalesce(v_keep_n,0) = 0 then app_private.disp_box('Your next step',
         'Open <b>Choose your carrier</b> in your workspace and pick your next carrier. LoadBoot reviews it quickly, and your trial dates are adjusted so the days without a carrier do not count against you.', 'ok') else '' end
$x$ || a1);
    d2 := replace(d2, a2, $x$Do not call, text, WhatsApp or e-mail this carrier, its owner or its driver from now on - not from your LoadBoot line and not from any personal number. If they contact you, reply only "Please contact LoadBoot directly" and tell LoadBoot the same day.$x$);
    execute d2;
  end if;

  -- (2) carrier e-mail: skip while held
  d := pg_get_functiondef('app_private.disp_carrier_change_email(uuid,text)'::regprocedure);
  if position('disp_carrier_held' in d) = 0 then
    a3 := $x$if a.id is null then return; end if;$x$;
    if (length(d) - length(replace(d, a3, ''))) / length(a3) <> 1 then
      raise exception 'bl_disp_0501b: disp_carrier_change_email anchor changed — not patched';
    end if;
    execute replace(d, a3, a3 || $x$ if app_private.disp_carrier_held(a.carrier_org_id) then return; end if;   -- bl_disp_0501b$x$);
  end if;
end $mig$;
