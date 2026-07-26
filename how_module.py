# how_module.py — "extreme level" additions for how-it-works.html:
# animated journey rail, 5-minute chat-start section, mid-page conversion band,
# under-the-hood engine grid. Inline SVG/CSS only; scoped .hw2- classes.

HIW2_CSS = '''<style>
.hw2-rail{background:linear-gradient(135deg,#0b1220,#10223B);border-radius:24px;padding:38px 26px 30px;position:relative;overflow:hidden}
.hw2-rail h2{color:#fff;text-align:center;margin:0 0 4px;font-size:1.6rem}
.hw2-rail .sub{color:#9fb3cc;text-align:center;font-size:.95rem;margin:0 0 30px}
.hw2-steps{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;position:relative}
.hw2-steps:before{content:"";position:absolute;top:26px;left:8%;right:8%;border-top:2.5px dashed #3f6ea6;animation:hw2dash 1.2s linear infinite}
@keyframes hw2dash{to{transform:translateX(24px)}}
.hw2-step{text-align:center;position:relative}
.hw2-step .dot{width:52px;height:52px;border-radius:16px;margin:0 auto 10px;background:linear-gradient(135deg,#12304f,#153a63);border:1.5px solid #3f6ea6;display:flex;align-items:center;justify-content:center;font-size:1.35rem;position:relative;z-index:1;box-shadow:0 10px 26px -10px rgba(8,131,247,.5)}
.hw2-step b{display:block;color:#fff;font-size:.9rem;margin-bottom:3px}
.hw2-step span{color:#9fb3cc;font-size:.76rem;line-height:1.45;display:block}
.hw2-truck{position:absolute;top:8px;left:6%;font-size:1.5rem;animation:hw2drive 9s linear infinite;z-index:2;filter:drop-shadow(0 6px 10px rgba(0,0,0,.4))}
@keyframes hw2drive{0%{left:5%;transform:scaleX(1)}48%{left:88%;transform:scaleX(1)}50%{left:88%;transform:scaleX(1)}100%{left:5%;transform:scaleX(1)}}
@media(max-width:860px){.hw2-steps{grid-template-columns:repeat(2,1fr);gap:22px 10px}.hw2-steps:before{display:none}.hw2-truck{display:none}}
.hw2-chat{display:grid;grid-template-columns:1.05fr .95fr;gap:36px;align-items:center}
@media(max-width:860px){.hw2-chat{grid-template-columns:1fr}}
.hw2-chatviz{display:flex;justify-content:center}
.hw2-float{animation:hw2float 5s ease-in-out infinite}
@keyframes hw2float{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}
@keyframes hw2pulse{0%,100%{opacity:1}50%{opacity:.35}}
.hw2-blink{animation:hw2pulse 2s ease-in-out infinite}
.hw2-band{background:linear-gradient(135deg,#FC5305,#e34a02);border-radius:22px;padding:30px 34px;display:flex;align-items:center;gap:20px;flex-wrap:wrap;color:#fff;box-shadow:0 24px 60px -24px rgba(252,83,5,.55)}
.hw2-band b{font-size:1.25rem;display:block;margin-bottom:4px}
.hw2-band p{margin:0;color:#ffe0cf;font-size:.95rem}
.hw2-band a{margin-left:auto;background:#fff;color:#c2410c;font-weight:800;padding:13px 24px;border-radius:12px;text-decoration:none;white-space:nowrap;transition:transform .15s}
.hw2-band a:hover{transform:translateY(-2px)}
@media(max-width:700px){.hw2-band a{margin-left:0}}
.hw2-eng{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.hw2-ecard{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:15px;padding:16px;color:#e2e8f0}
.hw2-ecard .ic{font-size:1.3rem}.hw2-ecard b{display:block;font-size:.92rem;margin:6px 0 3px;color:#fff}
.hw2-ecard p{margin:0;font-size:.8rem;color:#9fb3cc;line-height:1.5}
</style>'''

def hiw_journey():
    steps = [
        ('🛡️', 'Verify', 'FMCSA live check — both sides, before anything moves'),
        ('📋', 'Post / Find', 'Real loads only, rate card in writing'),
        ('✍️', 'Book', 'One tap, e-signed rate confirmation'),
        ('🛰️', 'Track', 'Geofenced GPS stamps arrive & depart'),
        ('📸', 'Prove', 'Photo POD + timestamps on the record'),
        ('💵', 'Paid', 'Auto-invoice, human-approved payout'),
    ]
    h = '<section style="background:#0b1220;padding:0 0 44px"><div class="wrap"><div class="hw2-rail reveal"><span class="hw2-truck">🚛</span>'
    h += '<h2>The loop, at a glance</h2><p class="sub">Six moves. Every one of them leaves a record. That is the whole trick.</p><div class="hw2-steps">'
    for ic, t, d in steps:
        h += '<div class="hw2-step"><div class="dot">%s</div><b>%s</b><span>%s</span></div>' % (ic, t, d)
    h += '</div></div></div></section>'
    return h

def hiw_chat5():
    chat_svg = '''<svg class="hw2-float" width="300" height="330" viewBox="0 0 320 350" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="LoadBoot chat assistant setting up a carrier account in five minutes">
<rect x="8" y="8" width="304" height="334" rx="24" fill="#0b1830" stroke="#2b4a71"/>
<rect x="8" y="8" width="304" height="54" rx="24" fill="#10223B"/><rect x="8" y="40" width="304" height="22" fill="#10223B"/>
<circle class="hw2-blink" cx="34" cy="35" r="5" fill="#22c55e"/><text x="48" y="40" font-size="13" font-weight="800" fill="#fff" font-family="Inter,Arial">LoadBoot Support</text>
<rect x="24" y="78" width="196" height="34" rx="12" fill="#152c4c"/><text x="36" y="99" font-size="11.5" fill="#c7d5ea" font-family="Inter,Arial">Hi! Which one are you? 🚚 🏢 📦</text>
<rect x="116" y="122" width="180" height="30" rx="12" fill="#0883F7"/><text x="130" y="141" font-size="11.5" fill="#fff" font-family="Inter,Arial">I'm a carrier — MC 123456</text>
<rect x="24" y="162" width="230" height="64" rx="14" fill="#0d1f3a" stroke="#3f6ea6"/>
<text x="38" y="184" font-size="11" font-weight="800" fill="#7cc0ff" font-family="Inter,Arial">✓ SMITH TRUCKING LLC</text>
<text x="38" y="201" font-size="10" fill="#9fb3cc" font-family="Inter,Arial">Authority: ACTIVE · 3 power units</text>
<text x="38" y="216" font-size="10" fill="#22c55e" font-family="Inter,Arial">Verified live on FMCSA ✓</text>
<rect x="116" y="238" width="180" height="30" rx="12" fill="#0883F7"/><text x="132" y="257" font-size="11.5" fill="#fff" font-family="Inter,Arial">✓ Yes, that's my company</text>
<rect x="24" y="280" width="272" height="10" rx="5" fill="#152c4c"/><rect x="24" y="280" width="190" height="10" rx="5" fill="#FC5305"/>
<text x="24" y="312" font-size="10.5" fill="#9fb3cc" font-family="Inter,Arial">Setup 70% — docs checked by AI in seconds…</text></svg>'''
    return ('<section class="ftx-sec"><div class="wrap"><div class="hw2-chat">'
      '<div class="reveal"><div class="ftx-kicker">Step zero — the 5-minute start</div>'
      '<h2 class="ftx-h">The fastest onboarding in trucking happens in a chat window</h2>'
      '<p style="color:#475569;line-height:1.7">No forms marathon, no email ping-pong. Open the chat bubble on any page and say <b>&ldquo;set me up&rdquo;</b> — the assistant does the rest, live:</p>'
      '<div style="margin-top:12px">'
      '<div class="ftx-li"><span class="ftx-tick">1</span><div><b>Type your MC or DOT</b> — your company card comes back verified from FMCSA in seconds</div></div>'
      '<div class="ftx-li"><span class="ftx-tick">2</span><div><b>Account, no password games</b> — a secure sign-in link lands in your email (we never ask for passwords in chat)</div></div>'
      '<div class="ftx-li"><span class="ftx-tick">3</span><div><b>Drop your COI</b> — AI reads it on the spot and tells you exactly what to fix <i>before</i> it costs you a load</div></div>'
      '<div class="ftx-li"><span class="ftx-tick">4</span><div><b>W-9 and dispatch agreement</b> — filled and e-signed right in the thread, IRS-style form included</div></div>'
      '<div class="ftx-li"><span class="ftx-tick">5</span><div><b>Leave any time, resume any day</b> — your progress is saved; come back Tuesday and pick up at step 4</div></div>'
      '</div>'
      '<a href="#" onclick="var f=document.getElementById(\'lbc-fab\');if(f){f.click();}return false;" class="btn btn-primary" style="margin-top:16px">💬 Open the chat &amp; try it now</a></div>'
      '<div class="hw2-chatviz reveal">' + chat_svg + '</div>'
      '</div></div></section>')

def hiw_band():
    return ('<section style="padding:10px 0 34px"><div class="wrap"><div class="hw2-band reveal">'
      '<div><b>Seen enough?</b><p>Your first load could be booked this week. Setup is free, takes ~5 minutes, and there is no contract to regret.</p></div>'
      '<a href="get-started.html">Start now — pick your role →</a></div></div></section>')

def hiw_engine():
    items = [
        ('🛡️', 'FMCSA live verification', 'Authority, insurance and safety — checked in real time, both directions.'),
        ('📜', 'Written accessorials', 'Detention, TONU, layover printed on every posting before booking.'),
        ('🛰️', 'Geofenced GPS', '800m fences stamp arrive/depart server-side. Nobody argues with a timestamp.'),
        ('✍️', 'E-sign vault', 'Rate cons, W-9s, agreements — signed, timestamped, stored forever.'),
        ('🤖', 'AI document checks', 'COIs and W-9s read in seconds; humans make the final call.'),
        ('🧑‍⚖️', 'Human-approved money', 'Software prepares every payout; a person signs it off. Always.'),
        ('💬', '24/7 concierge', 'AI answers instantly, staff on standby, onboarding inside the chat.'),
    ]
    h = ('<section style="background:linear-gradient(165deg,#0e1c38,#0b1220);padding:56px 0"><div class="wrap">'
         '<div class="sec-head reveal"><div class="eyebrow" style="color:#FC5305">Under the hood</div>'
         '<h2 style="color:#fff">Seven systems run on every single load</h2>'
         '<p style="color:#9fb3cc">You never think about them. That is the point — they just make the loop impossible to cheat.</p></div>'
         '<div class="hw2-eng reveal" style="margin-top:22px">')
    for ic, t, d in items:
        h += '<div class="hw2-ecard"><span class="ic">%s</span><b>%s</b><p>%s</p></div>' % (ic, t, d)
    h += '</div></div></section>'
    return h
