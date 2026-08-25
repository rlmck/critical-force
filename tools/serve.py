#!/usr/bin/env python3
"""Static file server for development.

`python -m http.server` sends no Cache-Control header at all, which
leaves the browser free to cache heuristically from Last-Modified. In
an app made of ES modules that means an edit to one file lands while
another is served from cache, and you debug a mixture of two versions
that never existed together. It cost an afternoon once.

Firebase Hosting sends `no-cache` on everything (see firebase.json),
so this makes development match production rather than adding a
special case to it.

    python tools/serve.py [port]
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # no-store rather than no-cache: skip revalidation entirely, so
        # a 304 can never hand back a stale module during development.
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        # One line per request is noise when the page pulls a dozen
        # modules; errors still surface through the normal channels.
        if not args or not str(args[0]).startswith(('GET', 'HEAD')):
            super().log_message(fmt, *args)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5178
    print(f'Serving on http://localhost:{port} with caching disabled')
    ThreadingHTTPServer(('', port), NoCacheHandler).serve_forever()
