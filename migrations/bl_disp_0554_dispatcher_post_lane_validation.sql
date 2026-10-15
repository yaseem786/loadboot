-- bl_disp_0554 — dispatcher posts: strict "City, ST" lane + required loaded miles (owner, 15 Oct 2026)
--
-- Why: a prod post went out as origin "austin" / destination "tx" with no miles. With no miles the $/mi floor check
-- in disp_post_normalise never ran, and the carrier saw a lane nobody could plan.
--
-- What changes:
--   1. NEW app_private.disp_city_st(text) -> 'City, ST' or null. Accepts "dallas tx", "Dallas,TX", "Dallas, TX 75201",
--      "Dallas, TX, USA". State must be a US state / DC / PR or a Canadian province. City: letters (accents ok), space . ' - only.
--      All-lower / all-upper city is title-cased; mixed case (McAllen) is kept.
--   2. app_private.disp_post_normalise — two exact-once fn_patch anchors:
--      a. origin/destination must parse through disp_city_st, and are stored normalised.
--      b. loaded miles required, 1..4000; "1,234" / "450.5" / "450 mi" parse correctly (the old regex turned
--         "450.5" into 4505).
--   Callers: dispatcher_post_load and dispatcher_update_load (an update of an old bad post now has to fix the lane).
-- Not touched: multi-stop locations on bookings, anything the carrier side reads.

create or replace function app_private.disp_city_st(p text)
returns text language plpgsql immutable set search_path = pg_catalog as $$
declare s text; m text[]; v_city text; v_st text;
begin
  s := btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'));
  s := regexp_replace(s, '[ ,]+(USA|US|United States|Canada|CAN)\.?$', '', 'i');
  s := regexp_replace(s, '[ ,]+[0-9]{5}(-[0-9]{4})?$', '');                 -- US ZIP
  s := regexp_replace(s, '[ ,]+[A-Za-z][0-9][A-Za-z] ?[0-9][A-Za-z][0-9]$', '');  -- Canadian postal code
  m := regexp_match(s, '^(.+?)[ ,]+([A-Za-z]{2})\.?$');
  if m is null then return null; end if;
  v_city := btrim(m[1], ' ,');  v_st := upper(m[2]);
  if v_st <> all (array['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
      'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX',
      'UT','VT','VA','WA','WV','WI','WY','DC','PR',
      'AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT']) then return null; end if;
  if v_city !~ '^[[:alpha:]][[:alpha:] .''-]{1,39}$' then return null; end if;
  if v_city = lower(v_city) or v_city = upper(v_city) then v_city := initcap(v_city); end if;
  return v_city || ', ' || v_st;
end $$;
revoke all on function app_private.disp_city_st(text) from public, anon, authenticated;

do $$
begin
  perform app_private.fn_patch('app_private.disp_post_normalise(uuid,jsonb,uuid)',
    $a$  if v_origin = '' or v_dest = '' then raise exception 'origin and destination are required (City, ST)' using errcode = '22023'; end if;$a$,
    $a$  if v_origin = '' or v_dest = '' then raise exception 'origin and destination are required (City, ST)' using errcode = '22023'; end if;
  if app_private.disp_city_st(v_origin) is null then raise exception 'origin must be City, ST — e.g. Dallas, TX (got "%")', v_origin using errcode = '22023'; end if;
  if app_private.disp_city_st(v_dest) is null then raise exception 'destination must be City, ST — e.g. Houston, TX (got "%")', v_dest using errcode = '22023'; end if;
  v_origin := app_private.disp_city_st(v_origin);  v_dest := app_private.disp_city_st(v_dest);$a$);

  perform app_private.fn_patch('app_private.disp_post_normalise(uuid,jsonb,uuid)',
    $a$  v_miles := nullif(regexp_replace(coalesce(v->>'miles',''), '[^0-9]', '', 'g'), '')::int;$a$,
    $a$  v_miles := case when regexp_replace(lower(coalesce(v->>'miles','')), '[\s,]|miles?$|mi$', '', 'g') ~ '^[0-9]{1,6}(\.[0-9]+)?$'
                   then round(regexp_replace(lower(v->>'miles'), '[\s,]|miles?$|mi$', '', 'g')::numeric)::int end;
  if v_miles is null then raise exception 'loaded miles are required — the carrier plans the trip and the $/mi floor is checked on them' using errcode = '22023'; end if;
  if v_miles < 1 or v_miles > 4000 then raise exception 'loaded miles must be between 1 and 4,000 (got %)', v_miles using errcode = '22023'; end if;$a$);
end $$;
