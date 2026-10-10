"""Find or start a public tunnel to the local service and discover its URL.

Supported: ngrok and cloudflared (quick tunnel). Reuse: an ngrok agent that is
already running and forwards to the service port is found through its local
API and reused, because a second agent on the same account or domain fails
with "domain in use" or "limited to 1 simultaneous session". Any other tunnel
works too if you run it yourself and pass its URL with --public-url.
"""

import json
import re
import socket
import subprocess
import threading
import time
import urllib.request
from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class TunnelSpec:
    command: Callable[[int], list]
    url_pattern: re.Pattern


# Logs go to stdout in logfmt so the URL is read from the process itself. That
# stays correct when another ngrok agent already owns the 4040 inspection port.
NGROK = TunnelSpec(
    command=lambda port: [
        "ngrok", "http", str(port), "--log", "stdout", "--log-format", "logfmt",
    ],
    url_pattern=re.compile(r"msg=\"started tunnel\".*\burl=(https://\S+)"),
)

CLOUDFLARED = TunnelSpec(
    command=lambda port: ["cloudflared", "tunnel", "--url", f"http://127.0.0.1:{port}"],
    url_pattern=re.compile(r"(https://[a-z0-9-]+\.trycloudflare\.com)"),
)

TUNNELS = {"ngrok": NGROK, "cloudflared": CLOUDFLARED}

# ngrok serves its local API on 4040, then the next free port for each extra agent.
DEFAULT_NGROK_API_PORTS = tuple(range(4040, 4046))


def find_existing_ngrok(port: int, api_ports=DEFAULT_NGROK_API_PORTS) -> str | None:
    """Return the HTTPS URL of a running ngrok tunnel that forwards to `port`, if any."""
    for api_port in api_ports:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{api_port}/api/tunnels", timeout=2) as resp:
                tunnels = json.load(resp).get("tunnels", [])
        except (OSError, ValueError):
            continue
        for t in tunnels:
            addr = t.get("config", {}).get("addr", "")
            url = t.get("public_url", "")
            if re.search(rf":{port}/?$", addr) and url.startswith("https://"):
                return url
    return None


def start(spec: TunnelSpec, port: int, timeout: float = 30.0) -> tuple[subprocess.Popen, str]:
    """Launch the tunnel and return (process, public URL). Stops it on failure."""
    argv = spec.command(port)
    try:
        proc = subprocess.Popen(
            argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1
        )
    except FileNotFoundError:
        raise SystemExit(f"{argv[0]} is not installed or not on PATH.")

    found: list = []
    log: list = []

    def read_output() -> None:
        for line in proc.stdout:
            log.append(line.rstrip())
            match = spec.url_pattern.search(line)
            if match and not found:
                found.append(match.group(1))

    threading.Thread(target=read_output, daemon=True).start()

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if found:
            return proc, found[0]
        if proc.poll() is not None:
            break
        time.sleep(0.1)

    proc.terminate()
    tail = "\n".join(log[-10:])
    raise SystemExit(f"{argv[0]} did not report a public URL. Last output:\n{tail}")


def lan_ip() -> str | None:
    """The address of the interface that routes outward. Connecting a UDP socket sends nothing."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        try:
            probe.connect(("192.0.2.1", 9))
            return probe.getsockname()[0]
        except OSError:
            return None


def local_hostname() -> str | None:
    """The Bonjour name (<name>.local) other computers on the network can resolve."""
    for command in (["scutil", "--get", "LocalHostName"], ["hostname", "-s"]):
        try:
            name = subprocess.run(command, capture_output=True, text=True, timeout=5).stdout.strip()
        except (OSError, subprocess.TimeoutExpired):
            continue
        if name:
            return f"{name}.local"
    return None


def lan_urls(port: int) -> list:
    """URLs for reaching this computer on its network: the .local name first, then the IP."""
    hosts = [h for h in (local_hostname(), lan_ip()) if h]
    return [f"http://{host}:{port}" for host in hosts]
