#!/usr/bin/env python3
"""Minimal dot-ai upstream stub for by-design e2e tests.

Endpoints mirror the tools REST paths the Grafana plugin proxies to.
Body markers (in intent/issue) drive failure modes without a second framework.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "0.0.0.0"
PORT = 8080

# Unique markers — must NEVER appear in Grafana browser/plugin resource responses.
UPSTREAM_SECRET_MARKER = "UPSTREAM_SECRET_STACK_DO_NOT_LEAK"
UPSTREAM_INTERNAL_FIELD = "raw_upstream_internal_do_not_leak"

_lock = threading.Lock()
_hits: dict[str, int] = {
    "version": 0,
    "query": 0,
    "remediate": 0,
    "other": 0,
}


def _bump(path: str) -> None:
    key = "other"
    if path.endswith("/version"):
        key = "version"
    elif path.endswith("/query"):
        key = "query"
    elif path.endswith("/remediate"):
        key = "remediate"
    with _lock:
        _hits[key] = _hits.get(key, 0) + 1


class Handler(BaseHTTPRequestHandler):
    server_version = "dot-ai-stub/1.0"

    def log_message(self, fmt: str, *args) -> None:  # quiet CI logs
        pass

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or "0")
        raw = self.rfile.read(length) if length else b""
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
            return data if isinstance(data, dict) else {}
        except json.JSONDecodeError:
            return {}

    def _write(self, status: int, body: dict | list | str, content_type: str = "application/json") -> None:
        if isinstance(body, (dict, list)):
            payload = json.dumps(body).encode("utf-8")
        else:
            payload = str(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:  # noqa: N802
        if self.path in ("/healthz", "/"):
            with _lock:
                hits = dict(_hits)
            self._write(200, {"ok": True, "hits": hits})
            return
        self._write(404, {"error": {"message": "not found"}})

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        _bump(path)
        body = self._read_json()
        auth = self.headers.get("Authorization", "")

        # Always require Bearer so a missing key is visible in dial failures.
        if not auth.startswith("Bearer "):
            self._write(
                401,
                {
                    "error": {"message": "missing bearer"},
                    UPSTREAM_INTERNAL_FIELD: UPSTREAM_SECRET_MARKER,
                },
            )
            return

        text = " ".join(
            str(body.get(k) or "")
            for k in ("intent", "issue", "query", "prompt")
        )

        if path.endswith("/version") or path.endswith("/api/v1/tools/version"):
            self._write(200, {"success": True, "data": {"connected": True, "version": "stub-1.0"}})
            return

        if path.endswith("/query") or path.endswith("/api/v1/tools/query"):
            self._handle_tool(text, body, tool="query")
            return

        if path.endswith("/remediate") or path.endswith("/api/v1/tools/remediate"):
            # If execute/apply leak past the plugin allowlist, surface a distinctive marker.
            leaked = [k for k in ("execute", "apply", "mode", "confirm") if k in body]
            if leaked:
                self._write(
                    200,
                    {
                        "success": True,
                        "data": {
                            "result": {
                                "summary": f"STUB_SAW_EXECUTE_KEYS:{','.join(leaked)}",
                            }
                        },
                    },
                )
                return
            self._handle_tool(text, body, tool="remediate")
            return

        self._write(404, {"error": {"message": f"unknown path {path}"}})

    def _handle_tool(self, text: str, body: dict, tool: str) -> None:
        if "TRIGGER_UPSTREAM_5XX" in text:
            self._write(
                503,
                {
                    "message": "generic upstream failure",
                    "error": {"message": "service unavailable"},
                    "debug_stack": UPSTREAM_SECRET_MARKER,
                    UPSTREAM_INTERNAL_FIELD: UPSTREAM_SECRET_MARKER,
                },
            )
            return
        if "TRIGGER_UPSTREAM_403" in text:
            self._write(
                403,
                {
                    "error": {"message": "upstream forbidden"},
                    "debug_stack": UPSTREAM_SECRET_MARKER,
                    UPSTREAM_INTERNAL_FIELD: UPSTREAM_SECRET_MARKER,
                },
            )
            return
        if "TRIGGER_UPSTREAM_401" in text:
            self._write(
                401,
                {
                    "error": {"message": "upstream unauthorized"},
                    "debug_stack": UPSTREAM_SECRET_MARKER,
                    UPSTREAM_INTERNAL_FIELD: UPSTREAM_SECRET_MARKER,
                },
            )
            return

        summary = f"stub-{tool}-ok"
        if text.strip():
            summary = f"stub-{tool}-ok: {text.strip()[:80]}"
        self._write(
            200,
            {
                "success": True,
                "data": {"result": {"summary": summary}},
                # Must never appear in the plugin envelope.
                UPSTREAM_INTERNAL_FIELD: UPSTREAM_SECRET_MARKER,
            },
        )


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"dot-ai-stub listening on {HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
