-- bl_rem_0331a_html_to_text_helper
--
-- Builds the text/plain alternative of an email template from its HTML body, so the
-- two halves cannot drift apart and nobody has to maintain the same copy twice.
--
-- Postgres ARE gotcha worth remembering: a branch's greediness is decided by its
-- FIRST quantifier. '<a [^>]*href=..(.*?)</a>' runs GREEDY and welds the first <a>
-- to the LAST </a>, scrambling two links into one. The leading quantifier has to be
-- non-greedy as well. This was caught on staging before it reached a real inbox.

create or replace function app_private.html_to_text(p_html text)
returns text
language sql
immutable
as $fn$
  select btrim(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    replace(replace(replace(replace(replace(replace(replace(replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(coalesce(p_html,''),
        '<br\s*/?>', E'\n', 'gi'),
        '</t[dh]>', ' ', 'gi'),
        '</(p|h1|h2|h3|div|tr|table|li)>', E'\n', 'gi'),
        '<a[^>]*?href="([^"]+)"[^>]*?>(.*?)</a>', E'\\2 (\\1)', 'gi'),
        '<[^>]*>', '', 'g'),
      '&nbsp;', ' '), '&mdash;', E'—'), '&ndash;', E'–'),
      '&rsquo;', E'’'), '&lsquo;', E'‘'),
      '&ldquo;', E'“'), '&rdquo;', E'”'), '&rarr;', '->'),
        '&#[0-9]+;', '- ', 'g'),
        '[ \t]{2,}', ' ', 'g'),
        '(?m)^[ \t]+|[ \t]+$', '', 'g'),
        E'\n{3,}', E'\n\n', 'g')
  );
$fn$;

comment on function app_private.html_to_text(text) is
  'Best-effort HTML fragment to plain text, used to build the text/plain alternative of an email template from its HTML body.';
