#!/usr/bin/env python3
"""Command-line client for the coordinator service.

  client.py send --to <box> [--from <name>] [--type <t>] [--thread <id>]
                 [--reply-to <id>] [--key <k>] [BODY | -]
  client.py read --box <box> [--since <id>] [--limit <n>]
  client.py claim --box <box> --id <id> [--by <name>]
  client.py join
  client.py subscribe [--box <box>] [--session <id>]
  client.py unsubscribe [--box <box>] [--session <id>]
  client.py subscriptions

Prints the service's JSON reply. Exits 1 on an HTTP error, including a lost
claim (409). `join` asks for the password, checks it against the service, and
saves the derived token. `subscribe` makes the push daemon write the box's
messages into this Claude Code session (needs CLAUDE_CODE_MESSAGING_SOCKET, which
Claude Code sets). BODY of "-" or no BODY reads the message from stdin.

Environment: COORDINATOR_URL, COORDINATOR_TOKEN or COORDINATOR_PASSWORD (see config.py) and
COORDINATOR_BOX (default sender and claimer name).
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

import subs
from config import DEFAULT_URL, TOKEN_FILE, prompt_password, read_token, save_token, token_from_password

URL = os.environ.get("COORDINATOR_URL", DEFAULT_URL).rstrip("/")
ME = os.environ.get("COORDINATOR_BOX") or os.environ.get("USER", "me")


def call(method: str, path: str, params: dict, body: str | None = None) -> int:
    query = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    request = urllib.request.Request(
        f"{URL}{path}?{query}",
        data=body.encode() if body is not None else None,
        method=method,
        headers={
            "X-Coordinator-Token": read_token(),
            "Content-Type": "text/plain; charset=utf-8",
            # The ngrok header skips its browser interstitial; other tunnels ignore it.
            "ngrok-skip-browser-warning": "1",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as resp:
            print(resp.read().decode())
            return 0
    except urllib.error.HTTPError as err:
        print(err.read().decode())
        return 1
    except urllib.error.URLError as err:
        print(json.dumps({"error": str(err.reason)}))
        return 1


def join() -> int:
    """Derive the token from the password, check it against the service, then save it."""
    password = os.environ.get("COORDINATOR_PASSWORD") or prompt_password(confirm=False)
    token = token_from_password(password)
    request = urllib.request.Request(
        f"{URL}/inbox?box={urllib.parse.quote(ME)}&limit=1",
        headers={"X-Coordinator-Token": token, "ngrok-skip-browser-warning": "1"},
    )
    try:
        urllib.request.urlopen(request, timeout=15).close()
    except urllib.error.HTTPError as err:
        reason = "wrong password" if err.code == 401 else f"HTTP {err.code}"
        print(json.dumps({"error": f"cannot join {URL}: {reason}"}))
        return 1
    except urllib.error.URLError as err:
        print(json.dumps({"error": f"cannot reach {URL}: {err.reason}"}))
        return 1
    save_token(token)
    print(json.dumps({"joined": URL, "box": ME, "token_file": str(TOKEN_FILE)}))
    return 0


def subscribe(box: str, session: str | None) -> int:
    session = session or os.environ.get("CLAUDE_CODE_SESSION_ID")
    socket_path = os.environ.get("CLAUDE_CODE_MESSAGING_SOCKET")
    if not session or not socket_path:
        print(json.dumps({"error": "run this inside a Claude Code session (no session id or inbox socket found)"}))
        return 1
    read_token()
    subs.subscribe(session, box, socket_path, URL, os.environ.get("CLAUDE_CODE_MESSAGING_TOKEN"))
    if os.environ.get("COORDINATOR_SPAWN_DAEMON") != "0":
        subs.ensure_daemon()
    print(json.dumps({"subscribed": box, "session": session, "url": URL}))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="action", required=True)

    send = sub.add_parser("send")
    send.add_argument("--to", required=True)
    send.add_argument("--from", dest="sender", default=ME)
    send.add_argument("--type")
    send.add_argument("--thread")
    send.add_argument("--reply-to", type=int)
    send.add_argument("--key")
    send.add_argument("body", nargs="?", default="-")

    read = sub.add_parser("read")
    read.add_argument("--box", default=ME)
    read.add_argument("--since", type=int, default=0)
    read.add_argument("--limit", type=int)

    claim = sub.add_parser("claim")
    claim.add_argument("--box", default=ME)
    claim.add_argument("--id", type=int, required=True)
    claim.add_argument("--by", default=ME)

    sub.add_parser("join")
    for name in ("subscribe", "unsubscribe"):
        action = sub.add_parser(name)
        action.add_argument("--box", default=ME)
        action.add_argument("--session")
    sub.add_parser("subscriptions")

    args = parser.parse_args()
    if args.action == "join":
        return join()
    if args.action == "subscribe":
        return subscribe(args.box, args.session)
    if args.action == "unsubscribe":
        session = args.session or os.environ.get("CLAUDE_CODE_SESSION_ID", "")
        print(json.dumps({"removed": subs.unsubscribe(session, args.box)}))
        return 0
    if args.action == "subscriptions":
        print(json.dumps({"subscriptions": [{k: v for k, v in e.items() if k != "auth_token"} for e in subs.list_subs()]}))
        return 0
    if args.action == "send":
        body = sys.stdin.read() if args.body == "-" else args.body
        params = {
            "box": args.to, "from": args.sender, "type": args.type,
            "thread": args.thread, "reply_to": args.reply_to, "key": args.key,
        }
        return call("POST", "/inbox", params, body)
    if args.action == "read":
        return call("GET", "/inbox", {"box": args.box, "since": args.since, "limit": args.limit})
    return call("POST", "/claim", {"box": args.box, "id": args.id, "by": args.by})


if __name__ == "__main__":
    sys.exit(main())
