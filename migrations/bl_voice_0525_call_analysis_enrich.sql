-- bl_voice_0525 — fill Riley post-call analysis gaps from the transcript (8 Oct 2026).
-- (1) contact_email: Retell's analysis is told to fill it "only if read back and confirmed", and in practice it was left
--     empty on 4 of 6 calls where Riley read an email back (Michael Smith 7 Oct: promised email never sent, because
--     lc_call_followup only sends when analysis.contact_email is set). We now take Riley's LAST spoken read-back
--     ("So that's dispatch at S M I T H ... dot com") or, failing that, the last written address in the transcript.
-- (2) equipment_type: Retell's enum has no sprinter / cargo van, so a Sprinter became "hotshot" and a cargo van
--     "box_truck". When the CALLER says sprinter / cargo van, we set sprinter_van / cargo_van.
-- Additive: a BEFORE trigger that only fills empty/mis-tagged keys and marks the source (…_source = 'transcript').

create or replace function app_private.lc_extract_email(p_transcript text)
returns text language plpgsql immutable as $$
declare
  ln text; w text[]; n int; i int; j int; k int; loc text; dom text; tld text; best text := null; tok text;
  stop text[] := array['so','thats','that','is','its','it','as','to','at','your','my','the','email','address','send','over',
                       'got','ive','have','i','okay','ok','right','correct','and','or','for','you','mail','sure','perfect'];
begin
  if p_transcript is null then return null; end if;
  for ln in select l from regexp_split_to_table(p_transcript, E'\n') as l where l ~* '^\s*agent\s*:' loop
    w := regexp_split_to_array(btrim(lower(regexp_replace(ln, '^\s*agent\s*:\s*', '', 'i'))), '\s+');
    n := coalesce(array_length(w, 1), 0);
    for i in 2..greatest(n - 2, 1) loop
      if regexp_replace(w[i], '[^a-z]', '', 'g') <> 'at' then continue; end if;
      -- find "dot <tld>" after the at
      j := null;
      for k in i + 2..n - 1 loop
        if regexp_replace(w[k], '[^a-z]', '', 'g') = 'dot'
           and regexp_replace(w[k + 1], '[^a-z]', '', 'g') in ('com','net','org','us','co','io','biz','info','email','me','ca') then j := k; exit; end if;
      end loop;
      if j is null or j - i > 25 then continue; end if;
      tld := regexp_replace(w[j + 1], '[^a-z]', '', 'g');
      dom := '';
      for k in i + 1..j - 1 loop
        tok := regexp_replace(w[k], '[^a-z0-9-]', '', 'g');
        if tok = 'dot' then dom := dom || '.'; elsif tok in ('dash','hyphen') then dom := dom || '-'; else dom := dom || tok; end if;
      end loop;
      loc := ''; k := i - 1;
      while k >= 1 and i - k <= 14 loop
        tok := regexp_replace(w[k], '[^a-z0-9._-]', '', 'g');
        exit when tok = '' or tok = any(stop) or w[k] ~ '[,?!]$';
        if tok = 'dot' then loc := '.' || loc; elsif tok = 'underscore' then loc := '_' || loc;
        elsif tok in ('dash','hyphen') then loc := '-' || loc; else loc := tok || loc; end if;
        k := k - 1;
      end loop;
      -- never our own domain ("sign up at loadboot dot com") and no run-on local parts
      if dom = 'loadboot' or length(loc) > 40 then continue; end if;
      if loc <> '' and dom <> '' and (loc || '@' || dom || '.' || tld) ~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$' then
        best := loc || '@' || dom || '.' || tld;   -- keep the LAST read-back (the corrected one)
      end if;
    end loop;
  end loop;
  if best is not null then return best; end if;
  select lower(m[1]) into best from regexp_matches(p_transcript, '([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})', 'g') as m;
  return best;  -- last written address, or null
end $$;

create or replace function app_private.lc_calls_enrich_analysis()
returns trigger language plpgsql as $$
declare v text; u text; eq text;
begin
  if new.transcript is null or new.analysis is null or jsonb_typeof(new.analysis) <> 'object' then return new; end if;
  if coalesce(btrim(new.analysis->>'contact_email'), '') = '' then
    v := app_private.lc_extract_email(new.transcript);
    if v is not null then new.analysis := new.analysis || jsonb_build_object('contact_email', v, 'contact_email_source', 'transcript'); end if;
  end if;
  select string_agg(l, ' ') into u from regexp_split_to_table(new.transcript, E'\n') as l where l ~* '^\s*user\s*:';
  eq := coalesce(new.analysis->>'equipment_type', '');
  if u ~* 'sprinter' and eq not in ('sprinter_van') then
    new.analysis := new.analysis || jsonb_build_object('equipment_type', 'sprinter_van', 'equipment_type_source', 'transcript', 'equipment_type_riley', nullif(eq, ''));
  elsif u ~* 'cargo\s*van' and eq not in ('cargo_van', 'sprinter_van') then
    new.analysis := new.analysis || jsonb_build_object('equipment_type', 'cargo_van', 'equipment_type_source', 'transcript', 'equipment_type_riley', nullif(eq, ''));
  end if;
  return new;
end $$;

drop trigger if exists lc_calls_enrich_analysis on app_private.lc_calls;
create trigger lc_calls_enrich_analysis before insert or update of analysis, transcript on app_private.lc_calls
  for each row execute function app_private.lc_calls_enrich_analysis();
