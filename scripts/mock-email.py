#!/usr/bin/env python3
"""Tiny stand-in for the Resend API: appends each request body to a JSON-lines file.

  scripts/mock-email.py /tmp/emails.jsonl 9999
Point the Worker at it with EMAIL_API_URL=http://localhost:9999/emails and RESEND_API_KEY=test.
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

log, port = sys.argv[1], int(sys.argv[2])


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("content-length", 0)))
        with open(log, "ab") as f:
            f.write(json.dumps(json.loads(body)).encode() + b"\n")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"id":"mock"}')

    def log_message(self, *args):
        pass


HTTPServer(("127.0.0.1", port), Handler).serve_forever()
