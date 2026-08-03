-- bl_mail_0199 — CTA buttons rendered dark-on-blue instead of white-on-blue.
-- Applied to production 2026-08-03.
--
-- Every template wrote its button as a bare anchor: <a style="background:#2563eb;color:#fff">.
-- That inline colour is not enough. Gmail (web and app), Outlook.com and Apple Mail all
-- re-colour bare link text, and a browser preview of a link the reader has already visited
-- does the same - which turns the label the same dark purple-blue as the button behind it
-- and makes the CTA unreadable. Spotted on the broker email preview.
--
-- The fix email clients actually respect is a <span> inside the anchor carrying the colour
-- with !important. This wraps the label of every button in all 45 affected templates; the
-- anchor's own style attribute is left untouched, so nothing else about the layout moves.

update app_private.comm_templates
   set body = regexp_replace(body,
         '(<a\s[^>]*background:[^>]*>)([^<]+)(</a>)',
         '\1<span style="color:#ffffff !important;text-decoration:none">\2</span>\3', 'g'),
       updated_at = now()
 where body ~ '<a[^>]*background:'
   and body !~ '<span style="color:#ffffff';

-- Verified after apply: still_broken = 0, fixed = 45.
