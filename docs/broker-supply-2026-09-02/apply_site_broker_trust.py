#!/usr/bin/env python3
"""apply_site_broker_trust.py — marketing-site copy for the broker tiered-trust model (bl_bp_0312).
Idempotent string surgery on build_site.py. Every edit is exact-match; a missing anchor aborts.
Principle: say only what the product does today — FMCSA-screened posting in minutes, request-to-book
for new brokerages, documents only where they matter. No numbers we cannot back."""
import sys, pathlib
ROOT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.')
P = ROOT / 'build_site.py'
s = P.read_text(encoding='utf-8')
n = 0
def rep(key, old, new, count=1):
    global s, n
    if new in s and old not in s:
        print('  =', key); return
    c = s.count(old)
    if c != count:
        raise SystemExit(f'ABORT: {key}: anchor found {c}x (need {count})')
    s = s.replace(old, new); n += 1; print('  +', key)

# ---- brokers.html · "Getting set up" rail ----
rep('brokers rail',
 """ ('clipboard', 'Apply as a broker partner', 'Share your company, authority and contacts. Activation is human-reviewed &mdash; no bots approving accounts.'),
 ('shieldcheck', 'Authority &amp; verification', 'We verify broker authority and key details against public and licensed sources before you go live.'),
 ('badge', 'Approved &amp; active', 'Once approved, you can post loads and reach the carrier network right away.'),""",
 """ ('shieldcheck', 'Screen your MC &mdash; seconds, no uploads', 'Enter your broker MC. We read your authority live from FMCSA Licensing &amp; Insurance (SAFER as backup). FMCSA only keeps broker authority active while the $75K BMC-84/85 is on file, so one check covers both.'),
 ('clipboard', 'One-click master agreement', 'The Master Broker Agreement covers every load you post &mdash; printed rate card, request-to-book, GPS proof, payables. Carriers see those terms on every posting.'),
 ('badge', 'Post &mdash; and verify when it pays off', 'Post right away (a few open loads to start). Carriers request, you approve within 30 minutes, LoadBoot dispatch confirms the rate con. The verification packet later lifts limits and turns on instant booking.'),""")

# ---- create-broker-account.html · the whole broker config ----
rep('acct desc',
 "'desc': 'How licensed freight brokers join LoadBoot: broker authority and bond verification, what documents to have ready, and how the first posting reaches vetted, health-scored carriers in minutes — with GPS proof and one-receipt payables.'",
 "'desc': 'How licensed freight brokers join LoadBoot: MC screened live on FMCSA in seconds, one-click agreement, first posting in minutes with no documents to start — GPS proof, request-to-book and one-receipt payables built in.'")
rep('acct intro',
 "'intro': 'Load posting on LoadBoot is for licensed brokers &mdash; that is what keeps the board real. Verification checks your broker authority and bond, and then your first posting goes to verified, health-scored carriers with the rate card in writing,",
 "'intro': 'Load posting on LoadBoot is for licensed brokers &mdash; that is what keeps the board real. We read your broker authority live from FMCSA the moment you enter your MC (no PDF to upload), you accept one master agreement, and your first posting goes to verified, health-scored carriers with the rate card in writing,")
rep('acct ticks',
 "'ticks': ['Broker authority &amp; bond verified', 'First-accept-wins offers &mdash; no double booking', 'Claims settle on GPS evidence']",
 "'ticks': ['MC screened live on FMCSA &mdash; seconds, no uploads', 'Post in minutes &mdash; documents only where they matter', 'Request-to-book &mdash; you approve every carrier']")
rep('acct steps_h', "'steps_h': 'Signup to covered freight in five steps', 'steps': [('Create the account', 'Company email, password, your name &mdash; then choose <b>Freight Broker</b>. Shippers and facilities have their own paths, so your workspace is broker-shaped from the first screen.'), ('Company &amp; authority details', 'Your brokerage legal name and MC number. LoadBoot verifies your broker authority and the $75K surety bond or trust (BMC-84/85) on the federal record.'), ('Post your first load',",
 "'steps_h': 'Signup to covered freight in five steps', 'steps': [('Create the account', 'Company email, password, your name &mdash; then choose <b>Freight Broker</b> (or <b>Broker Agent</b> if you post under a brokerage&rsquo;s authority). Shippers and facilities have their own paths.'), ('Screen your MC &mdash; seconds', 'Your brokerage legal name and MC number. LoadBoot reads your broker authority live from FMCSA Licensing &amp; Insurance, with the SAFER snapshot as backup &mdash; FMCSA only keeps it active while the $75K BMC-84/85 is on file. Nothing to upload. Then accept the Master Broker Agreement with one click.'), ('Post your first load',")
rep('acct offers step',
 "('Offers go out', 'Direct offers reach verified carriers that fit the lane and equipment; first acceptance wins and everything else closes automatically &mdash; no double-booked trucks.')",
 "('Carriers request, you approve', 'Your posting reaches verified carriers that fit the lane and equipment. New brokerages start with a few open postings and request-to-book: a carrier requests, you approve within 30 minutes, LoadBoot dispatch confirms the rate confirmation before the truck rolls. First acceptance wins &mdash; no double-booked trucks.')")
rep('acct docs',
 "'docs_h': 'Have these ready', 'docs': [('&#128737;', 'Broker MC authority', 'Your active FMCSA broker operating authority. Property broker registration is what unlocks posting.'), ('&#128176;', 'Surety bond or trust', 'The $75K BMC-84 bond or BMC-85 trust on file with FMCSA — verified against the federal record, not a PDF you email us.'), ('&#127970;', 'Company details', 'Legal entity, EIN and remit/billing contacts, so carrier invoices and your payables ledger match your books.'), ('&#128101;', 'Your team', 'Teammate emails — everyone gets their own login on the same brokerage account.')], 'docs_note': '',",
 "'docs_h': 'All you need to start', 'docs': [('&#128737;', 'Your broker MC number', 'That is the whole ask. Authority and bond are read live from the federal record &mdash; not a PDF you email us.'), ('&#129309;', 'Agents: your brokerage&rsquo;s MC', 'No MC of your own? Post under the brokerage you work for. We screen their authority and email their FMCSA-listed contact one link to confirm you.'), ('&#128203;', 'Later &mdash; the verification packet', 'W-9, bond certificate, bank instructions and claims contact lift the posting limit, turn on instant booking for carriers and move payables inside LoadBoot. Nothing in it is needed for your first loads.'), ('&#128101;', 'Your team', 'Teammate emails — everyone gets their own login on the same brokerage account.')], 'docs_note': 'Documents arrive where they matter &mdash; first booking and first payment &mdash; not as a wall in front of your first post.',")
rep('acct notes licensed',
 "('Licensed brokers only', 'Moving shipper freight requires a property-broker license — so posting is gated on it. That is why carriers treat LoadBoot postings as real.')",
 "('Licensed brokers only', 'Moving shipper freight requires a property-broker license — so posting is gated on it, read live from FMCSA rather than from a photocopy. A carrier MC cannot post. That is why carriers treat LoadBoot postings as real.')")
rep('acct notes ghost',
 "('Zero ghost loads policy', 'Stale postings auto-close and cancellations carry TONU exposure — the board stays real because fakes cost money.')",
 "('Zero ghost loads policy', 'Every posting is reviewed by LoadBoot dispatch before it goes live, new brokerages start with a small posting allowance, stale postings auto-close and cancellations carry TONU exposure — the board stays real because fakes cost money and cannot scale.')")
rep('acct faq who',
 "('Who can post loads?', 'Approved broker partners with active FMCSA broker authority and the federal bond. Carrier and shipper accounts are separate — see <a href=\"brokers.html\">for brokers</a>.')",
 "('Who can post loads?', 'Any property broker whose authority shows ACTIVE on FMCSA — screened live at signup, no documents to start. Agents post under their brokerage&rsquo;s MC once the brokerage confirms by email. A carrier MC cannot post; carrier and shipper accounts are separate — see <a href=\"brokers.html\">for brokers</a>.'), ('Do I have to upload my bond or W-9 before posting?', 'No. FMCSA keeps broker authority active only while a BMC-84/85 is on file, so the live authority check already covers the bond. The verification packet (W-9, bond certificate, bank instructions, claims contact) comes later and lifts the posting limit, turns on instant booking for carriers and moves payables inside LoadBoot.'), ('Why is there a posting limit at first?', 'New brokerages start with a few open postings and request-to-book, and the limit rises after your first delivered load. It is how the board stays free of ghost loads without asking you for a pile of PDFs on day one.')")
rep('acct hero caption',
 "'The real signup &mdash; pick Freight Broker and you are posting in minutes.'",
 "'The real signup &mdash; pick Freight Broker (or Broker Agent), enter your MC, and you are posting in minutes.'")

# ---- free-load-board-for-brokers.html ----
rep('flb ready',
 "'<p>Ready to post? <a href=\"create-broker-account.html\">Create a broker account</a> &mdash; verification checks your authority and bond, then your first load reaches vetted carriers in minutes.",
 "'<p>Ready to post? <a href=\"create-broker-account.html\">Create a broker account</a> &mdash; your MC is screened live on FMCSA in seconds (no documents to start), then your first load reaches vetted carriers in minutes.")
rep('flb faq who',
 "('Who is allowed to post loads?', 'Approved broker partners with active FMCSA broker authority and the federal surety bond. Moving shipper freight requires a broker license in the US, so posting is gated on it &mdash; that gate is exactly why carriers treat LoadBoot postings as real.')",
 "('Who is allowed to post loads?', 'Any property broker whose authority shows ACTIVE on FMCSA &mdash; we read it live at signup, and the bond is implied because FMCSA only keeps broker authority active while a BMC-84/85 is on file. No documents to start. Agents post under their brokerage&rsquo;s MC once the brokerage confirms by email. Moving shipper freight requires a broker license in the US, so posting is gated on it &mdash; that gate is exactly why carriers treat LoadBoot postings as real.')")
rep('flb faq ghost',
 "('How do you stop ghost and double-brokered loads?', 'Carriers are FMCSA-verified with insurance and account-health monitored continuously, offers are first-accept-wins so a load cannot be double-booked, and GPS on the assigned truck proves the real carrier is hauling. Stale postings auto-close.')",
 "('How do you stop ghost and double-brokered loads?', 'On the broker side: authority is read live from FMCSA (a carrier MC cannot post), every posting is reviewed by LoadBoot dispatch before it goes live, and new brokerages start with a small posting allowance and request-to-book. On the carrier side: FMCSA-verified with insurance and account-health monitored continuously, first-accept-wins so a load cannot be double-booked, and GPS on the assigned truck proves the real carrier is hauling. Stale postings auto-close.')")
rep('flb linkcard',
 "linkcard('create-broker-account.html', '&#128221;', 'Create a broker account', 'Authority and bond verification, then your first posting reaches verified carriers in minutes.')",
 "linkcard('create-broker-account.html', '&#128221;', 'Create a broker account', 'MC screened live on FMCSA in seconds, one-click agreement, then your first posting reaches verified carriers in minutes.')")

# ---- api.html ----
rep('api getting a key',
 "'<li>Create a broker account at <a href=\"create-broker-account.html\">Create a broker account</a> and complete verification &mdash; authority, bond and documents.</li>'",
 "'<li>Create a broker account at <a href=\"create-broker-account.html\">Create a broker account</a> &mdash; your MC is screened live on FMCSA; the verification packet lifts posting limits later.</li>'")

# ---- faq.html · broker section ----
rep('faq broker start',
 " ('What does carrier verification cost me as a broker?', 'Nothing. FMCSA authority, insurance and safety checks run automatically on the platform &mdash; both directions. You see a verified profile before you ever assign a load.'),\n]",
 " ('What does carrier verification cost me as a broker?', 'Nothing. FMCSA authority, insurance and safety checks run automatically on the platform &mdash; both directions. You see a verified profile before you ever assign a load.'),\n"
 " ('What do I need to start posting?', 'Your broker MC number. We read your authority live from FMCSA at signup (the bond is on file whenever FMCSA shows broker authority active), you accept one master agreement, and you post &mdash; a few open loads to start, more after your first delivery. W-9, bond certificate and bank instructions come later and lift the limits.'),\n"
 " ('I am an agent without my own MC &mdash; can I post?', 'Yes, under the brokerage you work for. Enter their MC; we screen it on FMCSA and email their FMCSA-listed contact one link to confirm you. Every load you post shows their name and MC, and rate confirmations must be on their paper.'),\n]")

# ---- agent-confirm.html page generator (block kept beside this script) ----
if 'agent-confirm.html' not in s:
    block = (pathlib.Path(__file__).parent / 'agent-confirm-page.py.txt').read_text(encoding='utf-8')
    anchor = "     'brokers.html', _bc_body + _bc_js)\n"
    if s.count(anchor) != 1: raise SystemExit('ABORT: broker-claim anchor for agent-confirm page')
    s = s.replace(anchor, anchor + '\n\n' + block)
    s = s.replace("_SITEMAP_EXCLUDE = {'dashboard.html', '404.html', 'broker-claim.html', 'unsub.html'}", "_SITEMAP_EXCLUDE = {'dashboard.html', '404.html', 'broker-claim.html', 'agent-confirm.html', 'unsub.html'}")
    n += 1; print('  + agent-confirm.html page')
else: print('  = agent-confirm.html page')
P.write_text(s, encoding='utf-8')
print('edits applied:', n)
