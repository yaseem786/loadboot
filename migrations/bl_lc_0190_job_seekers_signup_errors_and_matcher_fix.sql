-- bl_lc_0190 — Live-chat knowledge base: job seekers, signup failures, and a matcher fix.
-- Applied to production 2026-08-01 (this file is the repo record of that change).
--
-- Live conversation 99a5fd42 on 1 Aug. Bushra Tehreem, two years' dispatching experience,
-- asked to apply for a job four separate times and was never once shown careers.html. The
-- first time she got a generic "let's set up your account" answer. The second time she got
-- an explanation of our dispatch SERVICE — how we find loads for carriers — which is not
-- what she asked for. The third time she got an explanation of the MOBILE APP.
--
-- That third answer was a matcher bug, not a content gap. KB row 26 carried the bare
-- pattern 'app', and trigram similarity scores "apply" against "app" high enough to win
-- outright. So a qualified dispatcher asking for work was told to open the portal in her
-- phone browser and add a web page to her home screen. Four asks, four misses, and the one
-- thing she actually needed — the careers page — never appeared.
--
-- She also reported a real product failure in the same conversation: "error sending
-- confirmation email" when trying to create an account. The bot talked straight past it and
-- kept selling. That is a person telling us our signup is broken and being ignored.
--
-- Fixes in this migration:
--   * A job-application answer at priority 88, above the dispatch-service row, so "I want to
--     apply for a job" resolves to careers.html and not to what LoadBoot sells. It also
--     splits the two real doors: a salaried dispatcher role, or the Agent program.
--   * Follow-on answers for each of those two doors (priorities 86 and 84).
--   * Row 26 narrowed: the bare 'app' pattern is gone, replaced by phrases that can never
--     eat apply / application / applicant.
--   * A signup-trouble answer at priority 92 — above everything else — so a broken signup is
--     acknowledged and handed to a human instead of being answered with marketing.
--   * A generic "ok next" answer at priority 40, plus the four questions that were sitting
--     unresolved in lc_misses from this conversation.

update app_private.lc_kb set patterns = array['mobile app', 'phone app', 'download the app', 'install the app', 'app store', 'play store', 'ios app', 'android app', 'iphone app', 'is there an app'] where id = 26;

insert into app_private.lc_kb (patterns, answer, priority) values
  (array['apply as a dispatcher', 'apply for a job', 'how can i apply', 'how do i apply', 'i want to apply', 'apply remotely', 'remote dispatcher job', 'dispatcher job', 'dispatching job', 'job application', 'looking for a job', 'need a job', 'want to work with you', 'want to work for you', 'work for your company', 'are you hiring', 'any vacancy', 'job vacancy', 'send my resume', 'send my cv', 'my resume', 'my cv', 'employment', 'recruitment', 'hire me', 'position available', 'part time job', 'full time job', 'work from home job'],
   'Yes — we hire dispatchers, and remote is normal for us. 🧑‍✈️

<b>To apply:</b> open <b>https://loadboot.com/careers.html</b>, find the role that fits, and send your CV to <b>hello@loadboot.com</b> with "Dispatcher application" in the subject line. Tell us your years of dispatching experience, the equipment you know best, and which hours you can cover.

One thing worth knowing: there are two different doors here. A <b>salaried dispatcher role</b> with us, or joining as an <b>Agent</b> — you bring your own carriers and earn 1% of every load they deliver, no salary but no ceiling either. Plenty of experienced dispatchers do the second.

Which one sounds more like what you want?
[[chips:💼 A dispatcher job=I want a salaried dispatcher job|🤝 The agent program=Tell me about the agent program|👤 Talk to a person=I want to talk to a real person]]',
   88),
  (array['salaried dispatcher job', 'i want a salaried dispatcher job', 'staff dispatcher', 'employee dispatcher', 'dispatcher salary', 'how much do dispatchers earn', 'dispatcher pay'],
   'Good — that is the employed route. 💼

Roles and pay details are on <b>https://loadboot.com/careers.html</b>. Send your CV to <b>hello@loadboot.com</b> and include: years dispatching, equipment you know best, the hours you can cover (we run on US Central time), and whether you have worked under a carrier''s own authority before.

Drop your name and email below too and I will make sure the hiring side sees you rather than waiting on the inbox. 👇

[[form:name,email]]',
   86),
  (array['tell me about the agent program', 'agent program', '1% program', 'referral program details', 'become an agent', 'join as an agent', 'how does the agent program work'],
   'The Agent program is for dispatchers who already have carriers, or can bring them. 🤝

• You earn <b>1% of gross on every delivered load</b> your carriers move — for as long as they keep running.
• Paid out of LoadBoot''s own 5%. Your carriers never pay a rupee or cent extra.
• You get a referral link, a live earnings dashboard, and overrides five levels deep.
• No salary, no cap, no exclusivity — you can keep your own book.

Start here: https://loadboot.com/create-agent-account.html — or say <b>"start my setup"</b> and I will do the whole thing with you right here.',
   84),
  (array['error sending confirmation email', 'confirmation email error', 'didnt get the confirmation email', 'did not receive confirmation email', 'no confirmation email', 'verification email not received', 'didnt get verification email', 'email not coming', 'cant create account', 'cannot create account', 'error creating account', 'signup not working', 'sign up not working', 'registration failed', 'account not created', 'stuck on signup', 'error on signup'],
   'Sorry — that one is on us, not on you. 🙏

Sometimes our confirmation emails hit a sending limit and the signup errors out even though your account was created. Two things to try first: check your <b>spam and promotions folders</b>, and wait a few minutes — they sometimes arrive late.

If it still has not arrived, leave your name and email below. Our team confirms the account by hand and emails you a working sign-in link — usually within a business day, and you will not have to sign up again. 👇

[[form:name,email]]',
   92),
  (array['ok next', 'next', 'whats next', 'what next', 'and then', 'continue', 'go on then', 'ok now what', 'then what', 'proceed'],
   'Sure — where do you want to go next? 👇

[[chips:🚀 Set up my account=Start my 5-minute setup|💰 Pricing=What does LoadBoot cost?|🚚 Find loads=How do I find loads for my truck?|💼 Apply for a job=I want to apply for a job|🙋 Talk to a person=I want to talk to a real person]]',
   40);

update app_private.lc_misses set resolved = true
where lower(question) in ('ok next','hola','con este perfil conseguiré trabajo en 24 horas')
   or lower(question) like 'ok entonces busco puesto%';
