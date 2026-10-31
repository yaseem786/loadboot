-- bl_mail_0587 — signatures finalised against published brand standards (CP brand manual, J.B. Hunt style guide,
-- UW-Madison / Northwestern IT guidance), owner ask 31 Oct 2026:
--   fixed order: name → title/company → email → website → address → business hours → brand promise (brand colour);
--   text only (no image/background), system font, one accent colour, no separator symbols (one item per line).
-- hello@ is the founder's mailbox (dispatch/signatures/hello-signature.html, bl_comm_0464) → Muhammad Yaseen, Founder.
-- dispatch@ / billing@ / loads@ are shared desks → the desk name (staff has no stored names; none are invented).
-- Logo + Call/WhatsApp stay in the delivery-worker shell only (§10).
update app_private.mail_boxes m set signature_html = format(
  '<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td style="border-left:3px solid %1$s;padding-left:14px;vertical-align:top">'
  || '<div style="font-size:15px;line-height:1.4;font-weight:700;color:#10223B">%2$s</div>'
  || '<div style="font-size:12.5px;line-height:1.5;color:#475569">%3$s</div>'
  || '<div style="font-size:12.5px;line-height:1.6;padding-top:8px"><a href="mailto:%4$s" style="color:#10223B;text-decoration:none">%4$s</a></div>'
  || '<div style="font-size:12.5px;line-height:1.6"><a href="https://loadboot.com" style="color:#0883F7;text-decoration:none;font-weight:700">loadboot.com</a></div>'
  || '<div style="font-size:11px;line-height:1.6;padding-top:6px;color:#94a3b8">LoadBoot LLC, 30 N Gould St Ste N, Sheridan, WY 82801</div>'
  || '<div style="font-size:11px;line-height:1.6;color:#94a3b8">Mon&ndash;Fri 8 AM&ndash;6 PM ET, Sat 9 AM&ndash;1 PM ET</div>'
  || '<div style="font-size:11px;line-height:1.6;padding-top:6px"><span style="color:#FC5305;font-weight:700;letter-spacing:.4px;text-transform:uppercase">Keep Your Wheels Earning</span></div>'
  || '</td></tr></table>', v.c, v.name, v.title, v.addr)
from (values
  ('hello@loadboot.com',    'Muhammad Yaseen',    'Founder, LoadBoot',                       '#0883F7'),
  ('dispatch@loadboot.com', 'LoadBoot Dispatch',  'Dispatch Desk, Loads and Carriers',       '#FC5305'),
  ('billing@loadboot.com',  'LoadBoot Billing',   'Billing and Settlements',                 '#16a34a'),
  ('loads@loadboot.com',    'LoadBoot Load Desk', 'Freight and Load Postings',               '#7c3aed')
) v(addr, name, title, c)
where m.address = v.addr;
