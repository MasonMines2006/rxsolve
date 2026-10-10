#!/usr/bin/env python3
"""Claude Code hook for the coordinator, run with one argument.

  start  SessionStart: subscribe this session to its box, start the push daemon,
         and tell the agent how to send, claim and read
  touch  mark this session active (idle gating keys off this)
  stop   SessionEnd: remove this session's subscriptions

Environment:
  COORDINATOR_BOX            inbox this agent reads (default $USER)
  COORDINATOR_URL            service base URL (default http://127.0.0.1:8787)
  COORDINATOR_AUTOSUBSCRIBE  set to 0 to skip the automatic subscription
  COORDINATOR_SPAWN_DAEMON   set to 0 to leave the daemon to you
  CLAUDE_CODE_MESSAGING_SOCKET, CLAUDE_CODE_MESSAGING_TOKEN
                             set by Claude Code: the session's inbox socket
"""

import json
import os
import sys
from pathlib import Path

import subs
from config import DATA_DIR, DEFAULT_URL, TOKEN_FILE

POLLER = Path(__file__).with_name("poller.py")
CLIENT = Path(__file__).with_name("client.py")
SERVE = Path(__file__).with_name("serve.py")


def joined() -> bool:
    return bool(os.environ.get("COORDINATOR_TOKEN") or os.environ.get("COORDINATOR_PASSWORD") or TOKEN_FILE.exists())


def start_note(session: str) -> str:
    box = os.environ.get("COORDINATOR_BOX") or os.environ.get("USER", "me")
    url = os.environ.get("COORDINATOR_URL")
    url_env = f" COORDINATOR_URL={url}" if url else ""
    client = (
        f"To send, claim, read or subscribe, run: COORDINATOR_BOX={box}{url_env} python3 {CLIENT} "
        f"send|claim|read|subscribe --help. To host the coordinator service on this computer, see the host "
        f"skill: python3 {SERVE} --help."
    )
    if not joined():
        return (
            "The coordinator is not set up on this computer: there is no token yet. To join one, use the join skill "
            f"(the user runs `! COORDINATOR_BOX={box}{url_env} python3 {CLIENT} join` and types the password). "
            f"To start a new one, use the host skill. {client}"
        )
    socket_path = os.environ.get("CLAUDE_CODE_MESSAGING_SOCKET")
    if socket_path and os.environ.get("COORDINATOR_AUTOSUBSCRIBE") != "0":
        subs.subscribe(
            session, box, socket_path, url or DEFAULT_URL, os.environ.get("CLAUDE_CODE_MESSAGING_TOKEN")
        )
        if os.environ.get("COORDINATOR_SPAWN_DAEMON") != "0":
            subs.ensure_daemon()
        return (
            f"This session is subscribed to coordinator box {box}. Messages from other agents are pushed "
            f"into the session as they arrive; there is no poller to start. {client}"
        )
    if socket_path:
        return f"Automatic coordinator subscription is off. Subscribe with the client. {client}"
    return (
        "This Claude Code has no session inbox socket, so messages cannot be pushed. Fall back to a poller: "
        "start it with the Monitor tool (unbounded, timeout_ms 1800000, re-arm on expiry): "
        f"COORDINATOR_SESSION={session} COORDINATOR_BOX={box}{url_env} python3 {POLLER}. {client}"
    )


def main() -> None:
    event = json.load(sys.stdin)
    session = event.get("session_id", "default")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if sys.argv[1] == "touch":
        (DATA_DIR / f"active-{session}").touch()
    elif sys.argv[1] == "start":
        output = {
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "additionalContext": start_note(session),
            }
        }
        print(json.dumps(output))
    elif sys.argv[1] == "stop":
        subs.unsubscribe(session)
    else:
        raise SystemExit(f"unknown action: {sys.argv[1]}")


if __name__ == "__main__":
    main()
