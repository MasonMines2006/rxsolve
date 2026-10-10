#!/usr/bin/env python3
"""Poll a coordinator inbox and print each new message as one line on stdout.

Each line is JSON: id, box, body, plus from, type, thread, reply_to and
received_at when set. A watcher (for example the Claude Code Monitor tool)
reads the lines and decides on a reply (see client.py). The poller never acts
on message content.

Environment:
  COORDINATOR_URL      service base URL (default http://127.0.0.1:8787)
  COORDINATOR_TOKEN    shared secret (default: contents of the token file)
  COORDINATOR_BOX      inbox to poll (default "me")
  COORDINATOR_SESSION  id of the agent session this poller serves (default
                       $CLAUDE_CODE_SESSION_ID). Each session runs its own poller
                       and gets its own cursor, so every session sees every message.
  COORDINATOR_DATA_DIR where state files live (default ~/.cache/agent-coordinator)
  POLL_SECONDS         seconds between polls (default 3)
  IDLE_SECONDS         stop delivering once the session activity file is older
                       than this (default 3300, just under a 1h prompt-cache TTL).
                       Set 0 to disable idle gating.

While the session is idle the poller keeps running but does not fetch, so a
message cannot wake a session whose prompt cache has expired. Undelivered
messages stay in the inbox and are delivered when activity resumes. Hooks
(see hook.py) keep the activity file fresh.
"""

import http.client
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

from config import DATA_DIR, DEFAULT_URL, read_token

URL = os.environ.get("COORDINATOR_URL", DEFAULT_URL).rstrip("/")
BOX = os.environ.get("COORDINATOR_BOX", "me")
SESSION = (
    os.environ.get("COORDINATOR_SESSION")
    or os.environ.get("CLAUDE_CODE_SESSION_ID")
    or "default"
)
POLL_SECONDS = float(os.environ.get("POLL_SECONDS", "3"))
IDLE_SECONDS = float(os.environ.get("IDLE_SECONDS", "3300"))
PAGE_SIZE = 100
STATE_FILE = DATA_DIR / f"poller-{BOX}-{SESSION}.state"
ACTIVITY_FILE = DATA_DIR / f"active-{SESSION}"
PID_FILE = DATA_DIR / f"poller-{BOX}-{SESSION}.pid"


def fetch(token: str, since: int) -> dict:
    request = urllib.request.Request(
        f"{URL}/inbox?box={BOX}&since={since}&limit={PAGE_SIZE}",
        # The ngrok header skips its browser interstitial; other tunnels ignore it.
        headers={"X-Coordinator-Token": token, "ngrok-skip-browser-warning": "1"},
    )
    with urllib.request.urlopen(request, timeout=10) as resp:
        return json.load(resp)


def initial_since(token: str) -> int:
    if STATE_FILE.exists():
        return int(STATE_FILE.read_text().strip() or 0)
    # First run: skip the backlog so old messages are not replayed.
    return fetch(token, 0)["last_id"]


def deliverable(message: dict) -> dict:
    """Pick the fields a watcher needs, dropping unset metadata."""
    fields = ("id", "box", "from", "type", "thread", "reply_to", "received_at", "body")
    return {k: message[k] for k in fields if message.get(k) is not None}


def save(since: int) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    # Write then rename so a kill mid-write cannot leave an empty cursor and replay the inbox.
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(str(since))
    os.replace(tmp, STATE_FILE)


def touch_activity() -> None:
    ACTIVITY_FILE.parent.mkdir(parents=True, exist_ok=True)
    ACTIVITY_FILE.touch()


def session_idle() -> bool:
    if IDLE_SECONDS <= 0:
        return False
    try:
        return time.time() - ACTIVITY_FILE.stat().st_mtime > IDLE_SECONDS
    except FileNotFoundError:
        return True


def main() -> None:
    token = read_token()
    # Starting the poller counts as activity; without hooks it goes quiet after IDLE_SECONDS.
    touch_activity()
    PID_FILE.write_text(str(os.getpid()))
    since = initial_since(token)
    save(since)
    print(f"polling box={BOX} session={SESSION} at {URL} from id>{since}", file=sys.stderr, flush=True)
    paused = False
    while True:
        if session_idle():
            if not paused:
                print("session idle, delivery paused", file=sys.stderr, flush=True)
                paused = True
            time.sleep(POLL_SECONDS)
            continue
        if paused:
            print("session active, delivery resumed", file=sys.stderr, flush=True)
            paused = False
        try:
            while True:
                messages = fetch(token, since)["messages"]
                for message in messages:
                    since = message["id"]
                    # One line per message keeps the watcher's parsing simple.
                    print(json.dumps(deliverable(message)), flush=True)
                    save(since)
                if len(messages) < PAGE_SIZE:
                    break
        except (OSError, http.client.HTTPException, json.JSONDecodeError) as err:
            print(f"poll failed: {err}", file=sys.stderr, flush=True)
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
