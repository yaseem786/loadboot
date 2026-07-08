#!/usr/bin/env python3
"""dev_server.py — local dev server that serves /site with Cache-Control: no-store.
Cures ALL stale-file problems (Chrome heuristic caching of lazy-imported modules).
Usage: python scripts/dev_server.py 8080
"""
import sys, os
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'site')

class NoCacheHandler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()
    def log_message(self, fmt, *args):
        pass  # quiet

print(f'LoadBoot dev server (no-cache) -> http://localhost:{PORT}/app/carrier/  [serving {ROOT}]')
ThreadingHTTPServer(('0.0.0.0', PORT), NoCacheHandler).serve_forever()
