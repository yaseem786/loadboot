# sms_module.py — the public SMS program page (/sms.html).
#
# Written 24 Sep 2026 after Telnyx campaign CS3VIAJ came back MNO_REJECTED (806:
# "Unable to verify ... CTA"). The carrier reviewer could not verify the opt-in because
# the campaign pointed at /app/carrier/, which robots.txt disallows and which renders the
# signup form only after two taps inside a JS app. This page is a plain, crawlable,
# no-JavaScript copy of the exact call-to-action: the path to the form, the checkbox
# label word for word, and every disclosure the MNOs look for (frequency, rates,
# STOP, HELP, consent-not-a-condition, privacy link).
#
# RULES: the checkbox text below must stay IDENTICAL to the label in app/carrier/app.js
# (search "tick to agree") and to the Message Flow in the Telnyx campaign. Change one,
# change all three. Optional real screenshot: drop a PNG at docs/sms-optin-screenshot.png
# and the build copies and shows it automatically.

import os, shutil
import privacy_module as _pvm

CONSENT_LABEL = ('Optional — tick to agree to receive text messages from LoadBoot at the mobile '
 'number above about your loads and account (dispatch updates, check calls, paperwork requests). '
 'Consent is not a condition of creating an account or of purchasing anything. Message frequency '
 'varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help. See our Terms and Privacy Policy.')

SMS_CSS = '''<style>
.sm-form{max-width:440px;margin:26px auto 0;padding:26px 24px;border-radius:18px;background:#0B1526;color:#fff;
  border:1px solid rgba(255,255,255,.12);box-shadow:0 24px 60px rgba(2,8,23,.45);font-family:Inter,system-ui,sans-serif}
.sm-form h3{margin:0 0 4px;font-size:1.35rem;color:#fff}
.sm-form .sub{font-size:13px;color:#94a3b8;margin:0 0 18px}
.sm-form label.f{display:block;font-size:12.5px;font-weight:700;color:#cbd5e1;margin:12px 0 5px}
.sm-form .in{display:block;width:100%%;box-sizing:border-box;padding:11px 13px;border-radius:10px;border:1px solid rgba(255,255,255,.16);
  background:rgba(255,255,255,.06);color:#64748b;font-size:14px}
.sm-form .ph{display:grid;grid-template-columns:96px 1fr;gap:8px}
.sm-form .consent{display:flex;gap:9px;align-items:flex-start;margin:11px 0 0;font-size:11.5px;line-height:1.45;color:#e2e8f0}
.sm-form .consent .box{flex:none;width:16px;height:16px;margin-top:2px;border-radius:4px;border:1.5px solid #94a3b8;background:#fff;box-sizing:border-box}
.sm-form .consent a{color:#7dd3fc}
.sm-form .btn-fake{display:block;margin-top:16px;padding:12px;border-radius:10px;background:#0883F7;color:#fff;text-align:center;font-weight:800;font-size:14px}
.sm-cap{text-align:center;font-size:13px;color:#64748b;margin-top:12px}
.sm-path{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(230px,100%%),1fr));margin-top:22px}
.sm-step{padding:18px 18px 16px;border-radius:14px;background:#fff;border:1px solid #e2e8f0}
.sm-step .n{display:inline-flex;width:28px;height:28px;border-radius:50%%;background:#0883F7;color:#fff;font-weight:800;align-items:center;justify-content:center;font-size:13px}
.sm-step h4{margin:10px 0 6px;font-size:1rem}
.sm-step p{margin:0;font-size:.93rem;line-height:1.55;color:#475569}
.sm-quote{margin:22px 0 0;padding:20px 22px;border-left:4px solid #FC5305;background:#fff7ed;border-radius:0 14px 14px 0;font-size:.98rem;line-height:1.6;color:#1e293b}
.sm-shot{display:block;max-width:420px;width:100%%;margin:24px auto 0;border-radius:16px;border:1px solid #e2e8f0;box-shadow:0 18px 50px rgba(2,8,23,.18)}
.sm-msg{margin:0 0 10px;padding:12px 16px;border-radius:14px 14px 14px 4px;background:#eef4ff;font-size:.93rem;line-height:1.5;color:#1e293b;max-width:560px}
.sm-kw td,.sm-kw th{padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top;font-size:.93rem}
.sm-kw th{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#64748b}
.sm-kw code{background:#f1f5f9;padding:2px 7px;border-radius:6px;font-weight:700}
</style>'''

def _promise(items):
    out = '<div class="pv-grid pv-g3">'
    for ic, h, p in items:
        out += '<div class="pv-promise"><div class="ic">%s</div><h3>%s</h3><p>%s</p></div>' % (ic, h, p)
    return out + '</div>'

def sms_page(ctx=None):
    ctx = ctx or {}
    b = _pvm.PV_CSS + (SMS_CSS % ())

    # optional real screenshot of the live form
    shot = ''
    src = ctx.get('SRC'); out = ctx.get('OUT')
    if src and out:
        p = os.path.join(src, 'docs', 'sms-optin-screenshot.png')
        if os.path.exists(p):
            try:
                shutil.copy2(p, os.path.join(out, 'sms-optin-screenshot.png'))
                shot = ('<img class="sm-shot" src="sms-optin-screenshot.png" width="420" '
                        'alt="Screenshot of the LoadBoot carrier registration form showing the optional, unchecked SMS consent checkbox under the mobile number field">'
                        '<p class="sm-cap">Screenshot of the live registration form at loadboot.com/app/carrier</p>')
            except Exception:
                shot = ''

    label_html = CONSENT_LABEL.replace('&', '&amp;').replace('Terms and Privacy Policy',
        '<a href="/terms.html#s11">Terms</a> and <a href="/privacy.html#sms">Privacy Policy</a>')

    # ---------- HERO ----------
    b += '''<section class="pv-hero"><div class="wrap">
<span class="pv-kick"><span class="dot"></span>LoadBoot SMS program</span>
<h1>Text messages from LoadBoot. <span class="pv-grad">How you opt in, what we send, how you stop.</span></h1>
<p class="pv-lead">LoadBoot LLC sends one-to-one dispatch texts to motor carriers who asked for them. This page is the complete, public description of that program: the exact place you opt in, the exact words you agree to, and every way to reach us or stop.</p>
<div class="pv-chips">
<span class="pv-chip"><b>Opt-in</b> is a separate, unchecked box</span>
<span class="pv-chip"><b>STOP</b> ends it instantly</span>
<span class="pv-chip"><b>No</b> marketing texts, ever</span>
</div>
<div class="pv-stamp"><b>Program:</b> LoadBoot dispatch messaging &middot; Sender: LoadBoot LLC, 30 N Gould St Ste N, Sheridan, WY 82801 &middot; Last updated <b>24 September 2026</b></div>
</div></section>'''

    # ---------- HOW YOU OPT IN ----------
    b += ('<section class="pv-sec" id="optin"><div class="wrap">'
          '<div class="pv-head"><div class="pv-eye">The only opt-in method</div>'
          '<h2>You opt in on the carrier registration form</h2>'
          '<p>There is one way to receive texts from LoadBoot: tick the optional SMS box when you create a carrier account. '
          'Giving us your mobile number does not opt you in; only the ticked box does. Here is the exact path.</p></div>'
          '<div class="sm-path">'
          '<div class="sm-step"><span class="n">1</span><h4>Open the carrier portal</h4><p>Go to <a href="/app/carrier/">loadboot.com/app/carrier</a> and choose <b>Carrier owner</b>.</p></div>'
          '<div class="sm-step"><span class="n">2</span><h4>Tap &ldquo;Create an account&rdquo;</h4><p>The registration form asks for email, password, company, your name, and a country code plus mobile number.</p></div>'
          '<div class="sm-step"><span class="n">3</span><h4>Tick the optional SMS box</h4><p>It sits directly under the mobile number, is <b>unchecked by default</b>, and the account is created whether or not you tick it.</p></div>'
          '<div class="sm-step"><span class="n">4</span><h4>We record your consent</h4><p>The date, time and source (registration checkbox) are stored with your account. Untick later from Account &rarr; Security, or reply STOP.</p></div>'
          '</div>'
          # ---- replica of the live form ----
          '<div class="sm-form" aria-label="Copy of the LoadBoot carrier registration form">'
          '<h3>Create your account</h3><p class="sub">Set up your carrier profile &mdash; it&rsquo;s free.</p>'
          '<label class="f">Email</label><span class="in">you@company.com</span>'
          '<label class="f">Password</label><span class="in">Password</span>'
          '<label class="f">Company</label><span class="in">Company / carrier name</span>'
          '<label class="f">Your name</label><span class="in">Your full name</span>'
          '<label class="f">Mobile number</label><div class="ph"><span class="in">+1 US/CA</span><span class="in">Mobile number</span></div>'
          '<div class="consent"><span class="box" role="img" aria-label="unchecked checkbox"></span><span>' + label_html + '</span></div>'
          '<span class="btn-fake">Create account</span>'
          '</div>'
          '<p class="sm-cap">Exact copy of the live registration form. The consent box is optional and starts unchecked.</p>'
          + shot +
          '</div></section>')

    # ---------- THE WORDS YOU AGREE TO ----------
    b += ('<section class="pv-sec soft" id="consent"><div class="wrap">'
          '<div class="pv-head"><div class="pv-eye">Verbatim</div><h2>The checkbox label, word for word</h2>'
          '<p>This is the full text next to the box. Nothing is hidden behind a link.</p></div>'
          '<blockquote class="sm-quote">&ldquo;' + label_html + '&rdquo;</blockquote>'
          '<p style="margin-top:18px;color:#475569">&ldquo;Terms&rdquo; links to <a href="/terms.html#s11">loadboot.com/terms.html#s11</a> and &ldquo;Privacy Policy&rdquo; links to <a href="/privacy.html#sms">loadboot.com/privacy.html#sms</a>.</p>'
          '</div></section>')

    # ---------- DISCLOSURES ----------
    b += ('<section class="pv-sec" id="disclosures"><div class="wrap">'
          '<div class="pv-head"><div class="pv-eye">Program disclosures</div><h2>Everything you should know before you tick the box</h2></div>'
          + _promise([
            ('&#128172;', 'What we send', 'One-to-one operational dispatch messages only: load details, pickup and delivery times and addresses, check-call and status updates while a load is moving, paperwork requests such as the rate confirmation or signed POD, and replies to texts you send us. <b>No marketing or promotional messages.</b>'),
            ('&#128257;', 'Message frequency', 'Message frequency varies with your loads. A quiet week may mean no texts; a moving load may mean several in a day.'),
            ('&#128176;', 'Cost', 'Message and data rates may apply, depending on your mobile plan. LoadBoot does not charge for texts.'),
            ('&#9940;', 'How to stop', 'Reply <b>STOP</b> to any message and texts end immediately. You will get one confirmation and nothing more. Reply <b>START</b> if you want them back.'),
            ('&#10067;', 'How to get help', 'Reply <b>HELP</b> to any message, call <a href="tel:+14692537575">+1 (469) 253-7575</a>, or email <a href="mailto:hello@loadboot.com">hello@loadboot.com</a>.'),
            ('&#128274;', 'Your number stays private', 'Consent is not a condition of creating an account, of being dispatched, or of any purchase. Mobile numbers and text-message consent records are never sold, rented or shared with third parties or affiliates for their marketing. Full details in our <a href="/privacy.html#sms">Privacy Policy</a>.'),
          ]) +
          '<p style="margin-top:22px;font-size:.92rem;color:#64748b">Mobile carriers are not liable for delayed or undelivered messages. Supported carriers: all major US carriers.</p>'
          '</div></section>')

    # ---------- KEYWORDS ----------
    b += ('<section class="pv-sec soft" id="keywords"><div class="wrap">'
          '<div class="pv-head"><div class="pv-eye">Keywords</div><h2>What happens when you reply</h2></div>'
          '<table class="sm-kw" style="width:100%;border-collapse:collapse;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">'
          '<tr><th>You reply</th><th>We answer</th></tr>'
          '<tr><td><code>STOP</code>, <code>UNSUBSCRIBE</code>, <code>CANCEL</code>, <code>END</code>, <code>QUIT</code></td><td>LoadBoot: You are unsubscribed from LoadBoot messages and will receive no further texts. Reply START to resubscribe.</td></tr>'
          '<tr><td><code>HELP</code>, <code>INFO</code></td><td>LoadBoot dispatch support: call +1 469-253-7575 or email hello@loadboot.com. Msg frequency varies. Msg &amp; data rates may apply. Reply STOP to opt out.</td></tr>'
          '<tr><td><code>START</code>, <code>YES</code></td><td>LoadBoot: You\'re subscribed to load and dispatch updates at this number. Msg frequency varies. Msg &amp; data rates may apply. Reply HELP for help, STOP to opt out. Terms: loadboot.com/terms.html Privacy: loadboot.com/privacy.html</td></tr>'
          '</table></div></section>')

    # ---------- SAMPLES ----------
    b += ('<section class="pv-sec" id="samples"><div class="wrap">'
          '<div class="pv-head"><div class="pv-eye">Examples</div><h2>What a LoadBoot text looks like</h2></div>'
          '<div class="sm-msg">LoadBoot: Load #48219 Dallas, TX to Atlanta, GA, pickup Tue 8:00 AM, $2,850 all-in. Reply Y to accept or call dispatch at +1 469-253-7575. Reply STOP to opt out.</div>'
          '<div class="sm-msg">LoadBoot: pickup confirmed for tomorrow 8:00 AM at 1200 Commerce St, Dallas TX. PU# 48213. Reply here with any questions. Reply STOP to opt out.</div>'
          '<div class="sm-msg">LoadBoot check call: driver is 45 miles from the receiver, ETA 2:30 PM. Reply STOP to opt out.</div>'
          '<div class="sm-msg">LoadBoot: delivery complete. Send the signed POD to this number or upload it at https://loadboot.com/app/carrier/. Reply STOP to opt out, HELP for help.</div>'
          '</div></section>')

    # ---------- CONTACT ----------
    b += ('<section class="pv-sec soft" id="contact"><div class="wrap"><div class="pv-cta">'
          '<h2>Questions about texts from LoadBoot?</h2>'
          '<p>LoadBoot LLC &middot; 30 N Gould St Ste N, Sheridan, WY 82801, USA &middot; <a href="tel:+14692537575">+1 (469) 253-7575</a> &middot; <a href="mailto:hello@loadboot.com">hello@loadboot.com</a></p>'
          '<div class="row"><a class="btn btn-primary" href="/privacy.html#sms">Privacy Policy &mdash; SMS section</a>'
          '<a class="btn btn-secondary" href="/terms.html#s11">Terms &mdash; clause 11</a></div>'
          '</div></div></section>')
    return b, ''
