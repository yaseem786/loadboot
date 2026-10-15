# sms_brokers_module.py — the public SMS program page for FREIGHT BROKERS (/sms-brokers.html).
#
# Written 8 Oct 2026 for the broker 10DLC campaign (Telnyx/TCR). The carrier campaign (CS3VIAJ, /sms.html) has ONE
# opt-in: the registration checkbox. Brokers never fill in that form, so their campaign declares different opt-in
# methods — a verbal yes on a recorded dispatch call (the script read word for word), or the broker texting us first —
# and the carrier-network reviewer has to be able to read all of that on a plain, crawlable, no-JavaScript page.
#
# RULES:
#   * VERBAL_SCRIPT below must stay IDENTICAL to app_private.dialer_config.sms_verbal_script (bl_dial_0390) — the words
#     a dispatcher reads on the call — and to the Message Flow in the Telnyx campaign. Change one, change all three.
#   * FIRST_MSG_SUFFIX must stay IDENTICAL to dialer_config.sms_first_msg_suffix (appended to the first text by the
#     sms_consent_guard trigger).
#   * The sending number comes from ONE constant, SMS_BROKER_NUMBER. It is empty until the owner assigns the number;
#     the page then says so instead of inventing one. Set it as E.164 ('+1XXXXXXXXXX').
#   * sms.html (carriers) and the /text-us redirect are NOT touched by this page.

import privacy_module as _pvm
from sms_module import SMS_CSS

SMS_BROKER_NUMBER = ''   # E.164, e.g. '+18155551234' — placeholder until the owner assigns the broker number

VERBAL_SCRIPT = ('Before I text you — is it OK if LoadBoot sends you text messages at this number about loads and dispatch? '
 'That is load details, pickup and delivery info, check calls and paperwork. Message frequency varies, '
 'message and data rates may apply, and you can reply STOP at any time to stop them. Do I have your permission?')
VERBAL_SCRIPT_VERSION = 'v1-2026-09-21'
FIRST_MSG_SUFFIX = (' — LoadBoot dispatch. You agreed to texts about your loads. Msg & data rates may apply. '
 'Reply STOP to opt out, HELP for help.')

def _pretty(e164):
    d = ''.join(ch for ch in (e164 or '') if ch.isdigit())
    if len(d) == 11 and d[0] == '1':
        return '+1 (%s) %s-%s' % (d[1:4], d[4:7], d[7:])
    return e164 or ''

def _num_html():
    if SMS_BROKER_NUMBER:
        return '<a href="tel:%s">%s</a>' % (SMS_BROKER_NUMBER, _pretty(SMS_BROKER_NUMBER))
    return '<b>the LoadBoot dispatch number your dispatcher calls you from</b> (the dedicated broker texting number is published here the day the campaign is approved)'

def _num_short():
    return _pretty(SMS_BROKER_NUMBER) if SMS_BROKER_NUMBER else 'the LoadBoot dispatch number'

def _promise(items):
    out = '<div class="pv-grid pv-g3">'
    for ic, h, p in items:
        out += '<div class="pv-promise"><div class="ic">%s</div><h3>%s</h3><p>%s</p></div>' % (ic, h, p)
    return out + '</div>'

def sms_brokers_page(ctx=None):
    ctx = ctx or {}
    b = _pvm.PV_CSS + (SMS_CSS % ())
    script_html = VERBAL_SCRIPT.replace('&', '&amp;')
    sfx_html = FIRST_MSG_SUFFIX.replace('&', '&amp;')
    num = _num_html()

    # ---------- HERO ----------
    b += '''<section class="pv-hero"><div class="wrap">
<span class="pv-kick"><span class="dot"></span>LoadBoot SMS program &middot; freight brokers</span>
<h1>Text messages from LoadBoot to brokers. <span class="pv-grad">How you opt in, what we send, how you stop.</span></h1>
<p class="pv-lead">LoadBoot LLC is a truck dispatch service. Our dispatchers book loads with freight brokers by phone, and some brokers prefer the follow-up &mdash; the rate confirmation, the pickup number, the driver&rsquo;s ETA &mdash; by text. This page is the complete, public description of that program: the two ways a broker opts in, the exact words we use, every message type we send, and every way to stop.</p>
<div class="pv-chips">
<span class="pv-chip"><b>Opt-in</b> on a call or by texting first</span>
<span class="pv-chip"><b>STOP</b> ends it instantly</span>
<span class="pv-chip"><b>No</b> marketing texts, ever</span>
</div>
<div class="pv-stamp"><b>Program:</b> LoadBoot broker dispatch messaging &middot; Sender: LoadBoot LLC, 30 N Gould St Ste N, Sheridan, WY 82801 &middot; Sending number: ''' + num + ''' &middot; Last updated <b>8 October 2026</b></div>
</div></section>'''

    # ---------- HOW A BROKER OPTS IN ----------
    b += ('<section class="pv-sec" id="optin"><div class="wrap">'
          '<div class="pv-head"><div class="pv-eye">The only two opt-in methods</div>'
          '<h2>A broker opts in on a call, or by texting us first</h2>'
          '<p>A phone number on a load board, in a rate confirmation or in an email signature is <b>not</b> permission, and LoadBoot never texts one. '
          'A broker is texted only after one of these two things has happened, and both are recorded.</p></div>'
          '<div class="sm-path">'
          '<div class="sm-step"><span class="n">1</span><h4>Verbal consent on a dispatch call</h4><p>While booking or discussing a load, the dispatcher reads the consent script below <b>word for word</b> and continues only if the broker says yes.</p></div>'
          '<div class="sm-step"><span class="n">2</span><h4>We log the yes before the first text</h4><p>The dispatcher records which call it was on. LoadBoot stores the broker&rsquo;s number, the date and time, the dispatcher, the script version (' + VERBAL_SCRIPT_VERSION + ') and the call reference. No record, no text &mdash; the block is enforced in our database, not left to the dispatcher.</p></div>'
          '<div class="sm-step"><span class="n">3</span><h4>Or: the broker texts us first</h4><p>A broker who texts a LoadBoot dispatch number has asked for a reply. That inbound message is stored as the consent record and the conversation is answered on the same number.</p></div>'
          '<div class="sm-step"><span class="n">4</span><h4>The first text carries the full disclosure</h4><p>Whichever way they opted in, the first message to a number ends with the program name, what they agreed to, rates, STOP and HELP (shown below). After that every text ends with &ldquo;Reply STOP to opt out.&rdquo;</p></div>'
          '</div></div></section>')

    # ---------- THE SCRIPT ----------
    b += ('<section class="pv-sec soft" id="script"><div class="wrap">'
          '<div class="pv-head"><div class="pv-eye">Verbatim</div><h2>The consent script, word for word</h2>'
          '<p>This is what the dispatcher reads on the call. It is stored once in LoadBoot&rsquo;s configuration (version ' + VERBAL_SCRIPT_VERSION + ') and shown to the dispatcher on screen, so it cannot drift.</p></div>'
          '<blockquote class="sm-quote">&ldquo;' + script_html + '&rdquo;</blockquote>'
          '<p style="margin-top:18px;color:#475569">If the broker does not say yes, nothing is sent. The dispatcher can still call, leave a voicemail or email &mdash; none of which is a text message.</p>'
          '</div></section>')

    # ---------- FIRST MESSAGE ----------
    b += ('<section class="pv-sec" id="confirmation"><div class="wrap">'
          '<div class="pv-head"><div class="pv-eye">Confirmation</div><h2>What the first text looks like</h2>'
          '<p>Every text starts with &ldquo;LoadBoot:&rdquo;. The first one to a number also carries this disclosure, added by our system, not typed by the dispatcher:</p></div>'
          '<div class="sm-msg">LoadBoot: Thanks for the call, here is the load we discussed &mdash; pickup Tue 8:00 AM, 1200 Commerce St, Dallas TX, PU# 48213.' + sfx_html + '</div>'
          '<p style="margin-top:14px;font-size:.95rem;color:#475569">The disclosure, verbatim: <em>&ldquo;' + sfx_html.strip() + '&rdquo;</em></p>'
          '</div></section>')

    # ---------- DISCLOSURES ----------
    b += ('<section class="pv-sec soft" id="disclosures"><div class="wrap">'
          '<div class="pv-head"><div class="pv-eye">Program disclosures</div><h2>Everything a broker should know</h2></div>'
          + _promise([
            ('&#128172;', 'What we send', 'One-to-one operational messages about loads the broker is working with LoadBoot: rate confirmations and where to send them, pickup and delivery numbers, addresses and appointment times, driver and ETA updates while a load is moving, proof-of-delivery and paperwork, and replies to texts the broker sends. <b>No marketing, promotional or bulk messages.</b>'),
            ('&#128257;', 'Message frequency', 'Message frequency varies with the loads in progress. A broker with no active load with us receives nothing; a moving load may mean several texts in a day.'),
            ('&#128176;', 'Cost', 'Message and data rates may apply, depending on the mobile plan. LoadBoot does not charge for texts.'),
            ('&#9940;', 'How to stop', 'Reply <b>STOP</b> to any message and texts end immediately. One confirmation is sent and nothing more. Reply <b>START</b> to receive them again. A number that replied STOP cannot be re-added by a dispatcher &mdash; only the broker&rsquo;s own START does that.'),
            ('&#10067;', 'How to get help', 'Reply <b>HELP</b> to any message, email <a href="mailto:hello@loadboot.com">hello@loadboot.com</a>, or call or WhatsApp <a href="tel:+18153651168">+1 (815) 365-1168</a>.'),
            ('&#128274;', 'The number stays private', 'Consent is not a condition of doing business with LoadBoot or of any purchase. Mobile numbers and consent records are never sold, rented or shared with third parties or affiliates for their marketing. Full details in our <a href="/privacy.html#sms">Privacy Policy</a>.'),
          ]) +
          '<p style="margin-top:22px;font-size:.92rem;color:#64748b">Mobile carriers are not liable for delayed or undelivered messages.</p>'
          '</div></section>')

    # ---------- KEYWORDS ----------
    b += ('<section class="pv-sec" id="keywords"><div class="wrap">'
          '<div class="pv-head"><div class="pv-eye">Keywords</div><h2>What happens when a broker replies</h2></div>'
          '<table class="sm-kw" style="width:100%;border-collapse:collapse;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">'
          '<tr><th>They reply</th><th>We answer</th></tr>'
          '<tr><td><code>STOP</code>, <code>UNSUBSCRIBE</code>, <code>CANCEL</code>, <code>END</code>, <code>QUIT</code></td><td>LoadBoot: You are unsubscribed from LoadBoot messages and will receive no further texts. Reply START to resubscribe.</td></tr>'
          '<tr><td><code>HELP</code>, <code>INFO</code></td><td>LoadBoot dispatch support: email hello@loadboot.com or call +1 815-365-1168. Msg frequency varies. Msg &amp; data rates may apply. Reply STOP to opt out.</td></tr>'
          '<tr><td><code>START</code>, <code>YES</code></td><td>LoadBoot: You\'re subscribed to load and dispatch updates at this number. Msg frequency varies. Msg &amp; data rates may apply. Reply HELP for help, STOP to opt out. Terms: loadboot.com/terms.html Privacy: loadboot.com/privacy.html</td></tr>'
          '</table></div></section>')

    # ---------- SAMPLES ----------
    b += ('<section class="pv-sec soft" id="samples"><div class="wrap">'
          '<div class="pv-head"><div class="pv-eye">Examples</div><h2>What a LoadBoot text to a broker looks like</h2></div>'
          '<div class="sm-msg">LoadBoot: Rate confirmation for load #48219 Dallas, TX to Atlanta, GA received, thank you. Driver Sam, truck 214, trailer 8821. Reply STOP to opt out.</div>'
          '<div class="sm-msg">LoadBoot: Driver is loaded and rolling, 22,000 lbs, ETA to receiver Wed 2:30 PM. Reply STOP to opt out.</div>'
          '<div class="sm-msg">LoadBoot: Delivered 1:48 PM, signed POD attached. Please confirm the invoice email address. Reply STOP to opt out.</div>'
          '</div></section>')

    # ---------- CONTACT ----------
    b += ('<section class="pv-sec" id="contact"><div class="wrap"><div class="pv-cta">'
          '<h2>Questions about texts from LoadBoot?</h2>'
          '<p>LoadBoot LLC &middot; 30 N Gould St Ste N, Sheridan, WY 82801, USA &middot; <a href="mailto:hello@loadboot.com">hello@loadboot.com</a> &middot; Call or WhatsApp <a href="tel:+18153651168">+1 (815) 365-1168</a> &middot; Texts come from ' + _num_short() + '.</p>'
          '<div class="row"><a class="btn btn-primary" href="/privacy.html#sms">Privacy Policy &mdash; SMS section</a>'
          '<a class="btn btn-secondary" href="/terms.html#s11">Terms &mdash; clause 11</a>'
          '<a class="btn btn-secondary" href="/sms.html">Carrier SMS program</a></div>'
          '</div></div></section>')
    return b, ''
