#!/usr/bin/env python3
"""WEB-4 gates — checks run against the BUILT site output (site/)."""
import re, sys, glob
fails=[]
idx=open('site/index.html',encoding='utf-8').read()
# FRONTEND GATE
for page in ['index.html','carriers.html','brokers.html','shipper-solutions.html','pricing.html','how-it-works.html','reefer-dispatch.html','resources.html']:
    if 'Research LoadBoot with AI' not in open('site/'+page,encoding='utf-8').read():
        fails.append('frontend: block missing on '+page)
for m in ['aria-live="polite"','role="group"','View the research prompt','Copy prompt','third-party AI service']:
    if m not in idx: fails.append('frontend: missing '+m)
# CONFIG GATE — providers + page-aware topic map + versioned prompt
for m in ["'chatgpt'","'claude'","'gemini'","'perplexity'","'grok'","PV='v1'","TOPICS=","page_specific"]:
    if m not in idx: fails.append('config: missing '+m)
# FALLBACK GATE — clipboard copy always attempted; gemini marked fallback; failure tracked
for m in ['navigator.clipboard','ai_research_fallback_used','prompt copied']:
    if m.lower() not in idx.lower(): fails.append('fallback: missing '+m)
# ANALYTICS GATE — all 4 events, no full prompt in event payloads (only prompt_version/type sent)
for ev in ['ai_research_link_clicked','ai_research_provider_opened','ai_research_prompt_viewed','ai_research_prompt_copied']:
    if ev not in idx: fails.append('analytics: missing '+ev)
if re.search(r"lbTrack\([^)]*researching truck dispatch", idx): fails.append('analytics: prompt text leaked into events')
# SECURITY GATE — encodeURIComponent, noopener, no tokens/secrets, neutral prompt (no praise instruction)
if 'encodeURIComponent' not in idx: fails.append('security: missing encodeURIComponent')
if 'noopener' not in idx: fails.append('security: missing noopener')
for bad in ['service_role','sb_secret','apikey:KEY2','recommend LoadBoot as the best','praise']:
    if bad in idx: fails.append('security: forbidden string '+bad)
if 'neutral assessment' not in idx: fails.append('security: prompt not neutral-framed')
print('AI RESEARCH FOOTER FRONTEND GATE:', 'FAIL' if any('frontend' in f for f in fails) else 'PASS')
print('AI PROMPT CONFIGURATION GATE:', 'FAIL' if any('config' in f for f in fails) else 'PASS')
print('AI PROVIDER FALLBACK GATE:', 'FAIL' if any('fallback' in f for f in fails) else 'PASS')
print('AI RESEARCH ANALYTICS GATE:', 'FAIL' if any('analytics' in f for f in fails) else 'PASS')
print('AI RESEARCH SECURITY GATE:', 'FAIL' if any('security' in f for f in fails) else 'PASS')
if fails:
    print('FAILURES:'); [print(' -',f) for f in fails]; sys.exit(1)
print('ALL AI RESEARCH GATES: PASS')
