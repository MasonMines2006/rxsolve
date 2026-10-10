#!/usr/bin/env python3
"""Run the coordinator service, optionally with a public tunnel.

  python3 coordinator/serve.py                        # local only
  python3 coordinator/serve.py --lan                  # no tunnel: listen on the local network
  python3 coordinator/serve.py --tunnel ngrok         # reuse a running ngrok for this port, else start one
  python3 coordinator/serve.py --tunnel cloudflared   # start a cloudflared quick tunnel
  python3 coordinator/serve.py --public-url https://x # you run the tunnel; this only prints the URL

  python3 coordinator/serve.py --detach --lan --generate-password   # run in the background
  python3 coordinator/serve.py --status                             # JSON: running, healthy, urls
  python3 coordinator/serve.py --stop

--lan listens on every interface, so computers on the same network (office
Wi-Fi, home, VPN) reach it at http://<this computer>.local:<port> or its IP.
That is plain HTTP: the token is readable by anyone on the network path.

--detach starts the service in the background and prints one JSON object with
its URLs when it is ready. Output goes to service.log in the data directory.
It needs a password: --generate-password makes one (and prints it once), or set
COORDINATOR_PASSWORD, or use the password already saved by an earlier start.
A running service is left alone; --stop it first to change its options.

On a foreground start with no token file, COORDINATOR_TOKEN or
COORDINATOR_PASSWORD, it asks for a password. Tell the other agents the printed
URL and the password; they run `client.py join` and type it.

The port comes from COORDINATOR_PORT (default 8787). NGROK_API_PORTS (comma
separated) overrides where to look for a running ngrok (default 4040-4045).
"""

import argparse
import json
import os
import signal
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

import tunnel
from config import (
    DATA_DIR, DEFAULT_PORT, STATE_FILE, TOKEN_FILE,
    generate_password, prompt_password, save_token, token_from_password,
)
from service import Store, load_or_create_token, make_server
from subs import write_atomic

CLIENT = Path(__file__).with_name("client.py")
LOG_FILE = DATA_DIR / "service.log"
DETACH_TIMEOUT_SECONDS = 45


def ngrok_api_ports() -> tuple:
    raw = os.environ.get("NGROK_API_PORTS")
    if not raw:
        return tunnel.DEFAULT_NGROK_API_PORTS
    return tuple(int(p) for p in raw.split(","))


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def read_state() -> dict | None:
    """The record of the running service in this data directory, or None."""
    try:
        state = json.loads(STATE_FILE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return None
    return state if pid_alive(state.get("pid", 0)) else None


def write_state(port: int, mode: str, urls: list, public_url: str | None, ready: bool) -> None:
    join_url = public_url or (urls[0] if urls else f"http://127.0.0.1:{port}")
    write_atomic(STATE_FILE, json.dumps({
        "pid": os.getpid(), "port": port, "mode": mode, "ready": ready,
        "urls": urls, "public_url": public_url, "data_dir": str(DATA_DIR),
        "join_command": f"COORDINATOR_URL={join_url} python3 {CLIENT} join",
        "started": time.time(),
    }), mode=0o644)


def healthy(port: int) -> bool:
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=3).close()
        return True
    except OSError:
        return False


def run(args) -> None:
    port = int(os.environ.get("COORDINATOR_PORT", DEFAULT_PORT))
    if read_state():
        raise SystemExit(f"a coordinator is already running for {DATA_DIR}; run serve.py --stop first")
    if args.generate_password:
        password = generate_password()
        save_token(token_from_password(password))
        print(f"password: {password}", flush=True)
    has_secret = os.environ.get("COORDINATOR_TOKEN") or os.environ.get("COORDINATOR_PASSWORD") or TOKEN_FILE.exists()
    if not has_secret and sys.stdin.isatty():
        save_token(token_from_password(prompt_password(confirm=True)))
    host = "0.0.0.0" if args.lan else "127.0.0.1"
    mode = "lan" if args.lan else "public-url" if args.public_url else args.tunnel if args.tunnel != "none" else "local"
    server = make_server(host, port, Store(DATA_DIR), load_or_create_token())
    threading.Thread(target=server.serve_forever, daemon=True).start()
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    print(f"coordinator listening on {host}:{port}, data in {DATA_DIR}", flush=True)
    write_state(port, mode, [], None, ready=False)

    proc = None
    try:
        urls, url = [], args.public_url
        if args.lan:
            urls = tunnel.lan_urls(port)
            for lan_url in urls:
                print(f"LAN URL: {lan_url}", flush=True)
            if urls:
                print(f"others join with: COORDINATOR_URL={urls[0]} python3 coordinator/client.py join", flush=True)
            else:
                print("could not find a network address; use --public-url", flush=True)
        if args.tunnel == "ngrok":
            url = tunnel.find_existing_ngrok(port, ngrok_api_ports())
            if url:
                print("reusing the running ngrok tunnel", flush=True)
        if not url and args.tunnel != "none":
            proc, url = tunnel.start(tunnel.TUNNELS[args.tunnel], port)
        if url:
            print(f"public URL: {url}", flush=True)
            print(f"others join with: COORDINATOR_URL={url} python3 coordinator/client.py join", flush=True)
        write_state(port, mode, urls, url, ready=True)
        if proc:
            proc.wait()
        else:
            threading.Event().wait()
    except KeyboardInterrupt:
        pass
    finally:
        if proc and proc.poll() is None:
            proc.terminate()
        server.shutdown()
        STATE_FILE.unlink(missing_ok=True)


def public(state: dict) -> dict:
    return {k: state[k] for k in ("pid", "port", "mode", "urls", "public_url", "join_command") if k in state}


def detach(args, argv: list) -> int:
    state = read_state()
    if state:
        print(json.dumps({"running": True, "already_running": True, **public(state)}))
        return 0
    env = dict(os.environ)
    password = None
    if args.generate_password:
        password = generate_password()
        save_token(token_from_password(password))
        env.pop("COORDINATOR_TOKEN", None)
        env.pop("COORDINATOR_PASSWORD", None)
    elif not (env.get("COORDINATOR_TOKEN") or env.get("COORDINATOR_PASSWORD") or TOKEN_FILE.exists()):
        print(json.dumps({"error": "no password yet: pass --generate-password, or set COORDINATOR_PASSWORD"}))
        return 1
    child_args = [a for a in argv if a not in ("--detach", "--generate-password")]
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(LOG_FILE, "a") as log:
        child = subprocess.Popen(
            [sys.executable, str(Path(__file__).resolve()), *child_args],
            stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True, env=env,
        )
    deadline = time.monotonic() + DETACH_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        state = read_state()
        if state and state.get("ready") and state["pid"] == child.pid:
            result = {"running": True, **public(state), "log": str(LOG_FILE)}
            if password:
                result["password"] = password
            print(json.dumps(result))
            return 0
        if child.poll() is not None:
            break
        time.sleep(0.1)
    if child.poll() is None:
        child.terminate()
    tail = LOG_FILE.read_text().splitlines()[-5:] if LOG_FILE.exists() else []
    print(json.dumps({"error": "the service did not start", "log": str(LOG_FILE), "log_tail": tail}))
    return 1


def stop() -> int:
    state = read_state()
    if not state:
        STATE_FILE.unlink(missing_ok=True)
        print(json.dumps({"stopped": False, "reason": "not running"}))
        return 0
    pid = state["pid"]
    os.kill(pid, signal.SIGTERM)
    deadline = time.monotonic() + 15
    while pid_alive(pid) and time.monotonic() < deadline:
        time.sleep(0.1)
    if pid_alive(pid):
        os.kill(pid, signal.SIGKILL)
    STATE_FILE.unlink(missing_ok=True)
    print(json.dumps({"stopped": True, "pid": pid}))
    return 0


def status() -> int:
    state = read_state()
    if not state:
        print(json.dumps({"running": False}))
        return 1
    print(json.dumps({"running": True, "healthy": healthy(state["port"]), "ready": state.get("ready", False), **public(state)}))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--tunnel", choices=["none", *tunnel.TUNNELS], default="none")
    group.add_argument("--public-url", help="URL of a tunnel you already run for this port")
    group.add_argument("--lan", action="store_true", help="listen on the local network, no tunnel")
    parser.add_argument("--detach", action="store_true", help="run in the background and print JSON")
    parser.add_argument("--generate-password", action="store_true", help="make a password and print it once")
    parser.add_argument("--stop", action="store_true", help="stop the running service")
    parser.add_argument("--status", action="store_true", help="print JSON about the running service")
    args = parser.parse_args()
    if args.stop:
        return stop()
    if args.status:
        return status()
    if args.detach:
        return detach(args, sys.argv[1:])
    run(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
