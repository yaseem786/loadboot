-- bl_mail_0601d (10 Nov 2026): the relay also hands over SINGLE-PART bodies with their MIME headers
-- stripped — quoted-printable HTML ("<div>Hi there,</di=\r\nv>", class=3D"...") with no boundary, so
-- bl_mail_0601 did not see MIME at all. Decode when the body is HTML-shaped and carries QP evidence
-- (soft line breaks or =3D), or plain text that has BOTH soft breaks and =XX escapes. Raw kept in raw_mime.
create or replace function app_private.mail_normalize_payload(p jsonb) returns jsonb
language plpgsql immutable as $$
declare r jsonb; t text := p->>'body_text'; d text; is_html boolean;
begin
  if coalesce(p->>'body_html','') <> '' or t is null then return p; end if;
  if t ~ '^\s*--\S' then
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
revoke all on function app_private.mail_normalize_payload(jsonb) from public, anon, authenticated;
