-- bl_mail_0601 (10 Nov 2026) — inbound mail bodies were stored as RAW MIME.
-- The inbound relay hands inbound-mail the message body (multipart, base64 / quoted-printable)
-- in `text`, with `html` empty, and cc_mail_ingest stored it as-is: 940 of 1,023 inbound rows
-- since 7 Sep show "--boundary / Content-Type / PGh0bWw+..." in the CC Mailbox. mail_classify
-- also read the raw MIME, which mis-filed real replies into Updates.
-- Fix: decode in Postgres at ingest (one place, covers every caller), keep the original in
-- mail_messages.raw_mime, and backfill existing rows (raw kept, so reversible).

alter table app_private.mail_messages add column if not exists raw_mime text;

create or replace function app_private.mail_pg_enc(cs text) returns text
language sql immutable as $$
  select case lower(coalesce(btrim(cs, ' "'''), ''))
    when 'iso-8859-1' then 'LATIN1' when 'latin1' then 'LATIN1' when 'iso-8859-15' then 'LATIN9'
    when 'windows-1252' then 'WIN1252' when 'cp1252' then 'WIN1252'
    else 'UTF8' end
$$;

create or replace function app_private.mail_qp_decode(t text, cs text) returns text
language plpgsql immutable as $$
declare b bytea;
begin
  t := regexp_replace(coalesce(t,''), '=\r?\n', '', 'g');
  select coalesce(string_agg(case when m[1] is not null then decode(substr(m[1],2), 'hex')
                                  else convert_to(coalesce(m[2], m[3]), 'UTF8') end, ''::bytea order by o), ''::bytea)
    into b
    from regexp_matches(t, '(=[0-9A-Fa-f]{2})|([^=]+)|(=)', 'g') with ordinality as x(m, o);
  begin
    return convert_from(b, app_private.mail_pg_enc(cs));
  exception when others then
    begin return convert_from(b, 'LATIN1'); exception when others then return t; end;
  end;
end $$;

create or replace function app_private.mail_part_decode(body text, cte text, cs text) returns text
language plpgsql immutable as $$
begin
  if lower(coalesce(cte,'')) = 'base64' then
    begin
      return convert_from(decode(regexp_replace(body, '[^A-Za-z0-9+/=]', '', 'g'), 'base64'), app_private.mail_pg_enc(cs));
    exception when others then
      begin return convert_from(decode(regexp_replace(body, '[^A-Za-z0-9+/=]', '', 'g'), 'base64'), 'LATIN1');
      exception when others then return body; end;
    end;
  elsif lower(coalesce(cte,'')) = 'quoted-printable' then
    return app_private.mail_qp_decode(body, cs);
  end if;
  return body;
end $$;

-- Returns {"text": ..., "html": ...} (either may be null). depth guards recursion.
create or replace function app_private.mail_mime_parse(raw text, boundary text default null, depth int default 0)
returns jsonb language plpgsql immutable as $$
declare
  part text; hdr text; body text; sep int; ctype text; cs text; cte text; disp text; sub_b text;
  v_text text; v_html text; r jsonb;
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
    sep := position(E'\r\n\r\n' in part);
    if sep > 0 then hdr := left(part, sep - 1); body := substr(part, sep + 4);
    else
      sep := position(E'\n\n' in part);
      if sep = 0 then continue; end if;
      hdr := left(part, sep - 1); body := substr(part, sep + 2);
    end if;
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

-- Normalise an ingest payload: raw MIME in body_text + empty body_html -> decoded text/html.
create or replace function app_private.mail_normalize_payload(p jsonb) returns jsonb
language plpgsql immutable as $$
declare r jsonb; t text := p->>'body_text';
begin
  if coalesce(p->>'body_html','') <> '' or t is null or t !~ '^\s*--\S' then return p; end if;
  r := app_private.mail_mime_parse(t);
  if r ? 'text' or r ? 'html' then
    return p || jsonb_build_object(
      'raw_mime', t,
      'body_text', coalesce(r->>'text', btrim(regexp_replace(regexp_replace(r->>'html', '<(style|script)[^>]*>.*?</\1>', ' ', 'gis'), '<[^>]+>', ' ', 'g'))),
      'body_html', r->>'html');
  end if;
  return p;
end $$;

revoke all on function app_private.mail_pg_enc(text), app_private.mail_qp_decode(text,text),
  app_private.mail_part_decode(text,text,text), app_private.mail_mime_parse(text,text,int),
  app_private.mail_normalize_payload(jsonb) from public, anon, authenticated;

-- Wire into cc_mail_ingest: normalise p as the first statement (anchor = the function's first BEGIN).
do $$
declare d text; n int;
begin
  d := pg_get_functiondef('public.cc_mail_ingest(jsonb)'::regprocedure);
  if position('bl_mail_0601' in d) > 0 then return; end if;
  d := regexp_replace(d, '\nbegin\s*\n', E'\nbegin\n  p := app_private.mail_normalize_payload(p); -- bl_mail_0601\n', 'i');
  if position('bl_mail_0601' in d) = 0 then raise exception 'bl_mail_0601: begin anchor not found'; end if;
  -- store the raw copy alongside the decoded body
  d := replace(d, 'insert into app_private.mail_messages(direction, mailbox, peer_email, peer_name, subject, body_text, body_html,',
                  'insert into app_private.mail_messages(raw_mime, direction, mailbox, peer_email, peer_name, subject, body_text, body_html,');
  d := replace(d, 'values (''in'', v_to, v_from, nullif(p->>''from_name'',''''), v_subj, p->>''body_text'', p->>''body_html'',',
                  'values (p->>''raw_mime'', ''in'', v_to, v_from, nullif(p->>''from_name'',''''), v_subj, p->>''body_text'', p->>''body_html'',');
  if (position('raw_mime, direction' in d) > 0) <> (position('p->>''raw_mime''' in d) > 0) then
    raise exception 'bl_mail_0601: insert column/value patch matched only one side';
  end if;
  execute d;
end $$;
