-- bl_mail_0601e (10 Nov 2026): MIME bodies that start with a preamble ("This is a multi-part message in MIME format.")
-- before the first boundary (Progressive's COI mails) were not recognised. Find the first boundary line followed by a part header.
create or replace function app_private.mail_mime_parse(raw text, boundary text default null, depth int default 0)
returns jsonb language plpgsql immutable as $$
declare
  part text; hdr text; body text; sep int; ctype text; cs text; cte text; disp text; sub_b text;
  v_text text; v_html text; r jsonb; m text[];
begin
  if raw is null or depth > 4 then return '{}'::jsonb; end if;
  if boundary is null then
    -- first boundary line that is followed by a part header (allows a "This is a multi-part message" preamble)
    boundary := coalesce((regexp_match(left(raw, 4000), '(?:^|\n)--([^\s]+)\r?\n[ \t]*content-', 'i'))[1],
                         (regexp_match(raw, '^\s*--([^\s]+)'))[1]);
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
create or replace function app_private.mail_normalize_payload(p jsonb) returns jsonb
language plpgsql immutable as $$
declare r jsonb; t text := p->>'body_text'; d text; is_html boolean;
begin
  if coalesce(p->>'body_html','') <> '' or t is null then return p; end if;
  if t ~ '^\s*--\S' or left(t, 4000) ~* '(^|\n)--\S+\r?\n[ \t]*content-' then
    r := app_private.mail_mime_parse(t);
    if r ? 'text' or r ? 'html' then
      return p || jsonb_build_object(
        'raw_mime', t,
        'body_text', coalesce(r->>'text', btrim(regexp_replace(regexp_replace(r->>'html', '<(style|script)[^>]*>.*?</\1>', ' ', 'gis'), '<[^>]+>', ' ', 'g'))),
        'body_html', r->>'html');
    end if;
    return p;
  end if;
  is_html := t ~* '^\s*(<!doctype|<html|<div|<p[ >]|<table|<body|<meta|<span|<br)';
  if (is_html and (t ~ '=\r?\n' or t ~ '=3D'))
     or (not is_html and t ~ '=\r?\n' and t ~ '=[0-9A-F]{2}') then
    d := app_private.mail_qp_decode(t, 'utf-8');
    if is_html then
      return p || jsonb_build_object('raw_mime', t, 'body_html', d,
        'body_text', btrim(regexp_replace(regexp_replace(regexp_replace(d, '<(style|script)[^>]*>.*?</\1>', ' ', 'gis'), '<br\s*/?>|</(div|p|tr)>', E'\n', 'gi'), '<[^>]+>', '', 'g')));
    end if;
    return p || jsonb_build_object('raw_mime', t, 'body_text', d);
  end if;
  return p;
end $$;
revoke all on function app_private.mail_mime_parse(text,text,int), app_private.mail_normalize_payload(jsonb) from public, anon, authenticated;
