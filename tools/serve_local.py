"""Local preview server for the built site — same as `python -m http.server`, but tells the browser NEVER to cache.
Without this, Chrome keeps serving old copies of the app's JS modules after a rebuild (Ctrl+Shift+R does not always
refresh imported modules), so new work looks "missing". Usage (from the repo root):
    python tools/serve_local.py            -> http://localhost:8080  (serves ./site)
    python tools/serve_local.py 9000       -> another port
"""
import http.server, os, sys

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'site')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080


class NoCache(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()

    def send_response(self, code, message=None):
        super().send_response(code, message)

    def do_GET(self):
        # drop validators so the browser cannot answer itself with a 304 from a stale copy
        for h in ('If-Modified-Since', 'If-None-Match'):
            if h in self.headers:
                del self.headers[h]
        super().do_GET()


if __name__ == '__main__':
    print('Serving %s at http://localhost:%d  (no-cache) — Ctrl+C to stop' % (ROOT, PORT))
    http.server.ThreadingHTTPServer(('', PORT), NoCache).serve_forever()
