-- bl_comm_0543 — app_private.email_kit(jsonb): the ONE premium email BODY (owner, 12 Oct 2026)
--
-- Every LoadBoot email = delivery-worker shell (supabase/functions/_shared/email-shell.ts: real logo, brand bar,
-- call/WhatsApp band from the contact switch, footer) + a body FRAGMENT. Until now every body was hand-rolled, so each
-- email looked different and drafts drew their own (fake) header. This function is the standard body: same type
-- scale, colours, cards and button in every premium email, mobile-first (the shell's @media turns .lb-btn into a
-- full-width button and .lb-pad into 22px gutters on phones), table-based for Outlook, link colours on an inner
-- <span> with !important (delivery-worker v14 rule).
--
-- NEVER put a logo, header, footer, unsubscribe link or contact line/number in the body — the shell adds them.
-- Preview: select app_private.email_kit('{...}') → save → node tools/email-preview/preview.mjs body.html
-- Doc: claude/EMAIL-SHELL-0543.md · CLAUDE.md §10.
--
-- Input (all optional except title). Text fields are ESCAPED; *_html fields are trusted (build them in SQL and escape
-- any customer data with app_private.h_esc). URLs must be https:// or a {{token}}; anything else is dropped.
-- {
--   "eyebrow":  {"text": "Account active", "tone": "success|info|warning|danger|neutral"},
--   "title":    "You're all set, Mohamed.",
--   "intro":    "plain text"            | "intro_html": "<b>MEDO</b> is ...",
--   "card":     {"title": "Verified by our compliance team", "tone": "success", "items": ["MC authority", "W-9"]},
--               (bullet follows the tone: success ✓ · warning ! · danger ✕ · info/neutral •)
--   "facts":    [{"k": "Load", "v": "Dallas, TX → Atlanta, GA"}, ...],
--   "step":     {"label": "Your next step", "title": "Post your truck", "text": "plain text"},
--   "cta":      {"label": "Open my dashboard", "url": "https://loadboot.com/app/carrier/#dashboard"},
--   "secondary":{"label": "See how matching works", "url": "https://..."},
--   "note":     "small print",
--   "signoff":  "The LoadBoot team"   (default)
-- }

create or replace function app_private.email_kit(p jsonb)
returns text
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  o text := '';
  tones jsonb := '{
    "success": ["#166534", "#f0fdf4", "#bbf7d0"],
    "info":    ["#075985", "#f0f9ff", "#bae6fd"],
    "warning": ["#92400e", "#fffbeb", "#fde68a"],
    "danger":  ["#991b1b", "#fef2f2", "#fecaca"],
    "neutral": ["#334155", "#f8fafc", "#e2e8f0"]}'::jsonb;
  t jsonb; it jsonb; rows text; u text; first boolean;
begin
  -- eyebrow: status chip
  if coalesce(p->'eyebrow'->>'text', '') <> '' then
    t := coalesce(tones->(p->'eyebrow'->>'tone'), tones->'info');
    o := o || format(
      '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px"><tr>'
      || '<td style="background:%s;border:1px solid %s;border-radius:999px;padding:6px 13px;font-size:12px;font-weight:800;'
      || 'letter-spacing:.07em;text-transform:uppercase;color:%s;line-height:1">&#9679;&nbsp; %s</td></tr></table>',
      t->>1, t->>2, t->>0, app_private.h_esc(p->'eyebrow'->>'text'));
  end if;

  -- title
  o := o || format('<h1 style="margin:0 0 14px;font-size:26px;line-height:1.25;font-weight:800;color:#0f172a;'
                   || 'letter-spacing:-.015em">%s</h1>', app_private.h_esc(coalesce(p->>'title', '')));

  -- intro
  if coalesce(p->>'intro_html', '') <> '' then
    o := o || '<p style="margin:0 0 24px;font-size:16px;line-height:1.65;color:#334155">' || (p->>'intro_html') || '</p>';
  elsif coalesce(p->>'intro', '') <> '' then
    o := o || '<p style="margin:0 0 24px;font-size:16px;line-height:1.65;color:#334155">'
            || app_private.h_esc(p->>'intro') || '</p>';
  end if;

  -- card: checklist
  if jsonb_typeof(p->'card'->'items') = 'array' and jsonb_array_length(p->'card'->'items') > 0 then
    t := coalesce(tones->(p->'card'->>'tone'), tones->'success');
    rows := '';
    for it in select * from jsonb_array_elements(p->'card'->'items') loop
      rows := rows || format(
        '<tr><td valign="top" style="padding:4px 12px 4px 0;font-size:15px;line-height:1.5;font-weight:800;color:%s">%s</td>'
        || '<td style="padding:4px 0;font-size:15px;line-height:1.5;color:#0f172a">%s</td></tr>',
        t->>0,
        case coalesce(p->'card'->>'tone', 'success') when 'success' then '&#10003;' when 'warning' then '!'
             when 'danger' then '&#10005;' else '&#8226;' end,
        app_private.h_esc(it #>> '{}'));
    end loop;
    o := o || format(
      '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;background:%s;'
      || 'border:1px solid %s;border-radius:14px"><tr><td style="padding:18px 22px">%s'
      || '<table role="presentation" cellpadding="0" cellspacing="0">%s</table></td></tr></table>',
      t->>1, t->>2,
      case when coalesce(p->'card'->>'title', '') <> '' then
        format('<div style="font-size:13px;font-weight:800;letter-spacing:.02em;color:%s;margin:0 0 10px">%s</div>',
               t->>0, app_private.h_esc(p->'card'->>'title')) else '' end,
      rows);
  end if;

  -- facts: key / value rows
  if jsonb_typeof(p->'facts') = 'array' and jsonb_array_length(p->'facts') > 0 then
    rows := ''; first := true;
    for it in select * from jsonb_array_elements(p->'facts') loop
      rows := rows || format(
        '<tr><td style="padding:12px 18px;font-size:13px;color:#64748b;%s">%s</td>'
        || '<td align="right" style="padding:12px 18px;font-size:14px;font-weight:700;color:#0f172a;%s">%s</td></tr>',
        case when first then '' else 'border-top:1px solid #eef2f7' end, app_private.h_esc(it->>'k'),
        case when first then '' else 'border-top:1px solid #eef2f7' end, app_private.h_esc(it->>'v'));
      first := false;
    end loop;
    o := o || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;'
            || 'border:1px solid #e2e8f0;border-radius:14px">' || rows || '</table>';
  end if;

  -- step: the one thing to do next
  if coalesce(p->'step'->>'title', '') <> '' then
    o := o || format(
      '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="margin:0 0 26px;background:#f5f9ff;'
      || 'border:1px solid #dbeafe;border-radius:14px"><tr>'
      || '<td width="4" style="width:4px;background:#0883F7;border-radius:14px 0 0 14px;font-size:0;line-height:0">&nbsp;</td>'
      || '<td style="padding:18px 22px">'
      || '<div style="font-size:12px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:#0883F7;margin:0 0 6px">%s</div>'
      || '<div style="font-size:18px;line-height:1.35;font-weight:800;color:#0f172a;margin:0 0 6px">%s</div>'
      || '<div style="font-size:15px;line-height:1.6;color:#334155">%s</div></td></tr></table>',
      app_private.h_esc(coalesce(nullif(p->'step'->>'label', ''), 'Your next step')),
      app_private.h_esc(p->'step'->>'title'),
      app_private.h_esc(coalesce(p->'step'->>'text', '')));
  end if;

  -- cta: bulletproof button (full width on phones via the shell's .lb-btn rule)
  u := p->'cta'->>'url';
  if coalesce(p->'cta'->>'label', '') <> '' and (u ~ '^https://' or u ~ '^\{\{[a-z_]+\}\}$') then
    o := o || format(
      '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 6px"><tr>'
      || '<td class="lb-btn" bgcolor="#FC5305" style="background:#FC5305;border-radius:10px">'
      || '<a class="lb-btn" href="%s" style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:800;'
      || 'color:#ffffff !important;text-decoration:none;border-radius:10px">'
      || '<span style="color:#ffffff !important;text-decoration:none">%s &rarr;</span></a></td></tr></table>',
      replace(app_private.h_esc(u), '"', '&quot;'), app_private.h_esc(p->'cta'->>'label'));
  end if;

  -- secondary link
  u := p->'secondary'->>'url';
  if coalesce(p->'secondary'->>'label', '') <> '' and (u ~ '^https://' or u ~ '^\{\{[a-z_]+\}\}$') then
    o := o || format(
      '<p style="margin:14px 0 0;font-size:14px"><a href="%s" style="color:#0883F7 !important;font-weight:700;'
      || 'text-decoration:none"><span style="color:#0883F7 !important;text-decoration:none">%s &rarr;</span></a></p>',
      replace(app_private.h_esc(u), '"', '&quot;'), app_private.h_esc(p->'secondary'->>'label'));
  end if;

  -- note
  if coalesce(p->>'note', '') <> '' then
    o := o || '<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#64748b">' || app_private.h_esc(p->>'note') || '</p>';
  end if;

  -- sign-off
  o := o || format('<p style="margin:28px 0 0;font-size:15px;line-height:1.6;color:#0f172a">Thanks,<br><b>%s</b></p>',
                   app_private.h_esc(coalesce(nullif(p->>'signoff', ''), 'The LoadBoot team')));
  return o;
end; $function$;

revoke execute on function app_private.email_kit(jsonb) from public, anon, authenticated;
