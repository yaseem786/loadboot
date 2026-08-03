-- bl_mail_0198 — two templates for the people whose signup we broke, and the people who
-- simply never finished. Applied to production 2026-08-03.
--
-- Deliberately separate templates: apologising to someone whose email arrived fine reads as
-- noise, and nudging someone we actually failed reads as blaming them for our outage.
--
-- Both are tx.* so they render inside the standard branded shell (header, logo, footer, and
-- the "Rather just talk? Call us 24/7" line from bl_mail_0187) exactly like every other
-- transactional email - no bespoke one-off HTML.

insert into app_private.comm_templates
  (key, name, channel, channels, category, subject, preview_text, body, body_text, variables, status, active)
values
('tx.signup_recovery', 'Signup recovery - our send failed', 'email', array['email'], 'transactional',
 'Your LoadBoot account — that one was on us',
 'Your confirmation email never sent. Fixed, and your account is still waiting.',
 '<p>Hi {{first_name}},</p>'
 || '<p>You created a LoadBoot account and the confirmation email never reached you. That was a fault on our side — our email sender hit a sending limit and stopped delivering. Nothing you did, and nothing wrong with your details.</p>'
 || '<p>It is fixed. Your account is still there and the password you chose still works — this link finishes the setup:</p>'
 || '<p style="margin:18px 0 0"><a href="{{action_url}}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700">Confirm my account</a></p>'
 || '<p style="margin:18px 0 0">{{role_line}}</p>'
 || '<p style="margin:18px 0 0">If anything still looks wrong, reply to this email — it comes to me directly.</p>'
 || '<p style="margin:18px 0 0">Muhammad Yaseen<br><span style="color:#64748b">Founder, LoadBoot</span></p>',
 E'Hi {{first_name}},\n\nYou created a LoadBoot account and the confirmation email never reached you. That was a fault on our side - our email sender hit a sending limit and stopped delivering. Nothing you did.\n\nIt is fixed. Your account is still there and the password you chose still works. This link finishes the setup:\n{{action_url}}\n\n{{role_line}}\n\nIf anything still looks wrong, reply to this email - it comes to me directly.\n\nMuhammad Yaseen\nFounder, LoadBoot',
 array['first_name','action_url','role_line'], 'published', true),

('tx.signup_nudge', 'Signup nudge - never finished', 'email', array['email'], 'transactional',
 'You started a LoadBoot account — want me to finish it?',
 'Your account is still half-built. One link finishes it, or say the word and I will drop it.',
 '<p>Hi {{first_name}},</p>'
 || '<p>You started a LoadBoot account and never confirmed it. I would rather ask than assume — so, two options.</p>'
 || '<p>If you still want it, this takes you straight in:</p>'
 || '<p style="margin:18px 0 0"><a href="{{action_url}}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700">Finish setting up</a></p>'
 || '<p style="margin:18px 0 0">{{role_line}}</p>'
 || '<p style="margin:18px 0 0">If you have changed your mind, just ignore this — I will not email you about it again.</p>'
 || '<p style="margin:18px 0 0">Muhammad Yaseen<br><span style="color:#64748b">Founder, LoadBoot</span></p>',
 E'Hi {{first_name}},\n\nYou started a LoadBoot account and never confirmed it. I would rather ask than assume - so, two options.\n\nIf you still want it, this takes you straight in:\n{{action_url}}\n\n{{role_line}}\n\nIf you have changed your mind, just ignore this - I will not email you about it again.\n\nMuhammad Yaseen\nFounder, LoadBoot',
 array['first_name','action_url','role_line'], 'published', true)
on conflict (key) do update set
  subject = excluded.subject, preview_text = excluded.preview_text, body = excluded.body,
  body_text = excluded.body_text, variables = excluded.variables,
  status = excluded.status, active = excluded.active, updated_at = now();
