-- ═══════════════════════════════════════════════════════════════════════════════════════════
--  PROD — seed ONE carrier training world (bl_train_0548). Paste into the prod SQL Editor and Run.
--
--  BEFORE: migrations/bl_train_0548_carrier_training_sandbox.sql must already be applied on prod.
--  ① Edit the three values in `cfg` below. ANDREW_TRAINING_EMAIL must be a NEW address that has no
--    LoadBoot login yet — never Andrew's dispatcher login (e.g. andrew.higgins+training@gmail.com).
--    The seed refuses an address that already exists. Nothing is emailed to it (the training guard
--    holds every send), so it only has to be an address Andrew can type.
--  ② Run. The result row holds the password ONCE — it is not stored anywhere. Copy it to Andrew.
--  ③ Upload the sample PDFs (from the repo, on your PC):
--       node tools/training/upload-samples.mjs --env prod --email <ANDREW_TRAINING_EMAIL> --password '<password>'
--  The whole seed is one statement: if anything fails, nothing is created.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
with cfg as (
  select
    'ANDREW_TRAINING_EMAIL'::text                           as andrew_training_email,  -- ← replace with the NEW training address
    'Andrew'::text                                          as label,                  -- shown as "LOADBOOT TRAINING CARRIER — Andrew"
    '2f5ef591-2f1a-41dc-84df-de79f3438661'::uuid            as dispatcher_user         -- Asim Latif (prod dispatcher_profiles)
),
preflight as (
  select c.*,
    case
      when to_regprocedure('app_private.training_seed(text,text,uuid)') is null
        then 'STOP: bl_train_0548 is not applied on this database yet.'
      when c.andrew_training_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
        then 'STOP: put the real training email in cfg.andrew_training_email first.'
      when exists (select 1 from auth.users u where lower(u.email) = lower(btrim(c.andrew_training_email)))
        then 'STOP: that address already has a LoadBoot login — use a NEW one (never the dispatcher''s own login).'
      when not exists (select 1 from app_private.dispatcher_profiles d where d.user_id = c.dispatcher_user and d.status in ('trial','verified','active'))
        then 'STOP: dispatcher_user is not a dispatcher in trial/verified/active.'
      when exists (select 1 from public.organizations o where o.name = 'LOADBOOT TRAINING CARRIER — ' || c.label)
        then 'STOP: a training carrier with this label already exists — reset it instead: select app_private.training_reset(''<org id>'');'
    end as stop
  from cfg c
)
select case when p.stop is not null then jsonb_build_object('result', p.stop)
            else app_private.training_seed(p.andrew_training_email, p.label, p.dispatcher_user) end as training_world
  from preflight p;

-- ── Later ───────────────────────────────────────────────────────────────────────────────────
-- Hand the training carrier to Andrew's OWN dispatcher account (66544e6b-ab05-4427-a9e3-5d05ec7c6208 on prod),
-- so he can request loads from his dispatcher workspace and watch them land in the carrier portal:
--   select app_private.training_set_dispatcher('<carrier_org from the result>', '66544e6b-ab05-4427-a9e3-5d05ec7c6208');
-- Back to the clean starting state (loads / trips / offers / prefs re-seeded; same login):
--   select app_private.training_reset('<carrier_org from the result>');
--   …then run upload-samples.mjs again (the completed trip gets a new id).
-- Everything the world tried to send (all held):
--   select created_at, channel, template_key, reason from app_private.training_blocked_log order by id desc limit 50;
