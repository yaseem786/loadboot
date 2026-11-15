-- bl_mail_0601c (10 Nov 2026): split part headers at the EARLIEST blank line. Mixed CRLF/LF parts
-- (header ended by LF LF, body lines CRLF) were split at a later CRLF CRLF, so the HTML part's
-- base64 was never decoded.
create or replace function app_private.mail_mime_parse(raw text, boundary text default null, depth int default 0)
returns jsonb language plpgsql immutable as $$
declare
  part text; hdr text; body text; sep int; ctype text; cs text; cte text; disp text; sub_b text;
  v_text text; v_html text; r jsonb; m text[];
begin
  if raw is null or depth > 4 then return '{}'::jsonb; end if;
  if boundary is null then
    boundary := (regexp_match(raw, '^\s*--([^\s]+)'))[1];
    if boundary is null then return '{}'::jsonb; end if;
  end if;
  for part in select x from regexp_split_to_table(raw,
      '(?:^|\r?\n)--' || regexp_replace(boundary, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '(?:--)?[ \t]*(?=\r?\n|$)') x
  loop
    part := regexp_replace(part, '^\r?\n', '');
    -- header/body split = the EARLIEST blank line, whatever its line endings (relays mix CRLF and LF)
    m := regexp_match(part, '(\r?\n\r?\n)');
    if m is null then continue; end if;
    sep := position(m[1] in part);
    hdr := left(part, sep - 1); body := substr(part, sep + length(m[1]));
    hdr := regexp_replace(hdr, '\r?\n[ \t]+', ' ', 'g');             -- unfold
    ctype := lower(btrim((regexp_match(hdr, 'content-type:\s*([^;\r\n]+)', 'i'))[1]));
    if ctype is null then continue; end if;
    cs    := (regexp_match(hdr, 'charset\s*=\s*"?([^";\r\n]+)', 'i'))[1];
    cte   := btrim((regexp_match(hdr, 'content-transfer-encoding:\s*([^\s;]+)', 'i'))[1]);
    disp  := lower(coalesce((regexp_match(hdr, 'content-disposition:\s*([^;\r\n]+)', 'i'))[1], ''));
    if disp like 'attachment%' then continue; end if;
    if ctype like 'multipart/%' then
      sub_b := (regexp_match(hdr, 'boundary\s*=\s*"?([^";\r\n]+)"?', 'i'))[1];
      if sub_b is not null then
        r := app_private.mail_mime_parse(body, sub_b, depth + 1);
        v_text := coalesce(v_text, r->>'text'); v_html := coalesce(v_html, r->>'html');
      end if;
    elsif ctype = 'text/plain' and v_text is null then
      v_text := app_private.mail_part_decode(body, cte, cs);
    elsif ctype = 'text/html' and v_html is null then
      v_html := app_private.mail_part_decode(body, cte, cs);
    end if;
  end loop;
  return jsonb_strip_nulls(jsonb_build_object('text', v_text, 'html', v_html));
end $$;
revoke all on function app_private.mail_mime_parse(text,text,int) from public, anon, authenticated;
