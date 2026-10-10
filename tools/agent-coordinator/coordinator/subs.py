"""Subscriptions: which Claude Code sessions receive which boxes.

A subscription is a file in DATA_DIR/subs naming a session, the box it reads,
the coordinator URL and the session's inbox socket. The daemon (daemon.py)
reads these files and pushes messages into the sockets.
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

from config import DATA_DIR, DEFAULT_URL

SUBS_DIR = DATA_DIR / "subs"
DAEMON = Path(__file__).with_name("daemon.py")


def sub_path(box: str, session: str) -> Path:
    return SUBS_DIR / f"{box}.{session}.json"


def cursor_path(box: str, session: str) -> Path:
    return SUBS_DIR / f"{box}.{session}.cursor"


def write_atomic(path: Path, text: str, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    with os.fdopen(fd, "w") as f:
        f.write(text)
    os.replace(tmp, path)


def subscribe(session: str, box: str, socket_path: str, url: str = DEFAULT_URL, token: str | None = None) -> Path:
    """Register a session for a box. Messages already in the box are not replayed."""
    entry = {"session": session, "box": box, "socket": socket_path, "url": url.rstrip("/"), "at": time.time()}
    if token:
        entry["auth_token"] = token
    path = sub_path(box, session)
    write_atomic(path, json.dumps(entry))
    (DATA_DIR / f"active-{session}").touch()
    return path


def unsubscribe(session: str, box: str | None = None) -> int:
    """Remove a session's subscriptions (one box, or all). Returns how many were removed."""
    removed = 0
    for entry in list_subs():
        if entry["session"] == session and box in (None, entry["box"]):
            sub_path(entry["box"], session).unlink(missing_ok=True)
            cursor_path(entry["box"], session).unlink(missing_ok=True)
            removed += 1
    return removed


def list_subs() -> list:
    entries = []
    for path in sorted(SUBS_DIR.glob("*.json")):
        try:
            entries.append(json.loads(path.read_text()))
        except (OSError, json.JSONDecodeError):
            continue
    return entries


def ensure_daemon() -> None:
    """Start the daemon in the background. A second daemon exits at once (it cannot take the lock)."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(DATA_DIR / "daemon.log", "a") as log:
        subprocess.Popen(
            [sys.executable, str(DAEMON)],
            stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True,
        )
