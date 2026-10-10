"""Process helpers for the end-to-end tests: real service, poller, client and hook."""

import json
import os
import queue
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "coordinator"
TOKEN = "e2e-token"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Service:
    """The real service.py in a subprocess with its own data dir."""

    def __init__(self, data_dir: Path | None = None):
        self._tmp = None if data_dir else tempfile.TemporaryDirectory()
        self.data_dir = data_dir or Path(self._tmp.name)
        self.port = free_port()
        self.url = f"http://127.0.0.1:{self.port}"
        self.proc = None

    def env(self, **extra) -> dict:
        return {
            **os.environ,
            "COORDINATOR_URL": self.url,
            "COORDINATOR_TOKEN": TOKEN,
            "COORDINATOR_DATA_DIR": str(self.data_dir),
            "COORDINATOR_PORT": str(self.port),
            **extra,
        }

    def start(self) -> "Service":
        self.proc = subprocess.Popen(
            [sys.executable, str(ROOT / "service.py")],
            env=self.env(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                urllib.request.urlopen(f"{self.url}/health", timeout=1).close()
                return self
            except OSError:
                time.sleep(0.05)
        self.stop()
        raise RuntimeError("service did not start")

    def stop(self) -> None:
        if self.proc:
            self.proc.terminate()
            self.proc.wait()
            self.proc = None

    def cleanup(self) -> None:
        self.stop()
        if self._tmp:
            self._tmp.cleanup()

    def client(self, *args, stdin: str | None = None, **env) -> tuple[int, dict]:
        """Run client.py. Returns (exit code, parsed JSON reply)."""
        result = subprocess.run(
            [sys.executable, str(ROOT / "client.py"), *args],
            env=self.env(**env), input=stdin, capture_output=True, text=True, timeout=30,
        )
        return result.returncode, json.loads(result.stdout)

    def http(self, method: str, path: str, body: bytes | None = None, token: str = TOKEN) -> tuple[int, dict]:
        request = urllib.request.Request(
            self.url + path, data=body, method=method, headers={"X-Coordinator-Token": token}
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as resp:
                return resp.status, json.load(resp)
        except urllib.error.HTTPError as err:
            return err.code, json.load(err)


class Poller:
    """The real poller.py in a subprocess; stdout lines are collected on a queue."""

    def __init__(self, service: Service, box: str, session: str, **env):
        self.lines: queue.Queue = queue.Queue()
        self.proc = subprocess.Popen(
            [sys.executable, str(ROOT / "poller.py")],
            env=service.env(**{
                "COORDINATOR_BOX": box, "COORDINATOR_SESSION": session,
                "POLL_SECONDS": "0.1", "IDLE_SECONDS": "0", **env,
            }),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        self.ready = threading.Event()
        threading.Thread(target=self._pump_stdout, daemon=True).start()
        threading.Thread(target=self._pump_stderr, daemon=True).start()
        if not self.ready.wait(10):
            self.stop()
            raise RuntimeError("poller did not start")

    def _pump_stdout(self) -> None:
        for line in self.proc.stdout:
            self.lines.put(json.loads(line))

    def _pump_stderr(self) -> None:
        for line in self.proc.stderr:
            if line.startswith("polling "):
                self.ready.set()

    def wait_for_cursor(self, state_file: Path, expected: int, timeout: float = 10) -> None:
        """Block until the poller has saved its cursor, so a stop cannot race the save."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if state_file.exists() and state_file.read_text().strip() == str(expected):
                return
            time.sleep(0.05)
        raise AssertionError(f"cursor never reached {expected}")

    def next(self, timeout: float = 10) -> dict:
        return self.lines.get(timeout=timeout)

    def expect_none(self, wait: float = 1.0) -> None:
        try:
            extra = self.lines.get(timeout=wait)
        except queue.Empty:
            return
        raise AssertionError(f"unexpected delivery: {extra}")

    def stop(self) -> None:
        self.proc.terminate()
        self.proc.wait()
        self.proc.stdout.close()
        self.proc.stderr.close()
