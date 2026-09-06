# privacy_module.py — the flagship Privacy & Data page.
#
# Written 6 Sep 2026. Everything here is derived from what the platform ACTUALLY does —
# the document type lists in app/carrier/app.js and app/partner/app.js, the storage
# contract in app/shared/storage.js, the RLS policies in migrations/, the edge functions
# in supabase/functions/ and the sub-processors those functions call. A privacy policy
# that describes an imagined system is worse than none: it is a promise you will break.
# If the platform changes, this page changes with it.
#
# Structure follows how the best consumer-trust pages read (Uber's privacy centre, Amazon's
# "Your data" hub, Apple's per-feature disclosures): a plain-English summary anyone can act
# on, then the specifics, then the legal text — never legal text first.

PV_CSS = '''<style>
.pv-hero{position:relative;overflow:hidden;background:#0B1526;color:#fff;padding:96px 0 84px}
.pv-hero:before{content:"";position:absolute;inset:-40% -10% auto -10%;height:150%;
  background:radial-gradient(60% 55% at 20% 25%,rgba(8,131,247,.30),transparent 62%),
             radial-gradient(50% 50% at 82% 18%,rgba(252,83,5,.24),transparent 60%),
             radial-gradient(45% 45% at 60% 95%,rgba(125,211,252,.16),transparent 60%);
  filter:blur(6px)}
.pv-hero .wrap{position:relative;z-index:1}
.pv-kick{display:inline-flex;align-items:center;gap:9px;padding:7px 15px;border-radius:999px;
  background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.20);font-size:12.5px;
  font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#bfe0ff}
.pv-kick .dot{width:7px;height:7px;border-radius:50%;background:#4ade80;box-shadow:0 0 0 4px rgba(74,222,128,.20)}
.pv-hero h1{font-size:clamp(2.1rem,5vw,3.5rem);line-height:1.08;margin:20px 0 16px;letter-spacing:-.02em;max-width:16ch}
.pv-grad{background:linear-gradient(92deg,#7dd3fc,#0883F7 45%,#FC5305);-webkit-background-clip:text;background-clip:text;color:transparent}
.pv-hero .pv-lead{font-size:clamp(1.02rem,1.9vw,1.2rem);line-height:1.65;color:#c6d4e6;max-width:62ch;margin:0 0 26px}
.pv-chips{display:flex;flex-wrap:wrap;gap:9px;margin-top:6px}
.pv-chip{display:inline-flex;align-items:center;gap:8px;padding:9px 15px;border-radius:999px;
  background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);font-size:13.5px;font-weight:600;color:#e2e8f0}
.pv-chip b{color:#7dd3fc;font-weight:800}
.pv-stamp{display:inline-block;margin-top:26px;padding:8px 15px;border-radius:10px;background:rgba(255,255,255,.06);
  border:1px solid rgba(255,255,255,.14);font-size:13px;color:#a9bad0}
.pv-stamp b{color:#fff}

/* sticky section nav */
.pv-nav{position:sticky;top:0;z-index:30;background:rgba(255,255,255,.96);backdrop-filter:blur(10px);
  border-bottom:1px solid #e2e8f0}
.pv-nav-in{display:flex;gap:4px;overflow-x:auto;padding:11px 0;scrollbar-width:none}
.pv-nav-in::-webkit-scrollbar{display:none}
.pv-nav a{flex:0 0 auto;padding:8px 14px;border-radius:999px;font-size:13.5px;font-weight:700;color:#475569;
  text-decoration:none;white-space:nowrap;border:1px solid transparent}
.pv-nav a:hover{background:#eff6ff;color:#0883F7;border-color:#bfdbfe}

.pv-sec{padding:72px 0;scroll-margin-top:78px}
.pv-sec.soft{background:#f6f9fc}
.pv-sec.dark{background:#10223B;color:#e2e8f0}
.pv-sec.dark h2{color:#fff}
.pv-head{max-width:70ch;margin:0 0 34px}
.pv-eye{font-size:12px;letter-spacing:.15em;text-transform:uppercase;color:#0883F7;font-weight:800;margin-bottom:10px}
.pv-sec.dark .pv-eye{color:#7dd3fc}
.pv-head h2{font-size:clamp(1.6rem,3.1vw,2.3rem);line-height:1.18;margin:0 0 12px;letter-spacing:-.015em}
.pv-head p{font-size:1.02rem;line-height:1.72;color:#475569;margin:0}
.pv-sec.dark .pv-head p{color:#b7c6da}

/* promise cards */
.pv-grid{display:grid;gap:18px}
.pv-g2{grid-template-columns:repeat(auto-fit,minmax(min(420px,100%),1fr))}
.pv-g3{grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr))}
.pv-promise{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:24px;position:relative;
  transition:transform .18s ease,box-shadow .18s ease}
.pv-promise:hover{transform:translateY(-3px);box-shadow:0 14px 34px rgba(15,23,42,.09)}
.pv-promise .ic{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:20px;
  background:linear-gradient(135deg,#eff6ff,#dbeafe);margin-bottom:14px}
.pv-promise h3{font-size:1.02rem;margin:0 0 8px;letter-spacing:-.01em}
.pv-promise p{font-size:.93rem;line-height:1.65;color:#475569;margin:0}
.pv-promise .no{color:#b91c1c;font-weight:800}
.pv-promise .yes{color:#15803d;font-weight:800}

/* role cards */
.pv-role{background:#fff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden}
.pv-role .rh{padding:20px 24px;background:linear-gradient(135deg,#10223B,#152e4d);color:#fff}
.pv-role .rh .t{font-size:1.08rem;font-weight:800;letter-spacing:-.01em}
.pv-role .rh .s{font-size:.85rem;color:#9fb4cd;margin-top:3px}
.pv-role .rb{padding:20px 24px 24px}
.pv-role dl{margin:0}
.pv-role dt{font-size:11.5px;letter-spacing:.11em;text-transform:uppercase;color:#0883F7;font-weight:800;margin:16px 0 6px}
.pv-role dt:first-child{margin-top:0}
.pv-role dd{margin:0;font-size:.93rem;line-height:1.65;color:#334155}

/* data tables */
.pv-tw{overflow-x:auto;border:1px solid #e2e8f0;border-radius:16px;background:#fff}
.pv-t{width:100%;border-collapse:collapse;min-width:720px;font-size:.9rem}
.pv-t th{text-align:left;padding:14px 16px;background:#f1f5f9;font-size:11.5px;letter-spacing:.09em;
  text-transform:uppercase;color:#475569;font-weight:800;border-bottom:1px solid #e2e8f0;white-space:nowrap}
.pv-t td{padding:14px 16px;border-bottom:1px solid #eef2f7;vertical-align:top;line-height:1.6;color:#334155}
.pv-t tr:last-child td{border-bottom:none}
.pv-t td b{color:#0f172a}
.pv-t .who{color:#475569}
.pv-pill{display:inline-block;padding:3px 9px;border-radius:999px;font-size:11.5px;font-weight:700;white-space:nowrap}
.pv-pill.you{background:#dcfce7;color:#15803d}
.pv-pill.staff{background:#dbeafe;color:#1d4ed8}
.pv-pill.load{background:#fef3c7;color:#92400e}
.pv-pill.never{background:#fee2e2;color:#b91c1c}

/* rights */
.pv-right{display:flex;gap:16px;align-items:flex-start;background:#fff;border:1px solid #e2e8f0;
  border-radius:14px;padding:20px}
.pv-right .n{flex:0 0 34px;height:34px;border-radius:10px;display:grid;place-items:center;font-weight:800;
  background:#0883F7;color:#fff;font-size:15px}
.pv-right h3{margin:0 0 6px;font-size:1rem}
.pv-right p{margin:0;font-size:.92rem;line-height:1.65;color:#475569}
.pv-right a{color:#0883F7;font-weight:700}

.pv-faq details{background:#fff;border:1px solid #e2e8f0;border-radius:14px;margin-bottom:11px;overflow:hidden}
.pv-faq summary{cursor:pointer;padding:17px 20px;font-weight:700;font-size:1rem;list-style:none;color:#0f172a}
.pv-faq summary::-webkit-details-marker{display:none}
.pv-faq summary:after{content:"+";float:right;color:#0883F7;font-weight:800;font-size:1.25rem;line-height:1}
.pv-faq details[open] summary:after{content:"\\2013"}
.pv-faq p{padding:0 20px 18px;margin:0;color:#475569;line-height:1.72;font-size:.95rem}

.pv-note{border-left:4px solid #0883F7;background:#f1f7ff;padding:16px 20px;border-radius:0 12px 12px 0;
  font-size:.93rem;line-height:1.68;color:#334155;margin:22px 0}
.pv-note b{color:#0f172a}

.pv-cta{background:linear-gradient(135deg,#10223B,#0b1a30);color:#fff;border-radius:22px;padding:52px 40px;text-align:center}
.pv-cta h2{font-size:clamp(1.5rem,3vw,2.1rem);margin:0 0 12px;color:#fff}
.pv-cta p{color:#b7c6da;max-width:56ch;margin:0 auto 26px;line-height:1.7}
.pv-cta .row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
@media(max-width:640px){.pv-hero{padding:70px 0 60px}.pv-sec{padding:52px 0}.pv-cta{padding:38px 22px}}
</style>'''


def _promise(items):
    out = []
    for ic, t, d in items:
        out.append('<div class="pv-promise"><div class="ic">%s</div><h3>%s</h3><p>%s</p></div>' % (ic, t, d))
    return '<div class="pv-grid pv-g3">%s</div>' % ''.join(out)


def _role(title, sub, rows):
    dl = ''.join('<dt>%s</dt><dd>%s</dd>' % (k, v) for k, v in rows)
    return ('<div class="pv-role"><div class="rh"><div class="t">%s</div><div class="s">%s</div></div>'
            '<div class="rb"><dl>%s</dl></div></div>') % (title, sub, dl)


def _table(cols, rows):
    th = ''.join('<th>%s</th>' % c for c in cols)
    tb = ''.join('<tr>%s</tr>' % ''.join('<td>%s</td>' % c for c in r) for r in rows)
    return '<div class="pv-tw"><table class="pv-t"><thead><tr>%s</tr></thead><tbody>%s</tbody></table></div>' % (th, tb)


def _sec(sid, eyebrow, h2, lead, inner, cls=''):
    head = '<div class="pv-head"><div class="pv-eye">%s</div><h2>%s</h2>%s</div>' % (
        eyebrow, h2, ('<p>%s</p>' % lead) if lead else '')
    return '<section class="pv-sec %s" id="%s"><div class="wrap">%s%s</div></section>' % (cls, sid, head, inner)


def privacy_page(ctx=None):
    """Returns (body_html, faq_schema_html). ctx unused today; kept for parity with the
    other landing modules so build_site.py calls all of them the same way."""
    ctx = ctx or {}
    U = '2026-09-06'
    b = PV_CSS

    # ---------- HERO ----------
    b += '''<section class="pv-hero"><div class="wrap">
<span class="pv-kick"><span class="dot"></span>LoadBoot Privacy Policy</span>
<h1>Your paperwork is the most sensitive thing you own. <span class="pv-grad">Here is exactly who can see it.</span></h1>
<p class="pv-lead">This is not a page of legal cover. It names every document we ask for, why we ask, which specific people can open it, how long we keep it, and every outside company that touches your data &mdash; for carriers, brokers, shippers, agents and dispatchers.</p>
<div class="pv-chips">
<span class="pv-chip"><b>Never</b> sold, ever</span>
<span class="pv-chip"><b>No</b> ad tracking inside the portals</span>
<span class="pv-chip"><b>Private</b> document storage</span>
<span class="pv-chip"><b>Delete</b> your account yourself</span>
</div>
<div class="pv-stamp"><b>This page is the LoadBoot Privacy Policy.</b> Last updated <b>6 September 2026</b> &middot; LoadBoot LLC &middot; applies to loadboot.com, the Carrier, Partner, Agent and Developer portals, and the LoadBoot Android app</div>
</div></section>'''

    # ---------- STICKY NAV ----------
    nav = [('short', 'The short version'), ('role', 'What we collect'), ('documents', 'Every document'),
           ('sharing', 'Who sees what'), ('processors', 'Outside companies'), ('ai', 'AI &amp; automation'),
           ('security', 'Security'), ('rights', 'Your rights'), ('retention', 'How long we keep it'),
           ('faq', 'FAQ'), ('contact', 'Contact')]
    b += '<div class="pv-nav"><div class="wrap"><nav class="pv-nav-in">%s</nav></div></div>' % ''.join(
        '<a href="#%s">%s</a>' % (i, t) for i, t in nav)

    # ---------- SHORT VERSION ----------
    b += _sec('short', 'Read this if you read nothing else', 'Six promises, in plain English',
        'Each one is a design decision in the product, not a sentiment. Where a promise is enforced by the database rather than by policy, we say so.',
        _promise([
            ('&#128683;', 'We never sell your data',
             'Not to brokers, not to lead vendors, not to anyone. We have no advertising business, so there is nothing to sell it <i>for</i>. We also run no ad tracking inside the signed-in portals or the app.'),
            ('&#128274;', 'Your documents are private by default',
             'Every file you upload lands in a private store, inside a folder that belongs to your account. Access is enforced by database rules, not by a screen that hides a button. Files are only ever handed out through short-lived signed links, never a public URL.'),
            ('&#128222;', 'Brokers never get your phone or email',
             'On your public carrier profile a broker sees your company, MC/DOT, equipment and verification status. Your phone number and email address stay hidden &mdash; LoadBoot dispatch handles contact. That is why brokers cannot cold-call your drivers.'),
            ('&#127974;', 'Dispatchers can never open your bank details',
             'The rule that lets an assigned dispatcher read your documents names exactly four types: authority, insurance, W-9 and factoring NOA. Your voided check is not on that list, so the database refuses it &mdash; even to our own staff dispatcher.'),
            ('&#128273;', 'Your TIN is encrypted and masked',
             'Your EIN or SSN is stored encrypted on the server and shown masked everywhere it appears in the product, including to our own team. Payouts only ever go to the account you verified, so nobody can redirect your money.'),
            ('&#128205;', 'Location is opt-in and stays off until you turn it on',
             'The platform works completely without it. When you do share it, we keep only the points the active trip and its proof-of-delivery record need &mdash; not a movement history &mdash; and you can revoke it from the dashboard or your phone settings at any time.'),
        ]))

    # ---------- BY ROLE ----------
    roles = ''.join([
        _role('Carriers &amp; owner-operators', 'The account with the most at stake &mdash; and the most protection', [
            ('What we collect', 'Company and authority details (MC/DOT, equipment, lanes, domicile, availability); the compliance and load documents listed below; settlement and payout details; photos you take for proof of delivery; and precise location <i>only</i> while you choose to share it.'),
            ('Why', 'To verify you are a real, insured, authorised carrier, to match you to loads, to dispatch and track those loads, and to pay you.'),
            ('Where some of it comes from', 'We read your public FMCSA/SAFER record to confirm authority and insurance. That is a one-way, read-only lookup on a government database &mdash; we send nothing about you to FMCSA.'),
            ('What brokers never see', 'Your phone, your email, your finances, your other loads, your cost model, your payroll and your books.'),
        ]),
        _role('Brokers &amp; shippers', 'Posting freight and paying for it', [
            ('What we collect', 'Company, MC and bond details, contact people; the loads you post (origin, destination, dates, equipment, rate, references, notes); loads you email to loads@loadboot.com, including the sender address, signature block and attachments we need to post them; the onboarding packet documents listed below; and payment records.'),
            ('Why', 'To verify you can legally broker or tender freight, to post your loads to verified carriers, and to settle payment. The bond and BOC-3 exist so a carrier can be paid if something goes wrong &mdash; checking them is the whole point.'),
            ('What carriers never see', 'Your credit application, your payment terms with us, your other loads and your internal notes.'),
        ]),
        _role('Agents &amp; referral partners', 'Paid on results, verified like anyone handling money', [
            ('What we collect', 'Your referral link and the accounts that sign up through it, commission and payout records, a government photo ID, proof of the bank or payout account, and a signed W-9 or W-8BEN.'),
            ('Why the ID', 'Because money moves. Payouts only ever go to a verified identity &mdash; that protects you as much as us. International agents give a W-8BEN instead of a W-9.'),
            ('Per-load documents', 'If you source a load, we ask who really pays it: the source company name and MC/DOT, the rate confirmation from that source, and the billing contact. This is what stops double-brokering.'),
        ]),
        _role('Dispatchers', 'Our staff and contract dispatchers, working your loads', [
            ('What they can see', 'Your availability, your loads and trips, and exactly four document types: operating authority, insurance certificate, W-9 and factoring NOA &mdash; the documents a broker packet requires.'),
            ('What they cannot see', 'Your bank verification document, your books, your expenses, your payroll and your cost model. This is enforced in the database, not by hiding a button.'),
            ('What we collect about them', 'Identity and right-to-work information, the loads they source and book, and the actions they take &mdash; every one of which is written to an audit trail.'),
        ]),
    ])
    b += _sec('role', 'By who you are', 'What we collect, and why, for each kind of account',
        'Nobody should have to read four pages that do not apply to them. Find yourself here.',
        '<div class="pv-grid pv-g2">%s</div>' % roles, 'soft')
    # ---------- EVERY DOCUMENT ----------
    YOU = '<span class="pv-pill you">You</span>'
    STAFF = '<span class="pv-pill staff">LoadBoot review staff</span>'
    DISP = '<span class="pv-pill staff">Your dispatcher</span>'
    LOAD = '<span class="pv-pill load">Both sides of that load</span>'
    NEVER_D = '<span class="pv-pill never">Never your dispatcher</span>'

    carrier_docs = _table(
        ['Document', 'Why we ask for it', 'Who can open it', 'How long we keep it'],
        [
            ['<b>Operating authority</b><br><span class="who">MC / DOT letter</span>',
             'Proof you are legally authorised to haul. No broker will tender a load without it, and we will not post your truck without it.',
             YOU + ' ' + STAFF + ' ' + DISP,
             'While your account is open, then up to 7 years'],
            ['<b>Certificate of insurance (COI)</b><br><span class="who">ACORD 25, PDF from your agent</span>',
             'Brokers require proof of auto liability and cargo cover. We also read the expiry date so we can warn you before it lapses and your loads stop.',
             YOU + ' ' + STAFF + ' ' + DISP,
             'While current, then up to 7 years'],
            ['<b>W-9</b><br><span class="who">contains your EIN or SSN</span>',
             'No money can move to you without it. Required by the IRS, and part of every broker packet.',
             YOU + ' ' + STAFF + ' ' + DISP + '<br><span class="who">The TIN itself is stored encrypted and shown masked &mdash; including to us.</span>',
             'Up to 7 years (tax record)'],
            ['<b>Bank verification</b><br><span class="who">voided check or bank letter</span>',
             'So your settlement money can only ever land in an account you personally verified. This is the single strongest protection you have against payment fraud.',
             YOU + ' ' + '<span class="pv-pill staff">LoadBoot finance only</span> ' + NEVER_D,
             'While the payout account is active, then 7 years'],
            ['<b>Factoring notice of assignment (NOA)</b>',
             'Tells brokers to pay your factoring company instead of you. Without it on file, invoices get paid to the wrong place.',
             YOU + ' ' + STAFF + ' ' + DISP + ' <span class="who">+ the broker on loads you run</span>',
             'While the factoring relationship is active, then 7 years'],
            ['<b>Signed dispatch agreement</b>',
             'The contract between you and LoadBoot. You should keep a copy too &mdash; you can download yours any time.',
             YOU + ' ' + STAFF,
             'Life of the agreement + 7 years'],
            ['<b>MCS-150 &middot; FMCSA safety rating</b>',
             'Biennial update and safety standing. Brokers check both; we would rather show them a current copy than have them guess.',
             YOU + ' ' + STAFF + ' ' + DISP,
             'While current, then up to 7 years'],
            ['<b>Hazmat set</b><br><span class="who">PHMSA registration, CDL &ldquo;H&rdquo; endorsement, hazmat COI</span>',
             'Only asked for if you tell us you haul hazmat. The CDL photo is used to confirm the endorsement and nothing else.',
             YOU + ' ' + STAFF + ' ' + DISP,
             'While current, then up to 7 years'],
            ['<b>Rate confirmation &middot; BOL &middot; POD</b><br><span class="who">including delivery photos</span>',
             'The paperwork that proves a specific load ran and was delivered &mdash; which is what gets you paid and what settles a dispute.',
             YOU + ' ' + STAFF + ' ' + LOAD,
             '7 years (transport record)'],
        ])

    partner_docs = _table(
        ['Document', 'Why we ask for it', 'Who can open it', 'How long we keep it'],
        [
            ['<b>Broker authority &middot; BMC-84 bond &middot; BOC-3 &middot; UCR</b>',
             'The four things that decide whether a carrier can actually get paid by you. The bond is the money a carrier claims against if a broker fails to pay; FMCSA will not keep your authority active without a BOC-3.',
             YOU + ' ' + STAFF + '<br><span class="who">Verification status &mdash; not the documents &mdash; is shown to carriers.</span>',
             'While your account is open, then up to 7 years'],
            ['<b>W-9 &middot; certificate of insurance</b>',
             'Tax form before settlement money moves; GL / E&amp;O / contingent cargo cover for the freight itself.',
             YOU + ' ' + STAFF,
             'Up to 7 years'],
            ['<b>Bank / remittance instructions</b>',
             'Where invoices go and how you pay. Held to the same standard as a carrier&rsquo;s bank details.',
             YOU + ' <span class="pv-pill staff">LoadBoot finance only</span>',
             'While active, then 7 years'],
            ['<b>Signed broker or shipper agreement</b>',
             'The contract between us. Shippers also give a credit application and payment terms before a first booking.',
             YOU + ' ' + STAFF,
             'Life of the agreement + 7 years'],
            ['<b>Claims procedure &middot; facility rules &middot; cargo profile</b>',
             'Optional, and purely operational: who a driver calls when something goes wrong, and what to expect at the dock.',
             YOU + ' ' + STAFF + ' <span class="who">+ the carrier on a load, where it helps them deliver</span>',
             'While your account is open'],
        ])

    agent_docs = _table(
        ['Document', 'Why we ask for it', 'Who can open it', 'How long we keep it'],
        [
            ['<b>Government photo ID</b>',
             'Because we are about to send you money. Payouts go only to a verified identity &mdash; that is what stops someone else claiming your commissions.',
             YOU + ' <span class="pv-pill staff">LoadBoot finance only</span>',
             'While your account is open, then 7 years'],
            ['<b>Bank or payout proof</b><br><span class="who">voided check, statement header or payout-account screenshot</span>',
             'To lock your commission to one verified destination that cannot be changed by an email.',
             YOU + ' <span class="pv-pill staff">LoadBoot finance only</span>',
             'While active, then 7 years'],
            ['<b>W-9 or W-8BEN</b>',
             'US agents sign a W-9; agents outside the US sign a W-8BEN. Both are tax requirements, not a preference of ours.',
             YOU + ' <span class="pv-pill staff">LoadBoot finance only</span>',
             'Up to 7 years (tax record)'],
            ['<b>Per-load source documents</b>',
             'If you source a load: who really pays it, the rate confirmation from that source, and the billing contact. This is the check that stops double-brokering.',
             STAFF + ' ' + LOAD,
             '7 years (transport record)'],
        ])

    b += _sec('documents', 'The part most policies skip', 'Every document we ask for &mdash; and exactly who can open it',
        'If a document is not on this list, we are not asking you for it. If we ever need to add one, this table changes first.',
        '<h3 style="margin:26px 0 12px;font-size:1.15rem">Carriers &amp; owner-operators</h3>' + carrier_docs +
        '<div class="pv-note"><b>Read the fourth row again.</b> Your bank verification document is the one file even your assigned dispatcher cannot open. The database rule that grants dispatcher access lists four document types by name, and this is not one of them &mdash; so the request is refused at the data layer, not by a hidden button. A dispatcher who needs banking done goes to finance, the same as anyone else.</div>' +
        '<h3 style="margin:34px 0 12px;font-size:1.15rem">Brokers &amp; shippers</h3>' + partner_docs +
        '<h3 style="margin:34px 0 12px;font-size:1.15rem">Agents &amp; referral partners</h3>' + agent_docs)

    # ---------- WHO SEES WHAT ----------
    b += _sec('sharing', 'Sharing', 'Who sees what, and when',
        'We share information in exactly four situations. There is no fifth.',
        '<div class="pv-grid pv-g2">' +
        '<div class="pv-promise"><div class="ic">&#129309;</div><h3>1. Between the two parties on a load &mdash; because you asked us to</h3>'
        '<p>When you book or request a load, the broker or shipper sees your company name, MC/DOT, equipment, verification status and trip status. You see their company, contact and load details. The rate confirmation, BOL and POD attached to that load are visible to both sides. Your financials, your notes and your other loads are never shown &mdash; and neither are theirs to you.</p></div>'
        '<div class="pv-promise"><div class="ic">&#127981;</div><h3>2. Companies that run parts of the service for us</h3>'
        '<p>Hosting, database, email, SMS, the phone assistant and document processing. Every one is listed by name in the next section, with what it can actually see. They may only process data on our instructions, and none of them may use it for their own purposes.</p></div>'
        '<div class="pv-promise"><div class="ic">&#127974;</div><h3>3. Your factoring company or payout partner</h3>'
        '<p>Only if you choose one, and only to the extent needed to get you paid. You tell us who they are; we do not pick one for you.</p></div>'
        '<div class="pv-promise"><div class="ic">&#9878;</div><h3>4. Regulators, and the law</h3>'
        '<p>Where the law requires it, to enforce our terms, or to protect people from harm. If LoadBoot is ever acquired, information transfers to the successor under this same policy &mdash; it does not become a free-for-all.</p></div>'
        '</div>'
        '<div class="pv-note"><b>What is deliberately not on this list:</b> advertising networks, data brokers, lead-generation companies and &ldquo;partners&rdquo; who would like to email your carriers. We do not sell, rent or trade your information, and we do not run advertising analytics inside the signed-in portals or the app.</div>')

    # ---------- SUB-PROCESSORS ----------
    b += _sec('processors', 'Outside companies', 'Every third party that touches your data',
        'Most policies say &ldquo;we use service providers&rdquo; and stop. Here is the actual list, what each one does, and what it can see. If we add one, this table is updated before it goes live.',
        _table(['Company', 'What it does for us', 'What it can see'], [
            ['<b>Supabase</b>', 'Database, sign-in, and the private store your documents live in.',
             'All platform data. Encrypted in transit and at rest; access governed by row-level rules we write.'],
            ['<b>Netlify</b>', 'Serves the public loadboot.com pages.',
             'Public pages and standard web request logs. No account data and no documents pass through it.'],
            ['<b>Resend</b>', 'Delivers our email.',
             'Your name, email address and the content of the message we send you.'],
            ['<b>Twilio</b>', 'Delivers SMS, including check-call texts.',
             'Your phone number and the text of that message.'],
            ['<b>Retell AI</b>', 'The 24/7 phone assistant, when you call us or ask us to call you.',
             'That call &mdash; the audio and its transcript. Nothing else about your account.'],
            ['<b>Google (Gemini API)</b>', 'Reads an uploaded document, a rate confirmation or a load email to pre-fill fields and flag obvious problems.',
             'The content of the specific document, email or chat message being processed. See the next section.'],
            ['<b>Google Analytics 4 &amp; Search Console</b>', 'Tells us which public marketing pages people find useful.',
             'Aggregate visits to public pages only. Not loaded inside the signed-in portals or the app.'],
            ['<b>Intuit QuickBooks Online</b>', 'Two-way accounting sync &mdash; <b>only if you connect it yourself</b>.',
             'The invoices, expenses and payments you choose to sync. Disconnect any time and the sync stops.'],
            ['<b>Your ELD provider</b><br><span class="who">Samsara, Motive, KeepTruckin, Geotab</span>', 'Pulls vehicle location and hours &mdash; <b>only if you connect it yourself</b>.',
             'We hold a read-only token. LoadBoot never writes anything back to your ELD and never shares the token. Disconnect any time.'],
            ['<b>FMCSA / SAFER</b>', 'Confirms authority, insurance and safety standing.',
             'Nothing. This is a one-way read of a public government record &mdash; we send no information about you to FMCSA.'],
        ]), 'soft')

    # ---------- AI ----------
    b += _sec('ai', 'AI &amp; automation', 'Where a machine reads your paperwork &mdash; and where a human still decides',
        'Automation saves you re-typing a rate confirmation. It should never be the thing that quietly rejects your insurance certificate. Here is the line we draw.',
        '<div class="pv-grid pv-g2">'
        '<div class="pv-promise"><div class="ic">&#129302;</div><h3>What AI actually does here</h3>'
        '<p><b>Document pre-check.</b> When you upload a COI or authority letter, the file is read so we can tell you immediately if it is the wrong document, expired, or missing a required field &mdash; instead of you finding out three days later.<br><br>'
        '<b>Rate confirmation parsing.</b> Pulls the stops, dates and rate off a rate con so you do not re-type them.<br><br>'
        '<b>Load emails.</b> Reads freight emailed to loads@loadboot.com so a broker can post by email.<br><br>'
        '<b>Live chat.</b> Answers common questions on the website.</p></div>'
        '<div class="pv-promise"><div class="ic">&#128100;</div><h3>What it does not do</h3>'
        '<p><b>It never has the final word on compliance.</b> A LoadBoot compliance reviewer checks every AI verdict before it affects your account. If the machine flags your document, a person looks at it.<br><br>'
        '<b>We do not use your documents to train our own models.</b><br><br>'
        '<b>It does not read what it has no reason to read.</b> Only the specific file, email or message being processed is sent &mdash; not your account, your history or your other documents.<br><br>'
        '<b>The processor is Google&rsquo;s Gemini API</b>, listed in the table above, working on our instructions.</p></div>'
        '</div>')

    # ---------- SECURITY ----------
    b += _sec('security', 'Security', 'How the protection is actually built',
        'The useful question is not &ldquo;is it encrypted&rdquo; &mdash; everything is. It is: what happens if someone tries to read data that is not theirs?',
        '<div class="pv-grid pv-g3">' + ''.join(
            '<div class="pv-promise"><div class="ic">%s</div><h3>%s</h3><p>%s</p></div>' % t for t in [
            ('&#128451;', 'Your files live in your own folder',
             'Every upload is stored under a path that belongs to your account. The storage rules check that path on every single read &mdash; there is no query that returns another company&rsquo;s file.'),
            ('&#8987;', 'Links that expire',
             'A document is never served from a public address. Viewing one mints a signed link that dies within minutes.'),
            ('&#128272;', 'The server decides, not the screen',
             'Your organisation is resolved from your session on the server. Hiding a button is not our access control; the database refusing the row is.'),
            ('&#128179;', 'Two people for money',
             'Money-moving actions use maker-checker: the person who creates one cannot be the person who approves it.'),
            ('&#128220;', 'Everything leaves a trace',
             'Bookings, payments, claims and document events are timestamped records. We can tell you who did what, and when.'),
            ('&#128231;', 'We will never email you for a password',
             'Our mail only comes from @loadboot.com. We never ask for your password and never change payment details by email. Forward anything suspicious to security@loadboot.com.'),
        ]) + '</div>'
        '<div class="pv-note"><b>One honest exception.</b> Your <i>company logo</i> is stored in a public bucket, because it is meant to be seen &mdash; it appears on your carrier profile and on documents. Everything else you upload is private. We would rather tell you that than let you assume it.</div>'
        '<p style="margin-top:22px;color:#475569;line-height:1.72">Data is encrypted in transit with TLS and at rest. No system is perfectly secure, and anyone who tells you otherwise is selling something; what we can promise is that the safeguards match the sensitivity of what you have handed us, and that we will tell you promptly if that ever fails.</p>')

    # ---------- RIGHTS ----------
    rights = [
        ('1', 'See everything we hold about you',
         'Email <a href="mailto:privacy@loadboot.com">privacy@loadboot.com</a> from your account address and ask for a copy. We will send it, or tell you honestly why some part cannot be released, within 30 days.'),
        ('2', 'Correct anything that is wrong',
         'Most of it you can fix yourself in your portal &mdash; company details, contacts, documents, preferences. If something is locked because it is verified, email us and we will correct it.'),
        ('3', 'Delete your account',
         'In the portal go to <i>Settings &rarr; Account &rarr; Delete my account</i>, or read our <a href="delete-account.html">account deletion page</a> first &mdash; it names exactly what is erased and the narrow set of records tax and transport law makes us keep.'),
        ('4', 'Turn location off',
         'From your dashboard, or from your phone&rsquo;s own settings. It stops immediately. Nothing else about your account stops working.'),
        ('5', 'Stop marketing email',
         'Every marketing email carries a one-click unsubscribe, and we honour it at the point of sending, not eventually. Operational mail about your own loads, documents and payments keeps coming &mdash; you need those.'),
        ('6', 'Complain, and be taken seriously',
         'Write to <a href="mailto:privacy@loadboot.com">privacy@loadboot.com</a>. If we cannot resolve it, residents of California and other states with privacy laws may also complain to their state authority. We extend those rights to every user, wherever they live, rather than only where a law forces us to.'),
    ]
    b += _sec('rights', 'Your rights', 'What you can make us do &mdash; and how, today',
        'A right you cannot exercise in under five minutes is not really a right. Each of these has a real button or a real address behind it.',
        '<div class="pv-grid pv-g2">%s</div>' % ''.join(
            '<div class="pv-right"><div class="n">%s</div><div><h3>%s</h3><p>%s</p></div></div>' % r for r in rights), 'soft')

    # ---------- RETENTION ----------
    b += _sec('retention', 'Retention', 'How long each thing stays, and why',
        'We do not keep data because storage is cheap. Where a period looks long, it is because a law or a dispute window requires it &mdash; and we say which.',
        _table(['What', 'How long', 'Why that long'], [
            ['Account and contact details', 'While your account is open, plus a short wind-down period',
             'So you can come back, and so we can answer a question about a closed account.'],
            ['Load, trip and settlement records', 'Up to 7 years',
             'US tax and transportation record-keeping, and the window in which a freight claim or payment dispute can still be raised.'],
            ['Compliance documents (authority, COI, W-9, NOA)', 'While current, then up to 7 years',
             'Proof that you were authorised and insured <i>on the day a specific load ran</i> is what protects you if that load is ever questioned.'],
            ['Proof of delivery, BOL, rate confirmations', 'Up to 7 years',
             'They are the evidence a load was delivered and priced as agreed.'],
            ['Precise location', 'Minimised to the active trip and its arrival/departure stamps',
             'We keep the points the proof-of-service record needs, not a history of where your truck has been.'],
            ['Support conversations and call transcripts', 'Up to 2 years',
             'To keep context if an issue comes back, and to settle a disagreement about what was said.'],
            ['Marketing analytics', 'Aggregated, not tied to you',
             'We want to know which page helped, not which person read it.'],
        ]))

    # ---------- FAQ ----------
    faqs = [
        ('Do you sell my data to brokers or anyone else?',
         'No. We have no advertising business and no data-sales business, so there is nothing for us to sell it for. We do not sell, rent or trade your personal information, and we do not run ad tracking inside the signed-in portals or the app.'),
        ('Can a broker see my phone number or email address?',
         'No. On your carrier profile a broker sees your company, MC/DOT, equipment and verification status. Your phone and email stay hidden and LoadBoot dispatch handles contact. That is deliberate &mdash; it is why brokers cannot cold-call your drivers off the board.'),
        ('Can my LoadBoot dispatcher see my bank details?',
         'No, and not by policy alone. The database rule that lets an assigned dispatcher read your documents names four types &mdash; authority, insurance, W-9 and factoring NOA. Your bank verification document is not one of them, so the request is refused at the data layer.'),
        ('Why do you need my W-9 with my EIN or SSN on it?',
         'Because no money can legally move to you without it, and every broker packet includes one. Your TIN is stored encrypted on the server and shown masked everywhere it appears in the product &mdash; including to our own team.'),
        ('Is my document read by AI?',
         'When you upload a compliance document it is sent to Google&rsquo;s Gemini API so we can tell you straight away if it is the wrong file, expired, or missing something. A LoadBoot compliance reviewer checks every AI verdict before it affects your account, and we do not use your documents to train our own models.'),
        ('Do I have to share my location?',
         'No. The platform works completely without it and it is off until you turn it on. When you do share it, we keep only what the active trip and its proof-of-delivery record need, and you can revoke it from your dashboard or your phone at any time.'),
        ('What happens to my documents if I delete my account?',
         'Your account, profile and preferences are removed. Records that tax and transportation law require us to keep &mdash; completed loads, settlements and the compliance documents that were in force when those loads ran &mdash; are retained for the legal period and then deleted. Our account deletion page lists this precisely.'),
        ('Does connecting QuickBooks or my ELD give you access to everything?',
         'No, and both are entirely optional. QuickBooks syncs only the invoices, expenses and payments you choose. Your ELD connection is read-only &mdash; LoadBoot never writes anything back to it and never shares the token. Disconnect either at any time.'),
        ('I am an agent outside the US. Which rules apply to me?',
         'The same ones. You sign a W-8BEN instead of a W-9, and we honour the access, correction and deletion rights on this page for every user regardless of where they live, rather than only where a law compels us.'),
        ('Who do I contact if something looks wrong?',
         'Privacy questions and requests: privacy@loadboot.com. Anything that looks like phishing or a security problem: security@loadboot.com. Both are read by a person.'),
    ]
    rows = ''.join('<details><summary>%s</summary><p>%s</p></details>' % (q, a) for q, a in faqs)
    import json as _json, re as _re
    def _plain(x):
        x = _re.sub(r'<[^>]+>', '', x)
        for a, c in [('&mdash;', '—'), ('&rsquo;', '’'), ('&ldquo;', '“'), ('&rdquo;', '”'),
                     ('&amp;', '&'), ('&rarr;', '→'), ('&middot;', '·'), ('&nbsp;', ' ')]:
            x = x.replace(a, c)
        return x.strip()
    schema = '<script type="application/ld+json">%s</script>' % _json.dumps({
        '@context': 'https://schema.org', '@type': 'FAQPage',
        'mainEntity': [{'@type': 'Question', 'name': _plain(q),
                        'acceptedAnswer': {'@type': 'Answer', 'text': _plain(a)}} for q, a in faqs]},
        ensure_ascii=False)
    b += _sec('faq', 'Questions people actually ask', 'Straight answers', '',
              '<div class="pv-faq">%s</div>' % rows, 'soft')

    # ---------- CONTACT + LEGAL TAIL ----------
    b += _sec('contact', 'Contact &amp; the formal bits', 'Who we are, and how to reach a person', '',
        '<div class="pv-grid pv-g2">'
        '<div class="pv-promise"><div class="ic">&#9993;</div><h3>Reach us</h3>'
        '<p><b>LoadBoot LLC</b><br>30 N Gould St Ste N, Sheridan, WY 82801, USA<br><br>'
        'Privacy requests: <a href="mailto:privacy@loadboot.com">privacy@loadboot.com</a><br>'
        'Security reports: <a href="mailto:security@loadboot.com">security@loadboot.com</a><br>'
        'Anything else: <a href="contact.html">our contact page</a> or +1 (469) 253-7575</p></div>'
        '<div class="pv-promise"><div class="ic">&#128220;</div><h3>Scope, children and changes</h3>'
        '<p>This policy covers loadboot.com, the Carrier, Partner, Agent, Developer and Command Center portals, and the LoadBoot Android app on Google Play (<code>com.loadboot.app</code>) &mdash; the app is the same portal packaged for your phone, so everything here applies to it identically.<br><br>'
        'The Platform is for businesses and is not directed to anyone under 18; we do not knowingly collect information from children.<br><br>'
        'When this policy changes we post it here with a new date, and we email account holders about anything material rather than hoping they notice.</p></div>'
        '</div>'
        '<div style="margin-top:26px;display:flex;gap:12px;flex-wrap:wrap">'
        '<a class="btn btn-primary" href="delete-account.html">Delete your account</a>'
        '<a class="btn btn-secondary" href="security.html">Security &amp; Trust</a>'
        '<a class="btn btn-secondary" href="terms.html">Terms of Service</a>'
        '<a class="btn btn-secondary" href="cookies.html">Cookie Policy</a>'
        '</div>')

    b += ('<section class="pv-sec"><div class="wrap"><div class="pv-cta">'
          '<h2>Still not sure about something?</h2>'
          '<p>Ask us. A person reads privacy@loadboot.com, and &ldquo;why do you need this?&rdquo; is a fair question we would rather answer than have you guess at.</p>'
          '<div class="row"><a class="btn btn-primary" href="mailto:privacy@loadboot.com">Email privacy@loadboot.com</a>'
          '<a class="btn btn-secondary" href="contact.html">Talk to a human</a></div>'
          '</div></div></section>')

    return b, schema
