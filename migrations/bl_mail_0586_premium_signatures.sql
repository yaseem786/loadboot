-- bl_mail_0586 — premium CC Mailbox signatures (owner ask 31 Oct 2026: Amazon-style, automatic).
-- The delivery-worker shell already adds the logo, the Call/WhatsApp band and the footer to every mail.* reply (§10),
-- so the signature is the sign-off only: team, department, mailbox, site, business hours, tagline — no logo, no number.
-- Inline styles only (survive Gmail/Outlook and the composer's sanitizer). One colour accent per mailbox.
update app_private.mail_boxes m set signature_html = format(
  '<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td style="border-left:3px solid %1$s;padding-left:14px;vertical-align:top">'
  || '<div style="font-size:15px;line-height:1.4;font-weight:700;color:#10223B">%2$s</div>'
  || '<div style="font-size:12px;line-height:1.5;color:#64748b;letter-spacing:.2px">%3$s &middot; LoadBoot</div>'
  || '<div style="font-size:12.5px;line-height:1.7;padding-top:6px;color:#10223B"><a href="mailto:%4$s" style="color:#10223B;text-decoration:none">%4$s</a>'
  || '<span style="color:#94a3b8"> &nbsp;|&nbsp; </span><a href="https://loadboot.com" style="color:#0883F7;text-decoration:none;font-weight:700">loadboot.com</a></div>'
  || '<div style="font-size:11px;line-height:1.6;color:#94a3b8">Mon&ndash;Fri 8 AM&ndash;6 PM ET &middot; Sat 9 AM&ndash;1 PM ET</div>'
  || '<div style="font-size:11px;line-height:1.6;padding-top:4px"><span style="color:#FC5305;font-weight:700;letter-spacing:.4px;text-transform:uppercase">Keep Your Wheels Earning</span></div>'
  || '</td></tr></table>', v.c, v.team, v.dept, v.addr)
from (values
  ('hello@loadboot.com',    'The LoadBoot Team',  'Carrier Success &middot; Support',            '#0883F7'),
  ('dispatch@loadboot.com', 'LoadBoot Dispatch',  'Dispatch Desk &middot; Loads &amp; Carriers', '#FC5305'),
  ('billing@loadboot.com',  'LoadBoot Billing',   'Billing &amp; Settlements',                   '#16a34a'),
  ('loads@loadboot.com',    'LoadBoot Load Desk', 'Freight &amp; Load Postings',                 '#7c3aed')
) v(addr, team, dept, c)
where m.address = v.addr;
