# faq_module.py — Amazon/Uber-style help-center FAQ page: hero search, role tabs,
# categorized accordions, contact cards. Pure HTML/CSS + one tiny inline script
# (search + tab filtering). Schema built for every question.
import json, re

FAQ_CSS = '''<style>
.fq-hero{background:linear-gradient(135deg,#0b1220 0%,#10223B 50%,#14335c 100%);border-radius:26px;padding:52px 30px;text-align:center;color:#fff;position:relative;overflow:hidden}
.fq-hero:before{content:"";position:absolute;inset:0;background:radial-gradient(600px 260px at 80% 10%,rgba(8,131,247,.28),transparent 60%)}
.fq-hero h1{position:relative;font-size:clamp(1.7rem,4vw,2.7rem);margin:0 0 8px;letter-spacing:-.02em}
.fq-hero p{position:relative;color:#c7d5ea;margin:0 auto 22px;max-width:56ch}
.fq-search{position:relative;max-width:620px;margin:0 auto;display:flex;background:#fff;border-radius:16px;padding:6px;box-shadow:0 18px 50px rgba(2,6,23,.4)}
.fq-search input{flex:1;border:none;outline:none;padding:13px 16px;font:500 1rem Inter,Arial;color:#0f172a;background:transparent}
.fq-search .ic{display:flex;align-items:center;padding:0 6px 0 14px;color:#94a3b8;font-size:1.1rem}
.fq-tabs{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin:26px auto 6px;position:sticky;top:70px;z-index:5;background:rgba(244,247,251,.92);backdrop-filter:blur(8px);padding:10px;border-radius:16px;max-width:900px}
.fq-tab{border:1.5px solid #dbe4ef;background:#fff;color:#334155;font:700 .88rem Inter,Arial;padding:10px 16px;border-radius:999px;cursor:pointer;transition:all .15s}
.fq-tab:hover{border-color:#0883F7;color:#0883F7}
.fq-tab.on{background:#10223B;border-color:#10223B;color:#fff}
.fq-cat{max-width:900px;margin:0 auto}
.fq-cat-h{display:flex;align-items:center;gap:12px;margin:34px 0 14px}
.fq-cat-h .ic{width:44px;height:44px;border-radius:13px;display:flex;align-items:center;justify-content:center;font-size:1.35rem;background:linear-gradient(135deg,#10223B,#153055);box-shadow:0 8px 22px -10px rgba(2,12,30,.5)}
.fq-cat-h h2{margin:0;font-size:1.35rem;letter-spacing:-.01em}
.fq-cat-h span{color:#94a3b8;font-size:.85rem;font-weight:600}
.fq-item{background:#fff;border:1px solid #e6edf5;border-radius:16px;margin-bottom:10px;overflow:hidden;transition:box-shadow .2s,border-color .2s}
.fq-item[open]{border-color:#bfdcfb;box-shadow:0 14px 36px -20px rgba(8,131,247,.35)}
.fq-item summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:14px;padding:17px 20px;font:700 1rem Inter,Arial;color:#10223B}
.fq-item summary::-webkit-details-marker{display:none}
.fq-item summary .pm{flex:none;width:26px;height:26px;border-radius:9px;background:#eef5fd;color:#0883F7;display:flex;align-items:center;justify-content:center;font-weight:800;transition:transform .2s}
.fq-item[open] summary .pm{transform:rotate(45deg);background:#0883F7;color:#fff}
.fq-item .fq-a{padding:0 20px 18px;color:#475569;font-size:.96rem;line-height:1.7}
.fq-item .fq-a a{color:#0883F7;font-weight:600}
.fq-none{display:none;text-align:center;padding:40px 0;color:#64748b}
.fq-help{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px;max-width:900px;margin:44px auto 0}
.fq-help a{background:linear-gradient(160deg,#0d1b31,#153055);border-radius:18px;padding:22px;color:#fff;text-decoration:none;display:block;transition:transform .2s;border:1px solid rgba(124,192,255,.15)}
.fq-help a:hover{transform:translateY(-4px)}
.fq-help .ic{font-size:1.6rem}.fq-help b{display:block;margin:8px 0 4px}
.fq-help p{color:#9fb3cc;font-size:.85rem;margin:0;line-height:1.5}
@media(max-width:700px){.fq-tabs{position:static}.fq-hero{padding:38px 18px}}
</style>'''

def _strip(html):
    return re.sub(r'<[^>]+>', '', html).replace('&mdash;','—').replace('&rsquo;',"'").replace('&ldquo;','"').replace('&rdquo;','"').replace('&amp;','&')

def faq_page(cats):
    """cats = [(id, icon, label, [(q, a), ...]), ...] -> (body_html, schema_html)"""
    tabs = '<div class="fq-tabs reveal" id="fqTabs"><button class="fq-tab on" data-cat="all">All topics</button>'
    for cid, ic, label, items in cats:
        tabs += '<button class="fq-tab" data-cat="%s">%s %s</button>' % (cid, ic, label)
    tabs += '</div>'
    body = ('<section style="padding-bottom:0"><div class="wrap"><div class="fq-hero reveal">'
            '<h1>How can we help?</h1>'
            '<p>Straight answers for carriers, brokers, shippers and partners — search or pick your seat below. Still stuck? The chat bubble answers instantly, 24/7.</p>'
            '<div class="fq-search"><span class="ic">&#128269;</span><input id="fqSearch" type="search" placeholder="Search answers — detention, COI, posting, tracking, W-9…" aria-label="Search FAQs"></div>'
            '</div>' + tabs + '</div></section><section style="padding-top:8px"><div class="wrap">')
    all_items = []
    for cid, ic, label, items in cats:
        body += '<div class="fq-cat" data-catwrap="%s"><div class="fq-cat-h"><div class="ic">%s</div><h2>%s</h2><span>%d answers</span></div>' % (cid, ic, label, len(items))
        for q, a in items:
            body += ('<details class="fq-item" data-cat="%s"><summary>%s<span class="pm">+</span></summary>'
                     '<div class="fq-a">%s</div></details>') % (cid, q, a)
            all_items.append((q, a))
        body += '</div>'
    body += ('<div class="fq-none" id="fqNone">&#129301; Nothing matched — try a different word, or just ask in the chat bubble (bottom right). It answers instantly.</div>'
             '<div class="fq-help reveal">'
             '<a href="#" onclick="var f=document.getElementById(\'lbc-fab\');if(f){f.click();}return false;"><span class="ic">&#128172;</span><b>Chat — instant, 24/7</b><p>AI answers in seconds and can even set up your account right in the chat. Humans on standby.</p></a>'
             '<a href="tel:+19283936198"><span class="ic">&#128222;</span><b>Call +1 (928) 393-6198</b><p>24/7 line. Prefer we call you? Ask in chat and pick a time.</p></a>'
             '<a href="mailto:hello@loadboot.com"><span class="ic">&#9993;&#65039;</span><b>hello@loadboot.com</b><p>We reply within one business day — usually much faster.</p></a>'
             '</div></div></section>')
    body += ('<script>(function(){var s=document.getElementById("fqSearch"),tabs=document.querySelectorAll(".fq-tab"),items=document.querySelectorAll(".fq-item"),wraps=document.querySelectorAll("[data-catwrap]"),none=document.getElementById("fqNone");var cat="all";'
             'function apply(){var q=(s.value||"").toLowerCase().trim();var shown=0;items.forEach(function(it){var ok=(cat==="all"||it.getAttribute("data-cat")===cat)&&(!q||it.textContent.toLowerCase().indexOf(q)>=0);it.style.display=ok?"":"none";if(ok)shown++;if(q&&ok)it.open=true;});'
             'wraps.forEach(function(w){var any=false;w.querySelectorAll(".fq-item").forEach(function(it){if(it.style.display!=="none")any=true;});w.style.display=any?"":"none";});'
             'none.style.display=shown?"none":"block";}'
             'tabs.forEach(function(t){t.addEventListener("click",function(){tabs.forEach(function(x){x.classList.remove("on")});t.classList.add("on");cat=t.getAttribute("data-cat");apply();});});'
             's.addEventListener("input",apply);})();</script>')
    schema = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": _strip(q), "acceptedAnswer": {"@type": "Answer", "text": _strip(a)}} for q, a in all_items]}
    return FAQ_CSS + body, '<script type="application/ld+json">' + json.dumps(schema, ensure_ascii=False) + '</script>'
