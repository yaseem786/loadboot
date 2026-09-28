-- bl_ship_0496 — a shipper's direct load must carry a cargo value: the new-shipper value cap and the
-- high-value section cannot be checked without it, and carriers need it to confirm their cargo cover.
do $$ declare d text; n int;
  a text := $a$  v_val := coalesce(nullif(p_row->'details'->>'cargo_value','')::numeric, nullif(p_row->>'cargo_value','')::numeric);$a$;
begin
  d := pg_get_functiondef('app_private.assert_shipper_lane(uuid,text,jsonb)'::regprocedure);
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception 'bl_ship_0496: anchor found % times — refusing', n; end if;
  execute replace(d, a, a || $b$
  if p_lane = 'direct' and coalesce(v_val, 0) <= 0 then
    raise exception 'Enter the cargo value for this load — carriers need it to confirm their cargo insurance covers it.' using errcode = '22023'; end if;$b$);
end $$;
