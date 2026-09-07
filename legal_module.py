# legal_module.py — security.html, cookies.html and delete-account.html, brought to the same
# flagship standard as privacy.html and terms.html (6 Sep 2026). Reuses privacy_module's CSS
# so all five legal pages read as one family.
#
# Same rule as the other two: everything here is checked against what the platform actually
# does. The cookie table names the real tags on the real pages — Google Analytics 4
# (G-C2ELQ7H8EM), Microsoft Clarity (xvcrda1da1) and the Trustpilot widget — and the
# statement that the signed-in portals carry none of them was verified by grepping every
# portal index.html for clarity/gtag/googletagmanager and finding zero. Our own code writes
# no cookies at all (no document.cookie anywhere); first-party state is localStorage, which
# never leaves the device. Re-check before changing any of these claims.

import json, re
from privacy_module import PV_CSS, _sec, _table, _promise, _role

def _faq_block(faqs, sid='faq', eyebrow='Questions people actually ask', h2='Straight answers'):
    rows = ''.join('<details><summary>%s</summary><p>%s</p></details>' % (q, a) for q, a in faqs)
    def plain(x):
        x = re.sub(r'<[^>]+>', '', x)
        for a, c in [('&mdash;','—'),('&rsquo;','’'),('&ldquo;','“'),('&rdquo;','”'),
                     ('&amp;','&'),('&rarr;','→'),('&middot;','·'),('&ndash;','–')]:
            x = x.replace(a, c)
        return x.strip()
    schema = '<script type="application/ld+json">%s</script>' % json.dumps({
        '@context': 'https://schema.org', '@type': 'FAQPage',
        'mainEntity': [{'@type': 'Question', 'name': plain(q),
                        'acceptedAnswer': {'@type': 'Answer', 'text': plain(a)}} for q, a in faqs]},
        ensure_ascii=False)
    return _sec(sid, eyebrow, h2, '', '<div class="pv-faq">%s</div>' % rows, 'soft'), schema


def _hero(kicker, h1_plain, h1_grad, lead, chips, stamp):
    return ('<section class="pv-hero"><div class="wrap">'
            '<span class="pv-kick"><span class="dot"></span>%s</span>'
            '<h1>%s <span class="pv-grad">%s</span></h1>'
            '<p class="pv-lead">%s</p>'
            '<div class="pv-chips">%s</div>'
            '<div class="pv-stamp">%s</div>'
            '</div></section>') % (kicker, h1_plain, h1_grad, lead,
            ''.join('<span class="pv-chip">%s</span>' % c for c in chips), stamp)


def _nav(items):
    return '<div class="pv-nav"><div class="wrap"><nav class="pv-nav-in">%s</nav></div></div>' % ''.join(
        '<a href="#%s">%s</a>' % (i, t) for i, t in items)


def _legal_footer_links(current):
    all_links = [('privacy.html', 'Privacy Policy'), ('terms.html', 'Terms of Service'),
                 ('security.html', 'Security &amp; Trust'), ('cookies.html', 'Cookie Policy'),
                 ('delete-account.html', 'Delete your account')]
    btns = ''.join('<a class="btn btn-secondary" href="%s">%s</a>' % (h, t)
                   for h, t in all_links if h != current)
    return ('<div style="margin-top:26px;display:flex;gap:10px;flex-wrap:wrap">%s</div>' % btns)


# ============================== SECURITY ==============================
def security_page(ctx=None):
    b = PV_CSS
    b += _hero('LoadBoot Security &amp; Trust',
        'Is this platform safe to hand my paperwork to?',
        'Here is how to check, not just take our word.',
        'Every carrier asks it and almost nobody gets a real answer. This page names the specific '
        'controls, what each one actually stops, how to spot an email pretending to be us, and what '
        'to do the moment something looks wrong.',
        ['<b>No</b> password ever asked for', '<b>Private</b> document storage',
         '<b>Two people</b> for money', '<b>Full</b> audit trail'],
        '<b>This is the LoadBoot security page.</b> Last updated <b>6 September 2026</b> &middot; '
        'report anything suspicious to <a href="mailto:security@loadboot.com" style="color:#7dd3fc">security@loadboot.com</a>')
    b += _nav([('built', 'How it is built'), ('phishing', 'Spotting a fake'),
               ('yours', 'Your own account'), ('report', 'Report something'), ('faq', 'FAQ')])

    b += _sec('built', 'How it is built', 'Six controls, and what each one actually stops',
        'The useful question is not &ldquo;is it encrypted&rdquo; &mdash; everything is. It is: what '
        'happens when someone tries to reach data that is not theirs?',
        _promise([
            ('&#128274;', 'The server decides, not the screen',
             'Your organisation is resolved from your session on the server, and every action is permission-checked there. Hiding a button is not access control; the database refusing the row is. <b>Stops:</b> one company ever seeing another&rsquo;s loads, trips or documents.'),
            ('&#128193;', 'Documents live in your own folder',
             'Every upload is stored under a path belonging to your account, in a private store. Viewing one mints a signed link that expires in minutes. There is no public URL to guess or share by accident. <b>Stops:</b> a leaked link turning into a permanent open door.'),
            ('&#127974;', 'Even our dispatchers are fenced in',
             'The rule granting an assigned dispatcher access names four document types &mdash; authority, insurance, W-9 and factoring NOA. Your bank verification is not among them, so the request is refused at the data layer. <b>Stops:</b> an insider reaching your banking details.'),
            ('&#128176;', 'Two people for money',
             'Money-moving actions use maker-checker: whoever creates one cannot be the person who approves it. <b>Stops:</b> a single compromised or dishonest account releasing funds.'),
            ('&#128221;', 'Everything leaves a trace',
             'Bookings, payments, claims and document events are timestamped records. <b>Stops:</b> a dispute becoming your word against ours &mdash; we can show who did what, and when.'),
            ('&#128257;', 'Separate environments, reversible changes',
             'Testing and production are strictly separated, and database changes are tracked with documented rollbacks. <b>Stops:</b> an experiment touching real carrier data, and a bad change becoming permanent.'),
        ]))

    b += _sec('phishing', 'The attack that actually happens', 'How to spot a fake LoadBoot email in five seconds',
        'Nobody breaks the encryption. They send you an email. Freight is targeted heavily because '
        'payment details are worth stealing &mdash; so these five rules matter more than any badge on a website.',
        _promise([
            ('&#128273;', 'We never ask for your password',
             'Not by email, not by text, not on a call, ever. Our staff cannot see your password and will never ask you to &ldquo;confirm&rdquo;, &ldquo;reactivate&rdquo;, &ldquo;re-sync&rdquo; or &ldquo;verify&rdquo; one.'),
            ('&#9993;', 'Our mail only comes from @loadboot.com',
             'Check the actual address, not the display name &mdash; anyone can put &ldquo;LoadBoot&rdquo; in front of a random Gmail address. Real mail arrives from hello@, dispatch@ or billing@loadboot.com.'),
            ('&#128279;', 'Never sign in from an email link',
             'If a message wants you to log in, close it, type loadboot.com yourself, and go to the portal. That one habit defeats almost every phishing attempt ever sent.'),
            ('&#128176;', 'We never change payment details by email',
             'Banking and factoring changes are made only by you, inside the portal. An email asking you to update where your money goes is fraud &mdash; every single time, with no exceptions.'),
            ('&#9888;', 'Real subjects vs fake ones',
             'We email about load offers, rate confirmations, documents, settlements and account notices. We never send &ldquo;your mailbox is full&rdquo;, &ldquo;your password expires today&rdquo; or &ldquo;your account will be deleted in 24 hours&rdquo;.'),
            ('&#128225;', 'Our domain is locked down',
             'SPF, DKIM and DMARC are all published and enforced on loadboot.com, so mail forged in our name is rejected by most inboxes before you ever see it. It is not a guarantee &mdash; the rules above still apply.'),
        ]), 'soft')

    b += _sec('yours', 'Your side of it', 'Three things that protect you more than anything we can do',
        'Most account compromises in trucking start on the carrier&rsquo;s side, not the platform&rsquo;s.',
        '<div class="pv-grid pv-g3">' + ''.join(
            '<div class="pv-right"><div class="n">%s</div><div><h3>%s</h3><p>%s</p></div></div>' % t for t in [
            ('1', 'Turn on two-factor authentication',
             'In your portal under Settings &rarr; Security. A stolen password alone then gets nobody in. It takes about a minute.'),
            ('2', 'Give logins carefully',
             'Everything done under your account is your responsibility. Anyone who leaves the company should lose access the same day.'),
            ('3', 'Check the payout account after any change',
             'Payouts only go to the account you verified with a bank document. If you ever see one you do not recognise, stop and call us on +1 (469) 253-7575.'),
        ]) + '</div>')

    b += _sec('report', 'Report something', 'Found a bug, or an email that looks wrong?', '',
        '<div class="pv-grid pv-g2">'
        '<div class="pv-promise"><div class="ic">&#128027;</div><h3>Security researchers</h3>'
        '<p>Email <a href="mailto:security@loadboot.com">security@loadboot.com</a> with what you found and how to reproduce it. We read every report, we will confirm receipt, and we do not threaten people who report problems in good faith.<br><br>Please do not test against real carrier accounts or real freight &mdash; tell us instead and we will work it through with you.</p></div>'
        '<div class="pv-promise"><div class="ic">&#128231;</div><h3>Carriers, brokers and shippers</h3>'
        '<p>Forward the suspicious message to <a href="mailto:security@loadboot.com">security@loadboot.com</a> &mdash; forward it, do not screenshot it, so we can see the real sending address.<br><br>If you already clicked something or entered a password, call <b>+1 (469) 253-7575</b> straight away. Speed matters far more than embarrassment; we have seen it all and nobody gets a lecture.</p></div>'
        '</div>' + _legal_footer_links('security.html'), 'soft')

    faq_html, schema = _faq_block([
        ('Is LoadBoot safe to give my MC number and documents to?',
         'Your documents sit in a private store under your own account folder, reachable only through short-lived signed links, and access is enforced by database rules rather than by the interface. The full list of who can open each document type is on our <a href="privacy.html#documents">Privacy Policy</a>, document by document.'),
        ('Can a broker see my phone number or email?',
         'No. Brokers see your company, MC/DOT, equipment and verification status. Your phone and email stay hidden and LoadBoot dispatch handles contact, which is why brokers cannot cold-call your drivers off the board.'),
        ('Can a LoadBoot dispatcher see my bank details?',
         'No, and not merely as policy. The database rule granting dispatcher access lists four document types — authority, insurance, W-9 and factoring NOA. A bank verification document is not one of them, so the request is refused at the data layer.'),
        ('Is LoadBoot SOC 2 certified?',
         'No, and we will not imply otherwise. SOC 2 is an audit we have not yet undertaken. What we can point to are the specific controls on this page, which you can test against your own account rather than take on trust.'),
        ('I got an email saying my LoadBoot account will be closed. Is it real?',
         'Almost certainly not. We do not send deadline threats, password-expiry notices or mailbox-full warnings. Forward it to security@loadboot.com and do not click anything in it.'),
        ('Someone emailed asking me to update the bank details on my account. What do I do?',
         'Treat it as fraud. We never change payment details by email under any circumstance. Forward the message to security@loadboot.com and, if you acted on it, call +1 (469) 253-7575 immediately.'),
        ('Does LoadBoot sell my data?',
         'No. There is no advertising business and no data-sales business, so there is nothing to sell it for — and no ad tracking runs inside the signed-in portals or the app.'),
        ('What happens to my data if I close my account?',
         'Your profile, documents and preferences are deleted. A narrow set of records that US tax and transport law requires is retained for the legal period. Our <a href="delete-account.html">account deletion page</a> lists each category and the exact retention period.'),
    ])
    b += faq_html
    b += ('<section class="pv-sec"><div class="wrap"><div class="pv-cta">'
          '<h2>See something that worries you?</h2>'
          '<p>Tell us. A person reads security@loadboot.com, and we would far rather hear about a problem from you than read about it later.</p>'
          '<div class="row"><a class="btn btn-primary" href="mailto:security@loadboot.com">Email security@loadboot.com</a>'
          '<a class="btn btn-secondary" href="privacy.html">Read the Privacy Policy</a></div>'
          '</div></div></section>')
    return b, schema


# ============================== COOKIES ==============================
def cookies_page(ctx=None):
    b = PV_CSS
    b += _hero('LoadBoot Cookie Policy',
        'Three tags on our public pages.',
        'None inside your portal.',
        'Most cookie pages describe cookies in general and name none of them. This one lists every '
        'tag we load, what it stores, how long it lasts, and how to switch it off &mdash; and it is '
        'honest about the one that records how you move through a page.',
        ['<b>0</b> cookies written by our own code', '<b>0</b> tracking inside the portals',
         '<b>No</b> advertising cookies', '<b>Blockable</b> without breaking anything'],
        '<b>This is the LoadBoot Cookie Policy.</b> Last updated <b>6 September 2026</b> &middot; '
        'part of our <a href="privacy.html" style="color:#7dd3fc">Privacy Policy</a>')
    b += _nav([('third', 'What we load'), ('own', 'Our own storage'),
               ('portals', 'Inside the portals'), ('control', 'Turning it off'), ('faq', 'FAQ')])

    b += _sec('third', 'Third-party tags', 'Everything loaded on loadboot.com, named',
        'These run on the <b>public marketing pages only</b>. Each is listed with what it stores and '
        'how long it keeps it.',
        _table(['Tag', 'What it is for', 'What it stores', 'How long'], [
            ['<b>Google Analytics 4</b><br><span class="who">G-C2ELQ7H8EM</span>',
             'How many people reach a page and which pages actually help. Aggregate only &mdash; we never look up an individual.',
             '<code>_ga</code>, <code>_ga_C2ELQ7H8EM</code> &mdash; a random identifier for the browser, not for you.',
             '2 years'],
            ['<b>Microsoft Clarity</b><br><span class="who">xvcrda1da1</span>',
             '<b>Session recording and heatmaps.</b> It replays how a visitor moved through a page, so we can see where a form or a layout confuses people. This is more than counting visits and we would rather say so plainly.',
             '<code>_clck</code>, <code>_clsk</code>, and <code>CLID</code> on Clarity&rsquo;s own domain. Clarity masks text input by default, so what you type in a field is not captured.',
             '<code>_clck</code> 1 year<br><code>_clsk</code> 1 day'],
            ['<b>Trustpilot widget</b>',
             'Shows our real review score on the page. It is loaded from Trustpilot so the score cannot be faked by us.',
             'Whatever Trustpilot sets when its widget loads, under its own domain and its own policy.',
             'Per Trustpilot'],
        ]) +
        '<div class="pv-note"><b>What is deliberately absent.</b> No advertising cookies, no retargeting '
        'pixels, no Meta or LinkedIn tracking, no data brokers, no cross-site ad profiles. We do not sell '
        'advertising and we do not buy it against your browsing, so there is nothing here to serve that.</div>')

    b += _sec('own', 'Our own storage', 'We write no cookies at all',
        'This surprises people, so here is the detail. LoadBoot&rsquo;s own code sets zero cookies &mdash; '
        'there is no <code>document.cookie</code> anywhere in it. What we do use is <b>localStorage</b>, '
        'which lives in your browser on your device and is never transmitted to us.',
        _table(['What we keep on your device', 'Why', 'Leaves your device?'], [
            ['<b>Your sign-in session</b><br><span class="who">lb-auth-&hellip;</span>',
             'Keeps you signed in so you are not typing a password on every page. Strictly necessary &mdash; clearing it signs you out.',
             'No. It is sent only to authenticate you when you make a request.'],
            ['<b>Interface preferences</b><br><span class="who">last portal used, open tabs, map style, collapsed panels</span>',
             'So the app opens where you left it instead of resetting every time.',
             'No.'],
            ['<b>Your own lists and drafts</b><br><span class="who">saved load filters, favourite loads, an unsent draft</span>',
             'So a half-finished form survives a refresh and your filters are still there tomorrow.',
             'No.'],
            ['<b>&ldquo;Do not show me this again&rdquo; flags</b><br><span class="who">install hint, push prompt, geo prompt</span>',
             'So a prompt you dismissed stays dismissed.',
             'No.'],
            ['<b>Referral code</b><br><span class="who">lb_ref</span>',
             'If you arrived through an agent&rsquo;s referral link, so that agent gets credited when you sign up.',
             'Only at sign-up, to attach the referral to the account.'],
        ]) +
        '<div class="pv-note">Clearing your browser data removes all of it. You will be signed out and your '
        'preferences reset &mdash; nothing else is lost, because none of it lives only in your browser.</div>', 'soft')

    b += _sec('portals', 'The important part', 'Nothing tracks you inside the portals',
        '',
        '<div class="pv-grid pv-g2">'
        '<div class="pv-promise"><div class="ic">&#128683;</div><h3>The signed-in app carries no analytics</h3>'
        '<p>Google Analytics, Clarity and Trustpilot load on the public marketing pages. They are <b>not</b> '
        'present in the Carrier, Partner, Agent or Command Center portals, and not in the Android app. '
        'Nobody is recording your session while you work a load, upload a W-9 or look at your settlements.</p></div>'
        '<div class="pv-promise"><div class="ic">&#128064;</div><h3>Why we still use Clarity outside</h3>'
        '<p>Because a signup form that quietly fails on one phone model costs carriers real money, and a '
        'heatmap finds that in a day. It runs on marketing pages, where the worst you can reveal is which '
        'paragraph you read. The moment you sign in, it stops.</p></div>'
        '</div>')

    b += _sec('control', 'Your choices', 'How to switch any of it off',
        'None of these break the site. Sign-in storage is the only thing the app genuinely needs.',
        '<div class="pv-grid pv-g2">' + ''.join(
            '<div class="pv-right"><div class="n">%s</div><div><h3>%s</h3><p>%s</p></div></div>' % t for t in [
            ('1', 'Block them in your browser',
             'Every browser can block third-party cookies and scripts in its privacy settings. Analytics stops; the site keeps working.'),
            ('2', 'Use Google&rsquo;s opt-out',
             'Google publishes a browser add-on that turns off Analytics on every site at once, including ours.'),
            ('3', 'Browser Do Not Track / private window',
             'A private window discards everything when you close it, and blocks nothing you need to browse the public pages.'),
            ('4', 'Ask us',
             'Email <a href="mailto:privacy@loadboot.com">privacy@loadboot.com</a> and we will tell you exactly what we hold on you, or delete it. Rights and how to use them are on the <a href="privacy.html#rights">Privacy Policy</a>.'),
        ]) + '</div>' + _legal_footer_links('cookies.html'), 'soft')

    faq_html, schema = _faq_block([
        ('Does LoadBoot use advertising or retargeting cookies?',
         'No. There are no ad cookies, no retargeting pixels and no social media tracking tags on any LoadBoot page. We do not sell advertising and we do not run ads against your browsing.'),
        ('Does LoadBoot record my screen?',
         'On the public marketing pages, Microsoft Clarity records how a visitor moves through the page — scrolling, clicks, where attention lands — so we can find layouts that confuse people. It masks text you type into fields. It does not run inside the signed-in portals or the Android app.'),
        ('Are there cookies inside the carrier portal?',
         'No analytics or tracking cookies. The portal keeps your sign-in session and a few interface preferences in your browser’s localStorage, on your own device.'),
        ('Can I block cookies and still use LoadBoot?',
         'Yes. Blocking third-party cookies stops analytics and changes nothing else. The only storage the app genuinely needs is your sign-in session, which lives in localStorage on your device.'),
        ('Does LoadBoot set any cookies of its own?',
         'No. Our own code writes no cookies at all. Everything first-party is localStorage, which stays in your browser and is not transmitted to us.'),
        ('What is the lb_ref item for?',
         'If you arrived through a referral partner’s link, it remembers which partner so they are credited when you sign up. It is used at sign-up and nowhere else.'),
    ])
    b += faq_html
    b += ('<section class="pv-sec"><div class="wrap"><div class="pv-cta">'
          '<h2>Want the fuller picture?</h2>'
          '<p>The Privacy Policy names every outside company that touches your data, what each one can see, and exactly who can open each document you upload.</p>'
          '<div class="row"><a class="btn btn-primary" href="privacy.html">Read the Privacy Policy</a>'
          '<a class="btn btn-secondary" href="mailto:privacy@loadboot.com">Ask a question</a></div>'
          '</div></div></section>')
    return b, schema


# ============================== DELETE ACCOUNT ==============================
def delete_account_page(ctx=None):
    # Retention periods and timelines below are carried over VERBATIM from the published
    # page — 3 years transport records, 7 years tax, 5 years fraud, ack in 2 business days,
    # deletion in 30 days, backups up to 90 days. These are commitments already made in
    # public and required by Google Play's data-deletion policy. Do not "tidy" them.
    b = PV_CSS
    b += _hero('Delete your LoadBoot account',
        'Closing your account should be as easy as opening one.',
        'It is. Here is exactly what happens.',
        'Two ways to ask, what is erased, the short list the law makes us keep and for how long, '
        'and how long the whole thing takes. No retention team, no phone call to talk you out of it.',
        ['<b>2</b> business days to acknowledge', '<b>30</b> days to complete',
         '<b>No</b> fee, no subscription needed', '<b>No</b> retention call'],
        '<b>This is the LoadBoot account deletion page.</b> Last updated <b>6 September 2026</b> &middot; '
        'applies to loadboot.com and the LoadBoot Android app (<code>com.loadboot.app</code>), both operated by LoadBoot LLC')
    b += _nav([('how', 'How to ask'), ('deleted', 'What is deleted'), ('kept', 'What must stay'),
               ('timeline', 'How long'), ('instead', 'Other options'), ('faq', 'FAQ')])

    b += _sec('how', 'Two ways', 'How to request deletion',
        'Both reach the same team and are handled identically. You do not need an active subscription and there is no charge.',
        '<div class="pv-grid pv-g2">'
        '<div class="pv-promise"><div class="ic">&#128241;</div><h3>In the app or on the website</h3>'
        '<p>Sign in, open your portal, and go to <b>Settings &rarr; Account &rarr; Delete my account</b>. Confirm when prompted. That is the whole flow.</p></div>'
        '<div class="pv-promise"><div class="ic">&#9993;</div><h3>By email</h3>'
        '<p>Write to <a href="mailto:privacy@loadboot.com">privacy@loadboot.com</a> from the address on your account, subject <b>&ldquo;Delete my account&rdquo;</b>, and tell us your company name so we can find the right record.<br><br>Writing from a different address? We will verify you own the account first &mdash; that check exists to stop somebody else deleting your account.</p></div>'
        '</div>')

    b += _sec('deleted', 'Erased', 'What gets permanently deleted',
        'Once your request is verified, all of this is destroyed:',
        _promise([
            ('&#128100;', 'Your account and profile', 'Sign-in credentials, name, email, phone and mailing address.'),
            ('&#128193;', 'Every document you uploaded', 'Operating authority, certificates of insurance, W-9, bank verification, identity documents and anything else in your compliance folder.'),
            ('&#127974;', 'Banking and payout details', 'The account you verified, and any factoring instructions attached to it.'),
            ('&#128205;', 'Location history', 'Any position data recorded while you were sharing your location on an active load.'),
            ('&#128666;', 'Fleet records', 'Drivers and equipment you entered.'),
            ('&#128172;', 'Messages and preferences', 'Conversations with LoadBoot dispatch or support, notification settings and saved searches.'),
        ]), 'soft')

    b += _sec('kept', 'The honest exception', 'What we have to keep, and for exactly how long',
        'Some records cannot be erased on request because United States law requires us to hold them. '
        'We keep only what the law requires and we use it for nothing else.',
        _table(['Record', 'Kept for', 'Why we cannot delete it'], [
            ['<b>Completed load and trip records</b><br><span class="who">rate confirmations, bills of lading, proof of delivery, dispatch records</span>',
             '<b>3 years</b> from delivery', 'Federal motor carrier record-keeping rules. These are also what protects you if a load you ran is ever questioned.'],
            ['<b>Financial and tax records</b><br><span class="who">invoices, settlements, commission payments and the tax forms attached to them</span>',
             '<b>7 years</b>', 'Internal Revenue Service requirements.'],
            ['<b>Fraud and safety records</b><br><span class="who">only where an account was suspended or removed for fraud</span>',
             '<b>5 years</b>', 'So the same party cannot simply re-register under a new name. A minimal record only.'],
        ]) +
        '<div class="pv-note"><b>And even in those records, the person comes out.</b> Wherever the law allows '
        'it, we remove or replace the personal details inside a retained record, so what is left is the '
        '<i>transaction</i> rather than <i>you</i>.</div>')

    b += _sec('timeline', 'Timing', 'How long the whole thing takes', '',
        '<div class="pv-grid pv-g3">' + ''.join(
            '<div class="pv-right"><div class="n">%s</div><div><h3>%s</h3><p>%s</p></div></div>' % t for t in [
            ('1', 'Within 2 business days', 'We acknowledge your request, and verify it is really you if you wrote from another address.'),
            ('2', 'Within 30 days', 'Deletion is complete. Everything in the list above is gone from live systems.'),
            ('3', 'Up to 90 days', 'Backups are overwritten on their normal cycle, so a copy may sit in encrypted backup storage until then. Nobody reads or restores it in the ordinary course &mdash; it simply ages out.'),
        ]) + '</div>', 'soft')

    b += _sec('instead', 'Before you go', 'Three smaller things you can ask for instead',
        'Deleting everything is not always what someone actually wants. Any of these is fine, and none needs a phone call.',
        '<div class="pv-grid pv-g3">' + ''.join(
            '<div class="pv-promise"><div class="ic">%s</div><h3>%s</h3><p>%s</p></div>' % t for t in [
            ('&#9208;', 'Close the account, keep the history', 'You stop being active on the platform, but your load and settlement history stays available to you.'),
            ('&#128465;', 'Remove specific documents', 'Keep the account open and have particular files deleted. Just tell us which.'),
            ('&#128233;', 'Only stop the emails', 'Every marketing email carries a one-click unsubscribe, honoured at the moment of sending. Operational mail about your own loads keeps coming.'),
        ]) + '</div>' + _legal_footer_links('delete-account.html'))

    faq_html, schema = _faq_block([
        ('How do I delete my LoadBoot account?',
         'Sign in and go to Settings → Account → Delete my account, or email privacy@loadboot.com from your account address with the subject "Delete my account". Both routes reach the same team and there is no charge.'),
        ('How long does deletion take?',
         'We acknowledge within 2 business days and complete deletion within 30 days. A copy may remain in encrypted backup storage for up to 90 days until backups are overwritten on their normal cycle.'),
        ('What is actually deleted?',
         'Your credentials and profile, every document you uploaded, banking and payout details, location history, driver and equipment records, messages with dispatch or support, and your notification preferences.'),
        ('What does LoadBoot have to keep?',
         'Completed load and trip records for 3 years (federal motor carrier rules), financial and tax records for 7 years (IRS), and — only where an account was removed for fraud — a minimal record for 5 years. Personal details inside those records are removed wherever the law allows.'),
        ('Do I need an active subscription to delete my account?',
         'No, and there is no fee. Deletion is available to any account holder at any time.'),
        ('Can I delete the app data without deleting my account?',
         'Yes. You can close the account while keeping your history, or ask us to delete specific documents and keep the account open. Email privacy@loadboot.com and say which you prefer.'),
        ('Will someone call to talk me out of it?',
         'No. There is no retention team and no save call. If you ask us to delete, we delete.'),
        ('I deleted the app from my phone — is my account gone?',
         'No. Removing the app only removes it from that device. To close the account itself, use one of the two routes on this page.'),
    ])
    b += faq_html
    b += ('<section class="pv-sec"><div class="wrap"><div class="pv-cta">'
          '<h2>Ready, or just have a question first?</h2>'
          '<p>Either is fine. Write to privacy@loadboot.com, or call +1 (469) 253-7575 — a person answers, any hour.</p>'
          '<div class="row"><a class="btn btn-primary" href="mailto:privacy@loadboot.com?subject=Delete%20my%20account">Request deletion by email</a>'
          '<a class="btn btn-secondary" href="privacy.html">Read the Privacy Policy</a></div>'
          '</div></div></section>')
    return b, schema
