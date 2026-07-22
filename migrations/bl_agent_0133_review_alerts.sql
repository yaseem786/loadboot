-- bl_agent_0133 — CC visibility for agent submit + document RE-submission.
-- Gap 1: agent onboarding/doc events never emailed hello@loadboot.com (only website
--        forms did, via bl_cc_0118). The owner asked for the same owner-email channel.
-- Gap 2: a corrected-document re-upload saved without p_submit, so NO staff
--        notification was created and the CC never learned the doc was back for review
--        (latest agent.review_requested predated the resubmit).
-- Fix: AFTER trigger on app_private.agent_profiles.
--   * On a fresh submit (status -> under_review): the existing agent_save_onboarding
--     already inserts the staff in-app; here we only ADD the hello@loadboot.com email.
--   * On a document path change while not draft (a re-upload): insert a staff in-app
--     notification (cc_my_notifications returns recipient_role='staff' for active staff
--     regardless of status) AND email hello@loadboot.com.
-- Everything is wrapped so it can never block/rollback an agent's save. Email is
-- idempotent per user+reason+minute. Additive & reversible (drop trigger + function).

create or replace function app_private.agent_profiles_review_alert()
returns trigger
language plpgsql
security definer
set search_path to 'app_private, public'
as $$
declare
  v_email text; v_name text; v_kind text; v_title text; v_reason_tag text;
  new_id   text := NEW.payout_details->>'id_doc';
  new_bank text := NEW.payout_details->>'bank_doc';
  old_id   text := case when TG_OP='UPDATE' then OLD.payout_details->>'id_doc'   else null end;
  old_bank text := case when TG_OP='UPDATE' then OLD.payout_details->>'bank_doc' else null end;
  submitted  boolean := (NEW.status='under_review' and (TG_OP='INSERT' or OLD.status is distinct from 'under_review'));
  id_resub   boolean := (new_id   is not null and new_id   is distinct from old_id   and coalesce(NEW.status,'draft') <> 'draft');
  bank_resub boolean := (new_bank is not null and new_bank is distinct from old_bank and coalesce(NEW.status,'draft') <> 'draft');
begin
  if not (submitted or id_resub or bank_resub) then return NEW; end if;

  select email into v_email from auth.users where id = NEW.user_id;
  v_name := coalesce(nullif(trim(NEW.full_name),''), 'An agent');

  if submitted then
    v_kind := 'submitted their agent onboarding for review';
    v_title := '🤝 Agent verification requested';
    v_reason_tag := 'sub';
  else
    v_kind := 'uploaded a corrected ' ||
      case when id_resub and bank_resub then 'government ID and bank proof'
           when id_resub then 'government ID' else 'bank proof' end ||
      ' — ready to re-review';
    v_title := '📎 Agent re-uploaded a document — re-review';
    v_reason_tag := case when id_resub and bank_resub then 'idbank' when id_resub then 'id' else 'bank' end;
  end if;

  -- (a) staff in-app — only for a re-upload; a fresh submit is already notified by
  --     agent_save_onboarding, so we don't duplicate it here.
  if not submitted then
    begin
      insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
      values ('staff','in_app','agent.review_requested',
        jsonb_build_object('user', NEW.user_id, 'title', v_title,
          'body', v_name || ' ' || v_kind || '. Open the Agents tab to review.',
          'tone','info','url','/app/command-center/#/agents'),
        'sent', now());
    exception when others then null; end;
  end if;

  -- (b) email hello@loadboot.com (owner inbox), branded, idempotent per user+reason+minute
  begin
    perform app_private.sys_email('hello@loadboot.com', 'agent.owner_alert',
      'LoadBoot Agent — ' || v_name || ': ' || case when submitted then 'new submission to review' else 'document re-uploaded' end,
      '<div style="font-family:Inter,Arial,sans-serif;color:#0f172a"><h2 style="margin:0 0 8px">Agent action needs review</h2>'
      || '<p style="margin:0 0 6px"><b>' || v_name || '</b>' || case when v_email is not null then ' (' || v_email || ')' else '' end || ' ' || v_kind || '.</p>'
      || '<p style="margin:14px 0"><a href="https://loadboot.com/app/command-center/#/agents" style="background:#FC5305;color:#fff;padding:11px 20px;border-radius:9px;text-decoration:none;font-weight:800">Open Agents tab &rarr;</a></p>'
      || '<p style="color:#64748b;font-size:12px;margin:0">LoadBoot Command Center &middot; agent verification</p></div>',
      null,
      'agentalert:' || NEW.user_id::text || ':' || v_reason_tag || ':' || to_char(now(),'YYYYMMDDHH24MI'));
  exception when others then null; end;

  return NEW;
end $$;

drop trigger if exists trg_agent_profiles_review_alert on app_private.agent_profiles;
create trigger trg_agent_profiles_review_alert
  after insert or update on app_private.agent_profiles
  for each row execute function app_private.agent_profiles_review_alert();
