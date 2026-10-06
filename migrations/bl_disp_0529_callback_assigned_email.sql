-- bl_disp_0529 — catalog row for "a callback was assigned to you" (dispatcher).
--
-- 7 Oct 2026: Riley's needs-human callback for an inbound carrier (Phil, hotshot, no MC yet) sat unassigned on the
-- Riley screen; the owner assigned it to a trial dispatcher by hand and asked for an e-mail telling them to call
-- today. There was no catalog key for that notice, so it gets one here before the first send (CLAUDE.md §6).
-- Fired through app_private.disp_notify(p_email => true) → sys_email; one per assignment.

insert into app_private.email_catalog (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note,
                                       stop_condition, preference_group, unsub_allowed, cc_deep_link, status, send_mode, discovered_in, owner_note)
values ('dispatcher.callback.assigned', 'Callback assigned to you',
        'Tells a dispatcher that staff assigned them a callback (usually a caller Riley promised a person to): who to call, why, what to ask, what not to promise, and to mark the callback done with notes. The same text is on the callback in their dialer.',
        'T', 'dispatcher', 'manual', 'app_private.disp_notify (staff assigns a dialer_callbacks row)', 'on each assignment',
        'one per callback assignment', 'callback done or reassigned', 'account_critical', false, '#/riley', 'live', 'live', '{migration}', 'bl_disp_0529')
on conflict (key) do nothing;
