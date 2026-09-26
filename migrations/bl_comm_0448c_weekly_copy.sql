-- bl_comm_0448c — LoadBoot Weekly copy fixes seen on the first prod preview (26 Sep 2026):
--   1. carrier hero with no equipment on file read "what your lanes is paying" → "what your lanes are paying"
--      (with equipment it stays "what Dry Van is paying");
--   2. dispatcher subject read "1 carriers" → new token {{carriers_word}} ("carrier"/"carriers"), used by the
--      weekly.dispatcher subject template.
-- Patches app_private.weekly_render in place (one anchor each), so its ACL and the rest of the body are untouched.
-- No new function, anon surface unchanged.
do $$
declare d text; n int;
begin
  select pg_get_functiondef('app_private.weekly_render(text,jsonb,jsonb)'::regprocedure) into d;
  n := (length(d) - length(replace(d, $a$then app_private.wk_esc(v_eq[1]) else 'your lanes' end || ' is paying,$a$, ''))) / length($a$then app_private.wk_esc(v_eq[1]) else 'your lanes' end || ' is paying,$a$);
  if n <> 1 then raise exception 'anchor 1 found % times', n; end if;
  d := replace(d, $a$then app_private.wk_esc(v_eq[1]) else 'your lanes' end || ' is paying,$a$,
                  $b$then app_private.wk_esc(v_eq[1]) || ' is' else 'your lanes are' end || ' paying,$b$);
  n := (length(d) - length(replace(d, $a$'n_carriers', coalesce(p_ctx->>'n_carriers', '0'), 'n_bookings'$a$, ''))) / length($a$'n_carriers', coalesce(p_ctx->>'n_carriers', '0'), 'n_bookings'$a$);
  if n <> 1 then raise exception 'anchor 2 found % times', n; end if;
  d := replace(d, $a$'n_carriers', coalesce(p_ctx->>'n_carriers', '0'), 'n_bookings'$a$,
                  $b$'n_carriers', coalesce(p_ctx->>'n_carriers', '0'), 'carriers_word', case when coalesce((p_ctx->>'n_carriers')::int, 0) = 1 then 'carrier' else 'carriers' end, 'n_bookings'$b$);
  execute d;
end $$;

update app_private.comm_templates
   set subject = 'Your fleet this week · {{n_carriers}} {{carriers_word}} · {{lead_rate}}', updated_at = now()
 where key = 'weekly.dispatcher' and subject = 'Your fleet this week · {{n_carriers}} carriers · {{lead_rate}}';
