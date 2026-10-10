"""The push daemon against the real service, with fake Claude Code sessions listening on sockets."""

import json
import os
import queue
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

from helpers import ROOT, Service

sys.path.insert(0, str(ROOT))


class FakeSession:
    """A unix socket that collects the JSON lines written to it, like a session's inbox."""

    def __init__(self, directory: Path, name: str):
        self.path = str(directory / f"{name}.sock")
        self.lines: queue.Queue = queue.Queue()
        self.server = socket.socket(socket.AF_UNIX)
        self.server.bind(self.path)
        self.server.listen(8)
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while True:
            try:
                conn, _ = self.server.accept()
            except OSError:
                return
            with conn:
                data = b""
                while chunk := conn.recv(65536):
                    data += chunk
            for line in data.decode().splitlines():
                self.lines.put(json.loads(line))

    def next(self, timeout: float = 10) -> dict:
        return self.lines.get(timeout=timeout)

    def expect_none(self, wait: float = 1.0) -> None:
        try:
            extra = self.lines.get(timeout=wait)
        except queue.Empty:
            return
        raise AssertionError(f"unexpected delivery: {extra}")

    def close(self) -> None:
        self.server.close()


class DaemonTestCase(unittest.TestCase):
    IDLE_SECONDS = "0"

    def setUp(self):
        self.service = Service().start()
        self.addCleanup(self.service.cleanup)
        # unix socket paths are short on macOS, so the sockets live under /tmp
        self.socket_dir = Path(tempfile.mkdtemp(dir="/tmp", prefix="coord-"))
        self.addCleanup(shutil.rmtree, self.socket_dir, True)
        self.data = tempfile.TemporaryDirectory()
        self.addCleanup(self.data.cleanup)
        self.sessions = []
        self.addCleanup(lambda: [s.close() for s in self.sessions])
        self.daemon = None
        self.addCleanup(self.stop_daemon)

    def env(self, **extra) -> dict:
        env = self.service.env(
            COORDINATOR_DATA_DIR=self.data.name, POLL_SECONDS="0.1", WAIT_SECONDS="1",
            IDLE_SECONDS=self.IDLE_SECONDS, COORDINATOR_SPAWN_DAEMON="0", **extra,
        )
        # Running inside Claude Code must not leak this session's own token into the fake sessions.
        return {k: v for k, v in env.items() if k != "CLAUDE_CODE_MESSAGING_TOKEN"}

    def session(self, name: str) -> FakeSession:
        fake = FakeSession(self.socket_dir, name)
        self.sessions.append(fake)
        return fake

    def start_daemon(self) -> None:
        self.daemon = subprocess.Popen(
            [sys.executable, str(ROOT / "daemon.py")], env=self.env(),
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )

    def stop_daemon(self) -> None:
        if self.daemon:
            self.daemon.terminate()
            self.daemon.wait()
            self.daemon.stdout.close()
            self.daemon = None

    def client(self, *args, **extra):
        return subprocess.run(
            [sys.executable, str(ROOT / "client.py"), *args],
            env=self.env(**extra), capture_output=True, text=True, timeout=30,
        )

    def subscribe(self, fake: FakeSession, box: str, session: str):
        result = self.client(
            "subscribe", "--box", box, "--session", session, CLAUDE_CODE_MESSAGING_SOCKET=fake.path,
        )
        self.assertEqual(result.returncode, 0, result.stdout)

    def send(self, box: str, body: str, **flags) -> None:
        args = ["send", "--to", box, "--from", "alice", body]
        for name, value in flags.items():
            args[1:1] = [f"--{name}", value]
        self.assertEqual(self.client(*args).returncode, 0)


class DeliveryTest(DaemonTestCase):
    def test_pushes_a_new_message_framed_as_another_agent(self):
        fake = self.session("s1")
        self.subscribe(fake, "bob", "s1")
        self.start_daemon()
        time.sleep(0.5)
        self.send("bob", "review the schema change", type="task", thread="t1")
        line = fake.next()
        self.assertEqual(line["type"], "user")
        self.assertEqual(line["from"], "coordinator:alice")
        content = line["message"]["content"]
        self.assertIn("box=bob #1 from=alice type=task thread=t1", content)
        self.assertIn("not from the user", content)
        self.assertTrue(content.endswith("review the schema change"))

    def test_messages_from_before_subscribing_are_not_replayed(self):
        self.send("bob", "old news")
        fake = self.session("s1")
        self.subscribe(fake, "bob", "s1")
        self.start_daemon()
        fake.expect_none(1.5)
        self.send("bob", "fresh")
        self.assertIn("fresh", fake.next()["message"]["content"])

    def test_only_subscribed_sessions_get_a_box(self):
        mine, other = self.session("s1"), self.session("s2")
        self.subscribe(mine, "bob", "s1")
        self.subscribe(other, "carol", "s2")
        self.start_daemon()
        time.sleep(0.5)
        self.send("bob", "for bob")
        self.assertIn("for bob", mine.next()["message"]["content"])
        other.expect_none(1.0)

    def test_every_subscriber_of_a_box_gets_each_message_once(self):
        first, second = self.session("s1"), self.session("s2")
        self.subscribe(first, "bob", "s1")
        self.subscribe(second, "bob", "s2")
        self.start_daemon()
        time.sleep(0.5)
        self.send("bob", "both of you")
        for fake in (first, second):
            self.assertIn("both of you", fake.next()["message"]["content"])
            fake.expect_none(0.5)

    def test_a_session_that_ended_is_unsubscribed(self):
        gone = self.session("s1")
        self.subscribe(gone, "bob", "s1")
        gone.close()
        os.unlink(gone.path)
        self.start_daemon()
        time.sleep(0.5)
        self.send("bob", "anyone there?")
        sub_file = Path(self.data.name) / "subs" / "bob.s1.json"
        deadline = time.monotonic() + 10
        while sub_file.exists() and time.monotonic() < deadline:
            time.sleep(0.1)
        self.assertFalse(sub_file.exists())

    def test_a_second_daemon_exits_at_once(self):
        self.start_daemon()
        time.sleep(0.5)
        second = subprocess.run(
            [sys.executable, str(ROOT / "daemon.py")], env=self.env(), capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(second.returncode, 0)

    def test_unsubscribe_stops_delivery(self):
        fake = self.session("s1")
        self.subscribe(fake, "bob", "s1")
        self.start_daemon()
        time.sleep(0.5)
        self.assertEqual(self.client("unsubscribe", "--box", "bob", "--session", "s1").returncode, 0)
        self.send("bob", "too late")
        fake.expect_none(1.5)


class IdleGatingTest(DaemonTestCase):
    IDLE_SECONDS = "60"

    def test_an_idle_session_waits_and_an_active_one_does_not(self):
        idle, active = self.session("idle"), self.session("active")
        self.subscribe(idle, "bob", "idle")
        self.subscribe(active, "bob", "active")
        stale = time.time() - 3600
        os.utime(Path(self.data.name) / "active-idle", (stale, stale))
        self.start_daemon()
        time.sleep(0.5)
        self.send("bob", "wake up")
        self.assertIn("wake up", active.next()["message"]["content"])
        idle.expect_none(1.5)
        (Path(self.data.name) / "active-idle").touch()
        self.assertIn("wake up", idle.next()["message"]["content"])
        idle.expect_none(0.5)


if __name__ == "__main__":
    unittest.main()
