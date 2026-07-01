-- cup_register_pod_module.sql
-- Register the POD Review Queue in the platform module catalog (app_private.platform_modules) so the
-- module map, permissions and event contract are documented alongside every other module. Idempotent.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

insert into app_private.platform_modules(id, name, description, area, route, status, owning_team, permissions, events_produced, events_consumed, data_classification, version)
select gen_random_uuid(),
       'POD Review Queue',
       'Reviewers approve/reject carrier proof-of-delivery documents from a private signed preview; approval prepares the invoice exactly once.',
       'Operations', '/pod-review', 'LIVE', 'Dispatch/Finance/Compliance',
       array['dispatch.manage','finance.manage','compliance.manage'],
       array['pod.reviewed','invoice.prep_requested'],
       array['pod.uploaded'],
       'confidential', 1
where not exists (select 1 from app_private.platform_modules where route='/pod-review');
