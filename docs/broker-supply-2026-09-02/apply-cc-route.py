#!/usr/bin/env python3
"""apply-cc-route.py — Command Center route for views/brokerTrust.js. Idempotent.
Supports BOTH CC app.js shapes: the tabbed groups (`partners: { nav: '/partners', tabs: [...] }`, Sept 2026)
and the older flat route table (+ shell.js nav entry)."""
import sys, pathlib
R = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.')
a = R / 'app/command-center/app.js'; t = a.read_text(encoding='utf-8')
if 'brokerTrust.js' in t:
    print('  = cc app.js route'); sys.exit(0)
k1 = "import { renderBrokerSla } from './views/brokerSla.js';"
assert t.count(k1) == 1, 'cc app.js import anchor'
t = t.replace(k1, k1 + "\nimport { renderBrokerTrust } from './views/brokerTrust.js';")
tab = "      { id: 'sla', label: 'Broker SLA', path: '/broker-sla', allowed: () => partnersEnabled && can('partners.view'), render: (h) => renderBrokerSla(h) },"
if t.count(tab) == 1:
    t = t.replace(tab, "      { id: 'trust', label: 'Broker trust', path: '/broker-trust', allowed: () => partnersEnabled && (can('partners.view') || can('dispatch.manage')), render: (h) => renderBrokerTrust(h) },\n" + tab)
    r = "    '/broker-sla': tabbed('partners', 'sla'),"
    assert t.count(r) == 1, 'cc tabbed route anchor'
    t = t.replace(r, "    '/broker-trust': tabbed('partners', 'trust'),\n" + r)
    a.write_text(t, encoding='utf-8'); print('  + cc app.js tab + route (tabbed shape)')
else:
    k2 = "    '/broker-sla': () => {"
    assert t.count(k2) == 1, 'cc flat route anchor'
    t = t.replace(k2, "    '/broker-trust': () => { setActive('/broker-trust'); if (can('partners.manage') || can('dispatch.manage') || can('partners.view')) renderBrokerTrust(content); else denied(); },\n" + k2)
    a.write_text(t, encoding='utf-8'); print('  + cc app.js route (flat shape)')
    sh = R / 'app/command-center/views/shell.js'; u = sh.read_text(encoding='utf-8')
    k = "    { path: '/broker-sla', label: 'Broker SLA', icon: 'trend', perm: 'partners.view', flag: 'partners' },"
    if '/broker-trust' not in u and u.count(k) == 1:
        u = u.replace(k, "    { path: '/broker-trust', label: 'Broker trust', icon: 'shield', perm: 'partners.view', flag: 'partners' },\n" + k)
        sh.write_text(u, encoding='utf-8'); print('  + shell nav')
