-- cvm_campaign_ab.sql
-- Campaign A/B testing on the unified engine. A campaign may define content VARIANTS (different subject/body).
-- At enqueue, recipients are split across variants DETERMINISTICALLY by a stable hash of their address (so the
-- same person always lands in the same variant, and re-preview/re-enqueue is idempotent), weighted by each
-- variant's weight. Each delivery snapshots ITS variant's content + label. Per-variant analytics pick a winner.
--
-- Regression-safe: a campaign with NO variants enqueues exactly as before (the no-variant branch is unchanged).
-- Staff-gated (can_manage_comms), anon revoked. Anon SECURITY DEFINER surface unchanged (5).
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create table if not exists app_private.campaign_variants (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references app_private.campaigns(id) on delete cascade,
  label       text not null,
  subject     text,
  body_html   text,
  body_text   text,
  weight      integer not null default 1,
  created_at  timestamptz not null default now(),
  unique (campaign_id, label)
);
create index if not exists campaign_variants_campaign_idx on app_private.campaign_variants(campaign_id);

-- List variants for a campaign.
create or replace function public.cc_campaign_variants(p_campaign uuid)
returns table(id uuid, label text, subject text, body_html text, body_text text, weight integer)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  return query select v.id, v.label, v.subject, v.body_html, v.body_text, v.weight
    from app_private.campaign_variants v where v.campaign_id=p_campaign order by v.created_at, v.id;
end; $$;
revoke execute on function public.cc_campaign_variants(uuid) from anon, public;
grant  execute on function public.cc_campaign_variants(uuid) to authenticated;

-- Upsert a variant (by campaign+label). Editing variants clears the campaign's approval (re-approval required).
create or replace function public.cc_campaign_set_variant(p_campaign uuid, p_label text, p_subject text default null,
  p_body_html text default null, p_body_text text default null, p_weight integer default 1)
returns uuid language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_id uuid;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  if p_label is null or btrim(p_label)='' then raise exception 'variant label required' using errcode='22023'; end if;
  insert into app_private.campaign_variants(campaign_id,label,subject,body_html,body_text,weight)
  values (p_campaign, btrim(p_label), p_subject, p_body_html, p_body_text, least(greatest(coalesce(p_weight,1),1),100))
  on conflict (campaign_id,label) do update set
    subject=excluded.subject, body_html=excluded.body_html, body_text=excluded.body_text, weight=excluded.weight
  returning id into v_id;
  update app_private.campaigns set approved_by=null, approved_at=null, updated_at=now() where id=p_campaign;
  return v_id;
end; $$;
revoke execute on function public.cc_campaign_set_variant(uuid, text, text, text, text, integer) from anon, public;
grant  execute on function public.cc_campaign_set_variant(uuid, text, text, text, text, integer) to authenticated;

create or replace function public.cc_campaign_delete_variant(p_id uuid)
returns boolean language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_cmp uuid;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  delete from app_private.campaign_variants where id=p_id returning campaign_id into v_cmp;
  if v_cmp is not null then update app_private.campaigns set approved_by=null, approved_at=null, updated_at=now() where id=v_cmp; end if;
  return v_cmp is not null;
end; $$;
revoke execute on function public.cc_campaign_delete_variant(uuid) from anon, public;
grant  execute on function public.cc_campaign_delete_variant(uuid) to authenticated;

-- Per-variant analytics + suggested winner (by delivered, then opened).
create or replace function public.cc_campaign_variant_analytics(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v jsonb; v_winner text;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  select jsonb_agg(row) , (select label from (
      select meta->>'variant' label,
             count(*) filter (where status='delivered') dl,
             count(*) filter (where status in ('opened','clicked')) op
      from app_private.message_deliveries where campaign_id=p_campaign and meta ? 'variant'
      group by meta->>'variant' order by dl desc, op desc limit 1) w)
  into v, v_winner
  from (
    select jsonb_build_object('variant', coalesce(meta->>'variant','(none)'),
      'recipients', count(*),
      'delivered', count(*) filter (where status='delivered'),
      'opened', count(*) filter (where status in ('opened','clicked')),
      'bounced', count(*) filter (where status in ('bounced','complained'))) row
    from app_private.message_deliveries where campaign_id=p_campaign
    group by coalesce(meta->>'variant','(none)')
  ) s;
  return jsonb_build_object('variants', coalesce(v,'[]'::jsonb), 'winner', v_winner);
end; $$;
revoke execute on function public.cc_campaign_variant_analytics(uuid) from anon, public;
grant  execute on function public.cc_campaign_variant_analytics(uuid) to authenticated;
