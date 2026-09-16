"""本機測試用的靜態伺服器：UTF-8、不快取。"""
import functools
import http.server
import sys


class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8"}

    # 模擬 Artifact 沙箱的 CSP：圖片只能來自 self 或 data:，blob: 會被擋掉
    CSP = ("default-src 'self' 'unsafe-inline' 'unsafe-eval'; "
           "img-src 'self' data:; media-src 'self' data:; font-src 'self' data: https://fonts.gstatic.com; "
           "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
           "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net")

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        if "--csp" in sys.argv:
            self.send_header("Content-Security-Policy", self.CSP)
        super().end_headers()


http.server.ThreadingHTTPServer(
    ("127.0.0.1", 8131), functools.partial(H, directory=sys.argv[1])).serve_forever()
