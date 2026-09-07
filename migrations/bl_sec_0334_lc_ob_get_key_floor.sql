-- bl_sec_0334 — audit F34. Bring lc_ob_get's key floor in line with lc_history's.
--
-- THE FINDING. The live-chat visitor key is a BEARER SECRET: present it and you get that visitor's data back.
--   lc_history(p_visitor_key)  -> their last 10 conversations and message previews. Requires length 16..64.
--   lc_ob_get(p_visitor_key)   -> their onboarding record: role, step, free-form `data`, `docs`, account_email.
--                                 Required only length >= 8.
-- Eight characters is not a secret. The two functions guard the same secret to different standards, and the
-- weaker one returns the more personal record.
--
-- AND THE KEY ITSELF WAS WEAKER THAN IT LOOKED. build_site.py minted it with Math.random(), and its
-- storage-failure path returned 'novkey' + Date.now().toString(36) + 'xxxxxxxx' — fully predictable from the
-- clock. Anyone who knew roughly when a visitor used the site in a browser with localStorage blocked could
-- enumerate that key. Fixed in the same change: keys now come from crypto.getRandomValues (192 bits, hex), and
-- the failure path stays random instead of falling back to a fixed pattern.
--
-- EVIDENCE THIS IS LATENT, NOT LIVE (prod, read-only, 2026-09-07): 67 lc_conversations and 1 lc_onboarding row;
-- ZERO with a 'novkey' prefix; the shortest visitor_key in use is 26 characters. So the predictable path has
-- never actually been taken in production, and raising the floor to 16 locks out nobody who exists today.
-- That is why this is filed as a latent defect rather than an incident.
--
-- WHAT THIS CHANGES: the length floor 8 -> 16, and an explicit refusal of the old predictable prefix so a key
-- minted by the buggy fallback can never be replayed. Nothing else about the function changes.
--
-- STAGING RESULT 2026-09-07: tests/bl_sec_0334_rollback_test.sql -> RESULT PASS (4 cases). PROD: not applied.
create or replace function public.lc_ob_get(p_visitor_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'app_private', 'public'
as $function$
declare v app_private.lc_onboarding;
begin
  -- bl_sec_0334: same floor as lc_history (16..64), and the predictable 'novkey' prefix is refused outright.
  if p_visitor_key is null or length(p_visitor_key) < 16 or length(p_visitor_key) > 64
     or p_visitor_key like 'novkey%' then
    return jsonb_build_object('error','bad key');
  end if;
  select * into v from app_private.lc_onboarding where visitor_key = p_visitor_key;
  if not found then return jsonb_build_object('exists', false); end if;
  return jsonb_build_object('exists', true, 'role', v.role, 'step_key', v.step_key,
    'data', v.data, 'docs', v.docs, 'account_created', v.account_created,
    'account_email', v.account_email, 'completed', v.completed_at is not null);
end $function$;
