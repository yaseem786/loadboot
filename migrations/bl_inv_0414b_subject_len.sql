-- bl_inv_0414b — shorten e-mail subject / push text built from long expense descriptions and request reasons.
-- Applied staging + production 25 Sep 2026 (in-place rewrite of app_private.inv_compose).
do $$ declare s text; begin
s := pg_get_functiondef('app_private.inv_compose(text,text,jsonb,uuid,text)'::regprocedure);
s := replace(s, $a$subj := app_private.inv_tx(L,'s_exp', amt, what);$a$, $a$subj := app_private.inv_tx(L,'s_exp', amt, left(what, 70));$a$);
s := replace(s, $a$pb := what || coalesce(' — ' || nullif(d->>'vendor', ''), '');$a$, $a$pb := left(what, 100) || coalesce(' — ' || nullif(d->>'vendor', ''), '');$a$);
s := replace(s, $a$h := app_private.inv_tx(L,'h_proof', what);$a$, $a$h := app_private.inv_tx(L,'h_proof', left(what, 70));$a$);
s := replace(s, $a$pb := coalesce(d->>'reason', '');
  elsif p_ev = 'request.file'$a$, $a$pb := left(coalesce(d->>'reason', ''), 140);
  elsif p_ev = 'request.file'$a$);
execute s; end $$;
