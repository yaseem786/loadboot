-- bl_out_0236b — outreach_html_to_text: the inline-format strip `</?(b|...)` was also
-- eating <br> (the 'b' alternative matched "br"'s first letter). Word-boundary fixes it.
-- Also trim leading/trailing newlines/tabs, not just spaces.
create or replace function app_private.outreach_html_to_text(p_html text)
returns text language plpgsql immutable as $function$
declare h text := coalesce(p_html,'');
begin
  h := regexp_replace(h, '<div style="display:none[^>]*>[^<]*</div>', '', 'gi');
  h := regexp_replace(h, '</?(span|b|strong|i|em|u)\y[^>]*>', '', 'gi');
  h := regexp_replace(h, '<a[^>]*href="([^"]+)"[^>]*>([^<]*)</a>', '\2 (\1)', 'gi');
  h := regexp_replace(h, '<br[^>]*>', chr(10), 'gi');
  h := regexp_replace(h, '</p>', chr(10)||chr(10), 'gi');
  h := regexp_replace(h, '</td>\s*</tr>', chr(10), 'gi');
  h := regexp_replace(h, '<[^>]+>', '', 'g');
  h := replace(h, '&mdash;', '—'); h := replace(h, '&middot;', '·');
  h := replace(h, '&ldquo;', '"'); h := replace(h, '&rdquo;', '"');
  h := replace(h, '&lsquo;', ''''); h := replace(h, '&rsquo;', '''');
  h := replace(h, '&nbsp;', ' '); h := replace(h, '&bull;', '-');
  h := replace(h, '&rarr;', '->'); h := replace(h, '&amp;', '&');
  h := replace(h, '&iquest;', '¿'); h := replace(h, '&ntilde;', 'ñ');
  h := regexp_replace(h, '[ '||chr(9)||']+', ' ', 'g');
  h := regexp_replace(h, ' ?'||chr(10)||'( ?'||chr(10)||' ?)+', chr(10)||chr(10), 'g');
  return btrim(h, ' '||chr(10)||chr(13)||chr(9));
end; $function$;
