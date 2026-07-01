-- cvk_transactional_sms.sql
-- Completes the "unified engine, every channel" promise: cc_enqueue_transactional previously validated the
-- recipient as an EMAIL always, so an SMS could never be enqueued. Now it branches on channel — email → email
-- regex + recipient_email + resend; sms → phone (E.164-ish) + recipient_phone + twilio — and enforces the
-- suppression list on the correct (channel,address). All other behaviour (idempotency, staff-gate) unchanged.
-- Staff-gated (can_manage_comms), anon revoked. No change to the anon SECURITY DEFINER surface.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create or replace function public.cc_enqueue_transactional(
  p_channel text, p_email text, p_template_key text default null, p_subject text default null,
  p_idem text default null, p_meta jsonb default '{}'::jsonb, p_scheduled_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_key text; v_sched timestamptz; v_id uuid; v_ins int; v_provider text; v_addr text;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  if p_channel not in ('email','sms') then raise exception 'invalid channel' using errcode='22023'; end if;
  -- validate recipient per channel; p_email carries the address for either channel (email or phone)
  if p_channel='email' then
    if p_email is null or p_email !~ '^[^@]+@[^@]+\.[^@]+$' then raise exception 'invalid email recipient' using errcode='22023'; end if;
    v_addr := lower(p_email); v_provider := 'resend';
  else
    if p_email is null or p_email !~ '^\+?[0-9]{7,15}$' then raise exception 'invalid sms recipient' using errcode='22023'; end if;
    v_addr := p_email; v_provider := 'twilio';
  end if;
  if exists (select 1 from app_private.suppressions where channel=p_channel and lower(address)=lower(v_addr)) then
    return jsonb_build_object('queued',false,'reason','suppressed'); end if;
  v_sched := coalesce(p_scheduled_at, now());
  v_key := coalesce(p_idem, 'txn:'||p_channel||':'||lower(v_addr)||':'||coalesce(p_template_key,'')||':'||extract(epoch from v_sched)::bigint::text);
  insert into app_private.message_deliveries(source,channel,provider,recipient_email,recipient_phone,idempotency_key,status,scheduled_at,template_key,meta)
  values ('transactional',p_channel,v_provider,
    case when p_channel='email' then v_addr else null end,
    case when p_channel='sms'   then v_addr else null end,
    v_key, case when v_sched>now() then 'scheduled' else 'queued' end, v_sched, p_template_key,
    coalesce(p_meta,'{}'::jsonb) || jsonb_build_object('subject',p_subject))
  on conflict (idempotency_key) do nothing returning id into v_id;
  get diagnostics v_ins = row_count;
  return jsonb_build_object('queued', v_ins>0, 'delivery_id', v_id, 'idempotency_key', v_key, 'channel', p_channel,
    'status', case when v_ins=0 then 'duplicate' when v_sched>now() then 'scheduled' else 'queued' end);
end; $$;
revoke execute on function public.cc_enqueue_transactional(text, text, text, text, text, jsonb, timestamptz) from anon, public;
grant  execute on function public.cc_enqueue_transactional(text, text, text, text, text, jsonb, timestamptz) to authenticated;
