#!/usr/bin/env python3
"""Mailbox service for agents that run on different computers.

One machine runs this service behind a tunnel (ngrok, cloudflared, or any
HTTPS forwarder). Every agent uses plain HTTP against it: each posts to the
inbox of the agent that must read the message, and polls its own inbox.
The service stores messages as JSON lines and never executes content.

Endpoints (all need the token except /health):
  GET  /health                         liveness
  POST /inbox?box=<name>               store a message in inbox <name>
       optional query: from, type, thread, reply_to, key
  GET  /inbox?box=<name>&since=<id>&limit=<n>&wait=<seconds>
                                       list messages in <name> with id > since; with wait,
                                       hold the request until one arrives (long poll)
  POST /claim?box=<name>&id=<id>&by=<who>
                                       first caller wins a message; others get 409

Environment:
  COORDINATOR_PORT      listen port (default 8787)
  COORDINATOR_HOST      listen address (default 127.0.0.1; the tunnel reaches it locally)
  COORDINATOR_TOKEN     shared secret; if unset, derived from COORDINATOR_PASSWORD,
                        else read from the token file, else generated and saved
  COORDINATOR_DATA_DIR  where inbox-<name>.jsonl and the token are kept
                        (default ~/.cache/agent-coordinator)
"""

import hmac
import json
import os
import re
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from config import DATA_DIR, DEFAULT_PORT, TOKEN_FILE, save_token, token_from_password

MAX_BODY_BYTES = 1_000_000
MAX_DRAIN_BYTES = 10_000_000
DEFAULT_LIMIT = 100
MAX_LIMIT = 500
MAX_WAIT_SECONDS = 30
BOX_PATTERN = re.compile(r"^[a-z0-9_-]{1,32}$")
# Free-form labels (sender, type, thread, key, claimer).
LABEL_PATTERN = re.compile(r"^[A-Za-z0-9_.:@-]{1,64}$")


def load_or_create_token() -> str:
    token = os.environ.get("COORDINATOR_TOKEN")
    if token:
        return token
    password = os.environ.get("COORDINATOR_PASSWORD")
    if password:
        return token_from_password(password)
    if TOKEN_FILE.exists():
        return TOKEN_FILE.read_text().strip()
    token = secrets.token_urlsafe(32)
    save_token(token)
    return token


class GuessThrottle:
    """Caps wrong-token attempts. Once MAX_FAILURES wrong tries fall in one window,
    further wrong tries get 429 until the window clears. A correct token always passes."""

    MAX_FAILURES = 10
    WINDOW_SECONDS = 60.0

    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self._lock = threading.Lock()
        self._failures: list = []

    def record_failure(self) -> bool:
        """Record a wrong try. Returns True if it is over the limit."""
        now = self._clock()
        with self._lock:
            self._failures = [t for t in self._failures if now - t < self.WINDOW_SECONDS]
            locked = len(self._failures) >= self.MAX_FAILURES
            if not locked:
                self._failures.append(now)
            return locked


class Store:
    """Append-only JSON-lines inboxes, one file per box.

    Per-box state (last ID, idempotency keys, claims) is loaded from disk on
    first use and kept in memory. One service process must own the data dir.
    """

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self._lock = threading.Lock()
        self._arrived = threading.Condition(self._lock)
        self._boxes: dict = {}

    def _inbox_path(self, box: str) -> Path:
        return self.data_dir / f"inbox-{box}.jsonl"

    def _claims_path(self, box: str) -> Path:
        return self.data_dir / f"claims-{box}.jsonl"

    @staticmethod
    def _lines(path: Path):
        if not path.exists():
            return
        with path.open() as f:
            for line in f:
                if line.strip():
                    yield json.loads(line)

    def _state(self, box: str) -> dict:
        """Return the in-memory state for a box. The caller holds the lock."""
        if box not in self._boxes:
            last_id, keys = 0, {}
            for m in self._lines(self._inbox_path(box)):
                last_id = max(last_id, m["id"])
                if m.get("key"):
                    keys[m["key"]] = m["id"]
            claims = {c["id"]: c["by"] for c in self._lines(self._claims_path(box))}
            self._boxes[box] = {"last_id": last_id, "keys": keys, "claims": claims}
        return self._boxes[box]

    def read(self, box: str, since: int = 0, limit: int = DEFAULT_LIMIT, wait: float = 0) -> dict:
        """List messages with id > since. With wait, block up to that many seconds for the first one."""
        with self._lock:
            deadline = time.monotonic() + wait
            while self._state(box)["last_id"] <= since and (remaining := deadline - time.monotonic()) > 0:
                self._arrived.wait(remaining)
            last_id = self._state(box)["last_id"]
            messages = []
            for m in self._lines(self._inbox_path(box)):
                if m["id"] > since:
                    messages.append(m)
                    if len(messages) >= limit:
                        break
        return {"messages": messages, "last_id": last_id}

    def append(self, box: str, meta: dict, headers: dict, body: str) -> tuple[dict, bool]:
        """Store a message. Returns (message, created); a repeated key is not stored again."""
        self.data_dir.mkdir(parents=True, exist_ok=True)
        with self._lock:
            state = self._state(box)
            key = meta.get("key")
            if key and key in state["keys"]:
                existing = next(
                    m for m in self._lines(self._inbox_path(box)) if m["id"] == state["keys"][key]
                )
                return existing, False
            state["last_id"] += 1
            message = {
                "id": state["last_id"],
                "box": box,
                "received_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                **meta,
                "headers": headers,
                "body": body,
            }
            with self._inbox_path(box).open("a") as f:
                f.write(json.dumps(message) + "\n")
            if key:
                state["keys"][key] = message["id"]
            self._arrived.notify_all()
        return message, True

    def claim(self, box: str, message_id: int, by: str) -> tuple[str, str | None]:
        """Claim a message. Returns ("claimed" | "held" | "missing", current holder)."""
        with self._lock:
            state = self._state(box)
            if not 1 <= message_id <= state["last_id"]:
                return "missing", None
            holder = state["claims"].get(message_id)
            if holder is not None:
                return ("claimed" if holder == by else "held"), holder
            state["claims"][message_id] = by
            with self._claims_path(box).open("a") as f:
                f.write(json.dumps({"id": message_id, "by": by, "at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}) + "\n")
            return "claimed", by


def make_handler(store: Store, token: str, throttle: GuessThrottle | None = None):
    throttle = throttle or GuessThrottle()

    class Handler(BaseHTTPRequestHandler):
        def _reply(self, status: int, payload: dict) -> None:
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _authorized(self) -> bool:
            """True if the token is right. Otherwise replies 401, or 429 when guessing too fast."""
            supplied = self.headers.get("X-Coordinator-Token", "")
            auth = self.headers.get("Authorization", "")
            if auth.startswith("Bearer "):
                supplied = auth[len("Bearer "):]
            if hmac.compare_digest(supplied.encode(), token.encode()):
                return True
            if throttle.record_failure():
                self._reply(429, {"error": "too many failed attempts, try again in a minute"})
            else:
                self._reply(401, {"error": "unauthorized"})
            return False

        def _box(self, query: dict) -> str | None:
            box = query.get("box", ["default"])[0]
            if not BOX_PATTERN.match(box):
                self._reply(400, {"error": "box must match [a-z0-9_-]{1,32}"})
                return None
            return box

        def _int(self, query: dict, name: str, default: int | None = None) -> int | None:
            """Parse an integer query param. Replies 400 and returns None if invalid."""
            raw = query.get(name, [None])[0]
            if raw is None:
                return default
            try:
                return int(raw)
            except ValueError:
                self._reply(400, {"error": f"{name} must be an integer"})
                return None

        def _label(self, query: dict, name: str) -> tuple[bool, str | None]:
            """Parse an optional label param. Returns (ok, value); replies 400 if invalid."""
            value = query.get(name, [None])[0]
            if value is not None and not LABEL_PATTERN.match(value):
                self._reply(400, {"error": f"{name} must match [A-Za-z0-9_.:@-]{{1,64}}"})
                return False, None
            return True, value

        def do_GET(self) -> None:
            url = urlparse(self.path)
            if url.path == "/health":
                self._reply(200, {"status": "ok"})
                return
            if not self._authorized():
                return
            if url.path == "/inbox":
                query = parse_qs(url.query)
                box = self._box(query)
                if box is None:
                    return
                since = self._int(query, "since", 0)
                limit = self._int(query, "limit", DEFAULT_LIMIT)
                wait = self._int(query, "wait", 0)
                if since is None or limit is None or wait is None:
                    return
                limit = max(1, min(limit, MAX_LIMIT))
                self._reply(200, store.read(box, since, limit, max(0, min(wait, MAX_WAIT_SECONDS))))
                return
            self._reply(404, {"error": "not found"})

        def do_POST(self) -> None:
            url = urlparse(self.path)
            if not self._authorized():
                return
            if url.path not in ("/inbox", "/claim"):
                self._reply(404, {"error": "not found"})
                return
            query = parse_qs(url.query)
            box = self._box(query)
            if box is None:
                return
            if url.path == "/claim":
                self._claim(box, query)
            else:
                self._post_message(box, query)

        def _claim(self, box: str, query: dict) -> None:
            message_id = self._int(query, "id")
            ok, by = self._label(query, "by")
            if not ok:
                return
            if message_id is None or by is None:
                self._reply(400, {"error": "id and by are required"})
                return
            outcome, holder = store.claim(box, message_id, by)
            if outcome == "missing":
                self._reply(404, {"error": "no such message"})
            elif outcome == "held":
                self._reply(409, {"claimed": False, "id": message_id, "by": holder})
            else:
                self._reply(200, {"claimed": True, "id": message_id, "by": holder})

        def _post_message(self, box: str, query: dict) -> None:
            meta = {}
            for name in ("from", "type", "thread", "key"):
                ok, meta[name] = self._label(query, name)
                if not ok:
                    return
            reply_to = self._int(query, "reply_to")
            if "reply_to" in query and reply_to is None:
                return
            meta["reply_to"] = reply_to
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                self._reply(400, {"error": "invalid Content-Length"})
                return
            if length > MAX_BODY_BYTES:
                # Drain a modest overshoot so the client reads the 413 instead of a reset.
                if length <= MAX_DRAIN_BYTES:
                    self.rfile.read(length)
                self._reply(413, {"error": "body too large"})
                return
            body = self.rfile.read(length).decode("utf-8", errors="replace")
            keep = ("Content-Type", "User-Agent")
            headers = {k: self.headers[k] for k in keep if self.headers.get(k)}
            message, created = store.append(box, meta, headers, body)
            if created:
                print(f"[{box} #{message['id']}] {body[:200]}", flush=True)
            self._reply(202 if created else 200, {"box": box, "id": message["id"], "duplicate": not created})

        def log_message(self, fmt: str, *args) -> None:
            print(f"{self.address_string()} {fmt % args}", flush=True)

    return Handler


def make_server(host: str, port: int, store: Store, token: str, throttle: GuessThrottle | None = None) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), make_handler(store, token, throttle))


def main() -> None:
    port = int(os.environ.get("COORDINATOR_PORT", DEFAULT_PORT))
    host = os.environ.get("COORDINATOR_HOST", "127.0.0.1")
    server = make_server(host, port, Store(DATA_DIR), load_or_create_token())
    print(f"coordinator listening on {host}:{port}, data in {DATA_DIR}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
