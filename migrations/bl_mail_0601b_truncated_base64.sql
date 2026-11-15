-- bl_mail_0601b (10 Nov 2026) — follow-up to bl_mail_0601. The inbound relay cuts bodies at 20,000
-- characters (237 of 943 raw rows sit exactly at the cap), so the LAST base64 part (usually the HTML)
-- arrives incomplete and decode() refused it, leaving base64 on screen. Decode the longest valid
-- prefix instead (whole 4-char groups, then drop up to 3 bytes of a split UTF-8 character), and
-- re-derive every stored row from raw_mime.
create or replace function app_private.mail_part_decode(body text, cte text, cs text) returns text
language plpgsql immutable as $$
declare s text; b bytea; k int;
begin
  if lower(coalesce(cte,'')) = 'base64' then
    s := regexp_replace(coalesce(body,''), '[^A-Za-z0-9+/=]', '', 'g');
    s := regexp_replace(s, '=+(?=[A-Za-z0-9+/])', '', 'g');          -- stray padding mid-stream
    s := left(s, length(s) - (length(s) % 4));
    begin b := decode(s, 'base64'); exception when others then return body; end;
    for k in 0..3 loop
      begin
        return convert_from(substring(b from 1 for greatest(length(b) - k, 0)), app_private.mail_pg_enc(cs));
      exception when others then null; end;
    end loop;
    begin return convert_from(b, 'LATIN1'); exception when others then return body; end;
  elsif lower(coalesce(cte,'')) = 'quoted-printable' then
    return app_private.mail_qp_decode(body, cs);
  end if;
  return body;
end $$;
revoke all on function app_private.mail_part_decode(text,text,text) from public, anon, authenticated;
