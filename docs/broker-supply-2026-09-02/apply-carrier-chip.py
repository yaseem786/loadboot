#!/usr/bin/env python3
"""apply-carrier-chip.py — carrier board chip for request-only (FMCSA-screened, not yet verified) broker loads.
One exact-anchor edit in app/carrier/app.js. Idempotent."""
import sys, pathlib
p = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.') / 'app/carrier/app.js'
s = p.read_text(encoding='utf-8')
old = "(lbSourceNotice(l) ? h('span', { class: 'cpx-chip', style: 'background:rgba(148,163,184,.12);color:#94a3b8;font-weight:700' }, '\\u21aa Posted via ' + lbSourceProvider(l)) : null)"
new = "((lbSourceNotice(l) && lbSourceNotice(l).request_only) ? h('span', { class: 'cpx-chip', title: String(lbSourceNotice(l).label || ''), style: 'background:rgba(8,131,247,.16);color:#7cc0ff;font-weight:800;border:1px solid rgba(8,131,247,.4)' }, '\\ud83d\\udee1 ' + (lbSourceNotice(l).tier === 'agent_confirmed' ? 'Agent-posted \\u00b7 brokerage confirmed' : 'New brokerage \\u00b7 FMCSA-verified') + ' \\u00b7 broker approves your request') : (lbSourceNotice(l) ? h('span', { class: 'cpx-chip', style: 'background:rgba(148,163,184,.12);color:#94a3b8;font-weight:700' }, '\\u21aa Posted via ' + lbSourceProvider(l)) : null))"
if 'request_only' in s: print('  = carrier chip already applied'); sys.exit(0)
if s.count(old) != 1: raise SystemExit('ABORT: anchor found %dx' % s.count(old))
p.write_text(s.replace(old, new), encoding='utf-8'); print('  + carrier chip')
