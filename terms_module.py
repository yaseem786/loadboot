# terms_module.py — the flagship Terms of Service page.
#
# Written 6 Sep 2026, alongside privacy_module.py, so the two legal pages read as one family.
# It reuses PV_CSS from privacy_module and adds only what Terms needs.
#
# RULE FOR ANYONE EDITING THIS FILE: the numbered sections below are the CONTRACT. Their
# substance is carried over verbatim from the July 2026 Terms — the 5% fee on delivered-and-
# paid loads only, no forced dispatch, no minimum term, the liability cap, Texas law and the
# 30-day informal-resolution step. Restructure and explain them all you like; do not quietly
# reword what a party is agreeing to. The "In plain English" glosses are commentary sitting
# NEXT TO the clause, never a replacement for it — that is why each one is visually marked.

from privacy_module import PV_CSS, _sec, _table

TM_CSS = '''<style>
.tm-clause{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:22px 24px;margin-bottom:14px;scroll-margin-top:80px}
.tm-clause h3{margin:0 0 10px;font-size:1.06rem;letter-spacing:-.01em;display:flex;gap:10px;align-items:baseline}
.tm-clause h3 .no{flex:0 0 auto;width:26px;height:26px;border-radius:8px;background:#10223B;color:#fff;
  font-size:.78rem;display:grid;place-items:center;font-weight:800}
.tm-clause p{margin:0 0 10px;line-height:1.72;color:#334155;font-size:.95rem}
.tm-clause p:last-child{margin-bottom:0}
.tm-plain{margin-top:12px;padding:12px 14px;border-left:3px solid #16a34a;background:#f0fdf4;border-radius:0 10px 10px 0}
.tm-plain b{display:block;font-size:.74rem;letter-spacing:.09em;text-transform:uppercase;color:#15803d;margin-bottom:4px}
.tm-plain span{font-size:.92rem;line-height:1.62;color:#14532d}
.tm-deal{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))}
.tm-deal .d{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:22px}
.tm-deal .d .big{font-size:1.5rem;font-weight:800;letter-spacing:-.02em;color:#0883F7;margin-bottom:4px}
.tm-deal .d h3{margin:0 0 6px;font-size:1rem}
.tm-deal .d p{margin:0;font-size:.92rem;line-height:1.62;color:#475569}
.tm-ex{background:#10223B;color:#e2e8f0;border-radius:16px;padding:24px 26px;margin-top:22px}
.tm-ex h3{color:#fff;margin:0 0 14px;font-size:1.05rem}
.tm-ex .l{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.10);font-size:.95rem}
.tm-ex .l:last-of-type{border-bottom:none}
.tm-ex .l b{color:#fff}
.tm-ex .tot{margin-top:12px;padding-top:12px;border-top:2px solid rgba(255,255,255,.22);font-size:1.05rem;font-weight:800;color:#4ade80;display:flex;justify-content:space-between}
</style>'''


def _clause(no, title, paras, plain=None, anchor=None):
    ps = ''.join('<p>%s</p>' % p for p in paras)
    pl = ('<div class="tm-plain"><b>In plain English</b><span>%s</span></div>' % plain) if plain else ''
    aid = anchor or ('s%s' % no)
    return ('<div class="tm-clause" id="%s"><h3><span class="no">%s</span>%s</h3>%s%s</div>'
            % (aid, no, title, ps, pl))


def terms_page(ctx=None):
    """Returns (body_html, faq_schema_html)."""
    b = PV_CSS + TM_CSS

    b += '''<section class="pv-hero"><div class="wrap">
<span class="pv-kick"><span class="dot"></span>LoadBoot Terms of Service</span>
<h1>The agreement, <span class="pv-grad">written to be read.</span></h1>
<p class="pv-lead">Every clause that costs you money or limits what you can claim is on this page, in order, with a plain-English note beside it. Nothing is buried, and there is no separate document you have not seen.</p>
<div class="pv-chips">
<span class="pv-chip"><b>Free</b> to join</span>
<span class="pv-chip"><b>5%</b> only on loads that pay</span>
<span class="pv-chip"><b>No</b> forced dispatch</span>
<span class="pv-chip"><b>No</b> minimum term or cancellation fee</span>
</div>
<div class="pv-stamp"><b>These are the LoadBoot Terms of Service.</b> Last updated <b>6 September 2026</b> &middot; a binding agreement between you and LoadBoot LLC &middot; read with our <a href="privacy.html" style="color:#7dd3fc">Privacy Policy</a>, which forms part of it</div>
</div></section>'''

    nav = [('deal', 'The deal'), ('fees', 'Fees'), ('roles', 'By your role'), ('market', 'What we promise'),
           ('terms', 'The full terms'), ('liability', 'Liability &amp; disputes'), ('faq', 'FAQ'), ('contact', 'Contact')]
    b += '<div class="pv-nav"><div class="wrap"><nav class="pv-nav-in">%s</nav></div></div>' % ''.join(
        '<a href="#%s">%s</a>' % (i, t) for i, t in nav)

    # ---------- THE DEAL ----------
    b += _sec('deal', 'Before the legal text', 'The commercial deal, in six lines',
        'These are the terms people actually want to know before they sign. Each one is a real clause below, not a marketing line.',
        '<div class="tm-deal">' + ''.join(
            '<div class="d"><div class="big">%s</div><h3>%s</h3><p>%s</p></div>' % t for t in [
            ('$0', 'Joining costs nothing',
             'No subscription, no setup fee, no per-seat charge. Brokers and shippers post freight free as well.'),
            ('5%', 'Dispatch fee &mdash; and only when you get paid',
             'A flat 5% on loads that are <b>delivered and paid</b>. If a load does not pay, no fee is due. The fee is shown before you book.'),
            ('$0', 'To leave',
             'No minimum term and no cancellation fee. Close your account from the portal or by email, whenever you want.'),
            ('0', 'Loads booked without your approval',
             'There is no forced dispatch. You approve every load before it is booked, on your own authority.'),
            ('Never', 'We hold your freight money',
             'Brokers and shippers pay you (or your factoring company) directly. LoadBoot invoices its own fee separately and never sits between you and your revenue.'),
            ('Yours', 'Your documents and data',
             'You keep ownership of everything you upload. We get a limited licence to store and display it so the platform can work &mdash; nothing more.'),
        ]) + '</div>')

    # ---------- FEES ----------
    b += _sec('fees', 'Fees', 'What you pay, and when',
        'One fee exists. Here it is, with the arithmetic done for you.',
        _table(['Who you are', 'What you pay', 'When'], [
            ['<b>Carrier / owner-operator</b>', 'Flat <b>5%</b> dispatch fee on the linehaul',
             'Only after the load is <b>delivered and paid</b>. A load that never pays carries no fee.'],
            ['<b>Broker</b>', '<b>Nothing.</b> Posting is free.', '&mdash;'],
            ['<b>Shipper</b>', '<b>Nothing.</b> Posting is free.', '&mdash;'],
            ['<b>Referral agent</b>', 'You are <b>paid</b>, not charged &mdash; 1% referral commission.',
             'Per the agent programme terms, once the referred account&rsquo;s loads settle.'],
        ]) +
        '<div class="tm-ex"><h3>Worked example &mdash; one $2,400 load</h3>'
        '<div class="l"><span>Load pays</span><b>$2,400.00</b></div>'
        '<div class="l"><span>LoadBoot dispatch fee (5%)</span><b>&minus; $120.00</b></div>'
        '<div class="l"><span>Paid to you, or to your factoring company</span><b>$2,280.00</b></div>'
        '<div class="tot"><span>If that load never pays</span><span>$0 fee</span></div></div>'
        '<div class="pv-note"><b>Fees can change, but never backwards.</b> We may change fees going forward with notice; a change never applies to a load you have already booked. The fee is stated before you book, every time.</div>', 'soft')

    # ---------- ROLES ----------
    from privacy_module import _role
    b += _sec('roles', 'By who you are', 'What you are agreeing to',
        'The same contract, but the parts that bind you differ by role.',
        '<div class="pv-grid pv-g2">' + ''.join([
            _role('Carriers &amp; owner-operators', 'Clauses 3, 4, 6, 13', [
                ('You are agreeing to', 'Keep active MC/USDOT authority, insurance at the levels on your account (typically $1M auto liability and $100K cargo), a current W-9 and a signed dispatch agreement. Run safely and lawfully &mdash; hours of service, equipment, permits and insurance are yours alone.'),
                ('We are agreeing to', 'Never book a load without your approval, act as your authorised agent under 49 CFR Part 371 on your own authority, and charge our 5% only on loads that deliver and pay.'),
                ('If a document lapses', 'The features that depend on it pause until it is current again. That is the protection working, not a penalty &mdash; it is what stops the network tendering you freight you are not covered for.'),
            ]),
            _role('Brokers &amp; shippers', 'Clauses 3, 5, 6', [
                ('You are agreeing to', 'That every load you post is genuine, lawful and yours to tender; that the rate and details are accurate; and that you will honour the written terms of every confirmed booking, including accessorials.'),
                ('What gets you removed', 'Ghost loads, bait-and-switch postings, re-brokering a LoadBoot-covered load without disclosure, and payment default. Any of these can end the account immediately and may be reported within the network.'),
                ('What you pay', 'Nothing. Posting is free, and it stays free.'),
            ]),
            _role('Referral agents', 'Clauses 7, 13', [
                ('You are agreeing to', 'That you are an independent business, not an employee, and that you cannot bind LoadBoot or any carrier.'),
                ('Getting paid', 'Commission follows the referred account&rsquo;s settled loads. Payouts go only to the identity and account you verified &mdash; which is why we ask for ID and bank proof.'),
            ]),
            _role('Everyone', 'Clauses 2, 9, 10, 18', [
                ('Eligibility', 'You are 18 or over, able to form a binding contract, and authorised to act for the business you register. You are responsible for everything done under your account.'),
                ('Acceptable use', 'No misrepresenting identity, authority, insurance or documents. No false loads. No scraping, reverse engineering or probing the platform. No circumventing verification, fees or safety controls.'),
                ('Changes', 'For material changes we give notice before they take effect. Continued use after the effective date is acceptance. The date at the top is always the live version.'),
            ]),
        ]) + '</div>')
    # ---------- WHAT WE PROMISE / WHAT THE MARKET DECIDES ----------
    b += _sec('market', 'The honest part', 'What we promise &mdash; and what the market decides',
        'This clause is unusual for a terms page. We keep it because it is the one most likely to be tested.',
        '<div class="pv-grid pv-g2">'
        '<div class="pv-promise"><div class="ic">&#9989;</div><h3>What we commit to on every load</h3>'
        '<p>Dispatchers who hunt and negotiate on your lanes. Written protection on accessorials &mdash; detention, TONU, layover, lumper. GPS-verified records that make a claim stick. Paperwork handled end to end. That standard of effort, tooling and transparency is what you are buying, and we hold ourselves to it.</p></div>'
        '<div class="pv-promise"><div class="ic">&#128202;</div><h3>What no honest platform can promise</h3>'
        '<p>The freight market itself. Rates, load volume and lane availability move with fuel, seasonality, capacity and the wider economy &mdash; the same market every carrier, broker and load board in America works in. So specific rates, volumes or income levels are not guaranteed by LoadBoot, exactly as they are not by any reputable competitor. Our answer to a soft market is effort and information &mdash; live market rates, cost-per-mile tooling, and dispatchers who say no to freight that does not pay &mdash; never an inflated promise.</p></div>'
        '</div>', 'soft')

    # ---------- THE FULL TERMS ----------
    C = []
    C.append(_clause(1, 'What LoadBoot is', [
        'LoadBoot is an operating system for trucking: a technology platform that connects verified motor carriers, licensed freight brokers and shippers, and provides dispatch support services to carriers. The Platform includes a verified load board, dispatch services, GPS-based shipment visibility, digital document workflows (rate confirmations, BOLs, PODs, W-9s, dispatch agreements), settlement records and communication tools.',
        'LoadBoot acts as a dispatch service and technology provider. Unless expressly stated otherwise in writing: we are not a motor carrier, we do not take possession of freight, and when providing dispatch services we act as the carrier&rsquo;s authorised agent under 49 CFR Part 371, arranging freight on behalf of the carrier and under the carrier&rsquo;s own operating authority. We do not allocate traffic among carriers.'],
        'We are not a trucking company and we never touch your freight. When we book, we are acting as your agent, on your authority &mdash; which is why every load is legally yours.'))
    C.append(_clause(2, 'Accounts &amp; eligibility', [
        'You must be at least 18, able to form a binding contract, and authorised to act for the business you register. You are responsible for the accuracy of your information, for safeguarding your login, and for all activity under your account. One company may operate multiple authorised users; you remain responsible for each of them.'],
        'If someone on your team does something under your account, that is on you &mdash; so give logins carefully.'))
    C.append(_clause(3, 'Verification', [
        'Access to core features requires verification appropriate to your role: <b>carriers</b> &mdash; active MC/USDOT operating authority, insurance meeting the levels stated on your account (typically $1M auto liability and $100K cargo), and a completed W-9 and dispatch agreement; <b>brokers</b> &mdash; active brokerage authority and the federal surety bond or trust (BMC-84/85); <b>shippers</b> &mdash; verified business identity. We verify against public federal records (including FMCSA data) and the documents you upload. If a required document lapses, the related features pause until it is current &mdash; that protection is a feature of the network, not a penalty.'],
        'Let your COI expire and your truck stops getting tendered until you replace it. We will warn you before it happens.'))
    C.append(_clause(4, 'Carrier terms', [
        'Every load is booked under the carrier&rsquo;s own authority. You approve every load before it is booked &mdash; there is no forced dispatch. You are solely responsible for safe and lawful operations, including hours of service, equipment condition, permits and insurance. Written load terms (rate confirmation, and where applicable detention, TONU, layover and lumper provisions) govern each shipment.'],
        'Nobody can put a load on your truck without you saying yes. Everything about how you run that load stays your responsibility.'))
    C.append(_clause(5, 'Broker &amp; shipper terms', [
        'Posting is free. You represent that every posted load is genuine, lawful and yours to tender; that rate and load details are accurate; and that you will honour the written terms of every confirmed booking, including published accessorial policies. Ghost loads, bait-and-switch postings, re-brokering a LoadBoot-covered load without disclosure, and payment default are grounds for immediate removal and may be reported within the network.'],
        'Post a load that is not real, or do not pay, and you are off the platform &mdash; and other members may hear about it.'))
    C.append(_clause(6, 'Fees &amp; payment', [
        'Joining the Platform is free. Carriers pay a flat 5% dispatch fee, charged only on loads that are delivered and paid &mdash; if a load does not pay, no fee is due. Brokers and shippers post at no charge. LoadBoot never takes custody of freight payments: brokers and shippers pay carriers (or their factoring company) directly, and LoadBoot invoices its own fee separately. Fees are stated before you book and may change prospectively with notice; changes never apply retroactively.'],
        'Our money is downstream of yours. We get paid after you do, and never out of a payment we are holding &mdash; because we never hold one.'))
    C.append(_clause(7, 'Independent businesses', [
        'Carriers, brokers, shippers and referral agents are independent businesses. Nothing in these Terms creates an employment, joint venture or partnership relationship with LoadBoot, and no party may bind another except as expressly authorised in a signed dispatch agreement.'],
        'You are not our employee and we are not your partner. We cannot sign anything on your behalf beyond what your dispatch agreement allows.'))
    C.append(_clause(8, 'What you can expect from us &mdash; and what the market decides', [
        'We put real work behind every account: dispatchers who hunt and negotiate on your lanes, written protection on accessorials, GPS-verified records that make claims stick, and paperwork handled end to end. We commit to that standard of effort, tooling and transparency on every load we touch.',
        'What no honest platform can promise is the freight market itself. Rates, load volume and lane availability move with fuel, seasonality, capacity and the broader economy &mdash; the same market every carrier, broker and load board in America operates in. Specific rates, volumes or income levels therefore are not guaranteed by LoadBoot, just as they are not by any reputable competitor. Our answer to a soft market is effort and information &mdash; live market rates, cost-per-mile tooling, and dispatchers who say &ldquo;no&rdquo; to freight that does not pay &mdash; never inflated promises.'],
        'We guarantee how hard we work, not what the market pays. Anyone guaranteeing you a rate per mile is either lucky or lying.'))
    C.append(_clause(9, 'Acceptable use', [
        'You agree not to: misrepresent your identity, authority, insurance or documents; post false or misleading loads; harvest data, scrape, reverse engineer or probe the Platform; interfere with other users or with Platform operation; use the Platform for any unlawful purpose; or circumvent verification, fees or safety controls. We may suspend or remove accounts that put the network at risk, with notice where practicable.'],
        None))
    C.append(_clause(10, 'Your content &amp; our platform', [
        'You retain ownership of documents and data you upload and grant LoadBoot a limited licence to store, process and display them as needed to operate the Platform. The Platform, its software, design, brand and content are LoadBoot&rsquo;s property or its licensors&rsquo; and are protected by law; no rights are granted except as stated here.'],
        'Your paperwork stays yours. We only get the permission we need to actually run the service &mdash; and the <a href="privacy.html#documents">Privacy Policy</a> lists exactly who can open each document.'))
    C.append(_clause(11, 'Privacy', [
        'Our <a href="privacy.html">Privacy Policy</a> explains what we collect and how we use it, and forms part of these Terms. In summary: we use your data to run the Platform, we do not sell it, and communication preferences are always in your control.'],
        None))
    C.append(_clause(12, 'Third-party services', [
        'The Platform interoperates with third-party services (for example FMCSA data, mapping, payment, factoring and accounting integrations such as QuickBooks). Those services are governed by their own terms, and LoadBoot is not responsible for them.'],
        'Every one of those companies is named, with what it can see, in the <a href="privacy.html#processors">Privacy Policy</a>.'))
    C.append(_clause(13, 'Term &amp; termination', [
        'There is no minimum term and no cancellation fee &mdash; you may close your account at any time from your portal or by writing to <a href="mailto:hello@loadboot.com">hello@loadboot.com</a>. Obligations already accrued (including fees on delivered-and-paid loads and the terms of confirmed bookings) survive termination, as do Sections 8&ndash;18. We may suspend or terminate accounts for material breach, fraud, safety risk or extended inactivity.'],
        'You can walk away whenever you like. Loads already running still have to finish, and fees already earned are still owed &mdash; but nothing locks you in.'))
    C.append(_clause(14, 'Disclaimers', [
        'The Platform is provided &ldquo;as is&rdquo; and &ldquo;as available.&rdquo; To the fullest extent permitted by law, LoadBoot disclaims all warranties, express or implied, including merchantability, fitness for a particular purpose and non-infringement. We verify counterparties diligently, but each user remains responsible for its own commercial decisions and counterparties&rsquo; performance.'],
        'We check brokers hard, but we cannot guarantee one will pay. Running your own credit judgement is still your job.'))
    C.append(_clause(15, 'Limitation of liability', [
        'To the fullest extent permitted by law: LoadBoot is not liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, revenue, cargo or data; and LoadBoot&rsquo;s total aggregate liability arising out of the Platform is limited to the greater of (a) the dispatch fees you paid to LoadBoot in the six (6) months before the claim arose, or (b) one hundred U.S. dollars ($100). Some jurisdictions do not allow certain limitations, so parts of this section may not apply to you.'],
        '<b>Read this one twice.</b> If something goes badly wrong, the most you can recover from us is whatever you paid us in dispatch fees over the previous six months &mdash; or $100, whichever is larger. Cargo losses are what your cargo insurance is for.'))
    C.append(_clause(16, 'Indemnification', [
        'You will defend and hold harmless LoadBoot and its team from claims arising out of your freight operations, your breach of these Terms, your content, or your violation of law or third-party rights.'],
        'If someone sues us over how you ran a load, you cover it.'))
    C.append(_clause(17, 'Governing law &amp; disputes', [
        'These Terms are governed by the laws of the State of Texas, without regard to conflict-of-law rules. Before filing any claim, you agree to contact us at <a href="mailto:hello@loadboot.com">hello@loadboot.com</a> and give us thirty (30) days to work it out &mdash; most issues are resolved this way. Courts located in Texas will have exclusive jurisdiction over disputes not resolved informally, and each party waives trial by jury to the extent permitted.'],
        'Talk to us first &mdash; you have to give us 30 days. After that it is Texas courts, and neither side gets a jury.'))
    C.append(_clause(18, 'Changes to these Terms', [
        'We may update these Terms as the Platform evolves. For material changes we will give notice (portal notice or email) before they take effect; continued use after the effective date constitutes acceptance. The &ldquo;Last updated&rdquo; date above always reflects the current version.'],
        None))
    C.append(_clause(19, 'Contact', [
        'Questions about these Terms: <a href="mailto:hello@loadboot.com">hello@loadboot.com</a>. Live chat and our 24/7 phone line are on the <a href="contact.html">contact page</a>. LoadBoot LLC, 30 N Gould St Ste N, Sheridan, WY 82801.'],
        None))

    b += _sec('terms', 'The agreement', 'The full terms, all nineteen clauses',
        'Nothing is summarised away. The green notes beside a clause are our plain-English explanation of it &mdash; helpful, but the clause itself is what binds.',
        ''.join(C))

    # ---------- LIABILITY & DISPUTES, CALLED OUT ----------
    b += _sec('liability', 'The two clauses that matter most in a bad week',
        'If something goes wrong, this is where you will end up',
        'Most people sign a terms page and never look at it again &mdash; until a claim. So here are those clauses on their own, in the open.',
        '<div class="pv-grid pv-g2">'
        '<div class="pv-promise"><div class="ic">&#9878;</div><h3>What you can recover from us</h3>'
        '<p>Capped at the greater of the dispatch fees you paid us in the previous six months, or $100. We do not cover indirect or consequential loss, lost profit, or cargo.<br><br>'
        '<b>What actually covers cargo:</b> your cargo policy, and for a broker&rsquo;s non-payment, their BMC-84 bond &mdash; which is exactly why we verify both before anyone books.</p></div>'
        '<div class="pv-promise"><div class="ic">&#129309;</div><h3>How a dispute has to start</h3>'
        '<p>Email <a href="mailto:hello@loadboot.com">hello@loadboot.com</a> and give us 30 days. That is not a formality &mdash; almost everything gets resolved there, and it is a required step before a claim.<br><br>'
        'After that: Texas law, Texas courts, and both sides waive a jury trial.</p></div>'
        '</div>', 'soft')

    # ---------- FAQ ----------
    faqs = [
        ('Is there really no monthly fee?', 'No. Joining is free, there is no subscription and no per-seat charge. Carriers pay a flat 5% dispatch fee on loads that are delivered and paid. Brokers and shippers post for free.'),
        ('What if a broker never pays me — do I still owe the 5%?', 'No. The fee applies only to loads that are delivered <i>and</i> paid. A load that does not pay carries no fee. We are downstream of your money, deliberately.'),
        ('Can LoadBoot book a load without asking me?', 'No. There is no forced dispatch. Every load is approved by you before it is booked, and it runs under your own operating authority with us acting as your agent under 49 CFR Part 371.'),
        ('Does LoadBoot hold my freight payment?', 'Never. Brokers and shippers pay you or your factoring company directly. We invoice our own fee separately and are never in the middle of your revenue.'),
        ('Is there a contract term or cancellation fee?', 'Neither. Close your account any time from the portal or by emailing hello@loadboot.com. Loads already confirmed still have to be completed, and fees already earned are still owed.'),
        ('What happens if my insurance or authority expires?', 'The features that depend on that document pause until it is current. We warn you before the expiry date. It is the same check that stops a broker tendering you freight you are not covered for.'),
        ('How much can I claim from LoadBoot if something goes wrong?', 'The cap is the greater of the dispatch fees you paid us in the previous six months, or $100. Cargo loss is what your cargo insurance is for, and a broker&rsquo;s non-payment is what their BMC-84 bond is for.'),
        ('Where would a dispute be heard?', 'You must email us first and allow 30 days to resolve it informally. If that fails, Texas law applies and Texas courts have exclusive jurisdiction; both sides waive a jury trial.'),
        ('Do these Terms cover the Android app too?', 'Yes. The app is the same portal packaged for your phone, and both these Terms and the Privacy Policy apply to it identically.'),
        ('What happens when the Terms change?', 'For anything material we notify account holders by portal notice or email before it takes effect, and the date at the top of the page always reflects the live version. Changes to fees never apply to a load you have already booked.'),
    ]
    rows = ''.join('<details><summary>%s</summary><p>%s</p></details>' % (q, a) for q, a in faqs)
    import json as _json, re as _re
    def _plain(x):
        x = _re.sub(r'<[^>]+>', '', x)
        for a, c in [('&mdash;', '—'), ('&rsquo;', '’'), ('&ldquo;', '“'), ('&rdquo;', '”'),
                     ('&amp;', '&'), ('&rarr;', '→'), ('&middot;', '·'), ('&ndash;', '–'), ('&minus;', '−')]:
            x = x.replace(a, c)
        return x.strip()
    schema = '<script type="application/ld+json">%s</script>' % _json.dumps({
        '@context': 'https://schema.org', '@type': 'FAQPage',
        'mainEntity': [{'@type': 'Question', 'name': _plain(q),
                        'acceptedAnswer': {'@type': 'Answer', 'text': _plain(a)}} for q, a in faqs]},
        ensure_ascii=False)
    b += _sec('faq', 'Questions people actually ask', 'Straight answers', '',
              '<div class="pv-faq">%s</div>' % rows)

    # ---------- CONTACT ----------
    b += _sec('contact', 'Contact', 'Who you are contracting with', '',
        '<div class="pv-grid pv-g2">'
        '<div class="pv-promise"><div class="ic">&#9993;</div><h3>LoadBoot LLC</h3>'
        '<p>30 N Gould St Ste N, Sheridan, WY 82801, USA<br><br>'
        'Questions about these Terms: <a href="mailto:hello@loadboot.com">hello@loadboot.com</a><br>'
        'Privacy: <a href="mailto:privacy@loadboot.com">privacy@loadboot.com</a><br>'
        'Security: <a href="mailto:security@loadboot.com">security@loadboot.com</a><br>'
        '24/7: +1 (469) 253-7575</p></div>'
        '<div class="pv-promise"><div class="ic">&#128220;</div><h3>The rest of the paperwork</h3>'
        '<p>These Terms sit alongside a small set of other documents, all of which we keep current:</p>'
        '<div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">'
        '<a class="btn btn-secondary" href="privacy.html">Privacy Policy</a>'
        '<a class="btn btn-secondary" href="security.html">Security &amp; Trust</a>'
        '<a class="btn btn-secondary" href="cookies.html">Cookie Policy</a>'
        '<a class="btn btn-secondary" href="delete-account.html">Delete your account</a>'
        '</div></div></div>'
        '<div class="pv-note" style="margin-top:26px"><b>Your signed dispatch agreement still governs.</b> If you are a carrier working with a LoadBoot dispatcher, that agreement sits on top of these Terms and controls where the two differ. You can download your copy from your portal at any time.</div>')

    b += ('<section class="pv-sec"><div class="wrap"><div class="pv-cta">'
          '<h2>Something here you do not like?</h2>'
          '<p>Tell us before you sign, not after. If a clause does not make sense for how you run, we would rather explain it &mdash; or hear that it is wrong &mdash; than have you agree to something you have not read.</p>'
          '<div class="row"><a class="btn btn-primary" href="mailto:hello@loadboot.com">Ask about a clause</a>'
          '<a class="btn btn-secondary" href="contact.html">Talk to a human</a></div>'
          '</div></div></section>')

    return b, schema
