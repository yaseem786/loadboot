# -*- coding: utf-8 -*-
import os, shutil, re, sys, json
from tools_module import TOOLS_CSS, TOOLS_HTML, TOOLS_JS
from load_score_module import LS_CSS, LS_HTML, LS_JS
# SOURCE vs PUBLISH separation (Netlify: command="python3 build_site.py", publish="site").
#   SRC  = repo root. Holds SOURCE only (this script, modules, dashboard.html, images,
#          netlify.toml, runtime.txt, migrations/, docs/, README, content-queue). NOT published.
#   OUT  = SRC/site = the ONLY published directory. Cleaned + recreated on every build.
# build_site.py generates all HTML/CSS/JS + _headers/_redirects/404/robots/sitemap into OUT,
# copies dashboard.html and every referenced image into OUT, then FAILS the build if any
# referenced local asset or required output page is missing.
SRC = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get('LOADBOOT_OUT') or os.path.join(SRC, 'site')
shutil.rmtree(OUT, ignore_errors=True)   # clean
os.makedirs(OUT, exist_ok=True)          # recreate
# Files in SRC root that must NEVER be copied into the publish dir (source-only):
_NO_PUBLISH = {'build_site.py','tools_module.py','load_score_module.py','netlify.toml',
               'runtime.txt','README.md','content-queue.md','.gitignore'}
_ASSET_EXTS = ('.webp','.png','.jpg','.jpeg','.avif','.ico','.svg','.gif')
def asset_exists(name):
    """True if a referenced local asset is present in SRC (so the page can reference it)."""
    return bool(name) and os.path.exists(os.path.join(SRC, name.split('?')[0]))

# ============================================================================
# DEPLOY CONTEXT + SUPABASE TARGETS (single source of truth — used by the public
# load board, the app env-config, and the per-context CSP).
#   production context => the PRODUCTION project ONLY.
#   any preview/branch/dev context => the STAGING project ONLY (never production).
# A preview that cannot resolve its staging key FAILS the build (see app section).
# ============================================================================
PROD_REF = 'rwscphuhpjoudvljvmdk'
STAGING_REF = 'snslhvmkjusozgjelghi'
PROD_ANON = os.environ.get('LOADBOOT_PROD_ANON_KEY') or 'sb_publishable_lHr4JKuHCZEkkjaEh7vx3A_ya_XLG4V'
STAGING_ANON = os.environ.get('LOADBOOT_STAGING_ANON_KEY')   # required for preview builds
_CTX = (os.environ.get('CONTEXT') or os.environ.get('LOADBOOT_CONTEXT') or 'dev').strip()
IS_PRODUCTION_CTX = (_CTX == 'production')
_BUILD_ID = (os.environ.get('COMMIT_REF') or os.environ.get('LOADBOOT_BUILD_ID') or 'dev')[:12]
if IS_PRODUCTION_CTX:
    APP_ENV, APP_REF, APP_ANON = 'production', PROD_REF, PROD_ANON
else:
    APP_ENV, APP_REF, APP_ANON = 'preview', STAGING_REF, STAGING_ANON

# ---------------- shared CSS ----------------
CSS = r''':root{--navy:#0F172A;--blue:#2563EB;--orange:#F97316;--white:#fff;--bg:#F8FAFC;--muted:#64748B;--border:#E2E8F0;--blue-soft:#EFF6FF;--maxw:1200px;--r:16px}
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #2563EB;outline-offset:2px;border-radius:4px}
body{font-family:'Inter',system-ui,sans-serif;color:var(--navy);line-height:1.6;background:#fff;-webkit-font-smoothing:antialiased;overflow-x:hidden}
h1,h2,h3,h4,.logo{font-family:'Manrope',sans-serif;line-height:1.12;letter-spacing:-.025em}
h1{font-size:clamp(2.4rem,5.4vw,4rem);font-weight:800;letter-spacing:-.035em}
h2{font-size:clamp(1.8rem,3.6vw,2.7rem);font-weight:800;letter-spacing:-.03em}
h3{font-size:1.2rem;font-weight:700}h4{font-size:1.05rem;font-weight:700}
p{color:var(--muted)}a{text-decoration:none;color:inherit}
.wrap{max-width:var(--maxw);margin:0 auto;padding:0 24px}
section{padding:96px 0;position:relative}
.eyebrow{color:var(--blue);font-weight:600;font-size:.9rem;text-transform:uppercase;letter-spacing:.1em;margin-bottom:14px}
.lead{font-size:1.13rem;max-width:660px}
.center{text-align:center;margin-left:auto;margin-right:auto}
.gradtext{background:linear-gradient(120deg,#60a5fa,#a78bfa);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.prose p{margin-bottom:16px;font-size:1.05rem;max-width:760px}
.prose h2{margin:36px 0 14px}.prose h3{margin:24px 0 10px}
.prose ul{margin:0 0 18px 22px;color:var(--muted);max-width:760px}.prose li{margin-bottom:8px}
.btn{display:inline-flex;align-items:center;gap:9px;font-weight:600;font-size:1rem;padding:15px 30px;border-radius:10px;cursor:pointer;border:1px solid transparent;transition:.25s}
.btn svg{transition:.25s}.btn:hover svg{transform:translateX(4px)}
.btn-primary{background:var(--orange);color:#fff;box-shadow:0 10px 24px -8px rgba(249,115,22,.6)}
.btn-primary:hover{background:#ea670c;transform:translateY(-2px)}
.btn-secondary{background:#fff;color:var(--navy);border-color:var(--border)}
.btn-secondary:hover{border-color:var(--blue);color:var(--blue)}
header{position:sticky;top:0;z-index:60;background:rgba(255,255,255,.82);backdrop-filter:blur(14px);border-bottom:1px solid transparent;transition:.3s}
header.scrolled{border-bottom-color:var(--border);box-shadow:0 4px 24px -16px rgba(15,23,42,.4)}
.nav{display:flex;align-items:center;justify-content:space-between;height:74px}
.logo{font-weight:800;font-size:1.4rem;display:flex;align-items:center;gap:3px;color:var(--navy)}
.logo .mark{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#1e3a8a,#0b1220);display:flex;align-items:center;justify-content:center;color:#fff}
.nav-links{display:flex;gap:28px;align-items:center}
.nav-links a{font-weight:500;color:#334155;font-size:.95rem;position:relative}
.nav-links a::after{content:"";position:absolute;left:0;bottom:-6px;width:0;height:2px;background:var(--blue);transition:.25s}
.nav-links a:hover,.nav-links a.active{color:var(--navy)}.nav-links a:hover::after,.nav-links a.active::after{width:100%}
.menu-btn{display:none;background:none;border:none;cursor:pointer}
.nav-actions{display:flex;gap:12px;align-items:center}.hd-login{padding:11px 16px}.hd-login svg{vertical-align:-3px}
.nav-mob{display:none}
.hero{padding:108px 0 112px;position:relative;background:radial-gradient(130% 120% at 76% -10%,#243150 0%,#0f172a 56%);overflow:hidden;color:#fff;border-bottom:1px solid #1e293b}
.hero h1{color:#fff}
.hero .lead{color:#cbd5e1}
.hero .badge{background:rgba(255,255,255,.08);color:#e2e8f0;border-color:rgba(255,255,255,.16)}
.hero .trust div{color:#e2e8f0}.hero .trust svg{color:#60a5fa}
.hero .btn-secondary{background:rgba(255,255,255,.07);color:#fff;border-color:rgba(255,255,255,.22)}
.hero .btn-secondary:hover{background:rgba(255,255,255,.14);color:#fff;border-color:rgba(255,255,255,.4)}
.hero .hv-card{border:1px solid rgba(255,255,255,.1)}
.aurora{position:absolute;inset:0;z-index:0;pointer-events:none}
.aurora span{position:absolute;border-radius:50%;filter:blur(90px);opacity:.45;mix-blend-mode:screen;animation:float 14s ease-in-out infinite}
.aurora .a1{width:480px;height:480px;background:#bfdbfe;top:-120px;right:-80px}
.aurora .a2{width:420px;height:420px;background:#ddd6fe;bottom:-140px;left:-100px;animation-delay:-5s}
@keyframes float{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(20px,-30px) scale(1.08)}}
.hero-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:54px;align-items:center;position:relative;z-index:1}
.badge{display:inline-flex;align-items:center;gap:8px;background:#fff;color:var(--navy);font-weight:600;font-size:.86rem;padding:8px 16px;border-radius:999px;margin-bottom:24px;border:1px solid var(--border);box-shadow:0 4px 14px -8px rgba(15,23,42,.3)}
.badge .dot{width:8px;height:8px;border-radius:50%;background:#16a34a;box-shadow:0 0 0 4px rgba(22,163,74,.18)}
.hero p.lead{margin:24px 0 30px}.hero-btns{display:flex;gap:14px;flex-wrap:wrap}
.trust{display:flex;flex-wrap:wrap;gap:14px 26px;margin-top:34px}
.trust div{display:flex;align-items:center;gap:8px;font-size:.92rem;color:var(--navy);font-weight:500}
.trust svg{color:var(--blue);flex-shrink:0}
.hero-visual{position:relative}
.hero-photo{width:100%;border-radius:22px;display:block;box-shadow:0 40px 80px -30px rgba(15,23,42,.6)}
.hero-photo+.hv-card{display:none}
.hv-card{background:linear-gradient(150deg,var(--navy),#1e293b);border-radius:24px;padding:30px;color:#fff;box-shadow:0 40px 80px -30px rgba(15,23,42,.55);position:relative;overflow:hidden}
.hv-card .glow{position:absolute;width:240px;height:240px;background:radial-gradient(circle,rgba(37,99,235,.5),transparent 70%);top:-60px;right:-40px}
.hv-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:22px;position:relative}
.hv-top .truck{color:#fff}.hv-top .truck svg{width:40px;height:40px}
.hv-live{display:inline-flex;align-items:center;gap:7px;font-size:.78rem;background:rgba(34,197,94,.18);color:#86efac;padding:5px 12px;border-radius:999px}
.hv-live .dot,.pdot{width:7px;height:7px;border-radius:50%;background:#22c55e;animation:pulse 1.6s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.hv-row{display:flex;justify-content:space-between;padding:13px 0;border-bottom:1px solid rgba(255,255,255,.1);font-size:.92rem}
.hv-row span:first-child{color:#94a3b8}.hv-row span:last-child{font-weight:600}.hv-row:last-child{border-bottom:none}
.hv-rate{color:#86efac!important}
.hv-float{position:absolute;background:#fff;color:var(--navy);border-radius:14px;padding:13px 17px;box-shadow:0 20px 40px -16px rgba(15,23,42,.35);font-size:.84rem;font-weight:600;display:flex;align-items:center;gap:9px;animation:float 6s ease-in-out infinite}
.hv-float .ic{width:30px;height:30px;border-radius:9px;background:linear-gradient(150deg,#3b82f6,#1e40af);color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 14px -6px rgba(37,99,235,.6),inset 0 1px 0 rgba(255,255,255,.3)}
.hv-float .ic svg{width:17px;height:17px}.reply svg{width:18px;height:18px;vertical-align:-3px;margin-right:4px}
.hv-f1{bottom:-22px;left:-26px}.hv-f2{top:-20px;right:-20px;animation-delay:-3s}
.stats{background:var(--navy);color:#fff;padding:54px 0}
.stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;text-align:center}
.stat .n{font-family:'Manrope';font-weight:800;font-size:clamp(2rem,4vw,2.8rem);background:linear-gradient(120deg,#fff,#93c5fd);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.stat .l{color:#94a3b8;font-size:.95rem;margin-top:4px}
.grid{display:grid;gap:24px}.g4{grid-template-columns:repeat(4,1fr)}.g3{grid-template-columns:repeat(3,1fr)}.g2{grid-template-columns:repeat(2,1fr)}
.card{background:#fff;border:1px solid var(--border);border-radius:18px;padding:28px;transition:.28s;position:relative}
.card:hover{box-shadow:0 28px 56px -28px rgba(37,99,235,.38);transform:translateY(-5px);border-color:#bfdbfe}
.icon{width:54px;height:54px;border-radius:15px;background:linear-gradient(150deg,#3b82f6,#1e40af);border:1px solid rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;margin-bottom:18px;color:#fff;box-shadow:0 10px 22px -8px rgba(37,99,235,.55),inset 0 1px 0 rgba(255,255,255,.35);position:relative;overflow:hidden;transition:.3s}
.icon::after{content:"";position:absolute;inset:0;background:radial-gradient(120% 80% at 20% 0%,rgba(255,255,255,.35),transparent 60%);opacity:.7}
.card:hover .icon,.linkcard:hover .icon{transform:translateY(-2px) scale(1.04);box-shadow:0 16px 30px -10px rgba(37,99,235,.7),inset 0 1px 0 rgba(255,255,255,.4)}
.icon svg{width:25px;height:25px;position:relative;z-index:1;filter:drop-shadow(0 1px 1px rgba(0,0,0,.18))}
.card h3{margin-bottom:8px}.card p{font-size:.96rem}
.sec-head{max-width:680px;margin-bottom:50px}.sec-head.center{margin-left:auto;margin-right:auto}
.bg-soft{background:var(--bg)}
.photo-grid{display:grid;grid-template-columns:1.45fr 1fr;gap:20px}
.photo{border-radius:18px;overflow:hidden;min-height:340px;background:linear-gradient(135deg,#1e293b,#0f172a);box-shadow:0 34px 64px -36px rgba(15,23,42,.55);position:relative}
.photo img{width:100%;height:100%;object-fit:cover;display:block;min-height:340px}
.photo .ph-tag{position:absolute;left:18px;bottom:16px;z-index:2;background:rgba(15,23,42,.6);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);color:#fff;font-family:'Manrope';font-weight:700;font-size:.92rem;padding:8px 14px;border-radius:10px}
.svc-photo{margin:0;border-radius:22px;overflow:hidden;position:relative;box-shadow:0 40px 84px -50px rgba(15,23,42,.55)}
.svc-photo img{display:block;width:100%;height:clamp(240px,40vw,460px);object-fit:cover}
.svc-photo figcaption{position:absolute;left:0;right:0;bottom:0;padding:46px 26px 18px;color:#fff;font-family:'Manrope';font-weight:700;font-size:1rem;background:linear-gradient(transparent,rgba(11,18,32,.82))}
@media(max-width:880px){.photo-grid{grid-template-columns:1fr}.photo,.photo img{min-height:240px}}
.linkcard{display:block;background:#fff;border:1px solid var(--border);border-radius:var(--r);padding:26px;transition:.25s}
.linkcard:hover{transform:translateY(-4px);border-color:var(--blue);box-shadow:0 24px 50px -26px rgba(37,99,235,.4)}
.linkcard .arw{color:var(--blue);font-weight:700;margin-top:12px;display:inline-flex;gap:6px;align-items:center}
/* ROAD + TRUCK ANIM */
.road-sec{background:var(--navy);color:#fff;overflow:hidden}
.road-sec h2{color:#fff}.road-sec .eyebrow{color:#93c5fd}.road-sec p{color:#cbd5e1}
.road{position:relative;height:130px;margin-top:34px;background:linear-gradient(180deg,#0b1220,#1e293b);border-radius:18px;overflow:hidden;border:1px solid #1e293b}
.road .lane{position:absolute;top:50%;left:0;right:0;height:5px;transform:translateY(-50%);background:repeating-linear-gradient(90deg,#fbbf24 0 34px,transparent 34px 70px);animation:dash 1s linear infinite}
@keyframes dash{to{background-position:70px 0}}
.road .tk{position:absolute;top:50%;transform:translateY(-50%);color:#fff;animation:drive 7s linear infinite;filter:drop-shadow(0 6px 10px rgba(0,0,0,.45))}
.road .tk svg{width:62px;height:62px;display:block}
@keyframes drive{from{left:-9%}to{left:105%}}
.road .hill{position:absolute;bottom:0;left:0;right:0;height:40px;background:linear-gradient(180deg,transparent,rgba(37,99,235,.25))}
/* ROUTE MAP */
.routebox{background:#fff;border:1px solid var(--border);border-radius:20px;padding:22px;box-shadow:0 30px 60px -34px rgba(15,23,42,.4)}
.routebox svg{width:100%;height:auto;display:block}
.dasharw{stroke-dasharray:8 8;animation:draw 3s linear infinite}
@keyframes draw{to{stroke-dashoffset:-160}}
.route-grid{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center}
.tag{display:inline-flex;align-items:center;gap:7px;background:var(--blue-soft);color:var(--blue);font-weight:600;font-size:.85rem;padding:6px 13px;border-radius:999px;margin:4px 6px 0 0}
.cmp{width:100%;border-collapse:separate;border-spacing:0;background:#fff;border:1px solid var(--border);border-radius:var(--r);overflow:hidden}
.cmp th,.cmp td{padding:16px 18px;text-align:left;border-bottom:1px solid var(--border);font-size:.95rem}
.cmp th{font-family:'Manrope';font-weight:700;background:var(--bg)}
.cmp th.us{background:linear-gradient(135deg,var(--navy),#1e293b);color:#fff}
.cmp td.us{background:var(--blue-soft);font-weight:600}.cmp tr:last-child td{border-bottom:none}
.yes{color:#16a34a;font-weight:700}.no{color:#dc2626;font-weight:700}
.step .num{width:48px;height:48px;border-radius:14px;background:linear-gradient(135deg,var(--blue),#7c3aed);color:#fff;font-family:'Manrope';font-weight:800;display:flex;align-items:center;justify-content:center;margin-bottom:16px;box-shadow:0 12px 24px -10px rgba(37,99,235,.6)}
.chips{display:flex;flex-wrap:wrap;gap:12px}
.chip{background:#fff;border:1px solid var(--border);border-radius:999px;padding:12px 22px;font-family:'Manrope';font-weight:600;font-size:.95rem;transition:.2s}
.chip:hover{border-color:var(--blue);color:var(--blue);transform:translateY(-2px)}
.mq-wrap{overflow:hidden;padding:8px 0;-webkit-mask-image:linear-gradient(90deg,transparent,#000 9%,#000 91%,transparent);mask-image:linear-gradient(90deg,transparent,#000 9%,#000 91%,transparent)}
.mq-track{display:flex;gap:14px;width:max-content;animation:mqs 38s linear infinite}
.mq-wrap.rev .mq-track{animation-direction:reverse;animation-duration:44s}
.mq-wrap:hover .mq-track{animation-play-state:paused}
@keyframes mqs{to{transform:translateX(-50%)}}
.mq-chip{display:inline-flex;align-items:center;gap:9px;background:#fff;border:1px solid var(--border);border-radius:999px;padding:13px 22px;font-family:'Manrope';font-weight:600;font-size:.95rem;white-space:nowrap;box-shadow:0 10px 22px -18px rgba(15,23,42,.5)}
.mq-chip svg{width:18px;height:18px;color:var(--blue);flex-shrink:0}
.net-chip{display:inline-flex;align-items:center;justify-content:center;background:#fff;border:1px solid var(--border);border-radius:14px;padding:16px 30px;min-width:158px;min-height:64px;box-shadow:0 12px 26px -18px rgba(15,23,42,.5)}
.net-wm{font-family:'Manrope',sans-serif;font-weight:800;font-size:1.06rem;color:#334155;letter-spacing:-.02em;white-space:nowrap}
.net-chip .lg{height:30px;width:auto;max-width:152px;object-fit:contain;display:block}
.net-chip .mono{display:none;width:40px;height:40px;border-radius:10px;color:#fff;align-items:center;justify-content:center;font-family:'Manrope';font-weight:800;font-size:.82rem;letter-spacing:-.02em}
.net-chip.noimg .lg{display:none}.net-chip.noimg .mono{display:flex}
@media(prefers-reduced-motion:reduce){.mq-track{animation:none;flex-wrap:wrap;justify-content:center}}
.promise{background:linear-gradient(135deg,var(--navy),#1e293b);color:#fff;border-radius:28px;padding:66px 50px;text-align:center;position:relative;overflow:hidden}
.promise .glow{position:absolute;width:400px;height:400px;background:radial-gradient(circle,rgba(37,99,235,.4),transparent 70%);top:-150px;left:50%;transform:translateX(-50%)}
.promise>*{position:relative}.promise h2{color:#fff;max-width:760px;margin:0 auto 18px}
.promise p{color:#cbd5e1;max-width:640px;margin:0 auto 8px;font-size:1.08rem}
.promise .reply{display:inline-flex;gap:8px;align-items:center;margin-top:24px;background:rgba(255,255,255,.1);padding:11px 20px;border-radius:999px;font-size:.92rem;border:1px solid rgba(255,255,255,.15)}
.faq{max-width:820px;margin:0 auto}
.faq details{background:#fff;border:1px solid var(--border);border-radius:14px;margin-bottom:12px;overflow:hidden;transition:.2s}
.faq details[open]{border-color:#cbd5e1;box-shadow:0 16px 36px -24px rgba(15,23,42,.3)}
.faq summary{padding:20px 24px;font-family:'Manrope';font-weight:700;cursor:pointer;list-style:none;display:flex;justify-content:space-between;gap:16px;align-items:center;font-size:1.05rem}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";font-size:1.6rem;color:var(--blue)}
.faq details[open] summary::after{content:"\2013"}
.faq details p{padding:0 24px 22px;font-size:.98rem}
.quote-wrap{background:#fff;border:1px solid var(--border);border-radius:22px;padding:40px;box-shadow:0 40px 80px -40px rgba(15,23,42,.35)}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.field{display:flex;flex-direction:column;gap:7px}.field.full{grid-column:1/-1}
.field label{font-weight:600;font-size:.88rem}
.field input,.field select,.field textarea{padding:14px 15px;border:1px solid var(--border);border-radius:10px;font-family:'Inter';font-size:1rem;color:var(--navy);background:#fff;width:100%}
.field textarea{min-height:120px;resize:vertical;line-height:1.5}
.field input:focus,.field select:focus,.field textarea:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 4px var(--blue-soft)}
.intent-row{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.intent-row input{position:absolute;opacity:0;pointer-events:none}
.intent-row label{display:inline-flex;align-items:center;gap:8px;cursor:pointer;padding:12px 18px;border:1.5px solid var(--border);border-radius:12px;font-weight:600;font-size:.95rem;color:var(--navy);background:#fff;transition:.2s;user-select:none}
.intent-row label:hover{border-color:#bfdbfe}
.intent-row label .d{width:9px;height:9px;border-radius:50%;background:var(--border);transition:.2s}
.intent-row input:checked+label{border-color:var(--blue);background:var(--blue-soft);box-shadow:0 0 0 3px rgba(37,99,235,.12)}
.intent-row input:checked+label .d{background:var(--blue);box-shadow:0 0 0 4px rgba(37,99,235,.18)}
.intent-row input:focus-visible+label{box-shadow:0 0 0 3px var(--blue-soft)}
.cinfo{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:26px}
.cinfo .ci{display:flex;gap:13px;align-items:flex-start;background:#fff;border:1px solid var(--border);border-radius:16px;padding:18px}
.cinfo .ci .icon{width:42px;height:42px;border-radius:11px;margin:0;flex-shrink:0}.cinfo .ci .icon svg{width:20px;height:20px}
.cinfo .ci b{display:block;font-family:'Manrope';font-size:.97rem}.cinfo .ci span{font-size:.88rem;color:var(--muted)}
.btn-ghost{background:transparent;color:var(--blue);border-color:transparent;padding-left:6px}
.hero .btn-ghost{color:#cbd5e1}.btn-ghost:hover{color:var(--blue)}.hero .btn-ghost:hover{color:#fff}
@media(max-width:760px){.cinfo{grid-template-columns:1fr}.intent-row label{flex:1;justify-content:center}}
.fcta{background:linear-gradient(135deg,var(--orange),#fb923c);border-radius:28px;padding:66px 40px;text-align:center}
.fcta h2{color:#fff}.fcta p{color:#fff6ef}.fcta .btn-primary{background:#fff;color:var(--orange)}
footer{background:var(--navy);color:#cbd5e1;padding:64px 0 30px}
.foot-top{display:grid;grid-template-columns:1.4fr 1fr;gap:40px;padding-bottom:38px;border-bottom:1px solid #1e293b;margin-bottom:40px;align-items:center}
footer .logo{color:#fff}footer a{color:#cbd5e1;display:block;margin:8px 0;font-size:.95rem}footer a:hover{color:#fff}
.foot-h{color:#fff;font-family:'Manrope';font-weight:700;margin-bottom:8px}
.news{display:flex;gap:10px;margin-top:14px;max-width:380px}
.news input{flex:1;padding:13px 15px;border-radius:10px;border:1px solid #334155;background:#0b1220;color:#fff;font-family:'Inter'}
.news input:focus{outline:none;border-color:var(--blue)}
.social{display:flex;gap:10px;margin-top:16px}
.social a{width:40px;height:40px;border-radius:11px;background:#1e293b;display:flex;align-items:center;justify-content:center;margin:0;transition:.2s}
.social a:hover{background:var(--blue)}
.links5{display:grid;grid-template-columns:repeat(6,1fr);gap:26px;margin-bottom:40px}
.foot-bottom{border-top:1px solid #1e293b;padding-top:24px;font-size:.88rem;display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px}
.mcta{display:none;position:fixed;bottom:0;left:0;right:0;z-index:70;background:rgba(255,255,255,.95);backdrop-filter:blur(10px);border-top:1px solid var(--border);padding:12px 16px;gap:10px}
.mcta a{flex:1;justify-content:center}
.wa-btn{position:fixed;bottom:20px;right:20px;z-index:80;width:58px;height:58px;border-radius:50%;background:#25D366;display:flex;align-items:center;justify-content:center;box-shadow:0 14px 30px -8px rgba(37,211,102,.6);transition:.2s}
.wa-btn:hover{transform:scale(1.08)}
.scroll-road-sec{position:relative;color:#fff;padding:88px 0 70px;overflow:hidden;background:linear-gradient(135deg,#0f172a,#1e293b)}
.scroll-road-sec h2{color:#fff}.scroll-road-sec .eyebrow{color:#93c5fd}
.scroll-road{position:relative;z-index:2;height:150px;margin-top:30px}
.sr-line{position:absolute;top:50%;left:0;right:0;height:4px;background:repeating-linear-gradient(90deg,#fbbf24 0 30px,transparent 30px 64px);transform:translateY(-50%)}
.sr-truck{position:absolute;top:50%;left:0;transform:translate(0,-60%);color:#fff;will-change:transform}
.sr-truck svg{width:188px;height:auto;display:block;filter:drop-shadow(0 10px 16px rgba(0,0,0,.55))}
@media(max-width:880px){.wa-btn{bottom:84px;width:52px;height:52px}.sr-truck svg{width:120px}}
.reveal{opacity:0;transform:translateY(28px);transition:opacity .7s cubic-bezier(.2,.7,.2,1),transform .7s cubic-bezier(.2,.7,.2,1)}
.reveal.in{opacity:1;transform:none}
.reveal.d1{transition-delay:.08s}.reveal.d2{transition-delay:.16s}.reveal.d3{transition-delay:.24s}
@media(prefers-reduced-motion:reduce){.reveal{opacity:1;transform:none;transition:none}.aurora span,.hv-float,.road .tk,.road .lane,.dasharw{animation:none}}
@media(max-width:880px){.nav-links{position:fixed;inset:74px 0 auto 0;background:#fff;flex-direction:column;padding:18px 24px;gap:18px;border-bottom:1px solid var(--border);display:none}
.nav-links.open{display:flex}.menu-btn{display:block}
.nav-mob{display:block;font-weight:700}.nav-mob-login{color:var(--blue)}.nav-mob-go{color:var(--orange)}
.hero-grid,.route-grid{grid-template-columns:1fr;gap:40px}
.stats-grid{grid-template-columns:repeat(2,1fr);gap:32px 20px}
.g4{grid-template-columns:repeat(2,1fr)}.g3,.g2{grid-template-columns:1fr}
section{padding:66px 0}.promise,.fcta{padding:48px 24px}.form-grid{grid-template-columns:1fr}
.foot-top{grid-template-columns:1fr}.links5{grid-template-columns:repeat(2,1fr);gap:28px 20px}
.cmp{font-size:.82rem}.cmp th,.cmp td{padding:12px 10px}.mcta{display:flex}body{padding-bottom:72px}}
header{-webkit-backdrop-filter:blur(14px)}.mcta{-webkit-backdrop-filter:blur(10px)}
img{max-width:100%;height:auto}*{-webkit-tap-highlight-color:transparent}
@media(max-width:880px){.cmp{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch;white-space:nowrap}.wrap{padding:0 18px}h1,h2{word-break:break-word}.hero{padding:74px 0 78px}.sec-head{margin-bottom:34px}.promise,.fcta{border-radius:20px;padding:42px 22px}.quote-wrap{padding:26px}.scroll-road{height:120px}.hero-btns{flex-direction:column;align-items:stretch}.hero-btns .btn{width:100%;justify-content:center}.hd-btn{display:none}.nav-cta{gap:0}}
@media(max-width:520px){.g4{grid-template-columns:1fr}.links5{grid-template-columns:1fr}.cards,.stats-grid{gap:14px}h1{font-size:2rem}.btn{padding:13px 22px}}'''

JS = r'''const io=new IntersectionObserver((es)=>{es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{threshold:.12});
document.querySelectorAll('.reveal').forEach(el=>io.observe(el));
const cu=new IntersectionObserver((es)=>{es.forEach(e=>{if(e.isIntersecting){const el=e.target,t=+el.dataset.count;let n=0;const s=Math.max(1,Math.ceil(t/40));const tick=()=>{n+=s;if(n>=t){el.textContent=t}else{el.textContent=n;requestAnimationFrame(tick)}};tick();cu.unobserve(el)}})},{threshold:.6});
document.querySelectorAll('[data-count]').forEach(el=>cu.observe(el));
const hdr=document.getElementById('hdr');addEventListener('scroll',()=>{hdr&&hdr.classList.toggle('scrolled',scrollY>10)});
function toggleMenu(){document.getElementById('nav').classList.toggle('open')}
var st=document.getElementById('scrollTruck');if(st){var road=st.parentElement;function mv(){var r=road.getBoundingClientRect();var p=(innerHeight-r.top)/(innerHeight+r.height);p=Math.max(0,Math.min(1,p));st.style.transform='translate('+(p*(road.clientWidth-188))+'px,-60%)';}addEventListener('scroll',mv,{passive:true});addEventListener('resize',mv);mv();}'''

ARW = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
CHK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>'

def _svg(inner):
    return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>'
ICONS = {
 '&#128200;':'<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
 '&#128739;':'<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.2 17H14a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h2.8"/>',
 '&#128450;':'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
 '&#128222;':'<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
 '&#10052;&#65039;':'<line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/>',
 '&#128679;':'<polygon points="12 2 22 8.5 12 15 2 8.5"/><polyline points="2 15.5 12 22 22 15.5"/>',
 '&#128230;':'<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><line x1="12" y1="13" x2="12" y2="21"/>',
 '&#9889;':'<polygon points="13 2 4 14 11 14 11 22 20 10 13 10 13 2"/>',
 '&#128668;':'<path d="M2 6h12v9H2z"/><path d="M14 9h4l3 3v3h-7z"/><circle cx="6.5" cy="18" r="1.6"/><circle cx="17.5" cy="18" r="1.6"/>',
 '&#128640;':'<path d="M6 21V4M6 4h11l-2 3.5L17 11H6"/>',
 '&#128269;':'<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/>',
 '&#128172;':'<path d="M21 12a8 8 0 0 1-11.4 7.2L3 21l1.8-6.6A8 8 0 1 1 21 12z"/>',
 '&#129309;':'<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6.5 6.5 0 0 1 12 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6"/><path d="M22 20a6.5 6.5 0 0 0-4.5-6.2"/>',
 '&#129517;':'<circle cx="12" cy="12" r="9"/><polygon points="16 8 13 13 8 16 11 11 16 8"/>',
 '&#128196;':'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/>',
 '&#128336;':'<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/>',
 '&#128181;':'<line x1="12" y1="2" x2="12" y2="22"/><path d="M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
 '&#128737;':'<path d="M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5z"/>',
 '&#9981;':'<path d="M12 2.5 6 9.5a6 6 0 1 0 12 0z"/>',
 '&#9878;':'<path d="M12 3v18M6 21h12M5 7h14M5 7 2 13h6zM19 7l-3 6h6z"/>',
 '&#9989;':'<circle cx="12" cy="12" r="9"/><polyline points="8 12 11 15 16 9"/>',
 '&#128202;':'<line x1="6" y1="20" x2="6" y2="12"/><line x1="12" y1="20" x2="12" y2="5"/><line x1="18" y1="20" x2="18" y2="9"/>',
 '&#128236;':'<rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="3 7 12 13 21 7"/>',
 '&#128221;':'<path d="M4 20h4L18 10l-4-4L4 16z"/><path d="M14 6l4 4"/>',
 '&#128197;':'<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>',
 '&#129354;':'<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
 '&#129534;':'<path d="M6 2h9l3 3v17l-3-2-3 2-3-2-3 2V2z"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/>',
 '&#129514;':'<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/>',
 '&#128225;':'<path d="M5 18a10 10 0 0 1 14 0M8 15a6 6 0 0 1 8 0"/><circle cx="12" cy="19" r="1.4"/>',
 '&#128203;':'<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1"/><polyline points="9 12 11 14 15 10"/>',
 '&#128666;':'<path d="M2 6h12v9H2z"/><path d="M14 9h4l3 3v3h-7z"/><circle cx="6.5" cy="18" r="1.6"/><circle cx="17.5" cy="18" r="1.6"/>',
 '&#10003;':'<polyline points="5 12 10 17 19 7"/>',
 '&#9201;&#65039;':'<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/>',
}
def deglyph(s):
    for k,v in ICONS.items():
        s = s.replace(k, _svg(v))
    return s

NAV = [('index.html','Home'),('services.html','Services'),('how-it-works.html','How It Works'),
       ('pricing.html','Pricing'),('load-score.html','Load Score'),('blog.html','Blog'),
       ('about.html','About'),('contact.html','Contact')]

def header(active):
    links = ''.join('<a href="%s" class="%s">%s</a>' % (h, 'active' if h==active else '', t) for h,t in NAV)
    mob = '<a href="/app/carrier/" class="nav-mob nav-mob-login">Log in</a><a href="contact.html" class="nav-mob nav-mob-go">Get Started</a>'
    return '''<header id="hdr"><div class="wrap nav">
<a class="logo" href="index.html"><span class="mark"><svg width="30" height="30" viewBox="0 0 56 56" fill="none" aria-hidden="true"><rect x="17" y="13" width="7.5" height="30" rx="3.2" fill="#fff"/><rect x="17" y="35.5" width="15" height="7.5" rx="3.2" fill="#fff"/><path d="M32 30 L45 39 L32 48 Z" fill="#F97316"/></svg></span><span>oad<b style="color:var(--blue)">boot</b></span></a>
<nav class="nav-links" id="nav">%s%s</nav>
<div class="nav-actions"><a href="/app/carrier/" class="btn btn-secondary hd-btn hd-login"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>Log in</a><a href="contact.html" class="btn btn-primary hd-btn">Get Started %s</a>
<button class="menu-btn" onclick="toggleMenu()" aria-label="Open menu"><svg width="26" height="26" viewBox="0 0 24 24" stroke="#0F172A" stroke-width="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button></div>
</div></header>''' % (links, mob, ARW)

def footer():
    return '''<footer><div class="wrap">
<div class="foot-top">
<div><div class="logo"><span class="mark"><svg width="30" height="30" viewBox="0 0 56 56" fill="none" aria-hidden="true"><rect x="17" y="13" width="7.5" height="30" rx="3.2" fill="#fff"/><rect x="17" y="35.5" width="15" height="7.5" rx="3.2" fill="#fff"/><path d="M32 30 L45 39 L32 48 Z" fill="#F97316"/></svg></span><span>oad<b style="color:#60a5fa">boot</b></span></div>
<div style="color:#60a5fa;font-weight:700;font-size:.92rem;margin-top:10px;letter-spacing:.01em">Keep your wheels earning.</div>
<p style="margin-top:10px;max-width:380px">Professional truck dispatch services for owner-operators, fleets, and new-authority carriers across all 48 states. Higher-paying loads, less deadhead, no contracts.</p>
<div style="margin-top:14px;font-size:.9rem;line-height:1.85"><a href="mailto:hello@loadboot.com">hello@loadboot.com</a><a href="mailto:dispatch@loadboot.com">dispatch@loadboot.com</a><a href="mailto:billing@loadboot.com">billing@loadboot.com</a></div>
<div class="social"><a href="#" aria-label="Facebook"><svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M14 9h3V6h-3c-2 0-3 1-3 3v2H9v3h2v6h3v-6h2.5l.5-3H14V9z"/></svg></a>
<a href="#" aria-label="Instagram"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/></svg></a>
<a href="#" aria-label="LinkedIn"><svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M6 9H3v9h3V9zM4.5 3a1.8 1.8 0 100 3.6 1.8 1.8 0 000-3.6zM18 9c-1.6 0-2.5.8-3 1.5V9H12v9h3v-5c0-1 .7-1.7 1.6-1.7s1.4.7 1.4 1.7v5h3v-5.4C21 10 19.7 9 18 9z"/></svg></a></div></div>
<div><div class="foot-h">Get carrier tips &amp; better loads</div><p style="font-size:.92rem">Rate trends, compliance reminders, and dispatch tips.</p>
<form class="news" onsubmit="event.preventDefault();var f=this,em=f.querySelector('input').value;var done=function(){f.innerHTML='<span style=\\'color:#86efac;font-weight:600\\'>Subscribed &mdash; thanks!</span>';};if(window.lbSubmitLead){window.lbSubmitLead('newsletter',{email:em}).then(done).catch(done);}else{done();}"><input type="email" placeholder="Your email" required><button class="btn btn-primary" type="submit">Subscribe</button></form></div>
</div>
<div class="links5">
<div><div class="foot-h">Dispatch</div><a href="services.html">Load Booking</a><a href="services.html">Rate Negotiation</a><a href="services.html">Route Planning</a><a href="services.html">24/7 Dispatch</a></div>
<div><div class="foot-h">Freight</div><a href="reefer-dispatch.html">Reefer</a><a href="flatbed-dispatch.html">Flatbed</a><a href="dry-van-dispatch.html">Dry Van</a><a href="hotshot-dispatch.html">Hotshot</a><a href="power-only-dispatch.html">Power Only</a><a href="box-truck-dispatch.html">Box Truck</a></div>
<div><div class="foot-h">Carriers</div><a href="carriers.html">For Carriers</a><a href="owner-operator-dispatch.html">Owner-Operators</a><a href="new-authority-dispatch.html">New Authority</a><a href="services.html">Small Fleets</a></div>
<div><div class="foot-h">Partners</div><a href="brokers.html">For Brokers</a><a href="shipper-solutions.html">Shipper Solutions</a><a href="partners.html">Partner Portal</a><a href="referral.html">Referral Program</a></div>
<div><div class="foot-h">Compliance</div><a href="services.html">Authority &amp; DOT Setup</a><a href="services.html">BOC-3 / UCR</a><a href="services.html">Form 2290</a><a href="services.html">IFTA</a></div>
<div><div class="foot-h">Company</div><a href="about.html">About</a><a href="how-it-works.html">How It Works</a><a href="pricing.html">Pricing</a><a href="faq.html">FAQ</a><a href="resources.html">Resources</a><a href="blog.html">Blog</a><a href="careers.html">Careers</a><a href="contact.html">Contact</a></div>
<div><div class="foot-h">Programs &amp; Login</div><a href="brokers.html">For Brokers</a><a href="partners.html">Partner Program</a><a href="referral.html">Referral Program</a><a href="case-studies.html">Examples</a><a href="login.html">Log in</a><a href="/app/carrier/">Carrier Portal</a><a href="/app/partner/">Partner Portal</a><a href="/app/developer/">Developers &amp; API</a></div>
</div>
<div style="border-top:1px solid #1e293b;padding-top:24px;margin-bottom:24px"><div class="foot-h" style="margin-bottom:10px">Service areas &mdash; we dispatch nationwide</div><p style="font-size:.88rem;line-height:2">Texas &middot; California &middot; Florida &middot; Georgia &middot; Illinois &middot; Ohio &middot; Pennsylvania &middot; North Carolina &middot; Tennessee &middot; Indiana &middot; Michigan &middot; New Jersey &middot; Arizona &middot; Washington &middot; Missouri &middot; and all 48 contiguous states.</p></div>
<div class="foot-bottom"><span>&copy; 2026 Loadboot. All rights reserved. &middot; Serving carriers in all 48 states.</span>
<span><a href="privacy.html" style="display:inline">Privacy</a> &middot; <a href="terms.html" style="display:inline">Terms</a> &middot; <a href="cookies.html" style="display:inline">Cookies</a> &middot; <a href="accessibility.html" style="display:inline">Accessibility</a> &middot; <a href="security.html" style="display:inline">Security</a> &middot; <a href="status.html" style="display:inline">Status</a> &middot; <a href="sitemap.html" style="display:inline">Sitemap</a></span></div>
</div></footer>
<div class="mcta"><a href="contact.html#quote" class="btn btn-secondary">Get a Quote</a><a href="contact.html" class="btn btn-primary">Get Started</a></div>
<a class="wa-btn" href="contact.html" rel="noopener" aria-label="Contact us"><svg width="30" height="30" viewBox="0 0 24 24" fill="#fff"><path d="M12 2a10 10 0 00-8.5 15.2L2 22l4.9-1.4A10 10 0 1012 2zm0 18a8 8 0 01-4.2-1.2l-.3-.2-2.9.8.8-2.8-.2-.3A8 8 0 1112 20zm4.4-5.6c-.2-.1-1.4-.7-1.6-.8s-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1a6.5 6.5 0 01-3.2-2.8c-.2-.4.2-.4.6-1.2.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5a1 1 0 00-.7.3A2.9 2.9 0 006 9.9c0 1.7 1.3 3.4 1.4 3.6.2.2 2.5 3.9 6.1 5.2 2.2.8 2.5.6 3 .6s1.4-.6 1.6-1.1.2-1 .2-1.1-.2-.2-.5-.3z"/></svg></a>'''

GA_ID = 'G-C2ELQ7H8EM'  # GA4 Measurement ID — injected on every page.
LOCALBIZ = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"ProfessionalService","name":"Loadboot","image":"https://loadboot.com/icon-512.png","url":"https://loadboot.com/","email":"hello@loadboot.com","description":"Professional truck dispatch services for owner-operators, fleets, and new-authority carriers — flat 5%, no contracts.","areaServed":{"@type":"Country","name":"United States"},"serviceType":"Truck dispatching","priceRange":"5%"}</script>'
GA_SNIPPET = ('<script async src="https://www.googletagmanager.com/gtag/js?id=%s"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag(\'js\',new Date());gtag(\'config\',\'%s\');</script>' % (GA_ID, GA_ID)) if GA_ID else ''
HEADX = LOCALBIZ + GA_SNIPPET

# First-party analytics beacon (privacy-safe). Posts pageviews to the context's Supabase
# project via the public track_web_event RPC. Exposes window.lbTrack(type, extra) for events.
# Internal traffic: append ?lb_internal=1 once to flag this browser as team/internal (excluded).
_BEACON = ("<script>(function(){try{"
  "var K='lb_aid',aid=localStorage.getItem(K);if(!aid){aid=Date.now().toString(36)+Math.random().toString(36).slice(2,10);localStorage.setItem(K,aid);}"
  "var q=new URLSearchParams(location.search);if(q.get('lb_internal')==='1'){localStorage.setItem('lb_int','1');}var internal=localStorage.getItem('lb_int')==='1';"
  "var ref=document.referrer||'',rh='';try{rh=ref?new URL(ref).hostname:'';}catch(e){}"
  "var ua=navigator.userAgent||'';var dev=/Mobi|Android|iPhone|iPad/i.test(ua)?'mobile':'desktop';"
  "var br=/Edg/i.test(ua)?'Edge':/Chrome/i.test(ua)?'Chrome':/Firefox/i.test(ua)?'Firefox':/Safari/i.test(ua)?'Safari':'Other';"
  "var os=/Windows/i.test(ua)?'Windows':/Mac/i.test(ua)?'macOS':/Android/i.test(ua)?'Android':/iPhone|iPad|iOS/i.test(ua)?'iOS':/Linux/i.test(ua)?'Linux':'Other';"
  "var EP='https://%s.supabase.co/rest/v1/rpc/track_web_event',AK='%s';"
  "function send(p){try{fetch(EP,{method:'POST',headers:{'apikey':AK,'Content-Type':'application/json'},body:JSON.stringify({p:p}),keepalive:true}).catch(function(){});}catch(e){}}"
  "send({anon_id:aid,type:'pageview',page:location.pathname,referrer:ref,referrer_host:rh,utm_source:q.get('utm_source'),utm_medium:q.get('utm_medium'),utm_campaign:q.get('utm_campaign'),device:dev,browser:br,os:os,language:navigator.language,timezone:(Intl.DateTimeFormat().resolvedOptions().timeZone||''),ua:ua,internal:internal});"
  "window.lbTrack=function(t,x){var b=Object.assign({anon_id:aid,type:t,page:location.pathname},x||{});send(b);};"
  "window.lbSubmitLead=function(fk,d){var b=Object.assign({form_key:fk,anon_id:aid,page:location.pathname,referrer:ref,utm_source:q.get('utm_source'),utm_medium:q.get('utm_medium'),utm_campaign:q.get('utm_campaign')},d||{});return fetch(EP.replace('track_web_event','submit_web_form'),{method:'POST',headers:{'apikey':AK,'Content-Type':'application/json'},body:JSON.stringify({p:b})});};"
  "}catch(e){}})();</script>") % (APP_REF, APP_ANON)
HEADX = HEADX + _BEACON

def _breadcrumb(fname, title):
    if fname == 'index.html':
        return ''
    name = title.split(' | ')[0].split(' — ')[0].split(' &mdash; ')[0].strip()
    name = name.replace('"', "'")
    return ('<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList",'
            '"itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"https://loadboot.com/"},'
            '{"@type":"ListItem","position":2,"name":"%s","item":"https://loadboot.com/%s"}]}</script>' % (name, fname))


# ---- Internal-link engine (Inc 59, directive #39): related-page cards per topic cluster. ----
# Deterministic map — every commercial page links onward to its cluster (service, audience, pricing,
# a guide and an application/inquiry form). Appended before the footer by page(); no orphan pages.
RELATED = {
 'dry-van-dispatch.html':   [('reefer-dispatch.html','Reefer Dispatch'),('power-only-dispatch.html','Power Only'),('pricing.html','Pricing'),('carrier-application.html','Apply as Carrier'),('how-it-works.html','How It Works')],
 'reefer-dispatch.html':    [('dry-van-dispatch.html','Dry Van Dispatch'),('flatbed-dispatch.html','Flatbed Dispatch'),('pricing.html','Pricing'),('carrier-application.html','Apply as Carrier'),('load-score.html','Load Score Tool')],
 'flatbed-dispatch.html':   [('hotshot-dispatch.html','Hotshot Dispatch'),('reefer-dispatch.html','Reefer Dispatch'),('pricing.html','Pricing'),('carrier-application.html','Apply as Carrier'),('how-it-works.html','How It Works')],
 'hotshot-dispatch.html':   [('flatbed-dispatch.html','Flatbed Dispatch'),('box-truck-dispatch.html','Box Truck Dispatch'),('pricing.html','Pricing'),('carrier-application.html','Apply as Carrier'),('new-authority-dispatch.html','New Authority')],
 'power-only-dispatch.html':[('dry-van-dispatch.html','Dry Van Dispatch'),('owner-operator-dispatch.html','Owner-Operators'),('pricing.html','Pricing'),('carrier-application.html','Apply as Carrier'),('how-it-works.html','How It Works')],
 'box-truck-dispatch.html': [('hotshot-dispatch.html','Hotshot Dispatch'),('carriers.html','For Carriers'),('pricing.html','Pricing'),('carrier-application.html','Apply as Carrier'),('tools.html','Free Trucking Tools')],
 'new-authority-dispatch.html':[('how-to-get-loads-with-new-authority.html','Getting Loads with New Authority'),('owner-operator-dispatch.html','Owner-Operators'),('pricing.html','Pricing'),('carrier-application.html','Apply as Carrier'),('carriers.html','For Carriers')],
 'owner-operator-dispatch.html':[('owner-operator-dispatch-service-guide.html','Owner-Operator Guide'),('new-authority-dispatch.html','New Authority'),('pricing.html','Pricing'),('carrier-application.html','Apply as Carrier'),('load-score.html','Load Score Tool')],
 'carriers.html':           [('carrier-application.html','Apply as Carrier'),('services.html','All Services'),('pricing.html','Pricing'),('tools.html','Free Trucking Tools'),('faq.html','FAQ')],
 'brokers.html':            [('partners.html','Partner Portal'),('shipper-solutions.html','Shipper Solutions'),('security.html','Security & Trust'),('contact.html','Contact'),('how-it-works.html','How It Works')],
 'shipper-solutions.html':  [('brokers.html','For Brokers'),('partners.html','Partner Portal'),('security.html','Security & Trust'),('contact.html','Contact'),('faq.html','FAQ')],
 'services.html':           [('carriers.html','For Carriers'),('pricing.html','Pricing'),('how-it-works.html','How It Works'),('carrier-application.html','Apply as Carrier'),('tools.html','Free Trucking Tools')],
 'pricing.html':            [('how-much-does-a-truck-dispatcher-cost.html','What a Dispatcher Costs'),('services.html','All Services'),('carrier-application.html','Apply as Carrier'),('faq.html','FAQ'),('carriers.html','For Carriers')],
 'how-it-works.html':       [('services.html','All Services'),('pricing.html','Pricing'),('carrier-application.html','Apply as Carrier'),('faq.html','FAQ'),('truck-dispatcher-vs-freight-broker.html','Dispatcher vs Broker')],
 'partners.html':           [('brokers.html','For Brokers'),('shipper-solutions.html','Shipper Solutions'),('security.html','Security & Trust'),('contact.html','Contact'),('referral.html','Referral Program')],
 'referral.html':           [('carriers.html','For Carriers'),('carrier-application.html','Apply as Carrier'),('pricing.html','Pricing'),('contact.html','Contact'),('faq.html','FAQ')],
 'tools.html':              [('load-score.html','Load Score'),('resources.html','Resources'),('carriers.html','For Carriers'),('pricing.html','Pricing'),('carrier-application.html','Apply as Carrier')],
 'carrier-application.html':[('carriers.html','For Carriers'),('pricing.html','Pricing'),('how-it-works.html','How It Works'),('faq.html','FAQ'),('new-authority-dispatch.html','New Authority')],
 'case-studies.html':       [('carriers.html','For Carriers'),('services.html','All Services'),('carrier-application.html','Apply as Carrier'),('tools.html','Free Trucking Tools'),('pricing.html','Pricing')],
 'resources.html':          [('blog.html','Blog'),('tools.html','Free Trucking Tools'),('faq.html','FAQ'),('how-to-get-loads-with-new-authority.html','New Authority Guide'),('truck-dispatcher-vs-freight-broker.html','Dispatcher vs Broker')],
}

# ---- Inc 60: authentic photo bands. ONLY existing owned assets — no stock fakes, no fake clients.
PAGE_PHOTOS = {
 'carriers.html':           [('truck-fleet.webp','Semi-trucks staged at a freight yard','Owner-operators & fleets, coast to coast'),('owner-operator.webp','Owner-operator truck on the highway','Your truck, your authority — our dispatch')],
 'brokers.html':            [('truck-fleet.webp','Carrier fleet ready for dispatch','A vetted, compliance-tracked carrier network'),('dry-van.webp','Dry van trailer on the road','Coverage across dry van, reefer, flatbed & more')],
 'shipper-solutions.html':  [('dry-van.webp','Dry van trailer moving freight','Your freight, professionally coordinated'),('reefer.webp','Refrigerated trailer on the interstate','Temperature-controlled and time-critical lanes')],
 'box-truck-dispatch.html': [('truck-boxtruck.webp','Box truck ready for an expedited run','LTL, final-mile and expedited runs')],
 'services.html':           [('truck-fleet.webp','Trucks staged for dispatch','Full-service dispatch across equipment types'),('truck-boxtruck.webp','Box truck at a loading dock','From 26-ft boxes to full truckload')],
 'how-it-works.html':       [('owner-operator.webp','Owner-operator on a booked lane','Sign up to first booked load — usually within days')],
 'carrier-application.html':[('owner-operator.webp','Owner-operator truck at sunrise','Five minutes to apply — no contract lock-in')],
 'pricing.html':            [('truck-fleet.webp','Fleet trucks lined up','Flat 5% — you only pay when we book you')],
 'case-studies.html':       [('hotshot.webp','Hotshot truck with a loaded gooseneck','Worked examples across equipment types')],
 'about.html':              [('truck-fleet.webp','American trucking fleet on the move','Built for the people who keep America moving')],
}
def photo_band(fname):
    imgs = PAGE_PHOTOS.get(fname)
    if not imgs: return ''
    cells = ''.join('<div class="photo"><img src="%s" width="1280" height="720" alt="%s" loading="lazy" decoding="async" onerror="this.style.display=&quot;none&quot;"><span class="ph-tag">%s</span></div>' % (src, alt, tag) for src, alt, tag in imgs)
    return '<section><div class="wrap"><div class="photo-grid reveal">%s</div></div></section>' % cells

def related_block(fname):
    links = RELATED.get(fname)
    if not links: return ''
    cards = ''.join('<a class="card reveal" href="%s" style="text-decoration:none;display:block"><h3 style="margin:0 0 6px">%s</h3><p style="margin:0;color:var(--ink-soft,#64748b)">Explore &rarr;</p></a>' % (h,t) for h,t in links)
    return '<section class="bg-soft"><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">Keep exploring</div><h2>Related services &amp; guides</h2></div><div class="grid g3 reveal">%s</div></div></section>' % cards

def page(fname, title, desc, active, body, schema=''):
    schema = schema or ''
    if 'BreadcrumbList' not in schema:  # don't double up when a caller supplies its own breadcrumb
        schema = schema + _breadcrumb(fname, title)
    body = body + photo_band(fname) + related_block(fname)
    doc = '''<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>%s</title><meta name="description" content="%s"><link rel="canonical" href="https://loadboot.com/%s">
<meta property="og:title" content="%s"><meta property="og:description" content="%s"><meta name="theme-color" content="#0F172A">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png?v=2"><link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png?v=2"><link rel="icon" href="/favicon.ico?v=2"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/apple-touch-icon.png?v=2"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Loadboot">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="styles.css?v=6">%s</head><body><script>(function(){try{if(sessionStorage.getItem('lb_seen'))return;}catch(e){}var o=document.createElement('div');o.id='lbSplash';o.innerHTML='<div class="lbs-logo"><span class="lbs-mark"><svg viewBox="0 0 56 56" fill="none"><g class="lbs-L"><rect x="17" y="13" width="7.5" height="30" rx="3.2" fill="#fff"/><rect x="17" y="35.5" width="15" height="7.5" rx="3.2" fill="#fff"/></g><path class="lbs-arrow" d="M32 30 L45 39 L32 48 Z" fill="#F97316"/></svg></span><span class="lbs-word">oad<b>boot</b></span></div>';document.body.insertBefore(o,document.body.firstChild);try{sessionStorage.setItem('lb_seen','1');}catch(e){}setTimeout(function(){if(o&&o.parentNode)o.parentNode.removeChild(o);},1950);})();</script>
%s
%s
%s
<script>%s</script>
<script src="app.js?v=6"></script></body></html>''' % (title, desc, ('' if fname=='index.html' else fname), title, desc, (HEADX+schema), header(active), body, footer(), ANNOUNCE_JS)
    with open(os.path.join(OUT, fname), 'w', encoding='utf-8') as f:
        f.write(deglyph(doc))

# reusable blocks
def final_cta():
    return '''<section><div class="wrap"><div class="fcta reveal"><h2>Ready to keep your truck loaded?</h2>
<p class="lead center" style="margin:14px auto 26px">Get a free quote today and see how much more your truck could be earning with a dispatcher in your corner.</p>
<a href="contact.html" class="btn btn-primary">Get Started %s</a></div></div></section>''' % ARW

def faq_block(items):
    rows = ''.join('<details%s><summary>%s</summary><p>%s</p></details>' % (' open' if i==0 else '', q, a) for i,(q,a) in enumerate(items))
    sch = '{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[' + ','.join('{"@type":"Question","name":"%s","acceptedAnswer":{"@type":"Answer","text":"%s"}}' % (q.replace('"',"'"), a.replace('"',"'")) for q,a in items) + ']}'
    html = '<section id="faq"><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">Questions</div><h2>Frequently asked questions</h2></div><div class="faq reveal">%s</div></div></section>' % rows
    return html, '<script type="application/ld+json">%s</script>' % sch

# ---- write shared assets ----
PWA_JS = r'''
if('serviceWorker' in navigator){addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').then(function(reg){function n(w){if(w&&navigator.serviceWorker.controller)lbUpdBanner(w);}if(reg.waiting)n(reg.waiting);reg.addEventListener('updatefound',function(){var w=reg.installing;if(w)w.addEventListener('statechange',function(){if(w.state==='installed')n(w);});});setInterval(function(){reg.update();},60000);}).catch(function(){});var r=false;navigator.serviceWorker.addEventListener('controllerchange',function(){if(r)return;r=true;location.reload();});});}
function lbUpdBanner(w){if(document.getElementById('lbUpd'))return;var b=document.createElement('div');b.id='lbUpd';b.style.cssText='position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:100000;background:#0b1220;color:#fff;border-radius:14px;padding:12px 14px 12px 18px;display:flex;align-items:center;gap:14px;box-shadow:0 16px 40px -10px rgba(0,0,0,.5);font-family:Manrope,Arial,sans-serif;max-width:92%';b.innerHTML='<span style="font-size:14px;font-weight:600">&#128640; A new version of Loadboot is available.</span><button id="lbUpdBtn" style="background:#f97316;color:#fff;border:none;border-radius:9px;padding:9px 16px;font-weight:700;font-family:inherit;font-size:13px;cursor:pointer">Update</button><button id="lbUpdX" style="background:none;border:none;color:#94a3b8;font-size:20px;cursor:pointer;line-height:1">&times;</button>';document.body.appendChild(b);document.getElementById('lbUpdBtn').onclick=function(){this.textContent='Updating…';if(w)w.postMessage({type:'SKIP_WAITING'});};document.getElementById('lbUpdX').onclick=function(){b.remove();};}
(function(){var dp=null;addEventListener('beforeinstallprompt',function(e){e.preventDefault();dp=e;if(document.getElementById('pwaBtn'))return;var b=document.createElement('button');b.id='pwaBtn';b.innerHTML='&#11015; Install app';b.style.cssText='position:fixed;bottom:20px;left:20px;z-index:90;background:#2563EB;color:#fff;border:none;border-radius:30px;padding:12px 18px;font-weight:700;font-family:Manrope,sans-serif;font-size:.9rem;box-shadow:0 12px 30px -8px rgba(37,99,235,.6);cursor:pointer';b.onclick=function(){dp.prompt();dp.userChoice.finally(function(){dp=null;b.remove();});};document.body.appendChild(b);});})();
'''
MANIFEST = '{"name":"Loadboot","short_name":"Loadboot","description":"Professional truck dispatch — book loads, track payments, upload documents, and manage your carrier account.","start_url":"/","scope":"/","display":"standalone","background_color":"#ffffff","theme_color":"#0F172A","icons":[{"src":"/icon-192.png","sizes":"192x192","type":"image/png","purpose":"any"},{"src":"/icon-512.png","sizes":"512x512","type":"image/png","purpose":"any"},{"src":"/icon-maskable.png","sizes":"512x512","type":"image/png","purpose":"maskable"}]}'
SW = r'''const CACHE='lb-v5';
const CORE=['/','/index.html','/styles.css','/app.js','/dashboard.html','/load-score.html','/tools.html','/services.html','/pricing.html','/contact.html','/manifest.webmanifest','/icon-192.png','/icon-512.png','/apple-touch-icon.png'];
self.addEventListener('install',function(e){e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(CORE).catch(function(){});}));});
self.addEventListener('message',function(e){if(e.data&&e.data.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.map(function(k){if(k!==CACHE)return caches.delete(k);}));}));self.clients.claim();});
self.addEventListener('fetch',function(e){var r=e.request;var u=new URL(r.url);if(r.method!=='GET'||u.origin!==location.origin)return;e.respondWith(fetch(r).then(function(res){var cp=res.clone();caches.open(CACHE).then(function(c){c.put(r,cp);});return res;}).catch(function(){return caches.match(r).then(function(m){return m||caches.match('/index.html');});}));});
'''
LOADBOARD_CSS = '''
.plb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(295px,1fr));gap:18px;margin-top:36px}
.plb{background:#fff;border:1px solid var(--border);border-radius:16px;padding:20px 20px 18px;display:flex;flex-direction:column;gap:13px;transition:transform .2s,box-shadow .2s,border-color .2s}
.plb:hover{transform:translateY(-4px);border-color:var(--blue);box-shadow:0 24px 50px -28px rgba(37,99,235,.4)}
.plb-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.plb-lane{font-family:'Manrope',sans-serif;font-weight:800;font-size:1rem;color:var(--navy);line-height:1.25}
.plb-lane b{font-weight:800;display:block}
.plb-ar{color:var(--blue);font-weight:700;display:block;margin:1px 0}
.plb-rate{text-align:right;font-family:'Manrope',sans-serif;font-weight:800;font-size:1.45rem;color:var(--navy);white-space:nowrap}
.plb-rate span{display:block;font-size:.76rem;font-weight:700;color:var(--orange);margin-top:2px}
.plb-tags{display:flex;flex-wrap:wrap;gap:7px}
.plb-tag{background:var(--bg);border:1px solid var(--border);color:var(--muted);font-size:.77rem;font-weight:600;padding:4px 10px;border-radius:999px}
.plb-tag.eq{background:var(--blue-soft);color:var(--blue);border-color:transparent}
.plb-tag.alt{color:var(--navy)}
.plb-meta{display:flex;gap:18px;font-size:.82rem;color:var(--muted);border-top:1px solid var(--border);padding-top:12px}
.plb-meta b{color:var(--navy);font-weight:700;margin-left:5px}
.plb-book{margin-top:auto;display:inline-flex;align-items:center;justify-content:center;background:var(--navy);color:#fff;font-family:'Manrope',sans-serif;font-weight:700;font-size:.9rem;padding:11px;border-radius:10px;transition:background .2s}
.plb-book:hover{background:var(--blue)}
.plb{position:relative}
.plb-badge{position:absolute;top:10px;right:10px;background:#fef3c7;color:#92400e;font-family:'Manrope',sans-serif;font-weight:800;font-size:.66rem;letter-spacing:.04em;text-transform:uppercase;padding:3px 9px;border-radius:7px;border:1px solid #fde68a}
.plb-empty{grid-column:1/-1;text-align:center;color:var(--muted);font-size:.95rem;padding:34px 16px;border:1px dashed var(--border);border-radius:14px;background:#fff}
.src-row{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:18px}
.src-chip{background:#fff;border:1px solid var(--border);border-radius:10px;padding:9px 16px;font-family:'Manrope',sans-serif;font-weight:700;color:var(--navy);font-size:.92rem}
.src-disc{text-align:center;color:var(--muted);font-size:.8rem;max-width:760px;margin:16px auto 0;line-height:1.5}
.plb-cta{text-align:center;margin-top:30px;display:flex;flex-direction:column;align-items:center;gap:10px}
.plb-note{color:var(--muted);font-size:.86rem}
.plb-live{display:inline-block;width:8px;height:8px;border-radius:50%;background:#16a34a;vertical-align:middle;margin-left:5px;animation:plbpulse 1.8s infinite}
@keyframes plbpulse{0%{box-shadow:0 0 0 0 rgba(22,163,74,.55)}70%{box-shadow:0 0 0 8px rgba(22,163,74,0)}100%{box-shadow:0 0 0 0 rgba(22,163,74,0)}}
'''
SPLASH_CSS = '''
#lbSplash{position:fixed;inset:0;z-index:99999;background:#0b1220;display:flex;align-items:center;justify-content:center;animation:lbsOut .55s ease 1.3s forwards}
.lbs-logo{display:flex;align-items:center;gap:4px}
.lbs-mark{width:62px;height:62px;border-radius:16px;background:linear-gradient(135deg,#1e3a8a,#0b1220);box-shadow:0 0 0 1px rgba(255,255,255,.07),0 20px 50px -16px rgba(37,99,235,.5);display:flex;align-items:center;justify-content:center;animation:lbsPop .6s cubic-bezier(.2,.8,.2,1.25) both}
.lbs-mark svg{width:40px;height:40px}
.lbs-L{opacity:0;animation:lbsFade .4s ease .28s forwards}
.lbs-arrow{opacity:0;transform:translateX(-9px);animation:lbsArrow .5s cubic-bezier(.2,.8,.2,1.4) .5s forwards}
.lbs-word{font-family:'Manrope',Arial,sans-serif;font-weight:800;font-size:36px;color:#fff;letter-spacing:-1px;max-width:0;overflow:hidden;white-space:nowrap;opacity:0;animation:lbsWord .55s ease .6s forwards}
.lbs-word b{color:#60a5fa}
@keyframes lbsPop{0%{transform:scale(.5);opacity:0}100%{transform:scale(1);opacity:1}}
@keyframes lbsFade{to{opacity:1}}
@keyframes lbsArrow{to{opacity:1;transform:translateX(0)}}
@keyframes lbsWord{to{opacity:1;max-width:260px}}
@keyframes lbsOut{to{opacity:0;visibility:hidden}}
@media(prefers-reduced-motion:reduce){#lbSplash{animation:lbsOut .3s ease .2s forwards}.lbs-mark,.lbs-L,.lbs-arrow,.lbs-word{animation:none;opacity:1;max-width:260px;transform:none}}
'''
ART_CSS = '''
.crumbs{font-size:.85rem;color:var(--muted);padding:16px 0}.crumbs a{color:var(--blue)}
.art-hero{position:static;z-index:auto;background:linear-gradient(180deg,#0b1220,#0f172a);color:#fff;padding:48px 0 64px}
.art-hero .art-eyebrow{color:#fb923c;font-weight:700;font-size:.78rem;letter-spacing:.12em;text-transform:uppercase;margin-bottom:14px}
.art-hero h1{font-size:2.5rem;line-height:1.12;max-width:880px;margin:0 0 16px;color:#fff}
.art-sub{color:#cbd5e1;font-size:1.16rem;max-width:760px;line-height:1.6}
.art-meta{color:#94a3b8;font-size:.9rem;margin-top:18px;display:flex;gap:12px;flex-wrap:wrap}
.art-feat{margin:-44px 0 0;border-radius:18px;overflow:hidden;box-shadow:0 30px 60px -30px rgba(15,23,42,.55);position:relative;z-index:2;background:linear-gradient(120deg,#0f172a,#1e3a8a 55%,#2563EB);min-height:300px}
.art-feat .feat-art,.art-feat img{position:absolute;inset:0;width:100%;height:100%;display:block}
.art-feat img{object-fit:cover}
@media(max-width:880px){.art-feat{min-height:200px}}
.art-grid{display:grid;grid-template-columns:230px 1fr;gap:48px;align-items:start;padding-top:42px;padding-bottom:10px}
.art-toc{position:sticky;top:90px}
.art-toc .tt{font-weight:800;font-family:'Manrope',sans-serif;font-size:.76rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:12px}
.art-toc a{display:block;color:var(--navy);font-size:.92rem;padding:6px 0 6px 13px;border-left:2px solid var(--border);transition:.15s}
.art-toc a:hover{border-color:var(--blue);color:var(--blue)}
.art-body{max-width:768px}
.art-body h2{font-size:1.72rem;margin:42px 0 14px;scroll-margin-top:90px;color:var(--navy)}
.art-body h3{font-size:1.24rem;margin:26px 0 8px;color:var(--navy)}
.art-body p{font-size:1.06rem;line-height:1.75;color:#334155;margin-bottom:18px}
.art-body ul,.art-body ol{margin:0 0 20px 4px;color:#334155;line-height:1.7;padding-left:22px}.art-body li{margin-bottom:9px}
.art-body a{color:var(--blue);font-weight:600}
.callout{border-radius:14px;padding:17px 20px;margin:26px 0;display:flex;gap:14px;font-size:1rem;line-height:1.6;color:#334155}
.callout .ic{font-size:1.25rem;line-height:1;flex-shrink:0}
.cl-tip{background:#ecfdf5;border:1px solid #a7f3d0}.cl-warn{background:#fff7ed;border:1px solid #fed7aa}.cl-info{background:var(--blue-soft);border:1px solid #bfdbfe}
.pull{border-left:4px solid var(--orange);padding:4px 0 4px 22px;margin:30px 0;font-size:1.32rem;font-weight:700;font-family:'Manrope',sans-serif;color:var(--navy);line-height:1.42}
.statrow{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:28px 0}
.statcard{background:#fff;border:1px solid var(--border);border-radius:14px;padding:18px 14px;text-align:center}
.statcard .n{font-family:'Manrope',sans-serif;font-weight:800;font-size:1.7rem;color:var(--blue)}
.statcard .l{font-size:.84rem;color:var(--muted);margin-top:4px;line-height:1.35}
.cmp{width:100%;border-collapse:collapse;margin:24px 0;font-size:.97rem}
.cmp th,.cmp td{border:1px solid var(--border);padding:11px 14px;text-align:left;vertical-align:top}
.cmp th{background:var(--navy);color:#fff;font-family:'Manrope',sans-serif;font-weight:700}
.cmp td:first-child{font-weight:700;color:var(--navy);background:var(--bg)}
.art-fig{margin:30px 0;border:1px solid var(--border);border-radius:16px;padding:24px 24px 18px;background:#fff}
.art-fig figcaption{font-size:.85rem;color:var(--muted);text-align:center;margin-top:14px;line-height:1.5}
.art-author{display:flex;gap:16px;align-items:flex-start;background:var(--bg);border:1px solid var(--border);border-radius:16px;padding:20px;margin:42px 0 8px;max-width:768px}
.art-author .av{width:52px;height:52px;border-radius:12px;background:linear-gradient(135deg,#1e3a8a,#0b1220);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-family:'Manrope',sans-serif;flex-shrink:0}
.svc-banner{display:flex;align-items:center;justify-content:space-between;gap:18px;background:linear-gradient(135deg,#0b1220,#1e3a8a);color:#fff;border-radius:16px;padding:22px 24px;margin:32px 0;flex-wrap:wrap}
.svc-banner .sb-t{font-family:'Manrope',sans-serif;font-weight:800;font-size:1.16rem;margin-bottom:4px;color:#fff}
.svc-banner .sb-s{color:#cbd5e1;font-size:.95rem;max-width:460px;line-height:1.5}
.svc-banner a.sb-btn{background:#F97316;color:#fff;font-weight:700;font-family:'Manrope',sans-serif;padding:12px 22px;border-radius:11px;white-space:nowrap;font-size:.95rem;flex-shrink:0}
.svc-banner a.sb-btn:hover{background:#ea6a0c}
.bloggrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:24px;margin-top:36px}
.blogcard{display:flex;flex-direction:column;background:#fff;border:1px solid var(--border);border-radius:18px;overflow:hidden;transition:transform .2s,box-shadow .2s,border-color .2s}
.blogcard:hover{transform:translateY(-5px);border-color:var(--blue);box-shadow:0 28px 56px -30px rgba(37,99,235,.4)}
.bc-thumb{position:relative;aspect-ratio:2/1;overflow:hidden;background:#0b1220}
.bc-thumb svg,.bc-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.bc-thumb img{z-index:2}
.bc-ov{position:absolute;inset:0;z-index:3;pointer-events:none;background:linear-gradient(155deg,rgba(11,18,32,.22),transparent 38%,transparent 66%,rgba(11,18,32,.5))}
.bc-brand{position:absolute;top:12px;left:12px;z-index:4;display:inline-flex;align-items:center;gap:7px;font-family:'Manrope',sans-serif;font-weight:800;font-size:.74rem;letter-spacing:.01em;color:#fff;background:rgba(11,18,32,.4);backdrop-filter:blur(5px);padding:5px 11px 5px 5px;border-radius:9px}
.bc-l{display:inline-flex;align-items:center;justify-content:center;width:19px;height:19px;border-radius:6px;background:linear-gradient(135deg,#2563EB,#1e3a8a);color:#fff;font-size:.72rem;position:relative}
.bc-l::after{content:'';position:absolute;right:3px;bottom:4px;width:0;height:0;border-left:5px solid #F97316;border-top:3px solid transparent;border-bottom:3px solid transparent}
.blogcard:hover .bc-thumb img,.blogcard:hover .bc-thumb svg{transform:scale(1.05)}
.bc-thumb img,.bc-thumb svg{transition:transform .4s ease}
.bc-body{padding:20px 22px 22px;display:flex;flex-direction:column;flex:1}
.bc-meta{font-size:.75rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--blue);margin-bottom:8px}
.bc-body h3{font-family:'Manrope',sans-serif;font-size:1.18rem;color:var(--navy);line-height:1.3;margin-bottom:8px}
.bc-body p{color:var(--muted);font-size:.94rem;line-height:1.55;flex:1;margin:0}
.bc-link{margin-top:14px;color:var(--blue);font-weight:700;font-size:.92rem}
.art-steps{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:26px 0}
.art-step{background:#fff;border:1px solid var(--border);border-radius:14px;padding:18px}
.art-step .sn{width:30px;height:30px;border-radius:8px;background:var(--blue-soft);color:var(--blue);font-family:'Manrope',sans-serif;font-weight:800;display:flex;align-items:center;justify-content:center;margin-bottom:10px}
.art-step b{display:block;color:var(--navy);font-size:.98rem;margin-bottom:4px}.art-step span{color:var(--muted);font-size:.88rem;line-height:1.45}
@media(max-width:880px){.art-steps{grid-template-columns:1fr 1fr}}
@media(max-width:880px){.art-grid{grid-template-columns:1fr;gap:0;padding-top:30px}.art-toc{display:none}.art-hero h1{font-size:1.95rem}.statrow{grid-template-columns:1fr}.art-feat{margin-top:-30px}.svc-banner a.sb-btn{width:100%;text-align:center}}
'''
def _mincss(c):
    import re as _re
    c=_re.sub(r'/\*.*?\*/','',c,flags=_re.S)      # strip comments
    c=_re.sub(r'\n\s*','',c)                        # strip newlines + indentation
    c=_re.sub(r'\s*([{};,])\s*',r'\1',c)           # trim space around { } ; ,
    c=c.replace(';}','}')                            # drop trailing semicolons
    return c.strip()
with open(os.path.join(OUT,'styles.css'),'w',encoding='utf-8') as f: f.write(_mincss(CSS + TOOLS_CSS + LS_CSS + LOADBOARD_CSS + SPLASH_CSS + ART_CSS))
with open(os.path.join(OUT,'app.js'),'w',encoding='utf-8') as f: f.write(JS + PWA_JS)
with open(os.path.join(OUT,'manifest.webmanifest'),'w',encoding='utf-8') as f: f.write(MANIFEST)
with open(os.path.join(OUT,'sw.js'),'w',encoding='utf-8') as f: f.write(SW)

ROAD = '''<section class="road-sec"><div class="wrap">
<div class="sec-head reveal"><div class="eyebrow">Always Moving</div><h2>Your truck, loaded and rolling &mdash; coast to coast</h2><p class="lead">We keep freight moving across all 48 states, day and night.</p></div>
<div class="road reveal"><div class="lane"></div><div class="tk">&#128666;</div><div class="hill"></div></div></div></section>'''

ROUTE = '''<section><div class="wrap route-grid">
<div class="reveal"><div class="eyebrow">Freight Management, Handled</div><h2>From booking to delivery &mdash; we guide every mile</h2>
<p class="lead" style="margin:16px 0 22px">We plan the lane, book the load, negotiate the rate, and follow it through to delivery. You just drive &mdash; we manage the route, the broker, and the paperwork.</p>
<div><span class="tag">Route planning</span><span class="tag">Load tracking</span><span class="tag">Rate negotiation</span><span class="tag">Paperwork handled</span></div></div>
<div class="routebox reveal d1"><svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Animated dispatch route map">
<rect width="400" height="220" rx="12" fill="#F8FAFC"/>
<g stroke="#E2E8F0" stroke-width="1"><path d="M0 55H400M0 110H400M0 165H400M100 0V220M200 0V220M300 0V220"/></g>
<path d="M40 175 C 150 175 120 70 250 72 S 340 55 360 48" fill="none" stroke="#CBD5E1" stroke-width="5" stroke-linecap="round"/>
<path d="M40 175 C 150 175 120 70 250 72 S 340 55 360 48" fill="none" stroke="#2563EB" stroke-width="5" stroke-linecap="round" class="dasharw"/>
<circle cx="40" cy="175" r="14" fill="#2563EB" opacity=".18"/><circle cx="40" cy="175" r="7" fill="#2563EB"/>
<circle cx="360" cy="48" r="14" fill="#F97316" opacity=".18"/><circle cx="360" cy="48" r="7" fill="#F97316"/>
<g><circle r="13" fill="#2563EB" opacity="0.16"/><circle r="6.5" fill="#2563EB"/><circle r="2.5" fill="#fff"/><animateMotion dur="6s" repeatCount="indefinite" rotate="auto"><mpath href="#rtpath"/></animateMotion></g>
<text x="34" y="200" font-size="11" fill="#64748B" font-family="Inter">Origin</text>
<text x="318" y="38" font-size="11" fill="#64748B" font-family="Inter">Delivery</text></svg></div></div></section>'''
# fix mpath: use inline path reference via id
ROUTE = ROUTE.replace('<path d="M40 175 C 150 175 120 70 250 72 S 340 55 360 48" fill="none" stroke="#CBD5E1"','<path id="rtpath" d="M40 175 C 150 175 120 70 250 72 S 340 55 360 48" fill="none" stroke="#CBD5E1"').replace('<mpath href="#"/>','<mpath href="#rtpath"/>')

WHYUS = '''<section id="why"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Why Loadboot</div><h2>Built for carriers who want to earn more and stress less</h2></div>
<div class="grid g4">
<div class="card reveal"><div class="icon">&#128200;</div><h3>Higher-paying loads</h3><p>We negotiate hard on every rate and turn down cheap freight that wastes your time.</p></div>
<div class="card reveal d1"><div class="icon">&#128739;</div><h3>Less deadhead</h3><p>Smart lane planning keeps your truck loaded and your miles paid.</p></div>
<div class="card reveal d2"><div class="icon">&#128450;</div><h3>Back office handled</h3><p>Broker setup, rate confirmations, and paperwork &mdash; all taken care of.</p></div>
<div class="card reveal d3"><div class="icon">&#128222;</div><h3>Straight talk</h3><p>No hidden fees, no lock-in contracts, and a dispatcher who actually answers.</p></div>
</div></div></section>'''

STATS = '''<div class="stats"><div class="wrap stats-grid">
<div class="stat reveal"><div class="n" data-count="48">48</div><div class="l">States covered</div></div>
<div class="stat reveal d1"><div class="n">5%</div><div class="l">Flat rate, no contracts</div></div>
<div class="stat reveal d2"><div class="n">24/7</div><div class="l">Dispatch support</div></div>
<div class="stat reveal d3"><div class="n">15<span style="font-size:1.3rem">min</span></div><div class="l">Avg. reply (business hrs)</div></div>
</div></div>'''

PROMISE = '''<section><div class="wrap"><div class="promise reveal"><div class="glow"></div>
<div class="eyebrow" style="color:#93c5fd">Our Promise</div><h2>A dispatcher who actually has your back</h2>
<p>Loadboot was built on a simple idea: treat every carrier's truck like it's our own business. You get real attention, honest rates, and someone who picks up the phone.</p>
<p>We're a growing dispatch service &mdash; be one of our first carriers and grow with us.</p>
<div class="reply">&#9201;&#65039; We reply within 15 minutes during business hours</div></div></div></section>'''

def linkcard(href,emoji,title,text):
    return '<a class="linkcard reveal" href="%s"><div class="icon">%s</div><h3>%s</h3><p>%s</p><span class="arw">Learn more %s</span></a>' % (href,emoji,title,text,ARW)

FREIGHT_CARDS = '''<section id="services" class="bg-soft"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Dispatch by Freight Type</div><h2>Specialized dispatch for your equipment</h2></div>
<div class="grid g3">%s</div></div></section>''' % ''.join([
 linkcard('reefer-dispatch.html','&#10052;&#65039;','Reefer Dispatch','Temperature-controlled freight that pays &mdash; booked and protected.'),
 linkcard('flatbed-dispatch.html','&#128679;','Flatbed Dispatch','Steel, lumber, machinery &mdash; higher-skill freight, higher rates.'),
 linkcard('dry-van-dispatch.html','&#128230;','Dry Van Dispatch','Consistent, steady van freight to keep you moving.'),
 linkcard('hotshot-dispatch.html','&#9889;','Hotshot Dispatch','Expedited, smaller loads for hotshot operators.'),
 linkcard('power-only-dispatch.html','&#128668;','Power Only','Flexible drop-and-hook freight for your tractor.'),
 linkcard('new-authority-dispatch.html','&#128640;','New Authority','Just got your MC? We get you set up and loaded.'),
])

_WS = [
 ('Owner-Operators','<path d="M2 7h11v8H2z"/><path d="M13 10h4l3 3v2h-7z"/><circle cx="6" cy="18" r="1.4"/><circle cx="17" cy="18" r="1.4"/>'),
 ('Small Fleets','<rect x="2" y="9" width="9" height="7" rx="1"/><rect x="12" y="6" width="9" height="10" rx="1"/>'),
 ('Growing Fleets','<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>'),
 ('New-Authority Carriers','<path d="M6 21V4h11l-2 3.5L17 11H6"/>'),
 ('Independent Carriers','<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>'),
 ('Leased-On Operators','<path d="M9 15l6-6"/><path d="M12 6l1-1a4 4 0 0 1 6 6l-1 1"/><path d="M12 18l-1 1a4 4 0 0 1-6-6l1-1"/>'),
 ('Hotshot Operators','<polygon points="13 2 4 14 11 14 11 22 20 10 13 10 13 2"/>'),
 ('Box Truck / Expedited','<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/>'),
 ('Team Drivers','<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 6a3 3 0 0 1 0 5"/>'),
 ('CDL Drivers Going Independent','<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v6M12 15v6M3 12h6M15 12h6"/>'),
 ('Veteran &amp; Woman-Owned Carriers','<circle cx="12" cy="9" r="5"/><path d="M9 13l-1 8 4-2 4 2-1-8"/>'),
]
def _wschip(t):
    return '<span class="mq-chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + t[1] + '</svg>' + t[0] + '</span>'
WHOSERVE = '<section id="serve"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Who We Serve</div><h2>Built for every kind of carrier on the road</h2><p class="lead" style="margin-top:14px">Whether you run one truck or a growing fleet, brand new or years in &mdash; we tailor dispatch to how you run.</p></div></div><div class="mq-wrap reveal"><div class="mq-track">' + ''.join(_wschip(s) for s in _WS)*2 + '</div></div></section>'
# NOTE: Third-party platform logos and platform-specific sourcing claims were removed
# per owner decision (no trademark permission / authorized operational relationship on file).
# Wording is intentionally neutral and accurate. Do NOT name or display any platform unless
# its use and branding are authorized in writing.
# Platform names are CONFIGURABLE in ONE place. Default = OFF (empty) -> neutral text only.
# Add names ONLY after the owner confirms LoadBoot genuinely uses them. NO logos. NO
# partner/integrated/official/certified/connected/authorized language.
PLATFORM_NAMES = []   # e.g. ['DAT','Truckstop','Amazon Relay','Uber Freight'] once owner-confirmed
_PLAT_DISC = ('LoadBoot is an independent dispatch service and is not affiliated with, endorsed by, or '
 'sponsored by any platforms named above. Platform access depends on each carrier&rsquo;s eligibility, '
 'account status and applicable terms.')
def _networks():
    head=('<div class="sec-head center reveal"><div class="eyebrow">How we find your freight</div>'
          '<h2>Freight sources our dispatch workflow may use</h2>'
          '<p class="lead center" style="margin:14px auto 0">We search authorized freight sources and load boards '
          'available to your carrier and dispatch operation &mdash; then negotiate the rate so you keep more of every mile.</p></div>')
    if PLATFORM_NAMES:
        chips=''.join('<span class="src-chip">'+n+'</span>' for n in PLATFORM_NAMES)
        body='<div class="src-row reveal">'+chips+'</div><p class="src-disc reveal">'+_PLAT_DISC+'</p>'
    else:
        body='<p class="lead center" style="margin:6px auto 0;color:var(--muted)">Available sources depend on your authority, equipment and eligibility.</p>'
    return '<section class="bg-soft"><div class="wrap">'+head+body+'</div></section>'
NETWORKS = _networks()

# ---- Real public load board (admin-published) via the narrow secured RPC ----
LIVEBOARD = ('<section id="opportunities" class="bg-soft"><div class="wrap"><div class="sec-head center reveal">'
 '<div class="eyebrow">Live Opportunities</div><h2>Available Load Opportunities</h2>'
 '<p class="lead center" style="margin:0 auto">Current freight opportunities published by LoadBoot dispatch. '
 'Availability can change quickly. Verified carriers can sign in to view and book.</p></div>'
 '<div class="plb-grid reveal" id="liveLoads"><div class="plb-empty" id="liveEmpty">Loading current opportunities&hellip;</div></div>'
 '<div class="plb-cta reveal"><a href="/app/carrier/" class="btn btn-primary">Sign in to view &amp; book &rarr;</a>'
 '<span class="plb-note">A free verified carrier account is required to view full load details and book.</span></div></div></section>')
# The public load board talks to a Supabase project. In PRODUCTION it uses the
# production project. In ANY preview/branch/dev build it makes ZERO production
# requests: the board renders an explicit "disabled in preview" state and never
# fetches (staging has no public board data). This keeps a Deploy Preview fully
# production-isolated. The SB/KEY literals below are only ever the PRODUCTION
# project, and they are only emitted into the page when IS_PRODUCTION_CTX is true.
_BOARD_SB = 'https://%s.supabase.co' % PROD_REF
_BOARD_KEY = PROD_ANON
LIVEBOARD_JS_PROD = (r"(function(){var SB='" + _BOARD_SB + r"',KEY='" + _BOARD_KEY + r"';var el=document.getElementById('liveLoads'),em=document.getElementById('liveEmpty');if(!el)return;function esc(s){return (s==null?'':String(s)).replace(/[&<>\"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c];});}function num(n){return Number(n||0).toLocaleString();}function dt(d){if(!d)return '';try{return new Date(d).toLocaleDateString(undefined,{month:'short',day:'numeric'});}catch(e){return '';}}function ago(d){if(!d)return '';var s=Math.floor((Date.now()-new Date(d).getTime())/1000);if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago';}function card(l){var rpm=l.rpm?('$'+Number(l.rpm).toFixed(2)+'/mi'):'';return '<article class=\"plb\"><div class=\"plb-top\"><div class=\"plb-lane\"><b>'+esc(l.origin)+'</b><span class=\"plb-ar\">&rarr;</span><b>'+esc(l.destination)+'</b></div><div class=\"plb-rate\">$'+num(Math.round(l.rate))+(rpm?'<span>'+rpm+'</span>':'')+'</div></div><div class=\"plb-tags\"><span class=\"plb-tag eq\">'+esc(l.equipment||'Van')+'</span>'+(l.miles?'<span class=\"plb-tag alt\">'+num(l.miles)+' mi</span>':'')+(l.pickup_date?'<span class=\"plb-tag\">PU '+esc(dt(l.pickup_date))+'</span>':'')+'</div><div class=\"plb-meta\"><span>Posted<b>'+esc(ago(l.posted)||'recently')+'</b></span><span>Ref<b>#'+esc(l.ref)+'</b></span></div><a href=\"/app/carrier/\" class=\"plb-book\">View &amp; Book Load &rarr;</a></article>';}function empty(m){if(em){em.textContent=m;em.style.display='';}}fetch(SB+'/rest/v1/rpc/get_public_load_opportunities',{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json'},body:JSON.stringify({p_limit:9})}).then(function(r){return r.ok?r.json():Promise.reject(r.status);}).then(function(d){if(d&&d.length){el.innerHTML=d.map(card).join('');}else{empty('No public load opportunities right now. Sign in for the full carrier board.');}}).catch(function(){empty('Live opportunities are temporarily unavailable. Please sign in to view the full board.');});})();")
# Preview variant: NO network call at all — explicit disabled state.
LIVEBOARD_JS_PREVIEW = (r"(function(){var em=document.getElementById('liveEmpty');if(em){em.textContent='Live load board is disabled in this preview environment.';em.style.display='';}})();")
LIVEBOARD_JS = LIVEBOARD_JS_PROD if IS_PRODUCTION_CTX else LIVEBOARD_JS_PREVIEW

# Public announcement bar — fetches active audience='public' announcements (get_active_public_announcements,
# anon-granted) and renders a dismissible top bar. Emergencies show first in red. Dismissal is per-announcement
# (sessionStorage) so a visitor is not nagged after closing it. Production only (needs the live anon key).
ANNOUNCE_JS_PROD = (r"(function(){var SB='" + _BOARD_SB + r"',KEY='" + _BOARD_KEY + r"';var TONE={emergency:['#7f1d1d','#fecaca'],warning:['#78350f','#fde68a'],promo:['#4c1d95','#ddd6fe'],info:['#0c4a6e','#bae6fd']};function esc(s){return (s==null?'':String(s)).replace(/[&<>\"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c];});}fetch(SB+'/rest/v1/rpc/get_active_public_announcements',{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json'},body:'{}'}).then(function(r){return r.ok?r.json():Promise.reject(r.status);}).then(function(d){if(!d||!d.length)return;var a=null;for(var i=0;i<d.length;i++){var seen=false;try{seen=sessionStorage.getItem('lb_ann_'+d[i].id);}catch(e){}if(!seen){a=d[i];break;}}if(!a)return;var t=TONE[a.kind]||TONE.info;var bar=document.createElement('div');bar.className='lb-annbar';bar.setAttribute('role','status');bar.style.cssText='background:'+t[0]+';color:'+t[1]+';font:600 14px/1.4 Inter,system-ui,sans-serif;padding:10px 44px 10px 18px;text-align:center;position:relative;z-index:60';bar.innerHTML='<b style=\"color:#fff\">'+esc(a.title)+'</b>'+(a.body?' <span style=\"opacity:.92\">'+esc(a.body)+'</span>':'');var x=document.createElement('button');x.setAttribute('aria-label','Dismiss');x.textContent='×';x.style.cssText='position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:0;color:'+t[1]+';font-size:22px;line-height:1;cursor:pointer;padding:0 6px';x.onclick=function(){try{sessionStorage.setItem('lb_ann_'+a.id,'1');}catch(e){}bar.parentNode&&bar.parentNode.removeChild(bar);};bar.appendChild(x);document.body.insertBefore(bar,document.body.firstChild);}).catch(function(){});})();")
ANNOUNCE_JS = ANNOUNCE_JS_PROD if IS_PRODUCTION_CTX else ""

COMPARE = '''<section id="compare" class="bg-soft"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">The Difference</div><h2>Why carriers choose us over going it alone</h2></div>
<div class="reveal"><table class="cmp"><thead><tr><th>What matters to you</th><th>Dispatching yourself</th><th>A typical dispatcher</th><th class="us">Loadboot</th></tr></thead><tbody>
<tr><td>Hours saved on broker calls</td><td class="no">None</td><td>Some</td><td class="us">Fully handled</td></tr>
<tr><td>Expert rate negotiation</td><td class="no">On your own</td><td>Varies</td><td class="us">Every load</td></tr>
<tr><td>No long-term contract</td><td>&mdash;</td><td class="no">Often locked in</td><td class="us">Cancel anytime</td></tr>
<tr><td>You approve every load</td><td class="yes">Yes</td><td>Sometimes</td><td class="us">Always</td></tr>
<tr><td>24/7 support</td><td class="no">No</td><td>Limited</td><td class="us">Yes</td></tr>
<tr><td>Added-value (factoring, IFTA, claims)</td><td class="no">No</td><td class="no">Rarely</td><td class="us">Included help</td></tr>
</tbody></table></div></div></section>'''

HOW = '''<section id="how"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Simple Onboarding</div><h2>Getting started takes one conversation</h2></div>
<div class="grid g4">
<div class="step reveal"><div class="num">1</div><h3>Free Consultation</h3><p>Tell us about your truck, your authority, and the lanes you like to run.</p></div>
<div class="step reveal d1"><div class="num">2</div><h3>We Set You Up</h3><p>We handle broker setup and learn your preferences, equipment, and target rates.</p></div>
<div class="step reveal d2"><div class="num">3</div><h3>We Book &amp; Negotiate</h3><p>We find loads, negotiate the rate, and send the details for your approval.</p></div>
<div class="step reveal d3"><div class="num">4</div><h3>You Drive, We Handle the Rest</h3><p>You stay loaded and paid; we manage the back office.</p></div>
</div></div></section>'''

# ---------- HOME ----------
home_faqs=[('Do I need my own authority (MC/DOT)?','Yes &mdash; we dispatch for carriers who hold their own operating authority. New-authority carriers are welcome, and we help with broker setup.'),
('How do you charge?','A flat 5% of your gross on the loads we book &mdash; no hidden fees and no long-term contract. You only pay when you earn.'),
('Is there a long-term contract?','No. You can cancel anytime. We earn your business load by load.'),
('What kind of freight do you dispatch?','Dry van, reefer, flatbed, step deck, hotshot, power-only, and box truck/expedited.'),
('How soon can you start?','Usually within a day or two of completing your carrier setup.'),
('Do you work with new-authority carriers?','Absolutely &mdash; new carriers are a core part of who we help.'),
('Will I know the rate before I accept a load?','Always. Nothing is booked without your approval.')]
home_faq_html, home_faq_schema = faq_block(home_faqs)
HERO='''<section class="hero"><div class="aurora"><span class="a1"></span><span class="a2"></span></div>
<div class="wrap hero-grid"><div>
<span class="badge reveal"><span class="dot"></span> Helping Owner-Operators &amp; Fleets Grow</span>
<h1 class="reveal d1">Professional Truck Dispatch <span class="gradtext">Across the USA</span></h1>
<p class="reveal d1" style="color:#fb923c;font-weight:700;font-size:1.18rem;margin:12px 0 0;letter-spacing:.01em">Keep your wheels earning.</p>
<p class="lead reveal d2">We help owner-operators, fleets, and trucking companies book higher-paying freight, cut empty miles, and keep their trucks moving &mdash; with a dedicated dispatcher, honest communication, and no long-term contracts.</p>
<div class="hero-btns reveal d3"><a href="contact.html" class="btn btn-primary">Get Started %s</a><a href="contact.html#quote" class="btn btn-secondary">Get a Quote</a><a href="services.html" class="btn btn-ghost">Explore Services &rarr;</a></div>
<div class="trust reveal d3"><div>%s No contracts</div><div>%s You keep 100%% of your rate</div><div>%s Flat 5%% &mdash; pay only when you earn</div></div></div>
<div class="hero-visual reveal d2"><div class="hv-card"><div class="glow"></div>
<div class="hv-top"><div class="truck">&#128666;</div><span class="hv-live"><span class="dot"></span> Load booked</span></div>
<div class="hv-row"><span>Lane</span><span>Dallas, TX &rarr; Atlanta, GA</span></div>
<div class="hv-row"><span>Equipment</span><span>Dry Van &middot; 53&prime;</span></div>
<div class="hv-row"><span>Miles</span><span>781 mi</span></div>
<div class="hv-row"><span>Negotiated rate</span><span class="hv-rate">$2,640 &middot; $3.38/mi</span></div></div>
<div class="hv-float hv-f1"><span class="ic">&#128222;</span> Broker handled for you</div>
<div class="hv-float hv-f2"><span class="ic">&#10003;</span> You approve every load</div></div></div></section>''' % (ARW,CHK,CHK,CHK)
SCROLLBAND = '<section class="scroll-road-sec"><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">Coast to coast</div><h2>We keep your truck moving, every mile</h2><p class="lead center" style="color:#cbd5e1;margin:0 auto">Scroll and ride along &mdash; from pickup to delivery, we handle the whole route.</p></div></div><div class="scroll-road"><div class="sr-line"></div><div class="sr-truck" id="scrollTruck"><svg viewBox="0 0 130 58" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="9" width="78" height="33" rx="3" fill="#e2e8f0"/><rect x="3" y="9" width="78" height="33" rx="3" fill="none" stroke="#94a3b8" stroke-width="1.5"/><g stroke="#cbd5e1" stroke-width="1.5"><line x1="18" y1="11" x2="18" y2="40"/><line x1="33" y1="11" x2="33" y2="40"/><line x1="48" y1="11" x2="48" y2="40"/><line x1="63" y1="11" x2="63" y2="40"/></g><path d="M81 15h13c2 0 3.6 1 4.6 2.7l8.4 12.8c.7 1 1 2.3 1 3.5v8H81z" fill="#2563EB"/><path d="M85 19h9v9h-9z" fill="#bfdbfe"/><path d="M96 20l6 8h-6z" fill="#93c5fd"/><rect x="113" y="36" width="4" height="7" rx="1" fill="#1e293b"/><rect x="3" y="42" width="114" height="3" fill="#1e293b"/><g><circle cx="24" cy="46" r="8" fill="#0f172a"/><circle cx="24" cy="46" r="3.4" fill="#64748b"/></g><g><circle cx="42" cy="46" r="8" fill="#0f172a"/><circle cx="42" cy="46" r="3.4" fill="#64748b"/></g><g><circle cx="100" cy="46" r="8" fill="#0f172a"/><circle cx="100" cy="46" r="3.4" fill="#64748b"/></g></svg></div></div></section>'
BLOGHOME = '<section class="bg-soft"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">From the blog</div><h2>Guides to help you run a more profitable truck</h2></div><div class="grid g3">' + linkcard('how-much-does-a-truck-dispatcher-cost.html','&#128196;','How Much Does a Truck Dispatcher Cost?','Percentage vs flat fee, what 5% really gets you, and how a dispatcher pays for itself.') + linkcard('truck-dispatcher-vs-freight-broker.html','&#128196;','Dispatcher vs Broker vs Factoring','Who each represents, what they can legally do, how the money flows, and which you need.') + linkcard('how-to-get-loads-with-new-authority.html','&#128196;','Getting Loads With New Authority','How to set up with brokers and land your first loads fast.') + linkcard('owner-operator-dispatch-service-guide.html','&#128196;','Owner-Operator Dispatch Service Guide','What a dispatch service does for one truck, what it costs, and how to choose one.') + '</div></div></section>'
PHOTOS = '<section class="bg-soft"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Built for life on the road</div><h2>Dispatch support built around your operation</h2><p class="lead">Dispatch workflows and profit tools designed for owner-operators and small fleets operating across the contiguous United States.</p></div><div class="photo-grid reveal"><div class="photo"><img src="truck-fleet.webp" width="1280" height="720" alt="Semi-trucks parked at a freight yard" loading="lazy" decoding="async" onerror="this.style.display=&quot;none&quot;"><span class="ph-tag">Fleets &amp; owner-operators, coast to coast</span></div><div class="photo"><img src="truck-boxtruck.webp" width="1280" height="720" alt="Box truck ready for dispatch" loading="lazy" decoding="async" onerror="this.style.display=&quot;none&quot;"><span class="ph-tag">Dry van, reefer, flatbed, box &amp; more</span></div></div></div></section>'
_tp = [
 ('profit','&#128200;','Load Profit Calculator','See your net profit and rate-per-mile on any load before you accept it.'),
 ('cpm','&#128666;','Cost-Per-Mile Calculator','Turn your monthly costs into the one number every load decision depends on.'),
 ('fuel','&#9981;','Fuel Cost Calculator','Price diesel for any lane in seconds, with gallons and dollars per mile.'),
 ('breakeven','&#128202;','Break-Even Rate','Know the lowest rate you can accept and still hit your target margin.'),
 ('takehome','&#128181;','Owner-Op Take-Home','What actually lands in your pocket after fuel, fees and expenses.'),
 ('detention','&#128336;','Detention Pay','Stuck at the dock? See exactly what the shipper owes you.'),
]
_tpcards = ''.join('<a class="linkcard reveal" href="tools.html#%s"><div class="icon">%s</div><h3>%s</h3><p>%s</p><span class="arw">Open tool %s</span></a>' % (a,b,c,d,ARW) for a,b,c,d in _tp)
TOOLSPROMO = '<section class="bg-soft"><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">Free for drivers &mdash; no login</div><h2>Free trucking calculators that pay for themselves</h2><p class="lead center" style="margin:0 auto">Owner-operators use these every day to price loads, know their real cost per mile, and stop hauling cheap freight. 100% free, right in your browser &mdash; no signup needed.</p></div><div class="grid g3 reveal">' + _tpcards + '</div><div class="center" style="margin-top:32px"><a href="tools.html" class="btn btn-primary">Open all free tools %s</a></div></div></section>' % ARW
LSBAND = '<section id="load-score-home" class="bg-soft"><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">Free decision tool &mdash; no login</div><h2>Should you take this load? Find out in 3 seconds.</h2><p class="lead center" style="margin:0 auto">The one tool every owner-operator needs daily. Enter any offer and get a clear <b>take / negotiate / pass</b> verdict &mdash; with a smart counter-offer built on your real costs.</p></div>' + LS_HTML + '<div class="center" style="margin-top:24px"><a href="load-score.html" class="btn btn-secondary">How the Load Score works &rarr;</a></div></div></section>'
# Static, timeless ILLUSTRATIVE examples only. No dates, no "available now", no live DB query.
# Columns: origin, destination, equipment, loaded_miles, example_rate, weight
PLB_SAMPLES = [
 ('Dallas, TX','Atlanta, GA','Dry Van','781','2640','42,000 lbs'),
 ('Chicago, IL','Kansas City, MO','Reefer','510','1780','38,000 lbs'),
 ('Los Angeles, CA','Phoenix, AZ','Flatbed','373','1320','44,000 lbs'),
 ('Houston, TX','New Orleans, LA','Dry Van','348','1180','40,000 lbs'),
 ('Atlanta, GA','Orlando, FL','Reefer','438','1560','36,000 lbs'),
 ('Denver, CO','Salt Lake City, UT','Power Only','525','1490',''),
]
def _plb_card(o,d,eq,mi,rate,wt):
    miN=int(mi); rpm=('%.2f' % (float(rate)/miN)) if miN else ''
    transit=max(1, round(miN/550.0)) if miN else 1
    wttag = ('<span class="plb-tag">%s</span>' % wt) if wt else ''
    rpmtag = ('<span>$%s/mi est.</span>' % rpm) if rpm else ''
    return ('<article class="plb reveal"><div class="plb-badge">Example</div>'
            '<div class="plb-top"><div class="plb-lane"><b>%s</b><span class="plb-ar">&rarr;</span><b>%s</b></div>'
            '<div class="plb-rate">$%s%s</div></div>'
            '<div class="plb-tags"><span class="plb-tag eq">%s</span><span class="plb-tag alt">%s mi loaded</span>%s</div>'
            '<div class="plb-meta"><span>Example transit<b>%s day%s</b></span><span>Estimated RPM<b>$%s/mi</b></span></div>'
            '<a href="load-score.html" class="plb-book">Analyze a similar load &rarr;</a></article>') % (
            o, d, '{:,}'.format(int(float(rate))), rpmtag, eq, mi, wttag, transit, ('' if transit==1 else 's'), rpm)
PLB_CARDS = ''.join(_plb_card(*s) for s in PLB_SAMPLES)
LOADBOARD = '<section id="loads" class="bg-soft"><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">Example Load Analysis</div><h2>How LoadBoot evaluates a load</h2><p class="lead center" style="margin:0 auto">Illustrative freight examples showing how LoadBoot evaluates rate, miles, deadhead and estimated profitability. These are not currently available loads.</p></div><div class="plb-grid reveal">' + PLB_CARDS + '</div><div class="plb-cta reveal"><a href="load-score.html" class="btn btn-primary">Analyze your own load &rarr;</a><span class="plb-note">Free Load Score tool &mdash; score any rate for profit in seconds. No signup.</span></div></div></section>'
# NOTE: the anonymous public_loads Supabase fetch was removed. The homepage shows only
# static, clearly-labelled illustrative examples and makes no production database query.
home_body = HERO+STATS+SCROLLBAND+ROUTE+WHYUS+PHOTOS+FREIGHT_CARDS+NETWORKS+LIVEBOARD+LOADBOARD+WHOSERVE+COMPARE+HOW+LSBAND+TOOLSPROMO+PROMISE+BLOGHOME+home_faq_html+final_cta()
home_body += '<script>' + LS_JS + LIVEBOARD_JS + '</script>'
page('index.html','Truck Dispatch Services for Owner-Operators | Loadboot',
     'Reliable US truck dispatch for owner-operators, fleets, and new-authority carriers. Higher-paying loads, less deadhead, flat 5%, no contracts. Get a free quote.',
     'index.html', home_body, home_faq_schema)

# ---------- SERVICE PAGE BUILDER ----------
def svc_hero(h1,lead):
    return '''<section class="hero"><div class="aurora"><span class="a1"></span><span class="a2"></span></div><div class="wrap" style="position:relative;z-index:1;max-width:820px">
<span class="badge reveal"><span class="dot"></span> Loadboot Dispatch</span><h1 class="reveal d1">%s</h1>
<p class="lead reveal d2" style="margin:22px 0 28px">%s</p>
<div class="hero-btns reveal d3"><a href="contact.html" class="btn btn-primary">Get Started %s</a><a href="contact.html#quote" class="btn btn-secondary">Get a Quote</a><a href="services.html" class="btn btn-ghost">All Services &rarr;</a></div></div></section>''' % (h1,lead,ARW)

EXTRA = {
 "Reefer": [
  ("Reefer freight we dispatch across the USA",
   ["Temperature-controlled freight covers far more than just frozen food, and each type comes with its own rates, handling rules, and best-paying lanes. Our dispatchers know which reefer freight is worth chasing and which to leave on the board.",
    "We book and manage a wide range of refrigerated loads, matching them to your truck, your temperature capabilities, and the lanes you actually want to run."],
   ["Fresh produce and seasonal fruit and vegetables","Frozen foods, ice cream, and frozen proteins","Dairy, eggs, and refrigerated beverages","Meat, poultry, and seafood","Pharmaceuticals and temperature-sensitive medical freight","Flowers, plants, and other perishables"]),
  ("What drives your reefer rate (and how we push it higher)",
   ["Reefer rates swing more than any other trailer type. Produce season, lane imbalances, fuel for the reefer unit, and strict appointment windows all move the number. We track these factors and negotiate every load so you are paid for the extra work refrigerated freight demands.",
    "Cheap reefer freight is everywhere, especially on backhauls. We turn it down, plan smarter return lanes, and document detention at cold-storage facilities so a long wait does not quietly eat your week."],
   ["Produce season and regional demand spikes","Reefer fuel and continuous-run requirements","Strict delivery appointments and FIFO scheduling","Multi-stop and multi-temperature loads","Detention at slow cold-storage receivers"]),
 ],
 "Flatbed": [
  ("Flatbed and step-deck freight we book",
   ["Flatbed is skilled, physical work, and the freight should pay for that skill. We focus on well-paying open-deck loads and handle the broker side so you can focus on securing and hauling.",
    "From building materials to heavy machinery, we match loads to your equipment, your securement capabilities, and your preferred running area."],
   ["Steel, rebar, and metal coils","Lumber, drywall, and building materials","Construction and agricultural machinery","Pipe, beams, and structural materials","Oversize and overweight loads with permits","Tarped and untarped freight"]),
  ("Permits, securement, and oversize handling",
   ["Open-deck freight comes with responsibilities other trailer types do not: tarping, chaining, strapping, and sometimes permits and escorts. We confirm these details with the broker before you commit, so there are no surprises at the dock.",
    "For oversize and overweight loads, we help coordinate permits and route planning so your trip is legal, paid for the extra effort, and worth your time."],
   []),
 ],
 "Dry Van": [
  ("The dry van freight that keeps you moving",
   ["Dry van is the backbone of US freight, and consistency is what makes it profitable. The difference between a strong week and a slow one is having a dispatcher booking your next load before you have delivered the current one.",
    "We keep you loaded with reliable van freight on the lanes you prefer, so you spend your time driving and earning, not searching load boards."],
   ["Retail and consumer packaged goods","Paper, packaging, and printed materials","E-commerce and fulfillment freight","Non-perishable food and beverages","General palletized freight"]),
  ("How we keep your van utilization high",
   ["Empty miles are the silent killer of van profits. We plan loads back-to-back, use drop-and-hook freight where it makes sense, and keep you on tight, repeatable lanes so your truck stays paid.",
    "We also benchmark every rate against the lane so you are never the carrier hauling cheap freight while everyone else gets paid fairly."],
   []),
 ],
 "Hotshot": [
  ("Hotshot loads we find for you",
   ["Hotshot freight moves fast and the good loads disappear quickly. We watch the boards and the brokers in real time so your class 3 to 5 truck stays loaded with freight that actually pays.",
    "We focus on partials, expedited runs, and time-sensitive freight that fit a gooseneck or flatbed trailer behind your truck."],
   ["Construction equipment and materials","Expedited and time-critical partials","Agricultural and oilfield freight","Machinery and palletized partials","LTL-style and hot loads"]),
  ("Keeping hotshot profitable",
   ["Hotshot margins live and die on rate and deadhead. We chase the loads worth running, keep you off cheap freight, and plan backhauls so you are not driving home empty.",
    "We also check weights and dimensions up front, so you never roll up to a load your truck and trailer cannot legally or safely haul."],
   []),
 ],
 "Power Only": [
  ("How power only dispatch works",
   ["Power only gives you flexibility and lower overhead, because the trailer is supplied by the broker or shipper. You bring the tractor; we keep it connected to consistent drop-and-hook freight.",
    "It is a great fit for carriers who want to stay loaded without the cost and maintenance of owning trailers."],
   ["Drop-and-hook and pre-loaded trailers","Carrier and broker-supplied equipment","Dedicated and high-frequency lanes","Trailer interchange freight"]),
  ("Keeping your tractor earning",
   ["The key to power only is the right broker relationships and steady freight. We build those relationships and plan loads ahead so your tractor keeps moving and earning.",
    "We confirm trailer interchange details before every load, so handoffs are clean and you are not stuck holding someone else's equipment problem."],
   []),
 ],
 "Owner-Operator": [
  ("Stay independent while we handle the load",
   ["As an owner-operator, your independence is the whole point. You keep your own authority and stay in full control. You approve every load and every rate before anything is booked. We simply remove the busywork.",
    "Think of us as your back office and sales team rolled into one, working to keep your truck full and your rates fair while you focus on the road."],
   ["You keep your authority and your customers","You approve every load and rate","A dedicated dispatcher who knows your truck","No long-term contract, cancel anytime"]),
  ("Where owner-operators lose money, and how we fix it",
   ["Most owner-operators are not losing money because they are bad drivers. They lose it to cheap freight, empty miles, and the hours spent on the phone with brokers instead of rolling.",
    "We attack all three: we negotiate better rates, plan lanes to cut deadhead, and take broker calls and paperwork off your plate. The result is more paid miles and fewer wasted hours."],
   []),
 ],
 "New Authority": [
  ("Your first 90 days on your own authority",
   ["Getting your own authority is a huge step, and the first three months are where most new carriers either build momentum or burn out. Brokers want packets and setups before they hand you a load, and the cheap freight is easy to fall into.",
    "We guide you through all of it, get you set up with brokers, and keep you off low-paying loads from day one so your first months actually build your business."],
   ["Broker packet and setup handled for you","Your first loads booked on good lanes","Rate negotiation so you do not start cheap","Guidance on factoring, insurance, and compliance"]),
  ("Mistakes new carriers make (that we help you avoid)",
   ["New authority carriers often make the same costly mistakes: hauling cheap freight to stay busy, working with brokers who do not pay, skipping factoring and running out of cash, and falling behind on compliance.",
    "We have seen all of it. We screen brokers, set you up with factoring so you get paid fast, and keep your filings on track, so you grow steadily instead of stalling out."],
   []),
 ],
}

SVC_ALT = {
 'reefer':'Reefer truck loading temperature-controlled freight for dispatch',
 'flatbed':'Flatbed truck ready to haul steel, lumber and machinery freight',
 'dry-van':'Dry van semi truck running freight on the highway',
 'hotshot':'Hotshot truck with gooseneck trailer ready for expedited loads',
 'power-only':'Power only semi truck tractor ready to pull a trailer',
 'owner-operator':'Owner-operator truck driver managing loads with Loadboot dispatch',
 'new-authority':'New authority truck driver getting set up with Loadboot dispatch'}
SVC_CAP = {
 'reefer':'Temperature-controlled freight &mdash; booked and protected.',
 'flatbed':'Steel, lumber and machinery &mdash; freight that pays.',
 'dry-van':'Steady van freight that keeps your truck moving.',
 'hotshot':'Expedited hotshot loads, dispatched fast.',
 'power-only':'Power-only freight &mdash; we keep your tractor earning.',
 'owner-operator':'A dedicated dispatcher in your corner.',
 'new-authority':'New authority? We get you loaded fast.'}
def svc_page(fname,name,title,desc,h1,lead,intro,included,why,faqs):
    nl = name.lower()
    CHK = '&#9989;'; BOX = '&#128230;'
    introp = ''.join('<p>%s</p>' % p for p in intro)
    body = svc_hero(h1,lead)
    # Equipment banner photo (keyword-rich alt text) right under the hero
    ib = fname.replace('-dispatch.html','')
    if ib in SVC_ALT:
        body += ('<section style="padding-top:0"><div class="wrap"><figure class="svc-photo reveal">'
                 '<img src="%s.webp" alt="%s" width="1280" height="460" loading="lazy" decoding="async" '
                 'onerror="this.closest(&quot;.svc-photo&quot;).style.display=&quot;none&quot;">'
                 '<figcaption>%s</figcaption></figure></div></section>') % (ib, SVC_ALT[ib], SVC_CAP[ib])
    # Intro
    body += '<section><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">%s Dispatch</div><h2>Higher-paying %s freight, handled end to end</h2></div><div class="prose reveal" style="max-width:820px">%s</div></div></section>' % (name, nl, introp)
    # What is included -> icon cards
    inc_cards = ''.join('<div class="card reveal"><div class="icon">%s</div><p>%s</p></div>' % (CHK, x) for x in included)
    body += '<section class="bg-soft"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">What you get</div><h2>Everything in our %s dispatch service</h2></div><div class="grid g3">%s</div></div></section>' % (nl, inc_cards)
    # Why -> navy highlight panel
    body += '<section><div class="wrap"><div class="promise reveal"><div class="glow"></div><div class="eyebrow" style="color:#93c5fd">Why Loadboot</div><h2>Why %s carriers choose us</h2><p>%s</p></div></div></section>' % (nl, why)
    # EXTRA unique sections (bullets -> cards, else prose)
    for i,(st,sp,sb) in enumerate(EXTRA.get(name,[])):
        ps = ''.join('<p>%s</p>' % x for x in sp)
        if sb:
            cards = ''.join('<div class="card reveal"><div class="icon">%s</div><p>%s</p></div>' % (BOX, x) for x in sb)
            body += '<section class="bg-soft"><div class="wrap"><div class="sec-head reveal"><h2>%s</h2></div><div class="prose reveal" style="max-width:820px;margin-bottom:34px">%s</div><div class="grid g3">%s</div></div></section>' % (st, ps, cards)
        else:
            body += '<section><div class="wrap prose reveal" style="max-width:820px"><h2>%s</h2>%s</div></section>' % (st, ps)
    # Tailored process steps
    steps = [('1','Free consultation','Tell us about your truck, your authority, and the lanes you want to run.'),
             ('2','We set you up','We handle broker setup and learn your equipment, preferences, and target rates.'),
             ('3','We book &amp; negotiate','We find %s loads, negotiate the rate, and send the details for your approval.' % nl),
             ('4','You drive, we handle the rest','You stay loaded and paid; we manage the brokers and the paperwork.')]
    sc = ''.join('<div class="step reveal"><div class="num">%s</div><h3>%s</h3><p>%s</p></div>' % s for s in steps)
    body += '<section><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">How it works</div><h2>How we keep your %s truck loaded</h2></div><div class="grid g4">%s</div></div></section>' % (nl, sc)
    # Stats band for visual weight
    body += STATS
    fhtml,fsch = faq_block(faqs)
    body += fhtml + final_cta()
    bc = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"https://loadboot.com/"},{"@type":"ListItem","position":2,"name":"Services","item":"https://loadboot.com/services.html"},{"@type":"ListItem","position":3,"name":"%s Dispatch","item":"https://loadboot.com/%s"}]}</script>' % (name, fname)
    ssch = ('<script type="application/ld+json">{"@context":"https://schema.org","@type":"Service",'
            '"serviceType":"%s truck dispatching","name":"%s",'
            '"provider":{"@type":"Organization","name":"Loadboot","url":"https://loadboot.com/"},'
            '"areaServed":{"@type":"Country","name":"United States"},"url":"https://loadboot.com/%s"}</script>') % (name, h1.replace('"', "'"), fname)
    page(fname,title,desc,'services.html',body,fsch+bc+ssch)

svc_page('reefer-dispatch.html','Reefer','Reefer Dispatch Services for Owner-Operators | Loadboot',
 'Reefer truck dispatch for owner-operators &amp; fleets. We book high-paying temperature-controlled loads, negotiate rates, and handle the paperwork. Flat 5%.',
 'Reefer Dispatch Services Across the USA','Higher-paying temperature-controlled freight, booked and managed for you &mdash; so your reefer stays loaded and your margins stay protected.',
 ['Reefer freight pays well, but it comes with pressure &mdash; tight delivery windows, temperature requirements, and brokers who push for cheap rates. Our dispatchers know the reefer market and fight for what your run is actually worth.',
  'We book produce, frozen, dairy, and pharma loads on the lanes you want to run, confirm temperature and appointment details up front, and keep you moving without the cheap-freight headaches.'],
 ['Booking high-paying reefer loads on your preferred lanes','Rate negotiation on every load confirmation','Temperature, appointment, and detention details confirmed up front','Broker communication, setup, and check calls handled','Reduced deadhead through smart lane planning','Detention &amp; TONU claim help when appointments run long'],
 'Reefer carriers lose money to cheap freight and long detention more than almost anyone. We protect your time and your rate &mdash; turning down low-ball loads, documenting detention, and keeping your reefer on profitable lanes. You get a dedicated dispatcher who treats your truck like their own business.',
 [('Do you book produce and frozen reefer loads?','Yes &mdash; produce, frozen, dairy, and other temperature-controlled freight across the USA.'),
  ('How do you handle detention on reefer loads?','We confirm appointment windows up front and help document and claim detention and TONU when shippers or receivers run long.'),
  ('What does reefer dispatch cost?','A flat 5% of the gross on loads we book, with no contract &mdash; you only pay when you earn.')])

svc_page('flatbed-dispatch.html','Flatbed','Flatbed Dispatch Services for Owner-Operators | Loadboot',
 'Flatbed and step-deck truck dispatch. We book high-paying steel, lumber, and machinery loads, negotiate rates, and handle brokers. Flat 5%, no contracts.',
 'Flatbed Dispatch Services Across the USA','Steel, lumber, machinery, and oversized freight &mdash; we find the high-paying flatbed loads and handle the brokers, so you focus on securing and driving.',
 ['Flatbed is skilled work, and it should pay like it. Too many flatbed operators end up hauling cheap freight because they don\'t have time to work the phones. We do that for you.',
  'Our dispatchers book steel, lumber, building materials, and machinery on lanes that fit your truck, confirm securement and permit details, and negotiate every rate so your skill is rewarded.'],
 ['High-paying flatbed and step-deck load booking','Rate negotiation on every confirmation','Permit and oversize/overweight coordination support','Securement and tarping details confirmed with the broker','Broker setup, calls, and paperwork handled','Lane planning to cut empty miles'],
 'Flatbed carriers bring specialized skill, and brokers know it &mdash; but only if someone negotiates on your behalf. We push for premium flatbed rates, coordinate permits on oversized loads, and keep your trailer full on the lanes you want. A dedicated dispatcher in your corner, not a call center.',
 [('Do you dispatch step deck and oversize loads?','Yes &mdash; flatbed, step deck, and oversize/overweight freight, with permit coordination support.'),
  ('Can you keep me loaded on regional flatbed lanes?','Absolutely. Tell us your home base and preferred lanes and we plan loads to keep you regional if that\'s what you want.'),
  ('What does flatbed dispatch cost?','A flat 5% of gross on loads we book, no contract, cancel anytime.')])

svc_page('dry-van-dispatch.html','Dry Van','Dry Van Dispatch Services for Owner-Operators | Loadboot',
 'Dry van truck dispatch for owner-operators and fleets. Consistent, well-paying van freight, rate negotiation, and back-office support. Flat 5%, no contracts.',
 'Dry Van Dispatch Services Across the USA','Steady, consistent van freight that keeps your truck moving &mdash; booked, negotiated, and managed by a dedicated dispatcher.',
 ['Dry van is the backbone of freight, but consistency is everything. The difference between a good week and a bad one is having someone working loads ahead of you. That\'s what we do.',
  'We book reliable van freight on your preferred lanes, negotiate every rate, and keep your schedule full &mdash; so you\'re never sitting empty waiting for the next load.'],
 ['Consistent dry van load booking on your lanes','Rate negotiation on every confirmation','Back-to-back load planning to cut downtime','Broker setup, check calls, and paperwork handled','Reduced deadhead and smarter routing','Document management &mdash; rate cons, BOLs, PODs'],
 'Van carriers win on consistency and utilization. We keep your truck loaded back-to-back, negotiate fair rates on steady freight, and handle the broker relationships so your week runs smooth. You drive; we keep the loads coming.',
 [('Can you keep me running consistent lanes?','Yes &mdash; tell us your home base and preferred lanes and we plan loads to keep you consistent and reduce empty miles.'),
  ('Do you work with one-truck owner-operators?','Definitely. Most of our carriers are owner-operators running a single truck.'),
  ('What does dry van dispatch cost?','A flat 5% of gross on loads we book, no contract.')])

svc_page('hotshot-dispatch.html','Hotshot','Hotshot Dispatch Services | Loadboot',
 'Hotshot truck dispatch for owner-operators running class 3-5 trucks and goosenecks. Expedited loads, rate negotiation, broker handling. Flat 5%, no contracts.',
 'Hotshot Dispatch Services Across the USA','Expedited, smaller, well-paying loads for hotshot operators &mdash; we work the boards and the brokers so you keep rolling.',
 ['Hotshot is fast-moving and competitive, and the good loads go quick. You need someone watching the boards and negotiating in real time. We do exactly that for hotshot operators.',
  'We book expedited and partial loads that fit your class 3-5 truck and gooseneck or flatbed trailer, confirm weights and dimensions, and negotiate rates that make the run worth it.'],
 ['Booking expedited and partial hotshot loads','Real-time rate negotiation on fast-moving freight','Weight and dimension checks before you commit','Broker setup and communication handled','Lane planning to reduce empty backhauls','Paperwork and check calls managed'],
 'Hotshot margins live and die on rate and deadhead. We chase the loads that actually pay, keep you off cheap freight, and plan backhauls so you\'re not running empty. A dispatcher who understands hotshot, not a generic desk.',
 [('Do you dispatch class 3-5 hotshot trucks?','Yes &mdash; we work with hotshot operators running gooseneck and flatbed trailers behind class 3-5 trucks.'),
  ('Can you find paying backhauls?','We plan loads to reduce empty miles and find backhauls whenever the lane allows.'),
  ('What does hotshot dispatch cost?','A flat 5% of gross on loads we book, no contract.')])

svc_page('power-only-dispatch.html','Power Only','Power Only Dispatch Services | Loadboot',
 'Power only truck dispatch. We book drop-and-hook power only freight for your tractor, negotiate rates, and handle brokers. Flat 5%, no contracts.',
 'Power Only Dispatch Services Across the USA','Flexible drop-and-hook freight for your tractor &mdash; we keep you pulling trailers and earning without the wait.',
 ['Power only gives you flexibility, but it takes the right broker relationships to stay loaded. We connect you with consistent power only freight and keep your tractor working.',
  'We book drop-and-hook and trailer-supplied loads that fit your tractor, negotiate the rate, and handle the broker setup so you stay productive.'],
 ['Booking consistent power only / drop-and-hook freight','Rate negotiation on every load','Broker setup and communication handled','Trailer interchange details confirmed up front','Lane planning to reduce empty miles','Paperwork and check calls managed'],
 'Power only carriers win on flexibility and uptime. We keep you connected to drop-and-hook freight, negotiate fair rates, and manage broker relationships so your tractor keeps earning. Straightforward dispatch, honest rates, no contracts.',
 [('What is power only dispatch?','We book loads where the trailer is supplied by the broker or shipper, so you pull with your own tractor &mdash; flexible, drop-and-hook freight.'),
  ('Can you keep my tractor consistently loaded?','Yes &mdash; we plan loads ahead and build broker relationships to keep your uptime high.'),
  ('What does power only dispatch cost?','A flat 5% of gross on loads we book, no contract.')])

svc_page('owner-operator-dispatch.html','Owner-Operator','Truck Dispatch for Owner-Operators | Loadboot',
 'Dedicated truck dispatch for owner-operators. Keep your authority, book higher-paying loads, and offload the back office. Flat 5%, no contracts, cancel anytime.',
 'Truck Dispatch for Owner-Operators','Keep your authority and your independence &mdash; we handle the loads, the brokers, and the paperwork so you can focus on driving and earning.',
 ['As an owner-operator, your time is split between driving and running a business. The hours you spend on the phone with brokers are hours you\'re not earning. We give those hours back.',
  'You keep your own authority and stay fully in control &mdash; you approve every load and every rate. We just do the heavy lifting: finding freight, negotiating, and managing the back office.'],
 ['A dedicated dispatcher who knows your truck and lanes','Higher-paying load booking and rate negotiation','You keep your authority and approve every load','Broker setup, check calls, and paperwork handled','Factoring, IFTA, and compliance help when you need it','No long-term contract &mdash; cancel anytime'],
 'Owner-operators don\'t need a boss &mdash; they need a partner who removes the busywork and protects their rate. We do exactly that, at a flat 5% with no contract, so the relationship stays honest. You stay independent; we help you earn more from every mile.',
 [('Do I keep my own authority?','Yes &mdash; you keep your authority and stay in control. You approve every load and rate before anything is booked.'),
  ('Is there a contract?','No. Cancel anytime &mdash; we earn your business load by load.'),
  ('What does dispatch cost for owner-operators?','A flat 5% of your gross on loads we book, with no hidden fees.')])

svc_page('new-authority-dispatch.html','New Authority','Dispatch for New Authority Carriers | Loadboot',
 'Dispatch for new-authority carriers. We help you get set up with brokers, book your first loads, and start earning. Flat 5%, no contracts, real guidance.',
 'Dispatch for New Authority Carriers','Just got your MC number? We help you get set up with brokers, book your first loads, and avoid the rookie mistakes that cost new carriers money.',
 ['Getting your own authority is exciting &mdash; and overwhelming. Brokers want packets, setups, and paperwork before they\'ll give you a load, and the learning curve is steep. We guide you through all of it.',
  'We handle broker setup, find loads that fit your truck, negotiate your rates, and show you how the back office works &mdash; so your first weeks on your own authority actually make money.'],
 ['Broker packet setup and onboarding handled for you','Booking your first loads on lanes you want','Rate negotiation so you don\'t start out on cheap freight','Guidance on factoring, insurance, and compliance','Help avoiding common new-authority mistakes','Flat 5%, no contract &mdash; grow at your own pace'],
 'New-authority carriers are exactly who we love to help. Big dispatchers ignore you; we don\'t. We get you set up with brokers, keep you off cheap freight from day one, and walk you through the parts of trucking nobody explains. Start strong, with a dispatcher who actually answers.',
 [('I just got my MC number &mdash; can you help?','Yes &mdash; new-authority carriers are a core part of who we serve. We handle broker setup and get you booking loads.'),
  ('Do you help with broker setup and packets?','Absolutely. We manage broker onboarding and packets so you can start hauling sooner.'),
  ('What does it cost to start?','A flat 5% of gross on loads we book, with no contract &mdash; you only pay when you earn.')])

# ---------- SERVICES HUB ----------
serv_body = svc_hero('Truck Dispatch Services','Full-service dispatch for US carriers &mdash; from booking and rate negotiation to authority setup, compliance, and claims. One partner for the whole business.')
serv_body += FREIGHT_CARDS
serv_body += '''<section><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Core Dispatch</div><h2>Everything you need to keep your truck moving</h2></div>
<div class="grid g3">
<div class="card reveal"><div class="icon">&#128269;</div><h3>Load Booking</h3><p>Consistent, well-paying loads that fit your truck and lanes.</p></div>
<div class="card reveal d1"><div class="icon">&#128172;</div><h3>Rate Negotiation</h3><p>We negotiate every rate confirmation to protect your margins.</p></div>
<div class="card reveal d2"><div class="icon">&#129309;</div><h3>Broker Communication</h3><p>Calls, packet setups, and check-ins handled for you.</p></div>
<div class="card reveal"><div class="icon">&#129517;</div><h3>Route &amp; Lane Planning</h3><p>Smart planning to reduce empty miles.</p></div>
<div class="card reveal d1"><div class="icon">&#128196;</div><h3>Document Management</h3><p>Rate cons, BOLs, and PODs &mdash; organized and on time.</p></div>
<div class="card reveal d2"><div class="icon">&#128336;</div><h3>24/7 Dispatch Support</h3><p>A dedicated dispatcher who has your back on the road.</p></div>
</div></div></section>'''
serv_body += '''<section class="bg-soft"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Back-Office &middot; Money &middot; Claims</div><h2>Everything around the load &mdash; handled for you</h2></div>
<div class="grid g4">
<div class="card reveal"><div class="icon">&#128230;</div><h3>Broker Packet Onboarding</h3><p>Get set up with brokers fast.</p></div>
<div class="card reveal d1"><div class="icon">&#128181;</div><h3>Factoring Setup</h3><p>Get paid in hours, not weeks.</p></div>
<div class="card reveal d2"><div class="icon">&#128737;</div><h3>Insurance Assistance</h3><p>Connect with trusted insurance partners.</p></div>
<div class="card reveal d3"><div class="icon">&#9981;</div><h3>IFTA &amp; Fuel Tax</h3><p>Fuel-tax paperwork off your plate.</p></div>
<div class="card reveal"><div class="icon">&#9878;</div><h3>Detention &amp; TONU Claims</h3><p>Recover the money you're owed.</p></div>
<div class="card reveal d1"><div class="icon">&#9989;</div><h3>Broker Credit Checks</h3><p>Avoid non-paying brokers.</p></div>
<div class="card reveal d2"><div class="icon">&#128202;</div><h3>Weekly Settlement Reports</h3><p>Know what you earned, by load.</p></div>
<div class="card reveal d3"><div class="icon">&#128236;</div><h3>Cargo Claim Assistance</h3><p>Help when a load goes wrong.</p></div>
</div></div></section>'''
serv_body += '''<section><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Authority &middot; Compliance &middot; Filings</div><h2>We handle the paperwork most carriers dread</h2></div>
<div class="grid g4">
<div class="card reveal"><div class="icon">&#128640;</div><h3>Authority &amp; DOT Setup</h3><p>MC number and DOT registration guidance.</p></div>
<div class="card reveal d1"><div class="icon">&#128221;</div><h3>BOC-3 Filing</h3><p>Process-agent filing, done right.</p></div>
<div class="card reveal d2"><div class="icon">&#128197;</div><h3>UCR Registration</h3><p>Stay current, no missed deadlines.</p></div>
<div class="card reveal d3"><div class="icon">&#129354;</div><h3>IRP &amp; Plates</h3><p>Apportioned plate help.</p></div>
<div class="card reveal"><div class="icon">&#129534;</div><h3>Form 2290 (HVUT)</h3><p>Heavy-vehicle use tax filed for you.</p></div>
<div class="card reveal d1"><div class="icon">&#129514;</div><h3>Drug &amp; Alcohol Consortium</h3><p>Enrollment and management.</p></div>
<div class="card reveal d2"><div class="icon">&#128225;</div><h3>ELD Setup</h3><p>Get your ELD set up and running.</p></div>
<div class="card reveal d3"><div class="icon">&#128203;</div><h3>DOT Compliance &amp; Audits</h3><p>Stay audit-ready without stress.</p></div>
</div></div></section>'''
serv_hub_faq_html, serv_hub_faq_schema = faq_block(home_faqs)
serv_body += COMPARE + HOW + serv_hub_faq_html + final_cta()
page('services.html','Truck Dispatch Services (Full List) | Loadboot',
     'Full-service truck dispatch: load booking, rate negotiation, authority setup, IFTA, factoring, compliance, and freight-specific dispatch. Flat 5%, no contracts.',
     'services.html', serv_body, serv_hub_faq_schema)

# ---------- ABOUT ----------
about_body = svc_hero('About Loadboot','We started Loadboot to give carriers what most dispatchers don\'t: honesty, real attention, and a partner who actually picks up the phone.')
about_body += '''<section><div class="wrap prose reveal"><div class="eyebrow">Our Story</div>
<p>Loadboot was built on a simple belief &mdash; that the people who keep America moving deserve a dispatcher who treats their truck like a business, not a number. Too many carriers get locked into contracts, handed cheap freight, and left on hold when they need answers. We do the opposite.</p>
<h2>What we stand for</h2>
<p>Every decision we make comes back to the carrier. We negotiate hard on your rates, we tell you the truth even when it\'s not what you want to hear, and we never lock you into a contract. If we\'re not adding value, you can walk &mdash; and that keeps us honest.</p>
<h2>How we work</h2>
<p>You keep your own authority and approve every load. We handle the rest: finding freight, negotiating rates, talking to brokers, managing paperwork, and helping with the back-office pieces &mdash; factoring, IFTA, compliance, and claims. One partner, the whole business.</p>
<h2>Who we help</h2>
<p>We work with owner-operators, small and growing fleets, independent carriers, and especially new-authority carriers who need a guide through their first months. Wherever you are in your journey, we meet you there.</p>
<p style="font-weight:600;color:var(--navy)">We\'re a growing dispatch service &mdash; and we\'d be glad to have you grow with us.</p></div></section>'''
about_body += STATS + WHYUS + PROMISE + final_cta()
page('about.html','About Loadboot | Honest Truck Dispatch for Carriers',
     'Loadboot is a US truck dispatch service built on honesty and real attention. We help owner-operators and new-authority carriers earn more with no contracts.',
     'about.html', about_body)

# ---------- CONTACT ----------
contact_body = svc_hero('Get Started with Loadboot','Create your carrier profile in 2 minutes, request a rate quote, or just send us a message &mdash; flat 5%, no contracts, cancel anytime.')
contact_body += """<section class="bg-soft"><div class="wrap" style="max-width:820px">
<form class="quote-wrap reveal" id="qfForm" name="quote" method="POST" data-netlify="true" data-netlify-honeypot="bot-field">
<input type="hidden" name="form-name" value="quote"><p hidden><label>Skip: <input name="bot-field"></label></p>
<h3 style="margin-bottom:6px">How can we help?</h3>
<p id="formIntro" style="color:var(--muted);margin-bottom:18px">Tell us about your operation and a dispatcher gets you set up.</p>
<div class="intent-row">
<input type="radio" id="iAcct" name="intent" value="Create carrier account" checked onchange="qfIntent()"><label for="iAcct"><span class="d"></span> Create account</label>
<input type="radio" id="iQuote" name="intent" value="Get a rate quote" onchange="qfIntent()"><label for="iQuote"><span class="d"></span> Get a quote</label>
<input type="radio" id="iAsk" name="intent" value="General question / message" onchange="qfIntent()"><label for="iAsk"><span class="d"></span> Ask a question</label>
</div>
<div id="acctFields">
<h3 style="margin:26px 0 16px">Your business</h3>
<div class="form-grid">
<div class="field full"><label>Company / business name</label><input type="text" name="company" placeholder="Your trucking company"></div>
<div class="field"><label>MC number</label><input type="text" name="mc" placeholder="MC-123456"></div>
<div class="field"><label>DOT number</label><input type="text" name="dot" placeholder="DOT-1234567"></div>
<div class="field full"><label>Authority status</label><select name="authority"><option value="">Select&hellip;</option><option>Active / established authority</option><option>New authority</option><option>No authority yet</option></select></div>
</div>
<h3 style="margin:26px 0 16px">Equipment &amp; lanes</h3>
<div class="form-grid">
<div class="field"><label>Equipment type</label><select name="equipment"><option value="">Select&hellip;</option><option>Dry Van</option><option>Reefer</option><option>Flatbed</option><option>Step Deck</option><option>Hotshot</option><option>Power Only</option><option>Box Truck / Expedited</option></select></div>
<div class="field"><label>Number of trucks</label><select name="trucks"><option value="">Select&hellip;</option><option>1</option><option>2-5</option><option>6-20</option><option>20+</option></select></div>
<div class="field full"><label>Preferred lanes / home base</label><input type="text" name="lanes" placeholder="e.g. Dallas, TX &mdash; Southeast lanes"></div>
<div class="field"><label>Insurance in place?</label><select name="insurance"><option value="">Select&hellip;</option><option>Yes</option><option>Not yet &mdash; need help</option></select></div>
<div class="field"><label>Factoring?</label><select name="factoring"><option value="">Select&hellip;</option><option>Yes, already factoring</option><option>No &mdash; need help</option><option>Not sure</option></select></div>
</div>
</div>
<h3 style="margin:26px 0 16px">Your details</h3>
<div class="form-grid">
<div class="field"><label>Your name</label><input type="text" name="name" required placeholder="Full name"></div>
<div class="field"><label>Phone</label><input type="tel" name="phone" placeholder="(555) 555-5555"></div>
<div class="field full"><label>Email</label><input type="email" name="email" required placeholder="you@email.com"></div>
<div class="field full"><label id="msgLabel">Anything else? <span style="color:var(--muted);font-weight:500">(optional)</span></label><textarea name="message" placeholder="Tell us about a specific load, lane, or question &mdash; or anything you'd like us to know."></textarea></div>
</div>
<button class="btn btn-primary" id="submitBtn" style="width:100%;justify-content:center;margin-top:24px">Create My Carrier Account &rarr;</button>
<p style="text-align:center;margin-top:14px;font-size:.9rem">Free to start. No contracts. A dispatcher responds within 15 minutes during business hours.</p></form>
<div class="cinfo reveal">
<div class="ci"><div class="icon">&#128236;</div><div><b>Email us</b><span>General &mdash; hello@loadboot.com<br>Dispatch &mdash; dispatch@loadboot.com<br>Billing &mdash; billing@loadboot.com</span></div></div>
<div class="ci"><div class="icon">&#128336;</div><div><b>Hours</b><span>Mon&ndash;Fri 7am&ndash;9pm CT &middot; Sat 9&ndash;5</span></div></div>
<div class="ci"><div class="icon">&#9889;</div><div><b>Fast response</b><span>Most messages answered in 15 min</span></div></div>
</div>
</div></section>
<script>
function qfIntent(){var sel=document.querySelector('input[name=intent]:checked');if(!sel)return;var v=sel.value;var isAcct=v.indexOf('account')>-1;var isQuote=v.indexOf('quote')>-1;
var acct=document.getElementById('acctFields');if(acct)acct.style.display=isAcct?'':'none';
['company','authority','equipment'].forEach(function(n){var el=document.querySelector('[name='+n+']');if(el)el.required=isAcct;});
var msg=document.querySelector('[name=message]');var ml=document.getElementById('msgLabel');
if(msg){msg.required=(!isAcct&&!isQuote);}
if(ml){ml.innerHTML=(!isAcct&&!isQuote)?'Your message':((isQuote?'Load / lane details ':'Anything else? ')+'<span style=\\'color:var(--muted);font-weight:500\\'>(optional)</span>');}
var b=document.getElementById('submitBtn');if(b)b.innerHTML=(isAcct?'Create My Carrier Account':(isQuote?'Get My Rate Quote':'Send Message'))+' &rarr;';
var t=document.getElementById('formIntro');if(t)t.textContent=isAcct?'Tell us about your operation and a dispatcher gets you set up.':(isQuote?'Tell us about a load or lane and we will send you a rate.':'Send us a message and we will get right back to you.');}
(function(){if(location.hash==='#quote'){var q=document.getElementById('iQuote');if(q){q.checked=true;}}qfIntent();
var f=document.getElementById('qfForm');if(!f)return;f.addEventListener('submit',function(e){e.preventDefault();var d=new URLSearchParams(new FormData(f)).toString();fetch('/',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:d}).then(function(){f.innerHTML='<div style=\\'text-align:center;padding:40px\\'><div style=\\'font-size:2.6rem;color:#16a34a\\'>&#10003;</div><h3 style=\\'margin:12px 0\\'>Got it &mdash; thanks!</h3><p>A Loadboot dispatcher will reach out within 15 minutes during business hours.</p></div>';}).catch(function(){f.innerHTML='<p style=\\'text-align:center\\'>Something went wrong &mdash; please email hello@loadboot.com and we will get right back to you.</p>';});});})();
</script>"""
page('contact.html','Get Started, Get a Quote or Contact Us | Loadboot','Create your carrier profile, request a rate quote, or send Loadboot a message. Flat 5%, no contracts. A dispatcher responds within 15 minutes.','contact.html', contact_body)

# ---------- PRICING ----------
pr_body = svc_hero('Simple, Honest Dispatch Pricing','One flat rate, no contracts, no hidden fees. You only pay when we actually book you a load &mdash; so our goals and yours are always the same.')
pr_body += '''<section><div class="wrap"><div class="promise reveal"><div class="glow"></div><div class="eyebrow" style="color:#93c5fd">Our Rate</div><h2>A flat 5% of gross &mdash; that's it</h2><p>No setup fees. No monthly minimums. No long-term contract. We charge 5% of the gross on the loads we book for you, and nothing on the weeks you don't run. If we don't add value, you can walk away anytime.</p><div class="reply">&#9989; You only pay when you earn</div></div></div></section>'''
pr_inc = ['Dedicated dispatcher for your truck','Higher-paying load booking','Rate negotiation on every load','Broker setup and communication','Route and lane planning','Document and paperwork management','24/7 dispatch support','Help with factoring, IFTA, and compliance']
pr_cards = ''.join('<div class="card reveal"><div class="icon">&#9989;</div><p>%s</p></div>' % x for x in pr_inc)
pr_body += '<section class="bg-soft"><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">All included</div><h2>Everything is included in your 5%%</h2></div><div class="grid g4">%s</div></div></section>' % pr_cards
pr_body += COMPARE
pr_faq = [('Are there any setup or hidden fees?','No. There are no setup fees, monthly fees, or hidden charges. You pay a flat 5% only on the loads we book.'),
('What if I have a slow week?','You pay nothing on loads you don\'t run. We only earn when we book freight for you.'),
('Is there a contract?','No long-term contract &mdash; cancel anytime. We earn your business load by load.'),
('How is the 5% calculated?','It\'s 5% of the gross (line-haul) on each load we book and you approve.'),
('Do you work with new-authority carriers?','Yes &mdash; new authority carriers are a core part of who we help.')]
pf_html, pf_sch = faq_block(pr_faq)
pr_body += pf_html + final_cta()
page('pricing.html','Dispatch Pricing &mdash; Flat 5%, No Contracts | Loadboot',
     'Loadboot truck dispatch pricing: a flat 5% of gross, no setup fees, no monthly fees, no long-term contract. You only pay when we book your load.',
     'pricing.html', pr_body, pf_sch)

# ---------- BLOG ----------
def blog_post(fname,title,desc,excerpt,blocks):
    body = svc_hero(title, excerpt)
    inner = ''
    for b in blocks:
        inner += ('<h2>%s</h2>' % b[2:]) if b.startswith('H:') else ('<p>%s</p>' % b)
    body += '<section><div class="wrap prose reveal" style="max-width:780px">%s</div></section>' % inner
    body += final_cta()
    sch = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"%s","author":{"@type":"Organization","name":"Loadboot"},"publisher":{"@type":"Organization","name":"Loadboot"}}</script>' % title.replace('"',"'")
    page(fname,title,desc,'blog.html',body,sch)

BLOGPOSTS = [
 ('how-much-does-a-truck-dispatcher-cost.html',
  'How Much Does a Truck Dispatcher Cost in 2026?',
  'Truck dispatcher pricing explained: percentage vs flat fee, what 5% really gets you, and how the right dispatcher pays for itself.',
  'A clear breakdown of what truck dispatchers charge, the two common pricing models, and how to tell if a dispatcher is worth the cost.',
  ['If you are an owner-operator thinking about hiring a dispatcher, the first question is always the same: what does it cost, and is it worth it? Here is a straight answer.',
   'H:The two common pricing models',
   'Most truck dispatchers charge one of two ways. The first is a percentage of your gross &mdash; usually between 3% and 10%, with 5% being the industry standard. The second is a flat weekly fee per truck, often somewhere between 150 and 250 dollars per week.',
   'The percentage model is the most common and, for most owner-operators, the fairest. You only pay when you actually book and run a load, so the dispatcher only earns when you earn. That keeps your incentives aligned.',
   'H:What you should get for that money',
   'A good dispatcher does far more than forward you loads. For your 5% you should expect load booking on your preferred lanes, hard rate negotiation on every load, broker setup and communication, paperwork and rate confirmations handled, and lane planning that cuts your empty miles.',
   'If a dispatcher is just sending you cheap loads off the board with no negotiation, you are overpaying at any price.',
   'H:How a dispatcher pays for itself',
   'Say you run a 3,000 dollar load. A 5% fee is 150 dollars. If your dispatcher negotiates even 200 to 400 dollars more per load than you would have taken, and keeps you from running empty, the fee more than pays for itself &mdash; while giving you back the hours you would have spent on the phone with brokers.',
   'The real cost of dispatch is not the percentage. It is the cheap freight and empty miles you take when you are doing everything yourself.',
   'H:The bottom line',
   'Expect to pay around 5% of gross for quality truck dispatch, with no contract and no hidden fees. The right dispatcher should make you more than they cost &mdash; if they do not, you should be able to walk away anytime.']),
 ('truck-dispatcher-vs-freight-broker.html',
  'Truck Dispatcher vs Freight Broker vs Factoring',
  'Dispatcher, broker or factoring? Who each represents, what they legally can and cannot do, how the money flows, and which a carrier needs.',
  'Three roles, three different jobs. Who represents whom, how the money actually flows, and which ones you really need as a carrier.',
  ['New carriers often confuse dispatchers and freight brokers. They play very different roles, and understanding the difference protects you.',
   'H:Who they represent',
   'A freight broker represents the shipper. Their job is to find a truck for a load, and they are paid by the shipper, keeping a margin. A truck dispatcher represents the carrier &mdash; you. A dispatcher works on your behalf to find loads, negotiate your rate, and keep your truck moving.',
   'H:Authority and the law',
   'Freight brokers must hold a broker authority (an MC number for brokerage) and carry a surety bond. Dispatchers generally do not need broker authority, because they work for the carrier rather than the shipper. This is also why a dispatcher should never deal directly with shippers as if brokering &mdash; that crosses into brokerage.',
   'H:What this means for you',
   'When you work with a dispatcher, you keep your own authority and stay in control. You approve every load and rate. The dispatcher simply does the legwork &mdash; searching, negotiating, and handling brokers &mdash; so you can focus on driving.',
   'A broker is who your dispatcher negotiates with to get you a load. A dispatcher is who works for you to get the best deal from that broker.',
   'H:Which one do you need?',
   'If you are a carrier with your own authority who wants help finding and negotiating loads without giving up control, you need a dispatcher. Loadboot is a dispatch service &mdash; we represent you, the carrier, and we work to keep your truck loaded at the best possible rate.']),
 ('how-to-get-loads-with-new-authority.html',
  'How to Get Loads With a New Authority: A Carrier\'s Guide',
  'Just got your MC number? Here is how to get set up with brokers, find your first loads, and avoid the mistakes that sink new carriers.',
  'A practical guide for brand-new carriers on landing your first loads and building momentum in your first 90 days.',
  ['Getting your own authority is exciting, but the first few months are the hardest. Brokers want paperwork before they trust you, and cheap freight is everywhere. Here is how to start strong.',
   'H:1. Get your paperwork ready',
   'Before a broker gives you a load, they need your authority, insurance certificate, W-9, and a signed carrier packet. Have these ready as a single PDF so you can get set up with brokers in minutes, not days.',
   'H:2. Set up with brokers and load boards',
   'Get on the main load boards and start completing broker setups. Every broker you set up with is another source of freight. This is tedious work &mdash; which is exactly what a dispatcher handles for you.',
   'H:3. Do not chase the cheapest freight',
   'New carriers often grab any load to stay busy. That is how you end up running below your cost per mile. Know your numbers, and turn down freight that does not pay. One good load beats two cheap ones.',
   'H:4. Get factoring in place',
   'Brokers can take 30 to 45 days to pay. Without factoring, a new carrier can run out of cash fast. Factoring gets you paid in a day or two for a small fee &mdash; often worth it in your early months.',
   'H:5. Watch out for non-paying brokers',
   'Always check a broker\'s credit and reputation before hauling. A load that never pays is worse than no load at all.',
   'H:The shortcut',
   'All of this &mdash; broker setup, finding good loads, negotiating rates, and avoiding bad brokers &mdash; is exactly what a dispatcher does. If you would rather drive than spend your first months learning the back office the hard way, a dispatch service like Loadboot gets you set up and loaded from day one.']),
 ('owner-operator-dispatch-service-guide.html',
  'Owner-Operator Dispatch Service: The Complete Guide (2026)',
  'What an owner-operator dispatch service does, what it costs, how it works day to day, and how to choose one &mdash; a complete guide for single-truck operators.',
  'What a dispatch service does for a one-truck operation, what it costs, whether new authority needs one, and how to choose a good one.',
  ['For a single-truck owner-operator, a dispatch service is your back office &mdash; it finds, negotiates and books your freight so you can focus on driving, while you keep your authority and approve every load.']),
]
PREMIUM_ARTICLES={'how-much-does-a-truck-dispatcher-cost.html','truck-dispatcher-vs-freight-broker.html','owner-operator-dispatch-service-guide.html'}
for fn,t,d,ex,bl in BLOGPOSTS:
    if fn in PREMIUM_ARTICLES:
        continue
    blog_post(fn,t,d,ex,bl)

# ---------- PREMIUM LONG-FORM ARTICLE SYSTEM ----------
def svc_banner(t,s,btn,href):
    return ('<div class="svc-banner"><div><div class="sb-t">'+t+'</div><div class="sb-s">'+s
            +'</div></div><a class="sb-btn" href="'+href+'">'+btn+'</a></div>')

def rich_article(fname,title,desc,eyebrow,h1,deck,read_min,hero,hero_alt,toc,body_html,faqs,feat_svg=''):
    e=lambda s:s.replace('"',"'")
    crumb='<div class="wrap"><nav class="crumbs"><a href="index.html">Home</a> &rsaquo; <a href="blog.html">Blog</a> &rsaquo; '+h1+'</nav></div>'
    herob=('<header class="art-hero"><div class="wrap"><div class="art-eyebrow">'+eyebrow+'</div><h1>'+h1
           +'</h1><p class="art-sub">'+deck+'</p><div class="art-meta"><span>By Loadboot Dispatch Team</span>'
           '<span>&middot; Updated June 2026</span><span>&middot; '+str(read_min)+' min read</span></div></div></header>')
    # Only reference the hero photo if the file is actually present (else keep the gradient SVG).
    hero_img=('<img src="'+hero+'" alt="'+hero_alt+'" width="1200" height="630" decoding="async">') if asset_exists(hero) else ''
    feat='<div class="wrap"><figure class="art-feat">'+feat_svg+hero_img+'</figure></div>'
    toch='<aside class="art-toc"><div class="tt">In this guide</div>'+''.join('<a href="#'+i+'">'+l+'</a>' for i,l in toc)+'</aside>'
    author=('<div class="wrap"><div class="art-author"><div class="av">LB</div><div><b>Loadboot Dispatch Team</b>'
            '<div style="color:var(--muted);font-size:.92rem;margin-top:3px">Truck dispatchers who book, negotiate, and '
            'manage freight for owner-operators and fleets across the U.S. &mdash; flat 5%, no contracts.</div></div></div></div>')
    fhtml,fsch=faq_block(faqs)
    body=crumb+herob+feat+'<div class="wrap art-grid">'+toch+'<div class="art-body">'+body_html+'</div></div>'+author+fhtml+final_cta()
    art=('<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"'+e(h1)
         +'","description":"'+e(desc)+'","image":"https://loadboot.com/'+(hero if asset_exists(hero) else 'icon-512.png')+'","author":{"@type":"Organization","name":"Loadboot"},'
         '"publisher":{"@type":"Organization","name":"Loadboot","logo":{"@type":"ImageObject","url":"https://loadboot.com/icon-512.png"}},'
         '"datePublished":"2026-06-27","dateModified":"2026-06-27"}</script>')
    bcr=('<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":'
         '[{"@type":"ListItem","position":1,"name":"Home","item":"https://loadboot.com/"},'
         '{"@type":"ListItem","position":2,"name":"Blog","item":"https://loadboot.com/blog.html"},'
         '{"@type":"ListItem","position":3,"name":"'+e(h1)+'","item":"https://loadboot.com/'+fname+'"}]}</script>')
    page(fname,title,desc,'blog.html',body,art+bcr+fsch)

A1_SVG=('<figure class="art-fig"><svg viewBox="0 0 600 248" width="100%" role="img" '
 'aria-label="On a 3000 dollar load you keep 2850 dollars after a 5 percent fee, versus 2600 dollars booking cheap freight yourself">'
 '<text x="0" y="22" font-family="Manrope,Arial" font-weight="800" font-size="19" fill="#0F172A">The 5% math on a $3,000 load</text>'
 '<text x="0" y="70" font-family="Inter,Arial" font-size="13" fill="#64748B">Booking cheap freight yourself</text>'
 '<rect x="0" y="80" width="560" height="30" rx="6" fill="#eef2f7"/>'
 '<rect x="0" y="80" width="407" height="30" rx="6" fill="#94a3b8"/>'
 '<text x="418" y="100" font-family="Manrope,Arial" font-weight="800" font-size="15" fill="#0F172A">$2,600</text>'
 '<text x="0" y="148" font-family="Inter,Arial" font-size="13" fill="#64748B">With Loadboot (after the 5% fee)</text>'
 '<rect x="0" y="158" width="560" height="30" rx="6" fill="#eff6ff"/>'
 '<rect x="0" y="158" width="446" height="30" rx="6" fill="#2563EB"/>'
 '<text x="457" y="178" font-family="Manrope,Arial" font-weight="800" font-size="15" fill="#0F172A">$2,850</text>'
 '<text x="0" y="226" font-family="Inter,Arial" font-size="13" font-weight="700" fill="#F97316">'
 '+$250 in your pocket &#8212; and hours of broker calls off your plate.</text></svg>'
 '<figcaption>Example: a dispatcher books and negotiates a $3,000 load; after the $150 (5%) fee you keep $2,850 &mdash; '
 'more than the $2,600 cheap load you would have grabbed yourself.</figcaption></figure>')

A1_BODY=(
'<h2 id="quick-answer">Quick answer: what does a truck dispatcher cost?</h2>'
'<p>Most truck dispatchers in the U.S. charge <b>3% to 10% of your gross revenue</b>, and <b>5% is the industry standard</b>. '
'The other common model is a <b>flat weekly fee</b>, usually <b>$150&ndash;$250 per truck, per week</b>. At Loadboot it&rsquo;s a '
'<a href="pricing.html">flat 5% with no contracts</a> &mdash; you only pay when we actually book and run a load for you.</p>'
'<div class="callout cl-info"><span class="ic">&#128161;</span><div>On a $3,000 load, a 5% dispatch fee is <b>$150</b>. '
'The number that actually matters isn&rsquo;t the percentage &mdash; it&rsquo;s whether your dispatcher books better-paying loads '
'and cuts your empty miles by <em>more</em> than they cost. A good one should.</div></div>'
'<div class="statrow"><div class="statcard"><div class="n">5%</div><div class="l">Industry-standard fee</div></div>'
'<div class="statcard"><div class="n">$150&ndash;$250</div><div class="l">Typical flat weekly fee</div></div>'
'<div class="statcard"><div class="n">$0</div><div class="l">What you pay if we don&rsquo;t book you</div></div></div>'

'<h2 id="models">The two pricing models, explained</h2>'
'<p>Almost every dispatcher charges one of two ways. Understanding both helps you spot a fair deal &mdash; and a bad one.</p>'
'<table class="cmp"><thead><tr><th>&nbsp;</th><th>Percentage (e.g., 5%)</th><th>Flat weekly fee</th></tr></thead><tbody>'
'<tr><td>How you pay</td><td>A % of your gross on each booked load</td><td>A fixed $ amount per truck, per week</td></tr>'
'<tr><td>Best for</td><td>Most owner-operators &amp; small fleets</td><td>High-revenue trucks running steady, heavy miles</td></tr>'
'<tr><td>Slow week</td><td>You pay little or nothing</td><td>You pay the full fee regardless</td></tr>'
'<tr><td>Incentive</td><td>Aligned &mdash; they earn more when you earn more</td><td>Neutral &mdash; same fee no matter the rate</td></tr>'
'</tbody></table>'
'<p>For most carriers the <b>percentage model is the fairest</b>, because the dispatcher only earns when you do &mdash; so they&rsquo;re '
'motivated to fight for higher rates, not just fill your calendar. A flat fee can work out cheaper <em>only</em> if you run very high '
'gross revenue every single week without fail.</p>'

'<h2 id="included">What your fee should actually cover</h2>'
'<p>A real dispatch service does far more than forward you loads off a board. For your 5% you should expect:</p>'
'<ul>'
'<li><b>Load booking</b> on the lanes and equipment you actually want to run</li>'
'<li><b>Rate negotiation</b> on every load &mdash; not just accepting the first offer</li>'
'<li><b>Broker setup &amp; credit checks</b> so you don&rsquo;t haul for non-paying brokers</li>'
'<li><b>Paperwork &amp; rate confirmations</b> handled for you</li>'
'<li><b>Deadhead &amp; lane planning</b> to cut your empty miles</li>'
'<li><b>Detention &amp; TONU help</b> when appointments run long</li>'
'</ul>'
'<div class="callout cl-warn"><span class="ic">&#9888;</span><div>If a dispatcher just forwards cheap loads with no negotiation, '
'you&rsquo;re overpaying at <em>any</em> price. <b>Booking is not dispatching.</b></div></div>'
+svc_banner('Flat 5%. No contracts. You keep the rest.',
  'See exactly what our dispatch service includes and what you pay &mdash; no hidden fees, cancel anytime.',
  'See our pricing &rarr;','pricing.html')+

'<h2 id="roi">Does 5% actually pay for itself?</h2>'
'<p>This is the real question. The fee only matters next to what it earns you. Here&rsquo;s the simple math on a single load:</p>'
+A1_SVG+
'<p>A dispatcher who negotiates even <b>$200&ndash;$400 more per load</b> than you would have taken &mdash; and keeps you from running '
'empty between loads &mdash; covers the 5% several times over. And that&rsquo;s before you count the hours you get back instead of '
'sitting on the phone with brokers.</p>'
'<div class="pull">The real cost of dispatch isn&rsquo;t the 5%. It&rsquo;s the cheap freight and empty miles you run when you&rsquo;re doing everything yourself.</div>'
'<p>Want to see whether a specific load is even worth taking before you negotiate? Run the numbers in our '
'<a href="load-score.html">free Load Score tool</a> &mdash; it gives you a take / negotiate / pass verdict and a suggested counter-offer.</p>'
+svc_banner('Should you take this load?',
  'Use our free Load Score tool to score any offer in seconds &mdash; no signup. Get a take, negotiate, or pass verdict instantly.',
  'Try the Load Score &rarr;','load-score.html')+

'<h2 id="flat-vs-percent">Flat fee vs percentage: which is right for you?</h2>'
'<p>Choose <b>percentage</b> if you&rsquo;re an owner-operator or small fleet, your weekly revenue varies, or you want your dispatcher&rsquo;s '
'incentives tied to your own. Choose a <b>flat fee</b> only if you run consistently high gross every week and you&rsquo;ve done the math '
'showing the fixed cost works out lower. When in doubt, percentage is the safer, fairer default.</p>'

'<h2 id="red-flags">Red flags: when you&rsquo;re overpaying</h2>'
'<p>Price isn&rsquo;t the only thing that makes dispatch expensive. Watch for:</p>'
'<ul>'
'<li><b>Long contracts</b> or cancellation penalties &mdash; good dispatchers earn your business load by load</li>'
'<li><b>Upfront or setup fees</b> before they&rsquo;ve booked you anything</li>'
'<li><b>Forced factoring</b> you didn&rsquo;t choose</li>'
'<li><b>No rate transparency</b> &mdash; you should see and approve every rate</li>'
'<li><b>Dealing directly with shippers</b> as if brokering (that crosses into illegal territory for a dispatcher)</li>'
'</ul>'
'<div class="callout cl-tip"><span class="ic">&#10003;</span><div>A fair dispatch deal looks like this: a flat percentage, '
'no contract, full rate transparency, and <b>you approve every load</b>. If you can&rsquo;t walk away anytime, that&rsquo;s a red flag.</div></div>'
'<h2 id="how-works">How dispatch actually works, step by step</h2>'
'<p>Wondering what you&rsquo;re paying for day to day? Here&rsquo;s the loop a good dispatcher runs for every load you haul:</p>'
'<div class="art-steps">'
'<div class="art-step"><div class="sn">1</div><b>Find &amp; vet</b><span>We search the boards and our broker network for loads on your lanes, then credit-check the broker before anything moves.</span></div>'
'<div class="art-step"><div class="sn">2</div><b>Negotiate</b><span>We push for the highest rate the lane will bear &mdash; you see and approve the number before we commit.</span></div>'
'<div class="art-step"><div class="sn">3</div><b>Book &amp; paperwork</b><span>We lock the load, handle the rate confirmation and setup packet, and send you the details.</span></div>'
'<div class="art-step"><div class="sn">4</div><b>Plan the next load</b><span>While you roll, we line up your next load to cut deadhead and keep your wheels earning.</span></div>'
'</div>'
'<p>That last step &mdash; planning ahead so you&rsquo;re never sitting empty &mdash; is where most of the 5% pays for itself. '
'It&rsquo;s also worth knowing the legal line: a dispatcher works <em>for the carrier</em> and never brokers freight directly to shippers. '
'The <a href="https://www.fmcsa.dot.gov/registration/who-needs-register" target="_blank" rel="noopener nofollow">FMCSA registration rules</a> '
'spell out who must hold broker authority &mdash; a point every owner-operator should understand before signing with anyone.</p>'
+svc_banner('Every equipment type, one flat rate',
  'Reefer, flatbed, dry van, hotshot or power-only &mdash; see the full range of lanes and loads our dispatch team runs.',
  'Explore all dispatch services &rarr;','services.html')+
'<h2 id="bottom-line">The bottom line</h2>'
'<p>Expect to pay around <b>5% of gross</b> for quality truck dispatch, with no contract and no hidden fees. The right dispatcher should '
'make you more than they cost &mdash; in better rates, fewer empty miles, and the hours you get back. If they don&rsquo;t, you should be '
'able to leave anytime. That&rsquo;s exactly how Loadboot works.</p>')

A1_TOC=[('quick-answer','Quick answer'),('models','The two pricing models'),('included','What your fee covers'),
        ('roi','Does 5% pay for itself?'),('flat-vs-percent','Flat fee vs percentage'),('red-flags','Red flags to avoid'),
        ('how-works','How dispatch works'),('bottom-line','The bottom line')]
A1_FAQ=[
 ('Is 5% a lot for a truck dispatcher?','No &mdash; 5% is the industry standard, and for most owner-operators it is the fairest model because you only pay when the dispatcher actually books and runs a load for you. The fee is usually small next to the higher rates and reduced deadhead a good dispatcher delivers.'),
 ('Do dispatchers charge an upfront fee?','A reputable dispatcher should not charge upfront or setup fees. At Loadboot you pay a flat 5% only on loads we book &mdash; nothing upfront, and no contract.'),
 ('Is a flat weekly fee cheaper than a percentage?','It depends on your revenue. A flat fee ($150&ndash;$250/truck/week) can be cheaper only if you run high gross every week. If your weeks vary, the percentage model usually costs less and keeps your dispatcher&rsquo;s incentives aligned with yours.'),
 ('Do I still control which loads I take?','Yes. A dispatcher works for you &mdash; they find and negotiate loads, but you approve every load and rate before anything is booked.'),
 ('Can I cancel anytime?','With Loadboot, yes. There are no contracts &mdash; we earn your business load by load, and you can stop anytime.')]
A1_FEAT=('<svg class="feat-art" viewBox="0 0 1200 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true">'
 '<defs><linearGradient id="fa1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f172a"/>'
 '<stop offset=".55" stop-color="#1e3a8a"/><stop offset="1" stop-color="#2563EB"/></linearGradient></defs>'
 '<rect width="1200" height="360" fill="url(#fa1)"/>'
 '<circle cx="980" cy="80" r="220" fill="#ffffff" opacity=".05"/>'
 '<circle cx="1080" cy="300" r="160" fill="#F97316" opacity=".10"/>'
 '<text x="70" y="150" font-family="Manrope,Arial" font-weight="800" font-size="120" fill="#ffffff" opacity=".10">5%</text>'
 '<rect x="760" y="210" width="34" height="80" rx="6" fill="#3b82f6" opacity=".7"/>'
 '<rect x="812" y="170" width="34" height="120" rx="6" fill="#60a5fa" opacity=".7"/>'
 '<rect x="864" y="120" width="34" height="170" rx="6" fill="#F97316" opacity=".85"/>'
 '</svg>')
rich_article('how-much-does-a-truck-dispatcher-cost.html',
 'How Much Does a Truck Dispatcher Cost in 2026?',
 'Truck dispatcher pricing explained: percentage vs flat fee, what 5% really gets you, red flags, and how the right dispatcher pays for itself.',
 'Dispatch Pricing','How Much Does a Truck Dispatcher Cost in 2026?',
 'Percentage vs flat fee, what 5% should cover, the red flags that mean you are overpaying, and the simple math on whether a dispatcher pays for itself.',
 8,'dispatcher-cost-hero.avif','Semi-truck on a US highway — what a truck dispatcher costs',
 A1_TOC,A1_BODY,A1_FAQ,feat_svg=A1_FEAT)

# ===== ARTICLE #2 : Dispatcher vs Broker vs Factoring =====
A2_FEAT=('<svg class="feat-art" viewBox="0 0 1200 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true">'
 '<defs><linearGradient id="fa2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f172a"/>'
 '<stop offset=".55" stop-color="#1e3a8a"/><stop offset="1" stop-color="#2563EB"/></linearGradient></defs>'
 '<rect width="1200" height="360" fill="url(#fa2)"/>'
 '<circle cx="980" cy="70" r="230" fill="#ffffff" opacity=".05"/>'
 '<circle cx="1090" cy="300" r="150" fill="#F97316" opacity=".10"/>'
 '<rect x="690" y="150" width="150" height="64" rx="12" fill="#ffffff" opacity=".10"/>'
 '<rect x="870" y="150" width="150" height="64" rx="12" fill="#ffffff" opacity=".10"/>'
 '<rect x="1050" y="150" width="110" height="64" rx="12" fill="#F97316" opacity=".22"/>'
 '<text x="70" y="150" font-family="Manrope,Arial" font-weight="800" font-size="118" fill="#ffffff" opacity=".10">VS</text>'
 '</svg>')

# Diagram: who represents whom
A2_REP=('<figure class="art-fig"><svg viewBox="0 0 640 330" width="100%" role="img" '
 'aria-label="A freight broker represents the shipper; a truck dispatcher represents you, the carrier. They negotiate the load between them.">'
 '<text x="0" y="20" font-family="Manrope,Arial" font-weight="800" font-size="17" fill="#0F172A">Who works for whom</text>'
 '<text x="20" y="58" font-family="Inter,Arial" font-size="12" font-weight="700" fill="#F97316" text-transform="uppercase">THE LOAD&rsquo;S SIDE</text>'
 '<text x="400" y="58" font-family="Inter,Arial" font-size="12" font-weight="700" fill="#2563EB">YOUR SIDE</text>'
 '<rect x="20" y="70" width="210" height="62" rx="12" fill="#fff7ed" stroke="#fdba74"/>'
 '<text x="125" y="100" text-anchor="middle" font-family="Manrope,Arial" font-weight="800" font-size="15" fill="#0F172A">Shipper</text>'
 '<text x="125" y="120" text-anchor="middle" font-family="Inter,Arial" font-size="11.5" fill="#9a3412">Owns the freight</text>'
 '<rect x="20" y="200" width="210" height="62" rx="12" fill="#fff7ed" stroke="#fb923c"/>'
 '<text x="125" y="230" text-anchor="middle" font-family="Manrope,Arial" font-weight="800" font-size="15" fill="#0F172A">Freight Broker</text>'
 '<text x="125" y="250" text-anchor="middle" font-family="Inter,Arial" font-size="11.5" fill="#9a3412">Represents the shipper</text>'
 '<rect x="400" y="70" width="210" height="62" rx="12" fill="#eff6ff" stroke="#93c5fd"/>'
 '<text x="505" y="100" text-anchor="middle" font-family="Manrope,Arial" font-weight="800" font-size="15" fill="#0F172A">Carrier &mdash; You</text>'
 '<text x="505" y="120" text-anchor="middle" font-family="Inter,Arial" font-size="11.5" fill="#1e40af">Owns the truck &amp; authority</text>'
 '<rect x="400" y="200" width="210" height="62" rx="12" fill="#eff6ff" stroke="#60a5fa"/>'
 '<text x="505" y="230" text-anchor="middle" font-family="Manrope,Arial" font-weight="800" font-size="15" fill="#0F172A">Truck Dispatcher</text>'
 '<text x="505" y="250" text-anchor="middle" font-family="Inter,Arial" font-size="11.5" fill="#1e40af">Represents you</text>'
 '<path d="M125 132 V200" stroke="#fb923c" stroke-width="3"/><path d="M125 200 l-5 -10 h10 Z" fill="#fb923c"/>'
 '<path d="M505 132 V200" stroke="#2563EB" stroke-width="3"/><path d="M505 200 l-5 -10 h10 Z" fill="#2563EB"/>'
 '<path d="M230 231 H400" stroke="#64748B" stroke-width="2.5" stroke-dasharray="6 6"/>'
 '<path d="M400 231 l-12 -6 v12 Z" fill="#64748B"/><path d="M230 231 l12 -6 v12 Z" fill="#64748B"/>'
 '<text x="315" y="222" text-anchor="middle" font-family="Inter,Arial" font-size="11" font-weight="700" fill="#475569">negotiate the rate</text>'
 '</svg><figcaption>The broker is the <b>other side of the table</b> &mdash; they work for the shipper. Your dispatcher works for '
 '<b>you</b>, negotiating with that broker to get your truck the best rate.</figcaption></figure>')

# Diagram: money flow
A2_FLOW=('<figure class="art-fig"><svg viewBox="0 0 600 250" width="100%" role="img" '
 'aria-label="On a load the shipper pays the broker 3300 dollars; the broker keeps about 300 and pays the carrier 3000; the dispatcher takes 5 percent which is 150; optional factoring takes about 60; the carrier keeps roughly 2790.">'
 '<text x="0" y="20" font-family="Manrope,Arial" font-weight="800" font-size="17" fill="#0F172A">How the money flows on a $3,000 load</text>'
 '<rect x="0" y="44" width="150" height="58" rx="11" fill="#f1f5f9" stroke="#cbd5e1"/>'
 '<text x="75" y="69" text-anchor="middle" font-family="Manrope,Arial" font-weight="800" font-size="13" fill="#0F172A">Shipper</text>'
 '<text x="75" y="88" text-anchor="middle" font-family="Inter,Arial" font-size="11" fill="#64748B">pays $3,300</text>'
 '<rect x="225" y="44" width="150" height="58" rx="11" fill="#fff7ed" stroke="#fdba74"/>'
 '<text x="300" y="69" text-anchor="middle" font-family="Manrope,Arial" font-weight="800" font-size="13" fill="#0F172A">Broker</text>'
 '<text x="300" y="88" text-anchor="middle" font-family="Inter,Arial" font-size="11" fill="#9a3412">keeps ~$300</text>'
 '<rect x="450" y="44" width="150" height="58" rx="11" fill="#eff6ff" stroke="#93c5fd"/>'
 '<text x="525" y="69" text-anchor="middle" font-family="Manrope,Arial" font-weight="800" font-size="13" fill="#0F172A">You (Carrier)</text>'
 '<text x="525" y="88" text-anchor="middle" font-family="Inter,Arial" font-size="11" fill="#1e40af">gets $3,000</text>'
 '<path d="M150 73 H225" stroke="#94a3b8" stroke-width="2.5"/><path d="M225 73 l-11 -6 v12 Z" fill="#94a3b8"/>'
 '<path d="M375 73 H450" stroke="#94a3b8" stroke-width="2.5"/><path d="M450 73 l-11 -6 v12 Z" fill="#94a3b8"/>'
 '<path d="M525 102 V140" stroke="#cbd5e1" stroke-width="2.5"/>'
 '<rect x="300" y="140" width="135" height="46" rx="10" fill="#eff6ff" stroke="#bfdbfe"/>'
 '<text x="367" y="160" text-anchor="middle" font-family="Inter,Arial" font-size="11" fill="#1e40af">Dispatcher 5%</text>'
 '<text x="367" y="177" text-anchor="middle" font-family="Manrope,Arial" font-weight="800" font-size="12" fill="#0F172A">&minus; $150</text>'
 '<rect x="450" y="140" width="135" height="46" rx="10" fill="#fff7ed" stroke="#fed7aa"/>'
 '<text x="517" y="160" text-anchor="middle" font-family="Inter,Arial" font-size="11" fill="#9a3412">Factoring ~2%</text>'
 '<text x="517" y="177" text-anchor="middle" font-family="Manrope,Arial" font-weight="800" font-size="12" fill="#0F172A">&minus; $60 (optional)</text>'
 '<path d="M435 163 H300" stroke="#cbd5e1" stroke-width="0"/>'
 '<rect x="360" y="206" width="240" height="40" rx="10" fill="#0F172A"/>'
 '<text x="378" y="231" font-family="Inter,Arial" font-size="12" fill="#cbd5e1">You keep about</text>'
 '<text x="582" y="231" text-anchor="end" font-family="Manrope,Arial" font-weight="800" font-size="16" fill="#F97316">$2,790</text>'
 '</svg><figcaption>The broker&rsquo;s margin comes out <b>before</b> you ever see the rate. Your dispatcher&rsquo;s 5% and optional '
 'factoring come out of <b>your</b> side &mdash; and a good dispatcher usually negotiates a higher starting rate than you would alone, '
 'covering their fee and then some.</figcaption></figure>')

A2_BODY=(
'<h2 id="quick-answer">Quick answer</h2>'
'<p>A <b>freight broker</b> works for the shipper and owns the load. A <b>truck dispatcher</b> works for you, the carrier, and '
'negotiates with brokers to keep your truck loaded. A <b>factoring company</b> doesn&rsquo;t find freight at all &mdash; it advances you '
'cash on the loads you&rsquo;ve already hauled so you&rsquo;re not waiting 30&ndash;45 days to get paid. Three different jobs, not three '
'versions of the same thing.</p>'
'<div class="callout cl-info"><span class="ic">&#128161;</span><div>You will often deal with <b>all three at once</b>: your dispatcher '
'books a load from a broker, you haul it, and a factoring company pays you the next day. They&rsquo;re partners in the same trip &mdash; '
'not competitors.</div></div>'
'<div class="statrow"><div class="statcard"><div class="n">~5%</div><div class="l">Typical dispatch fee (of your load)</div></div>'
'<div class="statcard"><div class="n">$75,000</div><div class="l">Surety bond a broker must carry</div></div>'
'<div class="statcard"><div class="n">1&ndash;3%</div><div class="l">Typical factoring fee per invoice</div></div></div>'

'<h2 id="who-represents">Who each one represents</h2>'
'<p>This is the single most important thing to understand, because it tells you whose interests each party is protecting:</p>'
+A2_REP+
'<p>A broker is paid to get the shipper&rsquo;s freight moved for as little as the market allows. That&rsquo;s not dishonest &mdash; '
'it&rsquo;s their job, and they&rsquo;re good at it. The problem is that when you negotiate directly with a broker on your own, '
'you&rsquo;re a one-truck operation going up against someone who books hundreds of loads a week and knows every lane&rsquo;s real number. '
'A dispatcher levels that table, because they sit on <em>your</em> side and negotiate dozens of loads a week too.</p>'
+svc_banner('A dispatcher who works for you, not the load',
  'Loadboot represents the carrier &mdash; we negotiate with brokers on your behalf, you approve every rate, and you keep your own authority.',
  'See how our dispatch works &rarr;','services.html')+

'<h2 id="legal">What each can legally do</h2>'
'<p>The roles are separated by federal authority, and the line matters &mdash; crossing it is how carriers get burned:</p>'
'<ul>'
'<li><b>Freight brokers</b> must hold active brokerage authority (an MC number for brokering) and carry a <b>$75,000 surety bond</b>. '
'They&rsquo;re legally allowed to arrange transportation between shippers and carriers and keep a margin. You can verify any broker&rsquo;s '
'authority and bond in the <a href="https://safer.fmcsa.dot.gov/" target="_blank" rel="noopener nofollow">FMCSA SAFER system</a>.</li>'
'<li><b>Truck dispatchers</b> generally <b>do not need broker authority</b>, because they work for the carrier rather than arranging freight '
'for a shipper. A dispatcher should never negotiate directly with a shipper as if brokering &mdash; that crosses into brokerage and requires '
'authority and a bond. The <a href="https://www.fmcsa.dot.gov/registration/get-mc-number-authority-operate" target="_blank" rel="noopener nofollow">'
'FMCSA authority rules</a> spell out who must register.</li>'
'<li><b>Factoring companies</b> are a financial service, not a transportation one. They buy your invoices at a small discount. No FMCSA '
'authority is involved &mdash; just a contract you should read carefully (watch for recourse vs non-recourse terms and long lock-ins).</li>'
'</ul>'
'<div class="callout cl-warn"><span class="ic">&#9888;</span><div>If a &ldquo;dispatcher&rdquo; is dealing directly with shippers and '
'keeping a margin like a broker &mdash; without broker authority and a bond &mdash; that&rsquo;s a red flag. A real dispatcher works for you '
'and is paid <em>by you</em>, transparently.</div></div>'

'<h2 id="money-flow">How the money actually flows</h2>'
'<p>Carriers often think the dispatcher and the broker are both &ldquo;taking a cut&rdquo; of the same pie. They&rsquo;re not &mdash; '
'they&rsquo;re paid from different places. Here&rsquo;s a real example on a $3,000 load:</p>'
+A2_FLOW+
'<p>Notice the broker&rsquo;s margin is already baked into the rate before it reaches you &mdash; you never see the shipper&rsquo;s full '
'$3,300. Your dispatcher&rsquo;s 5% and any factoring fee come out of your $3,000. The math only works in your favor because a good '
'dispatcher typically <b>negotiates a higher rate to begin with</b>, so even after the fee you net more than you would have alone.</p>'
'<div class="pull">A broker owns the load. A dispatcher works your side of the table. Factoring just gets you paid faster. Different jobs &mdash; not competitors.</div>'
'<p>Want to know whether a broker&rsquo;s offer is actually fair before you (or your dispatcher) push back? Run it through our '
'<a href="load-score.html">free Load Score tool</a> &mdash; it scores any rate against the lane and gives you a take / negotiate / pass call.</p>'
+svc_banner('Is that broker&rsquo;s rate any good?',
  'Score any load offer in seconds with our free Load Score tool &mdash; no signup. Know your number before you negotiate.',
  'Try the Load Score &rarr;','load-score.html')+

'<h2 id="compare">Dispatcher vs broker vs factoring: side by side</h2>'
'<table class="cmp"><thead><tr><th>&nbsp;</th><th>Truck Dispatcher</th><th>Freight Broker</th><th>Factoring</th></tr></thead><tbody>'
'<tr><td>Works for</td><td><b>You</b> (the carrier)</td><td>The shipper</td><td><b>You</b> (the carrier)</td></tr>'
'<tr><td>Main job</td><td>Finds &amp; negotiates loads for your truck</td><td>Finds a truck for the shipper&rsquo;s load</td><td>Advances cash on loads you&rsquo;ve hauled</td></tr>'
'<tr><td>How they&rsquo;re paid</td><td>~5% of your rate, or a flat fee</td><td>Margin between shipper &amp; carrier rate</td><td>~1&ndash;3% of each invoice</td></tr>'
'<tr><td>Needs FMCSA authority?</td><td>No</td><td>Yes &mdash; broker authority + $75k bond</td><td>No</td></tr>'
'<tr><td>Do you keep control?</td><td>Yes &mdash; you approve every load</td><td>They&rsquo;re the other side of the deal</td><td>Yes &mdash; it&rsquo;s just cash flow</td></tr>'
'<tr><td>When you use them</td><td>Optional, but valuable on every load</td><td>On most loads (they hold the freight)</td><td>Optional &mdash; for faster pay</td></tr>'
'</tbody></table>'

'<h2 id="factoring">Where factoring fits &mdash; and when to skip it</h2>'
'<p>Factoring solves one problem: <b>cash flow</b>. Brokers commonly pay in 30 to 45 days, but your fuel, insurance and truck payment '
'are due now. A factoring company pays you within a day or two of submitting the paperwork, taking 1&ndash;3% as their fee.</p>'
'<p>It&rsquo;s often worth it in your <b>first months</b>, when one slow-paying broker can sink you. Once you have a cash cushion and steady '
'lanes, many carriers drop factoring to keep that 1&ndash;3%. Read the contract closely: prefer <b>non-recourse</b> where practical, avoid '
'long lock-ins, and never let a factor or dispatcher force you into a service you didn&rsquo;t choose.</p>'
'<div class="callout cl-tip"><span class="ic">&#10003;</span><div>A clean setup for a new carrier: your <b>own authority</b>, a '
'<b>dispatcher</b> who finds and negotiates your freight, and <b>optional factoring</b> while you build cash. You stay in control of all '
'three.</div></div>'
+svc_banner('New authority? Get loaded from day one',
  'We handle broker setup, find your lanes, and negotiate your rates so you can drive instead of learning the back office the hard way.',
  'See owner-operator dispatch &rarr;','owner-operator-dispatch.html')+

'<h2 id="which">Which do you actually need?</h2>'
'<p>If you&rsquo;re a carrier with your own authority: you&rsquo;ll <b>deal with brokers</b> on most loads whether you like it or not '
'(they hold the freight), a <b>dispatcher</b> is the optional-but-valuable partner who handles those brokers and negotiates for you, and '
'<b>factoring</b> is a cash-flow tool you turn on when you need faster pay. The only one that&rsquo;s truly &ldquo;you vs them&rdquo; is the '
'broker &mdash; and that&rsquo;s exactly why having a dispatcher on your side changes the game.</p>'

'<h2 id="bottom-line">The bottom line</h2>'
'<p>Don&rsquo;t think of dispatcher, broker and factoring as three choices &mdash; think of them as three roles in every load you run. The '
'broker represents the freight. Factoring represents your bank account. And a dispatcher is the one party in the chain whose only job is to '
'represent <b>you</b>. That&rsquo;s the difference, and it&rsquo;s the whole reason a good dispatch service pays for itself.</p>')

A2_TOC=[('quick-answer','Quick answer'),('who-represents','Who represents whom'),('legal','What each can legally do'),
        ('money-flow','How the money flows'),('compare','Side-by-side comparison'),('factoring','Where factoring fits'),
        ('which','Which do you need?'),('bottom-line','The bottom line')]
A2_FAQ=[
 ('Is a truck dispatcher the same as a freight broker?','No. A freight broker works for the shipper and arranges freight for a margin, and must hold broker authority plus a $75,000 bond. A truck dispatcher works for the carrier &mdash; finding and negotiating loads on your behalf &mdash; and generally does not need broker authority.'),
 ('Can a dispatcher also broker my loads?','Not on the same load. Brokering requires active broker authority and a surety bond, and a dispatcher who deals directly with shippers for a margin is crossing into brokerage. A legitimate dispatcher works for you and is paid transparently by you.'),
 ('Do I need a dispatcher, a broker, and factoring all at once?','You will deal with brokers on most loads because they hold the freight. A dispatcher is optional but handles those brokers and negotiates for you. Factoring is optional and only about getting paid faster. Many carriers use all three together.'),
 ('Is factoring worth the fee?','It depends on your cash flow. Paying 1&ndash;3% to get paid in a day or two is often worth it in your first months, when a slow-paying broker can sink you. Once you have a cash cushion, many carriers drop it to keep the fee.'),
 ('Who gets me a better rate, a dispatcher or a broker?','A broker is paid to move the shipper&rsquo;s freight for as little as the market allows, so their incentive is a lower rate. A dispatcher works for you and is motivated to negotiate the rate up, since on a percentage model they only earn more when you do.')]
rich_article('truck-dispatcher-vs-freight-broker.html',
 'Truck Dispatcher vs Freight Broker vs Factoring (2026)',
 'Dispatcher, broker or factoring? Who each represents, what they can legally do, how the money flows, and which ones a carrier actually needs.',
 'Carrier Basics','Truck Dispatcher vs Freight Broker vs Factoring',
 'Three roles every carrier deals with &mdash; but they do completely different jobs. Who represents whom, what each can legally do, how the money flows, and which ones you actually need.',
 9,'dispatcher-vs-broker-hero.jpg','Freight broker and truck dispatcher negotiating a load rate for a carrier',
 A2_TOC,A2_BODY,A2_FAQ,feat_svg=A2_FEAT)

# ===== ARTICLE #4 : Owner-Operator Dispatch Service — Complete Guide =====
A4_FEAT=('<svg class="feat-art" viewBox="0 0 1200 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true">'
 '<defs><linearGradient id="fa4" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f172a"/>'
 '<stop offset=".55" stop-color="#1e3a8a"/><stop offset="1" stop-color="#2563EB"/></linearGradient></defs>'
 '<rect width="1200" height="360" fill="url(#fa4)"/>'
 '<circle cx="960" cy="80" r="230" fill="#ffffff" opacity=".05"/>'
 '<circle cx="1090" cy="300" r="150" fill="#F97316" opacity=".10"/>'
 '<text x="70" y="150" font-family="Manrope,Arial" font-weight="800" font-size="96" fill="#ffffff" opacity=".10">OWNER-OP</text>'
 '<g transform="translate(770,196)"><rect x="0" y="0" width="150" height="64" rx="6" fill="#e2e8f0" opacity=".85"/>'
 '<path d="M150 14h26c4 0 7 2 9 5l16 25c1 2 2 4 2 7v13h-53z" fill="#2563EB"/>'
 '<rect x="158" y="20" width="18" height="18" fill="#bfdbfe"/><rect x="8" y="64" width="220" height="5" fill="#0f172a"/>'
 '<circle cx="46" cy="70" r="15" fill="#0f172a"/><circle cx="46" cy="70" r="6" fill="#64748b"/>'
 '<circle cx="196" cy="70" r="15" fill="#0f172a"/><circle cx="196" cy="70" r="6" fill="#64748b"/></g>'
 '</svg>')
A4_SVG=('<figure class="art-fig"><svg viewBox="0 0 600 250" width="100%" role="img" '
 'aria-label="A typical solo week nets about 4600 dollars booking your own loads versus about 5400 dollars with a dispatch service after the 5 percent fee">'
 '<text x="0" y="22" font-family="Manrope,Arial" font-weight="800" font-size="19" fill="#0F172A">A typical solo week: DIY vs dispatched</text>'
 '<text x="0" y="70" font-family="Inter,Arial" font-size="13" fill="#64748B">Booking your own loads (extra deadhead + one cheap load)</text>'
 '<rect x="0" y="80" width="560" height="30" rx="6" fill="#eef2f7"/>'
 '<rect x="0" y="80" width="392" height="30" rx="6" fill="#94a3b8"/>'
 '<text x="403" y="100" font-family="Manrope,Arial" font-weight="800" font-size="15" fill="#0F172A">~$4,600 net</text>'
 '<text x="0" y="150" font-family="Inter,Arial" font-size="13" fill="#64748B">With a dispatch service (better rates, less deadhead, after 5%)</text>'
 '<rect x="0" y="160" width="560" height="30" rx="6" fill="#eff6ff"/>'
 '<rect x="0" y="160" width="460" height="30" rx="6" fill="#2563EB"/>'
 '<text x="471" y="180" font-family="Manrope,Arial" font-weight="800" font-size="15" fill="#0F172A">~$5,400 net</text>'
 '<text x="0" y="228" font-family="Inter,Arial" font-size="13" font-weight="700" fill="#F97316">'
 '~$800 more in your pocket &#8212; plus a week of broker calls you never had to make.</text></svg>'
 '<figcaption>Illustrative: a dispatcher books higher-paying lanes and cuts your empty miles, so even after the 5% fee '
 'a well-run solo week nets more than doing everything yourself. Your numbers vary by lane, season and equipment.</figcaption></figure>')
A4_BODY=(
'<h2 id="what-is">What is an owner-operator dispatch service?</h2>'
'<p>An <b>owner-operator dispatch service</b> is a company that finds, negotiates, and books freight <em>on your behalf</em> '
'so you can stay focused on driving and delivering. For a one-truck operation, a good dispatcher is effectively your entire '
'back office &mdash; searching load boards and broker networks, haggling rates, vetting brokers, and handling the paperwork '
'&mdash; without you giving up your authority or your control over which loads you run.</p>'
'<div class="callout cl-info"><span class="ic">&#128161;</span><div>A dispatcher works <b>for you, the carrier</b>. That is the '
'whole point &mdash; and the legal line. A dispatcher is not a broker and never sells your truck to a shipper directly. You keep '
'your MC number, you approve every load, and you can walk away anytime.</div></div>'
'<div class="statrow"><div class="statcard"><div class="n">1 truck</div><div class="l">Exactly who this is built for</div></div>'
'<div class="statcard"><div class="n">5%</div><div class="l">Industry-standard dispatch fee</div></div>'
'<div class="statcard"><div class="n">$0</div><div class="l">What you pay on a week we don&rsquo;t book you</div></div></div>'

'<h2 id="what-it-does">What a dispatch service actually does for you</h2>'
'<p>The job is much bigger than &ldquo;forwarding loads.&rdquo; A real owner-operator dispatch service runs the entire load lifecycle '
'so your only job is to drive safely and deliver on time. For your fee you should expect:</p>'
'<ul>'
'<li><b>Load sourcing</b> on the lanes, equipment and home-time you actually want &mdash; not just whatever is cheapest to fill your week</li>'
'<li><b>Rate negotiation</b> on every load, pushing for the top of what the lane will pay instead of accepting the first number</li>'
'<li><b>Broker setup &amp; credit checks</b> so you never haul for a broker who won&rsquo;t pay</li>'
'<li><b>Rate confirmations &amp; setup packets</b> handled and organized for you</li>'
'<li><b>Deadhead &amp; trip planning</b> that lines up your next load before you&rsquo;re empty</li>'
'<li><b>Detention, TONU &amp; layover support</b> when an appointment runs long or a load falls through</li>'
'<li><b>A single point of contact</b> instead of ten broker phone numbers and a full voicemail box</li>'
'</ul>'
'<p>Notice what is <em>not</em> on that list: your dispatcher does not choose your loads for you, does not touch your money, and '
'does not lock you into anything. You stay the decision-maker.</p>'
'<p>There&rsquo;s also a less obvious benefit that owner-operators feel within a week or two: the mental load lifts. Instead of scanning '
'boards at a truck stop, chasing down a broker&rsquo;s setup packet, and second-guessing whether a rate is fair, you get one point of '
'contact who already knows your lanes and your floor. That&rsquo;s hours of screen time and phone tag every week that go straight back '
'into driving &mdash; or into actually resting during your reset. For a one-person business, protecting your focus and your hours-of-service '
'is not a soft perk; it&rsquo;s the difference between a sustainable operation and burning out by month six.</p>'
+svc_banner('Flat 5%. No contracts. Built for owner-operators.',
  'See exactly what our dispatch service covers and what you pay &mdash; no setup fees, no forced factoring, cancel anytime.',
  'See our pricing &rarr;','pricing.html')+

'<h2 id="how-it-works">How it works, day to day</h2>'
'<p>Here&rsquo;s the loop a good owner-operator dispatch service runs for every single load you haul &mdash; usually while you&rsquo;re '
'still rolling on the current one:</p>'
'<div class="art-steps">'
'<div class="art-step"><div class="sn">1</div><b>Set your plan</b><span>You tell us your lanes, equipment, home base, rate floor and when you want to be home. That becomes your standing playbook.</span></div>'
'<div class="art-step"><div class="sn">2</div><b>Find &amp; vet</b><span>We search boards and our broker network for loads that fit, then credit-check the broker before anything is committed.</span></div>'
'<div class="art-step"><div class="sn">3</div><b>Negotiate &amp; confirm</b><span>We push the rate up and send you the number. You approve it &mdash; then we lock the load and handle the rate confirmation.</span></div>'
'<div class="art-step"><div class="sn">4</div><b>Plan ahead</b><span>While you drive, we line up your next load to kill deadhead, and we jump on detention or issues if the day goes sideways.</span></div>'
'</div>'
'<p>That fourth step is where most of the fee pays for itself. An empty truck earns nothing, and a solo driver who is also their own '
'dispatcher almost always ends up sitting longer between loads than one whose next pickup is already booked.</p>'
'<div class="pull">A dispatcher&rsquo;s real product isn&rsquo;t a load &mdash; it&rsquo;s a truck that&rsquo;s never sitting empty and never hauling for a broker who won&rsquo;t pay.</div>'

'<h2 id="cost">What does it cost an owner-operator?</h2>'
'<p>Most dispatch services charge <b>3%&ndash;10% of your gross, with 5% being standard</b>, or a <b>flat $150&ndash;$250 per week</b>. '
'For a solo owner-operator whose weekly revenue moves up and down, the percentage model is usually the fairer deal &mdash; on a slow '
'week you pay little or nothing, and your dispatcher only earns when you do. We break the full comparison down in our guide to '
'<a href="how-much-does-a-truck-dispatcher-cost.html">how much a truck dispatcher costs</a>.</p>'
'<div class="callout cl-tip"><span class="ic">&#10003;</span><div>The number that matters isn&rsquo;t the percentage &mdash; it&rsquo;s '
'whether your dispatcher books better rates and cuts more empty miles than they cost. On a $3,000 load the 5% fee is $150; a single '
'well-negotiated rate usually covers that several times over.</div></div>'
+A4_SVG+
'<p>Want to sanity-check any individual offer before you commit? Run it through our '
'<a href="load-score.html">free Load Score tool</a> &mdash; it gives you a take / negotiate / pass verdict and a suggested counter-offer '
'in seconds, no signup needed.</p>'
+svc_banner('Should you take this load?',
  'Score any rate for real profit in seconds with our free Load Score tool &mdash; take, negotiate, or pass, instantly. No login.',
  'Try the Load Score &rarr;','load-score.html')+

'<h2 id="new-authority">Do you need one as a new owner-operator?</h2>'
'<p>If you&rsquo;ve just activated your own authority, the honest answer is: a dispatch service is one of the fastest ways to get loaded '
'without spending your first three months learning the back office the hard way. New carriers face a specific set of hurdles &mdash; '
'brokers who won&rsquo;t work with authority under 90 days old, thin credit history, and no relationships &mdash; and an experienced '
'dispatcher already has the broker connections and the setup process down.</p>'
'<p>It also helps to understand the legal landscape you&rsquo;re operating in. A dispatcher works for the carrier and does not need broker '
'authority; brokers, who represent shippers, must register and hold a bond. The FMCSA&rsquo;s '
'<a href="https://www.fmcsa.dot.gov/registration/who-needs-register" target="_blank" rel="noopener nofollow">guidance on who needs to register</a> '
'spells out exactly where that line sits &mdash; worth reading before you sign with anyone who blurs it.</p>'
'<div class="callout cl-warn"><span class="ic">&#9888;</span><div>Always confirm a broker&rsquo;s authority and safety record before you haul. '
'You can look up any carrier or broker for free on the FMCSA&rsquo;s '
'<a href="https://safer.fmcsa.dot.gov/CompanySnapshot.aspx" target="_blank" rel="noopener nofollow">SAFER Company Snapshot</a>. '
'A good dispatch service does this vetting for you on every load.</div></div>'

'<h2 id="diy-vs">Dispatch service vs doing it yourself</h2>'
'<p>Plenty of owner-operators dispatch themselves, and some do it well. The real question is what your time is worth and whether you can '
'consistently out-negotiate a full-time professional. Here&rsquo;s the honest trade-off:</p>'
'<table class="cmp"><thead><tr><th>&nbsp;</th><th>Dispatch yourself</th><th>Owner-operator dispatch service</th></tr></thead><tbody>'
'<tr><td>Cost</td><td>$0 in fees</td><td>~5% of gross on booked loads</td></tr>'
'<tr><td>Your driving hours</td><td>Cut into by load hunting &amp; broker calls</td><td>Spent driving &mdash; the loads come to you</td></tr>'
'<tr><td>Rate negotiation</td><td>As good as your own experience</td><td>Full-time negotiator working your lanes daily</td></tr>'
'<tr><td>Deadhead</td><td>Whatever you can plan solo</td><td>Next load lined up before you&rsquo;re empty</td></tr>'
'<tr><td>Broker risk</td><td>You vet every broker yourself</td><td>Credit-checked before you commit</td></tr>'
'<tr><td>Best for</td><td>Veterans with deep broker relationships and time to work the phones</td><td>Solo drivers who&rsquo;d rather drive than run a back office</td></tr>'
'</tbody></table>'
'<p>There&rsquo;s no universal right answer &mdash; but for most single-truck operators, the hours saved and the higher, better-vetted rates '
'more than cover a 5% fee. If you&rsquo;re still deciding who does what in your business, our breakdown of '
'<a href="truck-dispatcher-vs-freight-broker.html">dispatcher vs broker vs factoring</a> clears up who represents whom.</p>'

'<h2 id="how-to-choose">How to choose a dispatch service</h2>'
'<p>Not all dispatch services are equal. Before you hand over your operation, look for these green flags &mdash; and run from the red ones.</p>'
'<ul>'
'<li><b>A flat, transparent fee</b> (a clear percentage) with <b>no contract</b> and no setup or upfront charges</li>'
'<li><b>Full rate transparency</b> &mdash; you see and approve every rate before anything books</li>'
'<li><b>No forced factoring</b> &mdash; you choose your own factoring company, or none at all</li>'
'<li><b>Broker vetting</b> built into their process, not an afterthought</li>'
'<li><b>They run your lanes and equipment</b> &mdash; ask specifically about your freight type</li>'
'<li><b>You can cancel anytime</b> &mdash; a good service earns your business load by load</li>'
'</ul>'
'<div class="callout cl-warn"><span class="ic">&#9888;</span><div>Red flags: long contracts or cancellation penalties, upfront/setup fees, '
'forced factoring, no rate transparency, or a dispatcher dealing directly with shippers as if brokering. Any one of these should give you pause.</div></div>'
+svc_banner('Every equipment type, one flat rate',
  'Reefer, flatbed, dry van, hotshot, power-only or new authority &mdash; see the full range of lanes our dispatch team runs for owner-operators.',
  'Explore all dispatch services &rarr;','services.html')+

'<h2 id="bottom-line">The bottom line</h2>'
'<p>An owner-operator dispatch service exists to do one thing: keep your truck loaded at the best possible rate so you can focus on driving. '
'The right one is transparent, contract-free, vets your brokers, and makes you more than it costs &mdash; in higher rates, fewer empty miles, '
'and the hours you get back. If a service can&rsquo;t promise all of that, keep looking. That&rsquo;s exactly the standard '
'<a href="pricing.html">Loadboot</a> holds itself to: flat 5%, no contracts, you approve every load.</p>')

A4_TOC=[('what-is','What it is'),('what-it-does','What it does for you'),('how-it-works','How it works day to day'),
        ('cost','What it costs'),('new-authority','New owner-operators'),('diy-vs','Dispatch vs DIY'),
        ('how-to-choose','How to choose one'),('bottom-line','The bottom line')]
A4_FAQ=[
 ('What is an owner-operator dispatch service?','It&rsquo;s a company that finds, negotiates and books freight on your behalf so you can focus on driving. A dispatcher represents you, the carrier &mdash; searching loads, negotiating rates, vetting brokers and handling paperwork &mdash; while you keep your authority and approve every load.'),
 ('How much does dispatch cost for one truck?','Most services charge 3%&ndash;10% of gross, with 5% the standard, or a flat $150&ndash;$250 per week. For a solo owner-operator with variable weeks, the percentage model is usually fairer because you only pay when a load is actually booked. Loadboot is a flat 5% with no contract.'),
 ('Do I keep control of which loads I run?','Yes. A dispatch service does the legwork, but you approve every load and rate before anything books. You keep your own authority and stay the decision-maker.'),
 ('Do new-authority owner-operators need a dispatcher?','It&rsquo;s optional, but it&rsquo;s one of the fastest ways to get loaded when your authority is new. An experienced dispatcher already has broker relationships and the setup process handled, which helps get around the common &ldquo;90 days in business&rdquo; hurdle new carriers face.'),
 ('Is a dispatcher the same as a freight broker?','No. A broker represents the shipper and must hold broker authority and a bond. A dispatcher represents you, the carrier, and generally does not need broker authority. A dispatcher should never deal directly with shippers as if brokering.'),
 ('Can I cancel a dispatch service anytime?','With a fair service, yes. Loadboot has no contracts &mdash; we earn your business load by load, and you can stop anytime with no penalty.')]
rich_article('owner-operator-dispatch-service-guide.html',
 'Owner-Operator Dispatch Service: The Complete Guide (2026)',
 'What an owner-operator dispatch service does, what it costs, how it works day to day, and how to choose one &mdash; a complete guide for single-truck operators.',
 'Owner-Operator Guide','Owner-Operator Dispatch Service: The Complete Guide',
 'Everything a single-truck operator needs to know about using a dispatch service &mdash; what it does, what it costs, whether new authority needs one, and how to choose a good one.',
 9,'owner-operator-dispatch-hero.jpg','Owner-operator standing beside his semi-truck reviewing a dispatched load',
 A4_TOC,A4_BODY,A4_FAQ,feat_svg=A4_FEAT)

# Blog index
THUMBS={
 'how-much-does-a-truck-dispatcher-cost.html':'<svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="ta" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e3a8a"/><stop offset="1" stop-color="#0b1220"/></linearGradient></defs><rect width="400" height="200" fill="url(#ta)"/><text x="18" y="150" font-family="Manrope,Arial" font-weight="800" font-size="140" fill="#2563EB" opacity=".42">5%</text><rect x="256" y="120" width="26" height="55" rx="4" fill="#2563EB"/><rect x="292" y="92" width="26" height="83" rx="4" fill="#3b82f6"/><rect x="328" y="64" width="26" height="111" rx="4" fill="#F97316"/></svg>',
 'truck-dispatcher-vs-freight-broker.html':'<svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="tb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1220"/><stop offset="1" stop-color="#1e3a8a"/></linearGradient></defs><rect width="400" height="200" fill="url(#tb)"/><text x="172" y="115" font-family="Manrope,Arial" font-weight="800" font-size="34" fill="#fff">VS</text><path d="M70 72 H150" stroke="#2563EB" stroke-width="9" stroke-linecap="round"/><path d="M150 60 L172 72 L150 84 Z" fill="#2563EB"/><path d="M330 128 H250" stroke="#F97316" stroke-width="9" stroke-linecap="round"/><path d="M250 116 L228 128 L250 140 Z" fill="#F97316"/></svg>',
 'how-to-get-loads-with-new-authority.html':'<svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="tc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e3a8a"/><stop offset="1" stop-color="#0b1220"/></linearGradient></defs><rect width="400" height="200" fill="url(#tc)"/><path d="M36 150 C 130 105 220 175 372 100" fill="none" stroke="#F97316" stroke-width="6" stroke-dasharray="2 14" stroke-linecap="round"/><circle cx="36" cy="150" r="10" fill="#2563EB"/><g transform="translate(330,70)" fill="#fff"><rect x="0" y="0" width="6" height="46"/><path d="M6 2 H42 L31 14 L42 26 H6 Z"/></g></svg>',
 'owner-operator-dispatch-service-guide.html':'<svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="td" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1220"/><stop offset="1" stop-color="#1e3a8a"/></linearGradient></defs><rect width="400" height="200" fill="url(#td)"/><text x="24" y="168" font-family="Manrope,Arial" font-weight="800" font-size="150" fill="#2563EB" opacity=".38">1</text><g transform="translate(150,84)" fill="#e2e8f0"><rect x="0" y="0" width="118" height="46" rx="4"/><path d="M118 10h22c3 0 5 1.6 6.8 4l12.4 19c1 1.5 1.6 3.3 1.6 5.2V46H118z" fill="#2563EB"/><rect x="124" y="15" width="15" height="15" fill="#bfdbfe"/></g><g fill="#0f172a"><circle cx="188" cy="132" r="13"/><circle cx="286" cy="132" r="13"/></g><g fill="#F97316"><circle cx="188" cy="132" r="5"/><circle cx="286" cy="132" r="5"/></g></svg>'}
def blog_card(fn,title,excerpt,read):
    thumb=THUMBS.get(fn,'<svg viewBox="0 0 400 200"><rect width="400" height="200" fill="#0b1220"/></svg>')
    slug=fn[:-5] if fn.endswith('.html') else fn
    # Optional real photo: drop a file named thumb-<slug>.jpg in the site folder and it
    # Optional real photo: only referenced if thumb-<slug>.jpg is actually present in SRC,
    # otherwise the branded SVG thumbnail is used (no broken/missing image reference).
    img=('<img src="thumb-'+slug+'.jpg" alt="'+title.replace('"','')+'" loading="lazy" decoding="async">') if asset_exists('thumb-'+slug+'.jpg') else ''
    ov='<div class="bc-ov"></div><span class="bc-brand"><span class="bc-l">L</span>oadboot</span>'
    return ('<a class="blogcard" href="'+fn+'"><div class="bc-thumb">'+thumb+img+ov+'</div><div class="bc-body">'
            '<div class="bc-meta">Guide &middot; '+str(read)+' min read</div><h3>'+title+'</h3><p>'+excerpt
            +'</p><span class="bc-link">Read guide &rarr;</span></div></a>')
READTIME={'how-much-does-a-truck-dispatcher-cost.html':8,'truck-dispatcher-vs-freight-broker.html':9,'how-to-get-loads-with-new-authority.html':6,'owner-operator-dispatch-service-guide.html':9}
bcards = ''.join(blog_card(fn,t,ex,READTIME.get(fn,5)) for fn,t,d,ex,bl in BLOGPOSTS)
blog_body = svc_hero('The Loadboot Blog','Practical guides for owner-operators and carriers &mdash; pricing, authority, finding loads, and running a more profitable truck.')
blog_body += '<section class="bg-soft"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Guides &amp; resources</div><h2>Latest from Loadboot</h2></div><div class="bloggrid">%s</div></div></section>' % bcards
blog_body += final_cta()
page('blog.html','Loadboot Blog: Dispatch Tips &amp; Guides | Carriers','Practical truck dispatch guides for owner-operators and new-authority carriers: pricing, finding loads, dispatcher vs broker, and more.','blog.html', blog_body)

# ---------- LEGAL PAGES ----------
priv = svc_hero('Privacy Policy','How Loadboot collects, uses, and protects your information.')
priv += '''<section><div class="wrap prose reveal" style="max-width:800px">
<p><em>Last updated: 2026.</em> This Privacy Policy explains how Loadboot ("we", "us") handles information you provide through this website.</p>
<h2>Information we collect</h2><p>Depending on how you use Loadboot, we may collect: <b>account information</b> (name, email, phone, password handled securely by our authentication provider); <b>carrier and authority information</b> (company, MC/DOT numbers, equipment, lanes, preferences); <b>documents you upload</b> (such as authority, insurance, W-9 and load paperwork), stored privately; <b>precise location</b> &mdash; only if and while you explicitly consent to share it for load matching or active-load tracking; <b>usage analytics</b> on our public marketing pages. We do <b>not</b> run advertising analytics inside the authenticated carrier portal.</p>
<h2>How we use it</h2><p>To provide dispatch services &mdash; finding, negotiating and booking loads; reviewing carrier documents; matching loads to your equipment and (with consent) location; communicating about your loads and account; and operating and improving the website. We do not sell your information.</p>
<h2>Precise location &mdash; consent based</h2><p>Location sharing is <b>optional</b> and off by default. The portal is fully usable without it. You choose either a one-time share or sharing while a load is active, and you can revoke it at any time from your dashboard. We record your consent and store only your most recent location while sharing is active; sharing stops when you revoke it, sign out, or the active period ends. Only your assigned LoadBoot dispatcher can view it.</p>
<h2>Sharing</h2><p>We share information only as needed to provide services &mdash; for example, with brokers or a factoring company you choose &mdash; or where required by law. We do not sell personal information.</p>
<h2>Data security</h2><p>Documents are kept in private storage with per-account access controls and time-limited links; access to carrier records is restricted by server-enforced authorization so one carrier cannot access another&rsquo;s data. No method of transmission is perfectly secure, but we apply reasonable safeguards.</p>
<h2>Retention</h2><p>We keep information for as long as needed to provide services and meet legal obligations, then delete or anonymize it. Location data is minimized to the latest necessary point rather than a long history, unless a reviewed operational need applies.</p>
<h2>Your rights</h2><p>You may request access to, correction of, or deletion of your information, withdraw location consent, or close your account, by contacting us through this site. We will respond promptly.</p>
<h2>Contact</h2><p>Questions about this policy? Reach us through our contact page.</p></div></section>'''
priv += final_cta()
page('privacy.html','Privacy Policy | Loadboot','How Loadboot collects, uses, and protects the information you share through our website.','privacy.html',priv)

terms = svc_hero('Terms of Service','The terms that govern your use of the Loadboot website and services.')
terms += '''<section><div class="wrap prose reveal" style="max-width:800px">
<p><em>Last updated: 2026.</em> By using this website or our dispatch services, you agree to these terms.</p>
<h2>Our services</h2><p>Loadboot provides truck dispatch services to carriers who hold their own operating authority. We represent the carrier, not the shipper, and we are not a freight broker.</p>
<h2>Dispatch agreement</h2><p>Dispatch services are provided under a separate written dispatch agreement signed by you and Loadboot, which governs fees, responsibilities, and termination. Our standard fee is a flat percentage of gross on loads we book, with no long-term contract.</p>
<h2>Your responsibilities</h2><p>You are responsible for maintaining valid authority, insurance, and compliance, for operating safely and legally, and for approving every load before it is booked.</p>
<h2>No guarantee</h2><p>We work hard to find quality, well-paying freight, but we do not guarantee specific rates, load volume, or income. Market conditions vary.</p>
<h2>Limitation of liability</h2><p>To the fullest extent permitted by law, Loadboot is not liable for indirect or consequential damages arising from the use of our website or services.</p>
<h2>Changes</h2><p>We may update these terms from time to time. Continued use of the site means you accept the current terms.</p></div></section>'''
terms += final_cta()
page('terms.html','Terms of Service | Loadboot','The terms governing your use of the Loadboot website and truck dispatch services.','terms.html',terms)

# ---------- FLAGSHIP: LOAD SCORE ("Should You Take This Load?") ----------
ls_faqs = [
 ('Should I take this load if the rate per mile looks good?','Not always. A high rate per mile can still lose you money once you add deadhead miles to the pickup, a weak market on the delivery end, or long detention. The Load Score above weighs all of that against your real cost per mile and gives you a clear answer.'),
 ('How do I decide if a load is worth taking?','Start with your true cost per mile, then subtract every mile you will drive &mdash; loaded and empty &mdash; plus the time it ties up your truck. If the load does not clear your costs with a healthy margin, you either negotiate or pass. The tool does this math for you in seconds.'),
 ('Does deadhead really matter that much?','Yes. Empty miles to the pickup burn fuel and hours but earn nothing, so they quietly drag down your real rate per mile. A load that looks like $2.40 a mile can fall under $2.00 once deadhead is counted &mdash; which is exactly what the Load Score reveals.'),
 ('What is a good profit margin on a freight load?','Most healthy owner-operators aim for at least a 20&ndash;30% margin over their all-in cost. Set your target in the tool and it will tell you the lowest rate you should accept and suggest a counter-offer to get there.'),
 ('Can Loadboot just find good loads for me?','Yes &mdash; that is the whole point of a dispatcher. We screen loads against numbers like these, negotiate the rate, and keep your truck on profitable freight. Flat 5%, no contracts.'),
]
ls_faq_html, ls_faq_schema = faq_block(ls_faqs)
ls_seo = '''<section class="bg-soft"><div class="wrap" style="max-width:880px">
<h2>How to know if a load is worth taking</h2>
<p style="margin-top:14px">Every owner-operator faces the same question a dozen times a day: <em>should I take this load?</em> A broker throws a rate at you, the clock is ticking, and you have about thirty seconds to decide. Most drivers fall back on rate per mile &mdash; but that single number hides more than it shows. The Load Score tool above turns the offer into an honest answer by weighing everything that actually decides whether a load makes you money.</p>
<h3 style="margin-top:26px">Why rate per mile alone will trick you</h3>
<p>A load that reads $2.40 per mile sounds great until you count the 150 empty miles you will run just to reach the pickup. Those deadhead miles burn fuel and hours but pay nothing, so your real rate per mile drops fast. The same load can also strand you in a weak freight market where your next load runs cheap or empty. Time matters too: a load that ties up your truck for three days at a so-so rate can be worth less than a tighter one you can turn in a day. None of that shows up in the rate per mile &mdash; but all of it shows up in your bank account.</p>
<h3 style="margin-top:22px">What the Loadboot Load Score measures</h3>
<p>Instead of a single number, the Load Score blends five things real dispatchers weigh on every load: your profit margin after all-in costs, your true rate per mile across loaded <strong>and</strong> deadhead miles, how badly empty miles are dragging the rate, your profit per day, and the strength of the freight market where the load drops you. It rolls those into a score from 0 to 100 and a plain verdict &mdash; <strong>take it, negotiate, or pass</strong> &mdash; so you are not doing trucking math in your head at a truck stop.</p>
<h3 style="margin-top:22px">Counter the offer &mdash; do not just accept or walk</h3>
<p>The most profitable owner-operators rarely accept the first number, and they rarely hang up either. They counter. That is why the tool also gives you a suggested counter-offer: the exact total and rate per mile you should ask for to hit your target margin. Knowing that number before you call the broker back is the difference between hoping a load pays and knowing it does. If you want to sharpen the inputs first, run your numbers through our free <a href="tools.html">cost-per-mile and profit calculators</a>.</p>
<h3 style="margin-top:22px">Let a dispatcher take this off your plate</h3>
<p>This tool is free to use as often as you like &mdash; no signup, no catch. But if you would rather drive than screen loads all day, that is exactly what we do. A dedicated Loadboot dispatcher scores loads like this, negotiates the rate, and keeps your truck on freight that actually pays &mdash; flat 5%, no contracts. <a href="contact.html">Get started in two minutes</a> or <a href="services.html">see everything we handle</a>.</p>
</div></section>'''
ls_body = svc_hero('Should You Take This Load?','Paste in any load offer and get an instant score, a clear take / negotiate / pass verdict, and a smart counter-offer &mdash; built on your real cost per mile. Free, no signup.')
ls_body += '<section style="padding-top:10px"><div class="wrap">' + LS_HTML + '<p class="center" style="margin-top:22px;color:var(--muted);font-size:.9rem">Nothing you type is saved or sent anywhere &mdash; it all runs right in your browser.</p></div></section>'
ls_body += ls_seo + ls_faq_html + final_cta() + '<script>' + LS_JS + '</script>'
ls_howto = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"HowTo","name":"How to decide whether to take a freight load","step":[{"@type":"HowToStep","name":"Enter the offer","text":"Enter what the load pays, the loaded miles, and the deadhead miles to the pickup."},{"@type":"HowToStep","name":"Add your costs","text":"Enter your all-in cost per mile and how many days the load will take."},{"@type":"HowToStep","name":"Read the score and verdict","text":"The Load Score returns a 0-100 score and a take, negotiate, or pass verdict based on profit, deadhead, time, and market."},{"@type":"HowToStep","name":"Counter the rate","text":"Use the suggested counter-offer to negotiate a rate that hits your target margin before you accept."}]}</script>'
ls_app = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebApplication","name":"Loadboot Load Score","applicationCategory":"BusinessApplication","operatingSystem":"Web","offers":{"@type":"Offer","price":"0","priceCurrency":"USD"},"description":"Free tool that tells truckers and owner-operators whether a freight load is worth taking, with a take-negotiate-pass verdict and a suggested counter-offer."}</script>'
page('load-score.html','Should You Take This Load? Free Load Score Tool for Truckers','Free tool that scores any freight load and tells you to take, negotiate, or pass — with a counter-offer based on your cost per mile.','load-score.html', ls_body, ls_app + ls_howto + ls_faq_schema)

# ---------- FREE TOOLS ----------
LSP = '<section><div class="wrap"><a href="load-score.html" class="reveal" style="display:flex;align-items:center;gap:22px;flex-wrap:wrap;justify-content:space-between;background:linear-gradient(135deg,#0F172A,#1e3a8a);color:#fff;border-radius:22px;padding:30px 34px;text-decoration:none;box-shadow:0 30px 60px -34px rgba(15,23,42,.6)"><div style="max-width:640px"><div style="font-size:.74rem;letter-spacing:.14em;text-transform:uppercase;color:#fbbf24;font-weight:700;margin-bottom:8px">Our #1 free tool</div><div style="font-family:\'Manrope\';font-weight:800;font-size:1.7rem;line-height:1.15;margin-bottom:8px">Should You Take This Load?</div><p style="color:#cbd5e1;margin:0;font-size:.97rem">Stop guessing. Get an instant take / negotiate / pass score on any load &mdash; with a suggested counter-offer built on your real costs.</p></div><span class="btn btn-primary" style="white-space:nowrap">Open Load Score &rarr;</span></a></div></section>'
tools_faqs = [
 ('Are these truck dispatcher tools really free?','Yes. Every calculator on this page is 100% free, with no login and no signup. Use them as often as you like, right here on the page.'),
 ('How do I calculate profit on a load?','Enter what the load pays, the total miles, your fuel price and MPG, plus any tolls or expenses. The Load Profit Calculator instantly shows your net profit and your rate per mile.'),
 ('What is a good rate per mile for owner-operators?','It depends on your costs, but most owner-operators need at least $1.80 to $2.00 per mile just to break even. Use the Cost-Per-Mile and Break-Even tools above to find your own number.'),
 ('Why does my cost per mile matter so much?','Your cost per mile is the foundation of every load decision. Any rate below it loses money. The calculator above turns your monthly fixed and variable costs into one number you can judge any rate against.'),
 ('Can Loadboot just handle all of this for me?','Yes &mdash; that is exactly what we do. We negotiate rates, plan lanes, and keep your truck loaded so you are not crunching these numbers on every load. Flat 5%, no contracts.'),
]
tools_faq_html, tools_faq_schema = faq_block(tools_faqs)
tools_intro = '<section><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">Free trucker tools</div><h2>Free dispatch &amp; profit calculators for truckers</h2><p class="lead center" style="margin:0 auto">No login. No signup. Just fast, accurate calculators that owner-operators and fleets actually use to price loads, cut costs, and protect every mile &mdash; built by the dispatch team at Loadboot.</p></div></div></section>'
tools_section = '<section style="padding-top:0"><div class="wrap">' + TOOLS_HTML + '</div></section>'
tools_seo = '''<section class="bg-soft"><div class="wrap" style="max-width:880px">
<h2>Know your numbers before you take the load</h2>
<p style="margin-top:14px">Every profitable trucking business runs on a few simple numbers: what a load pays, what it actually costs to run those miles, and what is left over for you. The free calculators above put all of them in one place &mdash; no spreadsheet, no signup &mdash; so you can make a confident call on any load in seconds.</p>
<h3 style="margin-top:26px">Load profit &amp; rate per mile</h3>
<p>The <a href="tools.html#profit">load profit calculator</a> and <a href="tools.html#rpm">rate-per-mile calculator</a> answer the first question every owner-operator asks: is this load worth it? Drop in the rate, the miles, and your fuel numbers, and you instantly see your net profit and your true dollars-per-mile &mdash; before you ever call the broker back.</p>
<h3 style="margin-top:22px">Cost per mile &amp; break-even rate</h3>
<p>Your <a href="tools.html#cpm">cost per mile</a> is the single most important number in your business, and most drivers underestimate it. Once you know it, the <a href="tools.html#breakeven">break-even rate calculator</a> tells you the lowest rate you can accept and still hit your target margin &mdash; so you never haul cheap freight by accident.</p>
<h3 style="margin-top:22px">Fuel, take-home, detention &amp; deadhead</h3>
<p>Diesel is the biggest variable cost on the road, so the <a href="tools.html#fuel">fuel cost calculator</a> helps you price any lane in seconds. The <a href="tools.html#takehome">owner-operator take-home calculator</a> shows what really lands in your pocket after fuel and fees, the <a href="tools.html#detention">detention pay calculator</a> tells you what a shipper owes for wasting your day, and the <a href="tools.html#deadhead">deadhead calculator</a> reveals how empty miles quietly shrink your real rate.</p>
<h3 style="margin-top:22px">Want a dispatcher to handle the numbers for you?</h3>
<p>These tools are free to use forever. But if you would rather spend your time driving than crunching rates, that is exactly what we do. <a href="contact.html">Get started with Loadboot</a> and a dedicated dispatcher will find the loads, run these numbers, and negotiate the rate for you &mdash; flat 5%, no contracts. <a href="services.html">See all of our services</a>.</p>
</div></section>'''
tools_body = svc_hero('Free Tools for Truckers &amp; Owner-Operators','Price loads, know your true cost per mile, and stop leaving money on the table &mdash; with the same calculators our dispatchers use every day. Free, no signup, instant results.')
tools_body += LSP + tools_intro + tools_section + tools_seo + tools_faq_html + final_cta() + '<script>' + TOOLS_JS + '</script>'
tools_schema = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebApplication","name":"Loadboot Free Trucker Tools","applicationCategory":"BusinessApplication","operatingSystem":"Web","offers":{"@type":"Offer","price":"0","priceCurrency":"USD"},"description":"Free load profit, rate-per-mile, cost-per-mile, fuel, break-even, take-home, detention and deadhead calculators for truck drivers and owner-operators."}</script>' + tools_faq_schema
page('tools.html','Free Truck Driver Calculators (No Signup) | Loadboot','Free load profit, rate-per-mile, cost-per-mile, fuel, break-even, take-home and detention calculators for owner-operators. No login.','tools.html', tools_body, tools_schema)

# ======================================================================
# SPRINT 1 — PUBLIC MARKETING WEBSITE COMPLETION (added pages)
# Real, SEO-complete pages built on the same header/footer/design system.
# ======================================================================
def _sec(eyebrow, h2, inner, soft=False):
    return '<section%s><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">%s</div><h2>%s</h2></div>%s</div></section>' % (
        ' class="bg-soft"' if soft else '', eyebrow, h2, inner)

def _cards(items, cols='g3'):
    cs = ''.join('<div class="card reveal"><div class="icon">%s</div><h3>%s</h3><p>%s</p></div>' % (ic, t, d) for ic, t, d in items)
    return '<div class="grid %s reveal">%s</div>' % (cols, cs)

_FORM_N = [0]
def lead_form(form_key, heading, intro, fields, submit_label, success_msg):
    # fields: list of (name, label, type, required) ; type in text/email/tel/textarea/select:opt1|opt2
    _FORM_N[0] += 1
    fid = 'lf%d' % _FORM_N[0]
    rows = ''
    for nm, lb, ty, req in fields:
        r = ' required' if req else ''
        if ty == 'textarea':
            ctl = '<textarea name="%s"%s placeholder="%s"></textarea>' % (nm, r, lb)
        elif ty.startswith('select:'):
            opts = ''.join('<option>%s</option>' % o for o in ty.split(':', 1)[1].split('|'))
            ctl = '<select name="%s"%s><option value="">Select&hellip;</option>%s</select>' % (nm, r, opts)
        else:
            ctl = '<input type="%s" name="%s"%s placeholder="%s">' % (ty, nm, r, lb)
        rows += '<div class="field full"><label>%s</label>%s</div>' % (lb, ctl)
    js = ("(function(){var f=document.getElementById('%s');if(!f)return;f.addEventListener('submit',function(e){e.preventDefault();"
          "var b=document.getElementById('%s_b');b.disabled=true;b.textContent='Sending…';"
          "var d={};new FormData(f).forEach(function(v,k){d[k]=v;});if(d._hp){return;}"
          "if(window.lbSubmitLead){window.lbSubmitLead('%s',d).then(function(r){if(r.ok){f.innerHTML='<div style=\\'text-align:center;padding:34px\\'><div style=\\'font-size:2.4rem;color:#16a34a\\'>&#10003;</div><h3 style=\\'margin:10px 0\\'>%s</h3></div>';if(window.lbTrack)window.lbTrack('conversion',{form:'%s'});}else{b.disabled=false;b.textContent='%s';alert('Something went wrong — please email hello@loadboot.com.');}}).catch(function(){b.disabled=false;b.textContent='%s';alert('Network error — please try again or email hello@loadboot.com.');});}"
          "else{b.disabled=false;b.textContent='%s';}});})();" ) % (fid, fid, form_key, success_msg, form_key, submit_label, submit_label, submit_label)
    return ('<section class="bg-soft"><div class="wrap" style="max-width:720px">'
            '<form class="quote-wrap reveal" id="%s"><h3 style="margin-bottom:6px">%s</h3>'
            '<p style="color:var(--muted);margin-bottom:18px">%s</p>'
            '<p hidden><label>Skip<input name="_hp"></label></p>'
            '<div class="form-grid">%s</div>'
            '<button class="btn btn-primary" id="%s_b" style="width:100%%;justify-content:center;margin-top:22px">%s</button>'
            '<p style="text-align:center;margin-top:12px;font-size:.9rem">We reply within one business day.</p>'
            '</form></div></section><script>%s</script>') % (fid, heading, intro, rows, fid, submit_label, js)

# ---- How It Works ----
hiw = svc_hero('How Loadboot Works', 'From first call to steady miles &mdash; here is exactly how we get your truck loaded, keep it moving, and pay you faster. You keep your authority and approve every load.')
hiw += _sec('The process', 'Four steps to a loaded truck', _cards([
    ('1', 'Tell us about your truck', 'Share your equipment, home base, preferred lanes and target rate. Setup takes about two minutes &mdash; no contract, no commitment.'),
    ('2', 'We find &amp; negotiate loads', 'Your dispatcher works the boards and broker relationships to find higher-paying freight on your lanes, then negotiates the rate before you ever see it.'),
    ('3', 'You approve &amp; roll', 'Every load comes to you first. You approve it, we handle the rate confirmation and paperwork, and you drive. We are on call while you are on the road.'),
    ('4', 'Get paid, then repeat', 'We prepare your invoice and documents, help with factoring, and line up your next load so you are never sitting empty.'),
], 'g4'))
hiw += _sec('What you keep', 'You stay in control', _cards([
    ('&#9989;', 'Your own authority', 'You keep your MC/DOT and your relationships. We work for you, not the other way around.'),
    ('&#9989;', 'Approval on every load', 'Nothing books without your yes. No surprise freight, no forced dispatch.'),
    ('&#9989;', 'No contracts', 'Flat 5% only when we book you. If we are not earning it, you can walk.'),
]), )
hiw += final_cta()
page('how-it-works.html', 'How Truck Dispatch Works with Loadboot | Step by Step',
     'See exactly how Loadboot dispatch works: tell us about your truck, we find and negotiate loads, you approve every one, and we help you get paid faster. Flat 5%, no contracts.',
     'how-it-works.html', hiw)

# ---- FAQ ----
_faq_items = [
 ('How much does Loadboot dispatch cost?', 'A flat 5% of the linehaul on loads we book for you &mdash; no sign-up fee, no monthly minimum, and no long-term contract. You only pay when we actually put money on your truck.'),
 ('Do I keep my own authority?', 'Yes. You keep your MC/DOT authority, your insurance and your broker relationships. Loadboot works on your behalf; we never take over your authority.'),
 ('Is there a contract or cancellation fee?', 'No contract and no cancellation fee. You can pause or stop any time. We keep your business by earning it, not by locking you in.'),
 ('What equipment types do you dispatch?', 'Dry van, reefer, flatbed, step deck, hotshot, power only and box truck / expedited. If you run mixed equipment, we handle that too.'),
 ('How fast can I get started?', 'Most carriers are set up the same day. Create your profile, send us your authority and insurance, and a dispatcher gets to work on your lanes.'),
 ('Do you help new-authority carriers?', 'Yes &mdash; new-authority carriers are a big part of who we serve. We help you get your first loads, build broker credibility, and avoid the common early mistakes.'),
 ('Who talks to the brokers?', 'Your dispatcher does. We negotiate the rate, handle the rate confirmation and paperwork, and keep the broker relationship professional so you can focus on driving.'),
 ('How do I get paid?', 'You invoice the broker (or your factoring company does). We prepare the invoice and supporting documents &mdash; rate con, BOL and POD &mdash; so nothing slows your payment down.'),
 ('Do you help with factoring, IFTA and compliance?', 'Yes. We can connect you with factoring, help keep your filings and permits current, and support you on IFTA, 2290, UCR and BOC-3.'),
 ('What hours is dispatch available?', 'A dispatcher is reachable during business hours and on call for active loads. If your truck is moving, we are reachable.'),
]
_faq_html, _faq_sch = faq_block(_faq_items)
faq_body = svc_hero('Frequently Asked Questions', 'Straight answers about pricing, authority, equipment, getting started and how dispatch actually works. Do not see your question? Contact us any time.')
faq_body += _faq_html + final_cta()
page('faq.html', 'Truck Dispatch FAQ &mdash; Pricing, Authority &amp; Getting Started | Loadboot',
     'Answers to the most common questions about Loadboot truck dispatch: cost, authority, contracts, equipment types, getting started, factoring and compliance.',
     'faq.html', faq_body, _faq_sch)

# ---- Box Truck Dispatch (service page) ----
_btfaq_html, _btfaq_sch = faq_block([
    ('Do box trucks need their own MC authority?', 'If your box truck is over 10,001 lbs GVWR and hauls interstate freight for hire, yes &mdash; you generally need operating authority and insurance just like a semi. We can point you to the right compliance steps before you start.'),
    ('What loads suit a 26-ft box truck best?', 'LTL and partial freight, final-mile retail and furniture, expedited hot shots and trade-show or event freight. We match by weight, dock height and liftgate capability so you are not offered freight you cannot load.'),
    ('Is expedited freight really worth it?', 'When it fits your schedule &mdash; often yes. Time-critical loads pay a premium for reliability. The trade-off is strict windows, so we only push expedited runs your schedule can actually make.'),
    ('Do you dispatch cargo vans and sprinters?', 'Yes, where the freight genuinely fits the vehicle. We are honest about it: van freight is a thinner market than box trucks, and we will tell you what your lanes realistically pay.'),
])
bt = svc_hero('Box Truck &amp; Expedited Dispatch', 'Dispatch built for box trucks, sprinter vans and expedited freight &mdash; we keep your smaller equipment loaded with the right runs at the right rate.')
bt += _sec('Box truck dispatch', 'Loads that fit your equipment', _cards([
    ('&#128230;', 'Right-sized freight', 'We match box trucks and cargo/sprinter vans with LTL, final-mile, expedited and time-critical loads that pay &mdash; not deadhead.'),
    ('&#9889;', 'Expedited &amp; hot loads', 'Time-critical freight is our sweet spot for smaller equipment. We move fast so you can too.'),
    ('&#128176;', 'Flat 5%, no contract', 'Same honest pricing as our truckload dispatch: you only pay when we book you.'),
]))
bt += _sec('Freight we book', 'Box truck &amp; expedited freight we dispatch', _cards([
    ('&#128666;', 'LTL &amp; partials', 'Less-than-truckload and partial freight sized for 16&ndash;26 ft boxes &mdash; steady, repeatable work between bigger runs.'),
    ('&#127968;', 'Final-mile &amp; retail', 'Residential and store deliveries, furniture and appliances &mdash; liftgate and inside-delivery requirements captured before you accept.'),
    ('&#9200;', 'Expedited &amp; time-critical', 'Hot freight that pays a premium for a hard delivery window your schedule can genuinely make.'),
    ('&#127914;', 'Events &amp; trade shows', 'Show freight with strict move-in/move-out windows &mdash; we coordinate the appointments so you just drive.'),
    ('&#128188;', 'Dedicated &amp; recurring routes', 'Repeat lanes for the same customer &mdash; predictable weeks once your service record earns them.'),
    ('&#128736;', 'Equipment-matched only', 'Dock height, liftgate, pallet jack, weight &mdash; we check the requirements so you are never sent to freight you cannot load.'),
], 'g3'))
bt += _sec('Rates', 'What drives box truck rates (and how we protect yours)', _cards([
    ('&#128200;', 'Urgency premium', 'Expedited windows pay more &mdash; we chase the time-critical freight that values a reliable smaller truck.'),
    ('&#128205;', 'Lane &amp; region balance', 'Final-mile-heavy metros pay differently than lane freight; we plan runs so you are not stuck deadheading home.'),
    ('&#9878;', 'Accessorials documented', 'Liftgate work, inside delivery, wait time &mdash; recorded with real timestamps and billed, not absorbed.'),
]), soft=True)
bt += _sec('How it works', 'From sign-up to your first expedited run', _cards([
    ('1', 'Profile &amp; equipment', 'Truck size, dock height, liftgate, GVWR and your service area &mdash; five minutes to set up.'),
    ('2', 'We find &amp; negotiate', 'Your dispatcher sources LTL, final-mile and expedited freight that fits, negotiates the rate and checks the broker.'),
    ('3', 'You drive, we handle the rest', 'Paperwork, status updates, POD collection and invoice prep &mdash; you focus on the road.'),
]))
bt += _btfaq_html
bt += final_cta()
page('box-truck-dispatch.html', 'Box Truck &amp; Expedited Dispatch Service | Loadboot',
     'Box truck, cargo van and expedited freight dispatch. Loadboot keeps your smaller equipment loaded with LTL, final-mile and hot loads. Flat 5%, no contracts.',
     'services.html', bt, _btfaq_sch)

# ---- Careers ----
car = svc_hero('Careers at Loadboot', 'We are building an honest dispatch company for the people who keep America moving. If that sounds like you, we would love to talk.')
car += '<section><div class="wrap prose reveal"><h2>Why work here</h2><p>Loadboot exists to give carriers a dispatcher who actually has their back. We hire people who take that seriously &mdash; dispatchers, carrier-success reps, and builders who care about doing right by the driver on the other end of the phone.</p><h2>Open roles</h2><p>We are a growing team and hire as we scale. If you have dispatch, brokerage, carrier sales, compliance or trucking-tech experience, apply below and tell us what you are great at. Real people read every message.</p></div></section>'
car += lead_form('careers', 'Apply to Loadboot', 'Tell us about yourself and what you would want to own here.',
    [('name', 'Your name', 'text', True), ('email', 'Email', 'email', True), ('phone', 'Phone', 'tel', False),
     ('company', 'Current / most recent role', 'text', False),
     ('message', 'What are you great at? Share a link to your CV or LinkedIn.', 'textarea', True)],
    'Send application', 'Thanks — we&rsquo;ll be in touch.')
page('careers.html', 'Careers at Loadboot | Join an Honest Dispatch Company',
     'Join Loadboot. We hire dispatchers, carrier-success reps and builders who care about doing right by carriers. See how to apply.',
     'careers.html', car)

# ---- Partner Program ----
pp = svc_hero('Loadboot Partner Program', 'For brokers, shippers and facilities who want a reliable, professional carrier network and clean, on-time paperwork.')
pp += _sec('Partner with Loadboot', 'A network you can rely on', _cards([
    ('&#129309;', 'Vetted carriers', 'Work with carriers whose authority, insurance and compliance are actively tracked &mdash; fewer surprises, cleaner loads.'),
    ('&#128203;', 'Clean documentation', 'Rate confirmations, BOLs and PODs handled properly and delivered on time, so billing and claims stay simple.'),
    ('&#128222;', 'One point of contact', 'A professional dispatch team that answers the phone and communicates proactively on every load.'),
]))
pp += lead_form('partner_inquiry', 'Become a partner', 'Tell us about your freight and lanes and we will connect you with the right carriers.',
    [('name', 'Your name', 'text', True), ('company', 'Company', 'text', True), ('email', 'Email', 'email', True),
     ('phone', 'Phone', 'tel', False),
     ('partner_type', 'You are a', 'select:Broker|Shipper|Facility|Other', True),
     ('message', 'Lanes, freight type, and volume', 'textarea', False)],
    'Request partnership', 'Thanks — our partner team will reach out.')
pp += '<section><div class="wrap center" style="text-align:center"><a href="/app/partner/" class="btn btn-secondary">Existing partner? Log in &rarr;</a></div></section>'
page('partners.html', 'Partner Program for Brokers, Shippers &amp; Facilities | Loadboot',
     'Partner with Loadboot for a reliable, vetted carrier network and clean, on-time documentation. Built for brokers, shippers and facilities.',
     'partners.html', pp)

# ---- Dedicated Carrier page (premium, ~14 sections) ----
def _prose(h2, *paras):
    return '<section><div class="wrap prose reveal"><h2>%s</h2>%s</div></section>' % (h2, ''.join('<p>%s</p>' % p for p in paras))
cp = svc_hero('Truck Dispatch Built Around Your Truck',
    'Loadboot is a dispatcher in your corner &mdash; we find the loads, negotiate the rate, handle the paperwork and keep you moving, so you can focus on driving. Flat 5%, no contracts, you keep your authority.')
cp += _sec('Why carriers choose Loadboot', 'A dispatcher that actually has your back', _cards([
    ('&#128666;', 'We keep your truck loaded', 'Dedicated dispatchers work your lanes and preferences so you spend less time hunting boards and more time earning.'),
    ('&#128176;', 'Better rates, negotiated for you', 'We know the lanes and we counter &mdash; you get a rate that reflects what the freight is really worth.'),
    ('&#129309;', 'You keep your authority', 'Your MC/DOT, your insurance, your broker relationships. We work on your behalf; we never take over your authority.'),
]))
cp += _sec('Who we serve', 'Built for every kind of carrier', _cards([
    ('&#128100;', 'Owner-operators', 'One-truck operations get a full dispatch team without hiring one &mdash; more loaded miles, less deadhead.'),
    ('&#128203;', 'New-authority carriers', 'We help you land your first loads, build broker credibility, and avoid the costly early mistakes.'),
    ('&#128667;', 'Small &amp; growing fleets', 'Assign drivers and trucks, track every trip, and run your whole operation from one carrier portal.'),
]))
cp += _sec('Equipment', 'Every trailer type, dispatched', _cards([
    ('&#128230;', 'Dry van &amp; reefer', 'The bread-and-butter freight, matched to your lanes and appointment windows.'),
    ('&#127981;', 'Flatbed &amp; step deck', 'Open-deck freight with the securement and permit awareness it demands.'),
    ('&#9889;', 'Hotshot, power-only &amp; box truck', 'Smaller and specialized equipment kept busy with the right expedited and drop-and-hook runs.'),
]))
cp += _sec('Load sourcing', 'How we find your freight', _cards([
    ('&#128269;', 'Real relationships, licensed sources', 'We source from broker and shipper relationships and licensed load channels &mdash; no scraping where it is not allowed.'),
    ('&#127760;', 'Matched to your preferences', 'Home time, preferred lanes, minimum rate-per-mile and equipment all factor into what we bring you.'),
    ('&#128200;', 'Reduced deadhead', 'We plan backhauls and next-load opportunities so more of your miles are paid miles.'),
]))
cp += _prose('Rate negotiation that puts money on your truck',
    'The most profitable carriers rarely take the first number. Neither do we. Your dispatcher knows the lane, knows what the freight should pay, and counters on your behalf &mdash; then handles the rate confirmation so the agreed number is the number you get. Want to sharpen your own targets first? Run the math with our free <a href="tools.html">cost-per-mile and profit calculators</a>.')
cp += _sec('Dispatch &amp; appointments', 'The busywork, handled', _cards([
    ('&#128197;', 'Pickup &amp; delivery appointments', 'We set and confirm appointments and keep the facility details straight so you are not stuck on hold.'),
    ('&#128241;', 'Real-time trip support', 'When something changes on the road, a dispatcher is reachable to re-work the plan.'),
    ('&#128221;', 'Rate cons &amp; paperwork', 'We handle the tender, rate confirmation and load documents so nothing slows you down.'),
]))
cp += _sec('Documents &amp; compliance', 'Kept current, kept clean', _cards([
    ('&#128196;', 'Document management', 'BOL, POD, scale tickets and lumper receipts organized against every load.'),
    ('&#128737;', 'Compliance support', 'We help keep authority, insurance and filings (IFTA, 2290, UCR, BOC-3) on your radar before they lapse.'),
    ('&#9989;', 'Broker credibility', 'Clean, on-time paperwork builds the reputation that gets you better loads.'),
]))
cp += _sec('When things go sideways', 'Detention, layover, lumper &amp; TONU support', _cards([
    ('&#9203;', 'Detention &amp; layover', 'Arrival and departure captured, evidence collected, and the accessorial pursued under your load terms.'),
    ('&#128176;', 'Lumper &amp; TONU', 'Lumper receipts and truck-ordered-not-used situations documented and billed properly.'),
    ('&#128295;', 'Breakdowns &amp; exceptions', 'When a trip hits trouble, we help re-plan and keep the broker informed.'),
]))
cp += _sec('Invoicing &amp; settlement', 'Get paid without the chase', _cards([
    ('&#129534;', 'Invoice-ready packets', 'Rate con, BOL and POD assembled so your invoice (or your factoring company) goes out clean.'),
    ('&#128179;', 'Factoring friendly', 'Works with your factoring so the paperwork never holds up your cash.'),
    ('&#128202;', 'Settlement visibility', 'See what you earned, what was deducted, and what is still owed &mdash; all in your portal.'),
]))
cp += _sec('Your carrier software', 'One dashboard for the whole operation', _cards([
    ('&#128202;', 'Fleet &amp; drivers', 'Add drivers and trucks, watch license and medical expirations, and assign equipment to trips.'),
    ('&#128666;', 'Trips &amp; tracking', 'Confirm, start and deliver loads, share location, and see a full trip timeline.'),
    ('&#128241;', 'Pocket app for drivers', 'Drivers upload PODs, update status and share location from their phone &mdash; no extra hardware.'),
]))
cp += _sec('Getting started', 'On your lanes the same day', _cards([
    ('&#128221;', '1. Create your profile', 'Tell us your equipment, lanes and preferences &mdash; about two minutes.'),
    ('&#128228;', '2. Send authority &amp; insurance', 'We verify the basics so brokers say yes faster.'),
    ('&#128666;', '3. Start getting loads', 'A dispatcher goes to work on your lanes right away. No contract, cancel anytime.'),
]))
_cfaq_html, _cfaq_sch = faq_block([
    ('What does Loadboot cost carriers?', 'A flat 5% of the linehaul on loads we book &mdash; no sign-up fee, no monthly minimum, no contract. You only pay when we put money on your truck.'),
    ('Do I keep my own authority and insurance?', 'Yes. You keep your MC/DOT, your insurance and your broker relationships. We work on your behalf and never take over your authority.'),
    ('Do you work with new-authority carriers?', 'Absolutely &mdash; new-authority carriers are a core part of who we serve. We help you land early loads and build credibility.'),
    ('What equipment do you dispatch?', 'Dry van, reefer, flatbed, step deck, hotshot, power-only and box truck / expedited.'),
    ('How fast can I start?', 'Most carriers are set up the same day once we have your authority and insurance.'),
])
cp += _cfaq_html + final_cta()
page('carriers.html', 'Truck Dispatch for Carriers &amp; Owner-Operators | Loadboot',
     'Loadboot dispatches your truck: finds loads, negotiates rates, handles paperwork, and supports detention, invoicing and compliance. Flat 5%, no contracts, keep your authority.',
     'services.html', cp, _cfaq_sch)

# ---- Dedicated Broker page (~15 sections; brokers only) ----
bp = svc_hero('A Reliable Carrier Network for Brokers',
    'Post a load and reach vetted carriers whose authority, insurance and compliance are actively tracked &mdash; with clean, on-time documentation and one professional point of contact on every load.')
bp += _sec('Why brokers work with Loadboot', 'Fewer surprises, cleaner loads', _cards([
    ('&#129309;', 'Vetted carriers', 'Carrier authority, insurance and compliance are actively monitored &mdash; you cover freight with less risk.'),
    ('&#128203;', 'Clean documentation', 'Rate confirmations, BOLs and PODs handled properly and returned on time, so billing and claims stay simple.'),
    ('&#128222;', 'One point of contact', 'A dispatch team that answers the phone and communicates proactively from tender to POD.'),
]))
bp += _sec('Getting set up', 'Onboarding &amp; verification', _cards([
    ('&#128221;', 'Apply as a broker partner', 'Share your company, authority and contacts. Activation is human-reviewed &mdash; no bots approving accounts.'),
    ('&#128737;', 'Authority &amp; verification', 'We verify broker authority and key details against public and licensed sources before you go live.'),
    ('&#9989;', 'Approved &amp; active', 'Once approved, you can post loads and reach the carrier network right away.'),
]))
bp += _sec('Posting a load', 'A guided load wizard', _cards([
    ('&#128230;', 'Structured, step by step', 'Lane, schedule, equipment, requirements and documents &mdash; captured cleanly, with duplicate detection.'),
    ('&#128203;', 'Document requirements up front', 'Set what you will provide (rate con, pickup/delivery numbers, appointment) so nothing stalls the load.'),
    ('&#128260;', 'Recurring lanes &amp; reposts', 'Repeat lanes and re-post prior loads with controlled changes instead of retyping everything.'),
]))
bp += _sec('Matching', 'The right carrier, explained', _cards([
    ('&#127919;', 'Eligibility first', 'Only carriers who pass hard checks &mdash; authority, insurance, equipment, availability &mdash; are ever offered your load.'),
    ('&#128200;', 'Explainable ranking', 'Carriers are ranked on capacity, performance, equipment fit and more, with the reasoning shown &mdash; never a black-box score.'),
    ('&#128101;', 'Preferred carriers', 'Route to your contracted or preferred carriers first, then broaden the search.'),
]))
bp += _sec('Operational visibility', 'Know where your freight is', _cards([
    ('&#128205;', 'Permitted live status', 'See load and trip status, pickup and delivery progress and the latest permitted ETA &mdash; automatically.'),
    ('&#128666;', 'Driver &amp; trip tracking', 'Location and check-ins where the carrier and driver have enabled tracking, clearly labeled.'),
    ('&#128276;', 'Exceptions surfaced', 'Detention, delays and appointment issues are raised early, not discovered at delivery.'),
]))
bp += _sec('Appointments &amp; documents', 'Kept straight', _cards([
    ('&#128197;', 'Appointment management', 'Pickup and delivery appointments tracked against facility requirements.'),
    ('&#128196;', 'Required documents', 'A live checklist of what is required, received, missing or rejected &mdash; for every load.'),
    ('&#128203;', 'POD &amp; billing', 'Proof of delivery captured and organized so billing and claims are painless.'),
]))
bp += _sec('When issues happen', 'Structured exception resolution', _cards([
    ('&#9203;', 'Detention &amp; accessorials', 'Arrival/departure evidence and accessorial requests handled under the load terms, with an audit trail.'),
    ('&#128260;', 'Reschedules &amp; re-covers', 'Appointment changes and re-covers coordinated quickly to protect the delivery.'),
    ('&#128221;', 'One clear record', 'Every exception has a reporter, timeline, owner and resolution &mdash; no he-said-she-said.'),
]))
bp += _sec('Integrations &amp; security', 'Fits how you already work', _cards([
    ('&#128268;', 'API &amp; webhooks', 'Subscribe to load, trip, document and delivery events; integrate with your TMS on approved endpoints.'),
    ('&#128274;', 'Permissioned data', 'You see what you are entitled to and nothing more &mdash; carrier financials and internal notes stay private.'),
    ('&#128737;', 'Audit &amp; consent', 'Actions are audited and communications respect consent and suppression rules.'),
]))
bp += lead_form('partner_inquiry', 'Become a broker partner', 'Tell us about your freight and lanes and we will get you set up with the carrier network.',
    [('name', 'Your name', 'text', True), ('company', 'Brokerage', 'text', True), ('email', 'Email', 'email', True),
     ('phone', 'Phone', 'tel', False), ('mc', 'MC number', 'text', False),
     ('message', 'Lanes, freight type and typical volume', 'textarea', False)],
    'Request partnership', 'Thanks — our partner team will reach out.')
_bfaq_html, _bfaq_sch = faq_block([
    ('Who can post loads on Loadboot?', 'Approved broker partners. Because moving freight from shippers requires a broker license in the US, load posting is for licensed brokers &mdash; carrier and driver accounts are separate.'),
    ('How are carriers vetted?', 'We actively track carrier authority, insurance and compliance, and only carriers who pass hard eligibility checks are offered your loads.'),
    ('Can I integrate with my TMS?', 'Yes &mdash; subscribe to load, trip, document and delivery events via webhooks and our API on approved endpoints.'),
    ('What visibility do I get?', 'Permitted live load and trip status, pickup and delivery progress, ETAs, document status and open exceptions &mdash; without exposing private carrier data.'),
])
bp += _bfaq_html
bp += '<section><div class="wrap center" style="text-align:center"><a href="/app/partner/" class="btn btn-secondary">Existing broker partner? Log in &rarr;</a></div></section>'
page('brokers.html', 'For Freight Brokers &mdash; A Reliable Carrier Network | Loadboot',
     'Brokers post loads to a vetted Loadboot carrier network with explainable matching, live visibility, clean documentation and API/webhook integration. Broker partners only.',
     'partners.html', bp, _bfaq_sch)

# ---- Shipper Solutions page (Inc 58, directive #37) — INQUIRY/CONSULTATION ONLY.
# HONESTY GUARD: LoadBoot is a dispatch service company. Freight from shippers requires a licensed
# freight broker in the US; this page never claims broker authority and offers inquiry/consultation only.
_sfaq_html, _sfaq_sch = faq_block([
    ('Can I book a truck directly on this page?', 'Not yet &mdash; shipper freight moves through licensed broker partners. Start with a consultation and we will map the compliant path for your lanes.'),
    ('Is LoadBoot a freight broker?', 'No. LoadBoot is a dispatch and logistics technology company. Where broker authority is required, freight is handled with licensed broker partners &mdash; we are transparent about that boundary.'),
    ('What information should I prepare?', 'Lanes (origin/destination), freight type, weight, equipment needs, monthly volume and any appointment or facility requirements. The more detail, the faster the consultation.'),
    ('How do facilities and appointments work?', 'We coordinate pickup and delivery appointments, capture facility instructions, and track arrive/depart times so detention is documented from real timestamps.'),
])
sp = svc_hero('Shipper Solutions &mdash; Talk to a Logistics Team That Answers',
    'Tell us about your lanes and freight. We will walk you through a compliant, transparent path to reliable capacity &mdash; consultation first, no obligations.')
sp += _sec('Scenarios', 'Where we help shippers', _cards([
    ('&#128230;', 'Recurring lanes', 'Weekly or monthly moves on the same lanes that deserve consistent equipment, consistent drivers and predictable pricing conversations.'),
    ('&#9889;', 'Coverage gaps', 'When your usual capacity falls through and you need a professionally coordinated plan instead of a scramble.'),
    ('&#128203;', 'Process cleanup', 'Late PODs, surprise accessorials and untracked detention &mdash; we bring documentation discipline to every shipment conversation.'),
]))
sp += _sec('Straight answer', 'What LoadBoot is &mdash; and is not', '<div class="prose reveal" style="max-width:820px;margin:0 auto"><p><strong>LoadBoot is a truck dispatch and logistics technology company, not a licensed freight broker.</strong> In the USA, moving freight on behalf of shippers requires broker authority. Where that authority is required, your freight is handled together with licensed broker partners &mdash; and we tell you exactly who is doing what on your shipment. No blurred lines, no implied authority.</p></div>', soft=True)
sp += _sec('Visibility', 'See your shipment, not a mystery', _cards([
    ('&#128205;', 'Tracking with consent', 'Trips are tracked via driver app GPS, ELD/telematics or structured check-ins &mdash; source and freshness are always labeled, never invented.'),
    ('&#9200;', 'Appointment awareness', 'Pickup and delivery windows, countdowns and late-risk flags &mdash; surprises surface early, while there is still time to act.'),
    ('&#128276;', 'Exception updates', 'Breakdowns, weather, facility delays &mdash; logged as structured exceptions with owners and resolution notes, visible to you.'),
]))
sp += _sec('Facilities', 'Facilities and appointments, handled properly', _cards([
    ('&#127970;', 'Facility instructions', 'Dock hours, check-in rules, parking and loading notes are captured once and travel with every shipment.'),
    ('&#128337;', 'Real dwell times', 'Arrive and depart timestamps are recorded at each stop &mdash; detention conversations start from measured minutes, not guesses.'),
    ('&#128221;', 'Clean paperwork', 'BOL and POD collection with review status &mdash; missing documents are chased automatically, not discovered at invoice time.'),
]))
sp += _sec('Network', 'The carrier network concept', '<div class="prose reveal" style="max-width:820px;margin:0 auto"><p>Behind every shipment is a vetted carrier network: authority, insurance and compliance are actively tracked, and only carriers who pass hard eligibility checks are matched to freight. Matching is explainable &mdash; equipment fit, real location, availability and history &mdash; not a black box.</p></div>', soft=True)
sp += _sec('Money', 'Billing without surprises', _cards([
    ('&#129534;', 'Documented accessorials', 'Detention, lumper and layover items reference recorded evidence and agreed terms &mdash; reviewed by a person before they ever reach an invoice.'),
    ('&#128200;', 'Clear invoices', 'Line-item invoices tied to the shipment record, with payment status you can see.'),
    ('&#9878;', 'Disputes with process', 'A structured dispute lane with owners, SLAs and an audit trail &mdash; not an email thread that goes quiet.'),
]))
sp += _sec('Support', 'Claims and support', '<div class="prose reveal" style="max-width:820px;margin:0 auto"><p>Damaged, short or rejected freight becomes a structured claim with evidence, photos and timestamps attached. Support requests get owners and SLAs. You always know who is handling your issue and what happens next.</p></div>')
sp += _sec('Reporting', 'Reporting and integrations', _cards([
    ('&#128202;', 'Shipment reports', 'On-time performance, exception history and lane summaries &mdash; counted from real records.'),
    ('&#128279;', 'API &amp; webhooks', 'Shipment, document and delivery events can flow into your systems via approved API endpoints.'),
    ('&#128274;', 'Security first', 'Tenant-isolated data, role-based access and audited actions &mdash; your data is never another company&rsquo;s dashboard.'),
]))
sp += lead_form('shipper_inquiry', 'Discuss your shipping needs',
    'Tell us about your lanes and volumes &mdash; a logistics specialist will reply with a straight, compliant plan (usually within one business day).',
    [('company','Company name','text',True),('name','Your name','text',True),('email','Work email','email',True),
     ('phone','Phone','tel',False),('lanes','Main lanes (e.g. Dallas, TX to Atlanta, GA)','text',True),
     ('freight','Freight type / equipment needed','text',False),('volume','Approx. loads per month','text',False),
     ('notes','Anything else we should know?','textarea',False)],
    'Request Consultation', 'Thanks &mdash; our team will reach out to schedule your consultation.')
sp += _sfaq_html
page('shipper-solutions.html', 'Shipper Solutions &mdash; Consultation &amp; Freight Inquiry | Loadboot',
     'Talk to LoadBoot about your lanes and freight. Consultation-first shipper solutions with honest scope: dispatch expertise, vetted carriers, licensed broker partners where required.',
     'partners.html', sp, _sfaq_sch)

# ---- Referral Program ----
ref = svc_hero('Refer a Carrier, Get Rewarded', 'Know an owner-operator or fleet who deserves a better dispatcher? Send them our way &mdash; when they get rolling with Loadboot, we say thank you.')
ref += _sec('How referrals work', 'Simple and fair', _cards([
    ('1', 'Send them over', 'Share your referral or introduce them directly. There is no limit on how many carriers you can refer.'),
    ('2', 'They get set up', 'Your referral creates their carrier profile and starts booking loads with Loadboot &mdash; flat 5%, no contract.'),
    ('3', 'You get thanked', 'Once your referral is active and rolling, we reward you. Contact us for current referral terms.'),
], 'g3'))
ref += lead_form('referral', 'Refer a carrier', 'Tell us who to reach out to (with their permission) and how to thank you when they get rolling.',
    [('name', 'Your name', 'text', True), ('email', 'Your email', 'email', True), ('phone', 'Your phone', 'tel', False),
     ('referral_name', 'Who are you referring?', 'text', True),
     ('referral_contact', 'Their phone or email', 'text', True),
     ('message', 'Anything we should know?', 'textarea', False)],
    'Send referral', 'Thanks — we&rsquo;ll reach out and keep you posted.')
page('referral.html', 'Carrier Referral Program | Loadboot',
     'Refer an owner-operator or fleet to Loadboot and get rewarded when they start rolling. Simple, fair, no limit on referrals.',
     'referral.html', ref)

# ---- Resources ----
resr = svc_hero('Carrier Resources', 'Free tools, guides and answers to help you run a stronger trucking business &mdash; whether you dispatch with us or not.')
resr += _sec('Tools &amp; guides', 'Everything in one place', _cards([
    ('&#128200;', 'Load Score tool', 'Paste any load and get a take / negotiate / pass score with a counter-offer based on your cost per mile. <a href="load-score.html">Open the tool &rarr;</a>'),
    ('&#129518;', 'Free calculators', 'Profit, rate-per-mile, cost-per-mile, fuel, break-even, take-home and detention &mdash; no signup. <a href="tools.html">Open calculators &rarr;</a>'),
    ('&#128214;', 'Dispatch guides', 'Practical articles on pricing, finding loads with new authority, and dispatcher vs broker. <a href="blog.html">Read the blog &rarr;</a>'),
    ('&#10067;', 'FAQ', 'Straight answers on pricing, authority, equipment and getting started. <a href="faq.html">Read the FAQ &rarr;</a>'),
    ('&#128736;', 'How it works', 'The four-step Loadboot process, start to finish. <a href="how-it-works.html">See how it works &rarr;</a>'),
    ('&#128184;', 'Pricing', 'Flat 5%, no contracts &mdash; exactly what you pay and when. <a href="pricing.html">See pricing &rarr;</a>'),
], 'g3'))
resr += final_cta()
page('resources.html', 'Free Trucking &amp; Dispatch Resources for Carriers | Loadboot',
     'Free carrier resources from Loadboot: the Load Score tool, trucking calculators, dispatch guides, FAQ and pricing &mdash; all in one place.',
     'resources.html', resr)

# ---- Case Studies (clearly-labelled illustrative scenarios) ----
cs = svc_hero('Example Dispatch Scenarios', 'Illustrative examples of how Loadboot dispatch works in practice. These are worked examples for education &mdash; not testimonials or guarantees of specific results.')
cs += _sec('Worked examples', 'How the math tends to work', _cards([
    ('&#128666;', 'New-authority owner-operator', 'A carrier fresh off getting their authority struggles to get broker callbacks. A dispatcher works established relationships to land steady lanes, and coaches them through their first rate cons and PODs. <em>Illustrative example.</em>'),
    ('&#10052;', 'Reefer running empty backhauls', 'A reefer operator deadheading home half the week. The dispatcher targets round-trip lanes to cut empty miles and lift effective rate-per-mile. <em>Illustrative example.</em>'),
    ('&#128230;', 'Box truck chasing hot loads', 'An expedited box truck wasting hours self-searching. Dispatch surfaces time-critical runs so the truck stays loaded on the routes that pay. <em>Illustrative example.</em>'),
]))
cs += '<section class="bg-soft"><div class="wrap prose reveal center" style="text-align:center"><p style="color:var(--muted)">These scenarios are illustrative and for education only. Loadboot does not publish fabricated testimonials or promise specific earnings.</p><p><a href="contact.html" class="btn btn-primary">Talk to a dispatcher &rarr;</a></p></div></section>'
page('case-studies.html', 'Example Truck Dispatch Scenarios | Loadboot',
     'Illustrative, educational examples of how Loadboot dispatch works for owner-operators, reefer and box-truck carriers. Worked examples, not guarantees.',
     'case-studies.html', cs)

# ---- Security / Trust ----
sec = svc_hero('Security &amp; Trust', 'How we protect your account, your documents and your data. Security is built into Loadboot, not bolted on.')
sec += _sec('How we protect you', 'Security by design', _cards([
    ('&#128274;', 'Least-privilege access', 'Every action is permission-checked on the server. Your data is scoped to your account &mdash; carriers can only ever see their own loads, trips and documents.'),
    ('&#128193;', 'Private document storage', 'Documents live in a private store and are only ever shared through short-lived, signed links &mdash; never a public URL.'),
    ('&#128221;', 'Full audit trail', 'Sensitive actions are recorded with a tamper-evident audit log and an event history for accountability.'),
    ('&#127959;', 'Maker / checker on money', 'Payouts require separate people to create and approve &mdash; no single person can release funds alone.'),
    ('&#128737;', 'Isolated environments', 'Staging and production are kept strictly separate; the public build never references internal systems.'),
    ('&#128257;', 'Recoverable changes', 'Database changes are tracked and reversible, with documented rollback procedures.'),
]))
sec += '<section class="bg-soft"><div class="wrap prose reveal center" style="text-align:center"><h2>Report a security concern</h2><p>Found something? Email <a href="mailto:security@loadboot.com">security@loadboot.com</a> and we will respond promptly.</p></div></section>'
page('security.html', 'Security &amp; Trust at Loadboot | How We Protect Your Data',
     'How Loadboot protects your account and documents: least-privilege access, private signed document storage, full audit trails, maker/checker on payouts and isolated environments.',
     'security.html', sec)

# ---- System Status ----
st = svc_hero('System Status', 'Live status for the Loadboot website, carrier portal, driver app and API. We publish issues here honestly.')
_status_row = lambda name, sid, last: '<div style="display:flex;justify-content:space-between;padding:12px 0;%s"><span>%s</span><b id="%s" style="color:#64748b">Checking&hellip;</b></div>' % ('' if last else 'border-bottom:1px solid var(--border)', name, sid)
st += ('<section><div class="wrap" style="max-width:820px"><div class="card reveal" style="text-align:left">'
       '<h3 style="margin-bottom:6px">Current status</h3><p id="lbStatusOverall" style="color:#64748b;margin-bottom:14px;font-size:.92rem">Running a live check&hellip;</p>'
       '<div id="lbStatusList">'
       + _status_row('Marketing website', 'stWeb', False)
       + _status_row('Carrier Portal &amp; Pocket App', 'stApp', False)
       + _status_row('Command Center', 'stCC', False)
       + _status_row('API &amp; integrations', 'stApi', True)
       + '</div><p id="lbStatusChecked" style="color:var(--muted);margin-top:16px;font-size:.85rem"></p>'
       '<p style="color:var(--muted);margin-top:6px;font-size:.9rem">This page runs a live reachability check from your browser. For incident history or to report an outage, email <a href="mailto:status@loadboot.com">status@loadboot.com</a>.</p></div></div></section>'
       '<script>(function(){var UP="Operational",DOWN="Degraded";function set(id,ok){var e=document.getElementById(id);if(e){e.textContent=ok?UP:DOWN;e.style.color=ok?"#16a34a":"#dc2626";}}'
       'set("stWeb",true);' # if this page loaded, the website is up
       'var api="https://' + APP_REF + '.supabase.co/rest/v1/",apikey="' + (APP_ANON or '') + '";'
       'function done(ok){set("stApi",ok);set("stApp",ok);set("stCC",ok);var o=document.getElementById("lbStatusOverall");if(o){o.textContent=ok?"All systems operational.":"Some systems are degraded \\u2014 we are on it.";o.style.color=ok?"#16a34a":"#dc2626";}var c=document.getElementById("lbStatusChecked");if(c){c.textContent="Last checked: "+new Date().toLocaleString();}}'
       'if(!apikey){done(true);return;}'
       'var t=setTimeout(function(){done(false);},7000);'
       'fetch(api,{method:"GET",headers:{"apikey":apikey}}).then(function(r){clearTimeout(t);done(r.status>0&&r.status<500);}).catch(function(){clearTimeout(t);done(false);});'
       '})();</script>')
page('status.html', 'Loadboot System Status',
     'Live operational status for the Loadboot website, carrier portal, driver app and API.',
     'status.html', st)

# ---- Cookie Policy ----
ck = svc_hero('Cookie Policy', 'How Loadboot uses cookies and similar technologies, and the choices you have.')
ck += '<section><div class="wrap prose reveal"><h2>What cookies we use</h2><p>We use a small number of cookies and local-storage items to keep the site working and to understand, in aggregate, how it is used. These fall into two groups: <b>essential</b> items that make the site and your account function, and <b>analytics</b> items that help us improve pages and measure conversions.</p><h2>Analytics</h2><p>We use first-party analytics and Google Analytics to understand traffic and page performance. You can flag your browser as internal/excluded, and you can block analytics cookies in your browser settings without breaking the site.</p><h2>Your choices</h2><p>You can clear or block cookies in your browser at any time. Essential items are required for signed-in features (like your carrier account) to work. For questions, email <a href="mailto:privacy@loadboot.com">privacy@loadboot.com</a>.</p><p style="color:var(--muted);font-size:.9rem">See also our <a href="privacy.html">Privacy Policy</a>.</p></div></section>'
page('cookies.html', 'Cookie Policy | Loadboot',
     'How Loadboot uses essential and analytics cookies, and the choices you have to manage them.',
     'cookies.html', ck)

# ---- Accessibility ----
acc = svc_hero('Accessibility', 'We want every carrier to be able to use Loadboot. Here is our commitment and how to reach us if something is not working for you.')
acc += '<section><div class="wrap prose reveal"><h2>Our commitment</h2><p>We aim to meet widely-recognized accessibility guidelines (WCAG 2.1 AA) across our website and apps: readable contrast, keyboard navigation, descriptive labels, responsive layouts and support for screen readers. Accessibility is an ongoing effort and we fix issues as we find them.</p><h2>Need help or found a barrier?</h2><p>If any part of Loadboot is hard to use with assistive technology, please tell us &mdash; we take it seriously and will work with you directly. Email <a href="mailto:hello@loadboot.com">hello@loadboot.com</a> with the page and what you ran into.</p></div></section>'
page('accessibility.html', 'Accessibility Statement | Loadboot',
     'Loadboot is committed to an accessible website and apps (WCAG 2.1 AA). Learn about our commitment and how to report a barrier.',
     'accessibility.html', acc)

# ---- Carrier Application (dedicated apply page) ----
capp = svc_hero('Apply to Loadboot', 'Get your truck loaded with a dispatcher in your corner. Apply in two minutes &mdash; flat 5%, no contracts, cancel anytime.')
capp += lead_form('carrier_application', 'Carrier application', 'Tell us about your operation and a dispatcher gets you set up. A real person follows up fast.',
    [('company', 'Company / business name', 'text', True), ('name', 'Your name', 'text', True),
     ('email', 'Email', 'email', True), ('phone', 'Phone', 'tel', True),
     ('mc', 'MC number', 'text', False), ('dot', 'DOT number', 'text', False),
     ('authority', 'Authority status', 'select:Active / established authority|New authority|No authority yet', True),
     ('equipment', 'Equipment', 'select:Dry Van|Reefer|Flatbed|Step Deck|Hotshot|Power Only|Box Truck / Expedited', True),
     ('trucks', 'Number of trucks', 'select:1|2-5|6-20|20+', False),
     ('lanes', 'Preferred lanes / home base', 'text', False),
     ('message', 'Anything else we should know?', 'textarea', False)],
    'Submit application', 'Got it — a dispatcher will reach out shortly.')
page('carrier-application.html', 'Carrier Application &mdash; Apply for Truck Dispatch | Loadboot',
     'Apply for Loadboot truck dispatch in two minutes. Owner-operators, fleets and new-authority carriers welcome. Flat 5%, no contracts.',
     'contact.html', capp)

# ---- Login portal chooser ----
lg = svc_hero('Log in to Loadboot', 'Choose your portal. Not sure which one you need? Carriers and drivers use the Carrier options below.')
lg += _sec('Choose your portal', 'Where do you want to go?', _cards([
    ('&#128667;', 'Carrier Portal', 'Manage loads, trips, documents, finance and your team. <a href="/app/carrier/">Open Carrier Portal &rarr;</a>'),
    ('&#128241;', 'Driver Pocket App', 'On-the-road app for trips, check-ins and POD uploads. <a href="/app/pocket/">Open Pocket App &rarr;</a>'),
    ('&#129309;', 'Partner Portal', 'Brokers, shippers and facilities. <a href="/app/partner/">Open Partner Portal &rarr;</a>'),
    ('&#128104;&#8205;&#128187;', 'Developers &amp; API', 'API keys, docs and integrations. <a href="/app/developer/">Open Developer Portal &rarr;</a>'),
    ('&#127970;', 'Command Center (Staff)', 'Loadboot team operations console. <a href="/app/command-center/">Open Command Center &rarr;</a>'),
    ('&#10067;', 'Need an account?', 'New to Loadboot? Apply in about two minutes. <a href="carrier-application.html">Apply now &rarr;</a>'),
], 'g3'))
page('login.html', 'Log in to Loadboot | Carrier, Partner, Driver &amp; Developer Portals',
     'Choose your Loadboot portal: Carrier Portal, Driver Pocket App, Partner Portal, Developer/API or Command Center. New here? Create a carrier account in minutes.',
     'login.html', lg)

# ---- HTML sitemap (user-facing; complements the XML sitemap) ----
_SITEMAP_GROUPS = [
  ('Get started', [('contact.html', 'Get a Quote / Contact'), ('carriers.html', 'For Carriers'), ('brokers.html', 'For Brokers'), ('shipper-solutions.html', 'Shipper Solutions'), ('carrier-application.html', 'Carrier Application'), ('login.html', 'Log in'), ('how-it-works.html', 'How It Works'), ('pricing.html', 'Pricing')]),
  ('Services', [('services.html', 'All Services'), ('owner-operator-dispatch.html', 'Owner-Operator'), ('dry-van-dispatch.html', 'Dry Van'), ('reefer-dispatch.html', 'Reefer'), ('flatbed-dispatch.html', 'Flatbed'), ('hotshot-dispatch.html', 'Hotshot'), ('power-only-dispatch.html', 'Power Only'), ('box-truck-dispatch.html', 'Box Truck'), ('new-authority-dispatch.html', 'New Authority')]),
  ('Resources', [('resources.html', 'Resources'), ('load-score.html', 'Load Score Tool'), ('tools.html', 'Free Calculators'), ('blog.html', 'Blog'), ('faq.html', 'FAQ')]),
  ('Company', [('about.html', 'About'), ('careers.html', 'Careers'), ('partners.html', 'Partner Program'), ('referral.html', 'Referral Program'), ('case-studies.html', 'Examples'), ('status.html', 'System Status')]),
  ('Legal & trust', [('security.html', 'Security & Trust'), ('privacy.html', 'Privacy'), ('terms.html', 'Terms'), ('cookies.html', 'Cookie Policy'), ('accessibility.html', 'Accessibility')]),
]
_sm_body = svc_hero('Sitemap', 'Every page on Loadboot, in one place.')
_sm_cols = ''
for _g, _links in _SITEMAP_GROUPS:
    _items = ''.join('<li><a href="%s">%s</a></li>' % (u, t) for u, t in _links)
    _sm_cols += '<div class="card reveal"><h3>%s</h3><ul style="line-height:2.1;margin-top:8px">%s</ul></div>' % (_g, _items)
_sm_body += '<section><div class="wrap"><div class="grid g3 reveal">%s</div></div></section>' % _sm_cols
page('sitemap.html', 'Sitemap | Loadboot', 'Every page on the Loadboot website — services, resources, company and legal — in one place.', '', _sm_body)

# ---------- SITEMAP + ROBOTS ----------
DOMAIN = 'https://loadboot.com'
# PROD_REF/STAGING_REF/context targets are defined once near the top of this file.
_SITEMAP_EXCLUDE = {'dashboard.html', '404.html'}
pages = [f for f in sorted(os.listdir(OUT)) if f.endswith('.html') and f not in _SITEMAP_EXCLUDE]
urls = ''.join('<url><loc>%s/%s</loc><changefreq>weekly</changefreq></url>' % (DOMAIN, ('' if f=='index.html' else f)) for f in pages)
sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">%s</urlset>' % urls
with open(os.path.join(OUT,'sitemap.xml'),'w',encoding='utf-8') as f: f.write(sitemap)
with open(os.path.join(OUT,'robots.txt'),'w',encoding='utf-8') as f:
    f.write('User-agent: *\nAllow: /\nDisallow: /dashboard.html\nDisallow: /app/\nSitemap: %s/sitemap.xml\n' % DOMAIN)

# ---------- SECURITY HEADERS (Netlify _headers) ----------
# Applied to every response. Non-CSP baseline (safe: does not alter page behavior).
# geolocation=(self) keeps the carrier dashboard's location feature working while
# blocking any third-party from requesting location.
HEADERS = (
"/*\n"
"  X-Frame-Options: DENY\n"
"  X-Content-Type-Options: nosniff\n"
"  Referrer-Policy: strict-origin-when-cross-origin\n"
"  Permissions-Policy: geolocation=(self), camera=(), microphone=(), payment=(), usb=()\n"
"  Strict-Transport-Security: max-age=31536000; includeSubDomains\n"
"  Cross-Origin-Opener-Policy: same-origin\n"
)
# PER-CONTEXT CSP for the Phase 2A apps ONLY (scoped to /app/*). Item 8: the CSP
# permits the CONTEXT'S project ONLY — production builds allow the production
# Supabase project, preview builds allow the staging project. Never both. Allows:
# self for docs/styles/workers; the PINNED esm.sh module CDN for supabase-js. No
# inline/eval scripts.
_CSP_REF = APP_REF   # prod ref in production context, staging ref otherwise
# Live operations map: Leaflet from cdnjs (script+style) and OpenStreetMap raster tiles
# (img). circleMarkers are SVG, so no external marker images are needed.
_APP_CSP = (
  "default-src 'self'; "
  "base-uri 'self'; "
  "object-src 'none'; "
  "frame-ancestors 'none'; "
  "img-src 'self' data: https://*.tile.openstreetmap.org; "
  "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; "
  "font-src 'self' data:; "
  "script-src 'self' https://esm.sh https://cdnjs.cloudflare.com; "
  "worker-src 'self'; "
  "manifest-src 'self'; "
  "connect-src 'self' https://%s.supabase.co wss://%s.supabase.co https://esm.sh https://cdnjs.cloudflare.com"
) % (_CSP_REF, _CSP_REF)
APP_HEADERS = (
  "\n/app/*\n"
  "  X-Frame-Options: DENY\n"
  "  X-Content-Type-Options: nosniff\n"
  "  Referrer-Policy: no-referrer\n"
  "  X-Robots-Tag: noindex, nofollow\n"
  "  Content-Security-Policy: " + _APP_CSP + "\n"
)
with open(os.path.join(OUT,'_headers'),'w',encoding='utf-8') as f: f.write(HEADERS + APP_HEADERS)

# ---------- _redirects ----------
# Publish dir is /site and contains ONLY built output — no Python/Markdown/SQL/source files
# are ever copied here, so nothing sensitive can be fetched. This file is intentionally minimal.
REDIRECTS = "# Loadboot — no custom redirects. Source files are not in the publish directory.\n"
with open(os.path.join(OUT,'_redirects'),'w',encoding='utf-8') as f: f.write(REDIRECTS)

# ---------- BRANDED 404 (noindex; Netlify serves automatically) ----------
NOTFOUND = (
'<!doctype html><html lang="en"><head><meta charset="utf-8">'
'<meta name="viewport" content="width=device-width,initial-scale=1">'
'<meta name="robots" content="noindex,follow">'
'<title>Page not found &mdash; Loadboot</title>'
'<link rel="stylesheet" href="/styles.css?v=6">'
'<link rel="icon" href="/favicon.ico?v=2">'
'<style>.nf{min-height:70vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:40px 20px}'
'.nf .in{max-width:520px}.nf .c{font-family:\'Manrope\',sans-serif;font-weight:800;font-size:3.2rem;color:#2563EB;line-height:1}'
'.nf h1{font-family:\'Manrope\',sans-serif;color:#0F172A;font-size:1.5rem;margin:14px 0 8px}'
'.nf p{color:#64748B;margin:0 0 22px}.nf a.btn{display:inline-block;background:#F97316;color:#fff;text-decoration:none;'
'font-weight:700;font-family:\'Manrope\',sans-serif;padding:13px 24px;border-radius:12px}</style></head>'
'<body><div class="nf"><div class="in"><div class="c">404</div>'
'<h1>That page took a wrong turn</h1>'
'<p>The page you&rsquo;re looking for isn&rsquo;t here. It may have moved, or the link was mistyped.</p>'
'<a class="btn" href="/">Back to home &rarr;</a>'
'<p style="margin-top:18px;font-size:.92rem">Or jump to <a href="/services.html">services</a>, '
'<a href="/load-score.html">Load Score</a>, or <a href="/blog.html">the blog</a>.</p>'
'</div></div></body></html>'
)
with open(os.path.join(OUT,'404.html'),'w',encoding='utf-8') as f: f.write(NOTFOUND)

# ---------- COPY SOURCE-ONLY-AT-ROOT FILES INTO PUBLISH DIR ----------
# dashboard.html is authored by hand (not generated) -> copy it into /site.
if os.path.exists(os.path.join(SRC,'dashboard.html')):
    shutil.copy2(os.path.join(SRC,'dashboard.html'), os.path.join(OUT,'dashboard.html'))
# Copy every image/icon asset present at the repo root into /site (favicons, icons,
# webp/jpg/png/avif photos). Source-only files (.py/.md/.toml/.sql) are NEVER copied.
for fn in os.listdir(SRC):
    full=os.path.join(SRC,fn)
    if os.path.isfile(full) and fn not in _NO_PUBLISH and fn.lower().endswith(_ASSET_EXTS):
        shutil.copy2(full, os.path.join(OUT,fn))

# ============================================================================
# PHASE 2A APPLICATIONS (Command Center + Carrier Pocket App)
# Emit the /app tree into the publish dir with an environment-specific config that
# is asserted against the deploy CONTEXT: a PRODUCTION build may target ONLY the
# production project; any PREVIEW/branch build may target ONLY the staging project.
# A mismatch (or a missing required key) FAILS the build — never silently wrong.
# ============================================================================
APP_SRC = os.path.join(SRC, 'app')
APP_OUT = os.path.join(OUT, 'app')
# Static file types allowed into the publish dir for the apps. Source-only types
# (.py/.md/.sql/.toml) are NEVER copied — enforced again by the recursive leak scan.
_APP_OK_EXTS = ('.html', '.js', '.css', '.webmanifest', '.json', '.svg', '.png', '.webp', '.ico', '.gif', '.jpg', '.jpeg')

# Deploy context + Supabase targets are resolved once near the top of this file
# (PROD_REF/STAGING_REF/PROD_ANON/STAGING_ANON/_CTX/IS_PRODUCTION_CTX/APP_* /_BUILD_ID).
if os.path.isdir(APP_SRC):
    # 1) target env from context (production => prod ONLY, else staging ONLY)
    _app_env, _app_ref, _app_anon = APP_ENV, APP_REF, APP_ANON

    # 2) copy the app tree (allowed extensions only), preserving structure
    for dirpath, dirnames, filenames in os.walk(APP_SRC):
        rel = os.path.relpath(dirpath, APP_SRC)
        dest_dir = APP_OUT if rel == '.' else os.path.join(APP_OUT, rel)
        os.makedirs(dest_dir, exist_ok=True)
        for fn in filenames:
            if fn.lower().endswith(_APP_OK_EXTS):
                shutil.copy2(os.path.join(dirpath, fn), os.path.join(dest_dir, fn))

    # 3) write env-config.js (the ONLY place the project URL/key are injected).
    #    The runtime (shared/env.js) re-asserts url<->projectId consistency.
    if _app_env == 'production' and _app_ref != PROD_REF:
        _APP_FATAL = 'production build must target the production project'
    elif _app_env == 'preview' and _app_ref != STAGING_REF:
        _APP_FATAL = 'preview build must target the staging project'
    else:
        _APP_FATAL = None
    # Preview/branch deploys MUST have a staging key — refuse to fall back to prod.
    if _app_env == 'preview' and not _app_anon and _CTX in ('deploy-preview', 'branch-deploy'):
        _APP_FATAL = 'preview build is missing LOADBOOT_STAGING_ANON_KEY (refusing to target production)'

    _app_url = 'https://%s.supabase.co' % _app_ref
    _env_cfg = ('// GENERATED by build_site.py — do not edit. context=%s\n'
                'window.__LB_ENV=%s;\n') % (
        _CTX, json.dumps({
            'environment': _app_env, 'supabaseUrl': _app_url,
            'supabaseAnonKey': _app_anon or 'MISSING_STAGING_ANON_KEY',
            'projectId': _app_ref, 'buildId': _BUILD_ID,
        }))
    with open(os.path.join(APP_OUT, 'env-config.js'), 'w', encoding='utf-8') as f:
        f.write(_env_cfg)

    # 4) generate the app service worker. Precache = the ACTUAL emitted static files
    #    only (NO synthetic '/app/' directory URL that would 404). Each app's index
    #    is precached so each app has its OWN offline shell. env-config.js + sw.js are
    #    excluded (env identity must always come from the network).
    _precache = []
    for dirpath, dirnames, filenames in os.walk(APP_OUT):
        for fn in filenames:
            if fn in ('env-config.js', 'sw.js'):
                continue
            p = os.path.join(dirpath, fn)
            url = '/app/' + os.path.relpath(p, APP_OUT).replace(os.sep, '/')
            _precache.append(url)
    _precache = sorted(set(_precache))
    _cc_shell = '/app/command-center/index.html'
    _ca_shell = '/app/carrier/index.html'
    APP_SW = ("// GENERATED by build_site.py. App service worker (scope /app/).\n"
        "// Caches ONLY the static shell allowlist below, and RESILIENTLY (one bad URL\n"
        "// never wipes the cache). Network-only for everything else; NEVER caches API/\n"
        "// auth/storage/document/money/location/profile data (all cross-origin Supabase).\n"
        "// No mutation queue. Each app has its OWN offline shell — the carrier app never\n"
        "// receives Command Center HTML and vice-versa.\n"
        "const CACHE='lb-app-%s';\n"
        "const CORE=%s;\n"
        "const CC_SHELL=%s, CA_SHELL=%s;\n"
        "self.addEventListener('install',function(e){e.waitUntil(caches.open(CACHE).then(function(c){\n"
        "  return Promise.allSettled(CORE.map(function(u){return c.add(u);}));   // resilient: per-URL\n"
        "}).then(function(){return self.skipWaiting();}));});\n"
        "self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.map(function(k){if(k!==CACHE&&k.indexOf('lb-app')===0)return caches.delete(k);}));}).then(function(){return self.clients.claim();}));});\n"
        "self.addEventListener('message',function(e){if(e.data&&e.data.type==='LB_PURGE'){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k.indexOf('lb-app')===0;}).map(function(k){return caches.delete(k);}));}).then(function(){if(e.source&&e.source.postMessage)e.source.postMessage({type:'LB_PURGED'});}));}});\n"
        "function shellFor(p){return p.indexOf('/app/carrier/')===0?CA_SHELL:(p.indexOf('/app/command-center/')===0?CC_SHELL:null);}\n"
        "self.addEventListener('fetch',function(e){var r=e.request;var u=new URL(r.url);\n"
        "  if(r.method!=='GET'||u.origin!==location.origin){return;}            // never touch cross-origin or writes\n"
        "  if(u.pathname.indexOf('/app/')!==0){return;}                          // only manage the app scope\n"
        "  if(u.pathname==='/app/env-config.js'){return;}                        // env identity: always network\n"
        "  var isNav=(r.mode==='navigate')||(r.headers.get('accept')||'').indexOf('text/html')>=0;\n"
        "  if(isNav){                                                            // navigations: app-shell model (per-app), works on/offline\n"
        "    var s=shellFor(u.pathname);\n"
        "    if(s){e.respondWith(caches.match(s).then(function(m){return m||fetch(s).catch(function(){return Response.error();});}));return;}\n"
        "    return;                                                             // navigation outside a known app: let it pass through\n"
        "  }\n"
        "  if(CORE.indexOf(u.pathname)<0){return;}                               // not allowlisted: network-only (no caching)\n"
        "  e.respondWith(caches.match(r).then(function(m){return m||fetch(r).then(function(res){if(res&&res.ok){var cp=res.clone();caches.open(CACHE).then(function(c){c.put(r,cp);});}return res;});}));\n"
        "});\n"
        "// ---- Web Push (Phase 5): show notification + focus/open on click ----\n"
        "self.addEventListener('push',function(e){var d={};try{d=e.data?e.data.json():{};}catch(_){d={};}var title=d.title||'LoadBoot';var options={body:d.body||'',icon:'/favicon.ico',badge:'/favicon.ico',data:{url:d.url||'/app/carrier/'},vibrate:[80,40,80]};e.waitUntil(self.registration.showNotification(title,options));});\n"
        "self.addEventListener('notificationclick',function(e){e.notification.close();var url=(e.notification.data&&e.notification.data.url)||'/app/carrier/';e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(function(list){for(var i=0;i<list.length;i++){var c=list[i];if('focus' in c){if(c.navigate)c.navigate(url);return c.focus();}}if(clients.openWindow)return clients.openWindow(url);}));});\n") % (_BUILD_ID, json.dumps(_precache), json.dumps(_cc_shell), json.dumps(_ca_shell))
    with open(os.path.join(APP_OUT, 'sw.js'), 'w', encoding='utf-8') as f:
        f.write(APP_SW)
else:
    _APP_FATAL = None

# ---------- PREVIEW REBIND (item 8: ENTIRE preview is staging-bound) ----------
# The legacy dashboard.html (and any other copied artifact) hardcodes the PRODUCTION
# Supabase project. In any non-production build we rewrite every production project
# reference (URL + publishable key) to the STAGING project, so a Deploy Preview makes
# ZERO production-backend requests. Production builds are left untouched.
if not IS_PRODUCTION_CTX:
    _sub_pairs = [('https://%s.supabase.co' % PROD_REF, 'https://%s.supabase.co' % STAGING_REF)]
    if STAGING_ANON:
        _sub_pairs.append((PROD_ANON, STAGING_ANON))
    for dirpath, dirnames, filenames in os.walk(OUT):
        for fn in filenames:
            if fn.lower().endswith(('.html', '.js', '.css', '.json', '.webmanifest')):
                p = os.path.join(dirpath, fn)
                try:
                    txt = open(p, encoding='utf-8').read()
                    new = txt
                    for a, b in _sub_pairs:
                        new = new.replace(a, b)
                    if new != txt:
                        open(p, 'w', encoding='utf-8').write(new)
                except Exception:
                    pass

# ---------- BUILD-FAILING VALIDATIONS ----------
_errors=[]
if os.path.isdir(APP_SRC) and _APP_FATAL:
    _errors.append('APP ENV ASSERTION FAILED: ' + _APP_FATAL)

# (1) Required output pages/files must exist in the publish dir.
REQUIRED_OUTPUT = ['index.html','about.html','services.html','pricing.html','contact.html',
 'tools.html','load-score.html','blog.html','privacy.html','terms.html','dashboard.html',
 'how-it-works.html','faq.html','box-truck-dispatch.html','careers.html','partners.html',
 'referral.html','resources.html','case-studies.html','security.html','status.html',
 'cookies.html','accessibility.html','login.html','carrier-application.html',
 '404.html','sitemap.xml','robots.txt','_headers','_redirects','styles.css','app.js',
 'sw.js','manifest.webmanifest']
for r in REQUIRED_OUTPUT:
    if not os.path.exists(os.path.join(OUT,r)):
        _errors.append('MISSING REQUIRED OUTPUT: '+r)

# (2) Every locally-referenced asset must resolve inside the publish dir.
def _is_local(u):
    if not u: return False
    u=u.strip().strip('\'"')
    return not u.startswith(('http://','https://','//','data:','mailto:','tel:','#','javascript:'))
def _norm(u):
    u=u.strip().strip('\'"').split('#')[0].split('?')[0]
    return u[1:] if u.startswith('/') else u
ref_re = re.compile(r'(?:href|src)\s*=\s*"([^"]+)"|url\(([^)]+)\)')
missing=set()
def _check_refs(text, where):
    for m in ref_re.finditer(text):
        raw=m.group(1) or m.group(2)
        if not _is_local(raw): continue
        rel=_norm(raw)
        if not rel or rel.endswith('/') or '.' not in os.path.basename(rel): continue
        if not os.path.exists(os.path.join(OUT, rel)):
            missing.add(rel+'  (in '+where+')')
for fn in os.listdir(OUT):
    if fn.endswith(('.html','.css')):
        _check_refs(open(os.path.join(OUT,fn),encoding='utf-8').read(), fn)
try:
    man=json.loads(open(os.path.join(OUT,'manifest.webmanifest'),encoding='utf-8').read())
    for ic in man.get('icons',[]):
        s=ic.get('src','')
        if _is_local(s) and not os.path.exists(os.path.join(OUT,_norm(s))):
            missing.add(_norm(s)+'  (manifest icon)')
except Exception as ex:
    _errors.append('manifest parse error: '+str(ex))
try:
    sw=open(os.path.join(OUT,'sw.js'),encoding='utf-8').read()
    mm=re.search(r'CORE\s*=\s*\[([^\]]*)\]', sw)
    if mm:
        for tok in re.findall(r'[\'"]([^\'\"]+)[\'"]', mm.group(1)):
            if _is_local(tok):
                rel=_norm(tok)
                if rel and '.' in os.path.basename(rel) and not os.path.exists(os.path.join(OUT,rel)):
                    missing.add(rel+'  (sw precache)')
except Exception:
    pass
for x in sorted(missing): _errors.append('MISSING LOCAL ASSET: '+x)

# (3) Publish dir must contain NO source-only files, anywhere (recursive).
#     Catches .py/.md/.sql/.toml and any stray migrations/docs dirs at any depth.
for dirpath, dirnames, filenames in os.walk(OUT):
    if 'migrations' in dirnames or 'docs' in dirnames:
        for d in ('migrations','docs'):
            if d in dirnames:
                _errors.append('SOURCE DIR LEAKED INTO PUBLISH DIR: '+os.path.relpath(os.path.join(dirpath,d),OUT))
    for fn in filenames:
        if fn.lower().endswith(('.py','.md','.toml','.sql','.pyc')):
            _errors.append('SOURCE LEAKED INTO PUBLISH DIR: '+os.path.relpath(os.path.join(dirpath,fn),OUT))

# (4) Phase 2A app surface must be present and the env-config must match the context.
if os.path.isdir(APP_SRC):
    _app_required = ['app/env-config.js','app/sw.js',
                     'app/command-center/index.html','app/command-center/app.js',
                     'app/carrier/index.html','app/carrier/app.js',
                     'app/shared/env.js','app/shared/supabaseClient.js','app/shared/api.js']
    for r in _app_required:
        if not os.path.exists(os.path.join(OUT, r)):
            _errors.append('MISSING REQUIRED APP FILE: '+r)
    # env-config must declare exactly the project ref expected for this context.
    try:
        _cfg_txt = open(os.path.join(OUT,'app','env-config.js'),encoding='utf-8').read()
        _want_ref = PROD_REF if _CTX=='production' else STAGING_REF
        if ('https://%s.supabase.co' % _want_ref) not in _cfg_txt:
            _errors.append('APP ENV-CONFIG does not target expected project for context %s' % _CTX)
        _bad_ref = STAGING_REF if _CTX=='production' else PROD_REF
        if ('https://%s.supabase.co' % _bad_ref) in _cfg_txt:
            _errors.append('APP ENV-CONFIG leaks the wrong project ref for context %s' % _CTX)
        if 'service_role' in _cfg_txt:
            _errors.append('APP ENV-CONFIG contains a service_role key (must never reach the browser)')
    except Exception as ex:
        _errors.append('APP ENV-CONFIG unreadable: '+str(ex))

# (5) PREVIEW PRODUCTION-ISOLATION GATE (item 8): in any non-production build, the
#     production project ref must NOT appear in ANY emitted artifact (html/js/css/
#     json/webmanifest/_headers/_redirects). This proves a Deploy Preview makes zero
#     production-backend requests at the artifact level.
if not IS_PRODUCTION_CTX:
    _iso_exts = ('.html', '.js', '.css', '.json', '.webmanifest', '.txt')
    _iso_extra = {'_headers', '_redirects'}
    _leaks = []
    for dirpath, dirnames, filenames in os.walk(OUT):
        for fn in filenames:
            if fn.lower().endswith(_iso_exts) or fn in _iso_extra:
                p = os.path.join(dirpath, fn)
                try:
                    if PROD_REF in open(p, encoding='utf-8', errors='ignore').read():
                        _leaks.append(os.path.relpath(p, OUT))
                except Exception:
                    pass
    for x in sorted(set(_leaks)):
        _errors.append('PREVIEW PRODUCTION-ISOLATION: production ref present in '+x)

# ---- Public hosted custom forms (/forms/?f=key) — renders a published form via the
#      anon cc_get_public_form RPC and submits through the existing submit_web_form path,
#      so submissions land in the Forms Inbox → CRM. Production only (needs the live key).
_FORMS_JS = (r"""(function(){var SB='__SB__',KEY='__KEY__';var host=document.getElementById('lbf');
var f=new URLSearchParams(location.search).get('f');if(!f){host.textContent='No form specified.';return;}
function esc(s){return (s==null?'':String(s)).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function post(fn,body){return fetch(SB+'/rest/v1/rpc/'+fn,{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});}
function field(fl){var id='fld_'+fl.key,req=fl.required?' required':'',lbl='<label for="'+id+'">'+esc(fl.label||fl.key)+(fl.required?' *':'')+'</label>',inp;
if(fl.type==='textarea')inp='<textarea id="'+id+'" rows="4"'+req+'></textarea>';
else if(fl.type==='select')inp='<select id="'+id+'"'+req+'><option value="">Select…</option>'+(fl.options||[]).map(function(o){return '<option>'+esc(o)+'</option>';}).join('')+'</select>';
else if(fl.type==='checkbox')inp='<input type="checkbox" id="'+id+'">';
else inp='<input type="'+(fl.type||'text')+'" id="'+id+'"'+req+'>';
return '<div class="lbf-f">'+lbl+inp+'</div>';}
post('cc_get_public_form',{p_key:f}).then(function(r){return r.ok?r.json():null;}).then(function(def){
if(!def){host.innerHTML='<div class="lbf-msg">This form is not available.</div>';return;}
var h='<h1 style="font-family:Manrope,sans-serif;margin:0 0 6px;font-size:1.5rem">'+esc(def.title)+'</h1>';
if(def.description)h+='<p style="color:#64748b;margin:0 0 18px">'+esc(def.description)+'</p>';
h+='<form id="lbform">'+(def.fields||[]).map(field).join('')+'<button class="lbf-btn" type="submit">Submit</button></form>';
host.innerHTML=h;
document.getElementById('lbform').addEventListener('submit',function(e){e.preventDefault();
var raw={};(def.fields||[]).forEach(function(fl){var el=document.getElementById('fld_'+fl.key);raw[fl.key]=el?(fl.type==='checkbox'?(el.checked?'yes':'no'):el.value):'';});
var u=new URLSearchParams(location.search);
var payload={form_key:def.form_key,name:raw.name||raw.full_name||null,email:raw.email||null,phone:raw.phone||null,company:raw.company||null,message:raw.message||raw.notes||null,raw:raw,source_page:'/forms/?f='+def.form_key,referrer:document.referrer||null,utm_source:u.get('utm_source'),utm_medium:u.get('utm_medium'),utm_campaign:u.get('utm_campaign')};
post('submit_web_form',{p:payload}).then(function(r){if(r.ok){host.innerHTML='<div class="lbf-msg"><h2>✓ Thank you</h2><p>'+esc(def.thank_you||'We received your submission and will be in touch.')+'</p></div>';if(def.redirect_url)setTimeout(function(){location.href=def.redirect_url;},1600);}else{alert('Submission failed. Please try again.');}}).catch(function(){alert('Submission failed.');});
});
}).catch(function(){host.innerHTML='<div class="lbf-msg">This form is temporarily unavailable.</div>';});})();""").replace('__SB__', _BOARD_SB).replace('__KEY__', _BOARD_KEY)

_forms_body = ('<div class="lbf-wrap"><div class="lbf-card" id="lbf">Loading…</div>'
    '<p style="text-align:center;color:#94a3b8;font-size:.8rem;margin-top:16px">Powered by LoadBoot</p></div>'
    + ('<script>' + _FORMS_JS + '</script>' if IS_PRODUCTION_CTX else '<script>document.getElementById("lbf").textContent="Hosted forms are disabled in this preview environment.";</script>'))
_forms_html = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">'
    '<title>LoadBoot — Form</title><link rel="preconnect" href="https://fonts.googleapis.com">'
    '<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@700;800&family=Inter:wght@400;600&display=swap" rel="stylesheet">'
    '<style>body{margin:0;background:#f1f5f9;font-family:Inter,system-ui,sans-serif}.lbf-wrap{max-width:560px;margin:0 auto;padding:40px 16px}'
    '.lbf-card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:26px;box-shadow:0 10px 30px -12px rgba(15,23,42,.12)}'
    '.lbf-f{margin-bottom:14px}.lbf-f label{display:block;font-weight:600;font-size:.88rem;margin-bottom:5px;color:#0f172a}'
    '.lbf-f input,.lbf-f textarea,.lbf-f select{width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:9px;font-size:1rem;font-family:inherit;box-sizing:border-box}'
    '.lbf-f input[type=checkbox]{width:auto}.lbf-btn{background:#2563EB;color:#fff;border:0;border-radius:10px;padding:12px 18px;font-weight:700;font-size:1rem;cursor:pointer;width:100%;margin-top:6px}'
    '.lbf-msg{padding:24px;text-align:center;color:#334155}</style></head><body>' + _forms_body + '</body></html>')
os.makedirs(os.path.join(OUT, 'forms'), exist_ok=True)
with open(os.path.join(OUT, 'forms', 'index.html'), 'w', encoding='utf-8') as _ff:
    _ff.write(_forms_html)

if _errors:
    print('BUILD FAILED — %d problem(s):' % len(_errors))
    for e in _errors: print('  - '+e)
    sys.exit(1)

print("BUILD OK — publish dir:", OUT)
print("BUILT:", sorted(os.listdir(OUT)))

