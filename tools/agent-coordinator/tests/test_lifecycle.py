"""Starting, checking and stopping the service through serve.py, as the plugin's host skill does."""

import json
import os
import signal
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from helpers import ROOT, free_port

sys.path.insert(0, str(ROOT))
import config  # noqa: E402
from words import WORDS  # noqa: E402


class PasswordGeneratorTest(unittest.TestCase):
    def test_words_are_distinct_and_the_password_uses_them(self):
        self.assertEqual(len(WORDS), len(set(WORDS)))
        words = config.generate_password().split("-")
        self.assertEqual(len(words), 5)
        self.assertTrue(set(words) <= set(WORDS))

    def test_passwords_differ_and_meet_the_minimum_length(self):
        first, second = config.generate_password(), config.generate_password()
        self.assertNotEqual(first, second)
        self.assertGreaterEqual(len(first), config.MIN_PASSWORD_LENGTH)


class LifecycleTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.port = free_port()
        self.env = {k: v for k, v in os.environ.items() if not k.startswith(("COORDINATOR_", "CLAUDE_CODE_MESSAGING"))}
        self.env.update(COORDINATOR_DATA_DIR=self.tmp.name, COORDINATOR_PORT=str(self.port))
        self.addCleanup(self.serve, "--stop")

    def serve(self, *args, **env):
        result = subprocess.run(
            [sys.executable, str(ROOT / "serve.py"), *args],
            env={**self.env, **env}, capture_output=True, text=True, timeout=90, stdin=subprocess.DEVNULL,
        )
        try:
            return result.returncode, json.loads(result.stdout)
        except json.JSONDecodeError:
            return result.returncode, {"raw": result.stdout, "err": result.stderr}

    def client(self, *args, **env):
        result = subprocess.run(
            [sys.executable, str(ROOT / "client.py"), *args],
            env={**self.env, "COORDINATOR_URL": f"http://127.0.0.1:{self.port}", **env},
            capture_output=True, text=True, timeout=30, stdin=subprocess.DEVNULL,
        )
        return result.returncode, json.loads(result.stdout)

    def health(self) -> bool:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{self.port}/health", timeout=2).close()
            return True
        except OSError:
            return False

    def test_detach_prints_json_with_a_password_that_joins_and_stop_ends_it(self):
        code, started = self.serve("--detach", "--lan", "--generate-password")
        self.assertEqual(code, 0, started)
        self.assertEqual((started["running"], started["mode"], started["port"]), (True, "lan", self.port))
        self.assertTrue(started["urls"])
        self.assertIn("client.py", started["join_command"])
        self.assertEqual(len(started["password"].split("-")), 5)
        self.assertTrue(self.health())

        code, status = self.serve("--status")
        self.assertEqual((code, status["running"], status["healthy"], status["ready"]), (0, True, True, True))
        self.assertNotIn("password", status)

        guest = tempfile.TemporaryDirectory()
        self.addCleanup(guest.cleanup)
        code, joined = self.client(
            "join", COORDINATOR_DATA_DIR=guest.name, COORDINATOR_PASSWORD=started["password"], COORDINATOR_BOX="bob",
        )
        self.assertEqual(code, 0, joined)
        code, sent = self.client("send", "--to", "alice", "hi", COORDINATOR_DATA_DIR=guest.name, COORDINATOR_BOX="bob")
        self.assertEqual((code, sent["id"]), (0, 1))

        code, stopped = self.serve("--stop")
        self.assertEqual((code, stopped["stopped"]), (0, True))
        self.assertFalse(self.health())
        self.assertEqual(self.serve("--status"), (1, {"running": False}))

    def test_detach_survives_the_command_that_started_it(self):
        _, started = self.serve("--detach", "--generate-password")
        os.kill(started["pid"], 0)
        self.assertTrue(self.health())

    def test_a_second_detach_reports_the_running_service_and_keeps_the_password_out(self):
        _, first = self.serve("--detach", "--generate-password")
        code, second = self.serve("--detach", "--lan", "--generate-password")
        self.assertEqual(code, 0)
        self.assertTrue(second["already_running"])
        self.assertEqual(second["pid"], first["pid"])
        self.assertNotIn("password", second)

    def test_detach_without_a_password_explains_what_to_do(self):
        code, reply = self.serve("--detach")
        self.assertEqual(code, 1)
        self.assertIn("--generate-password", reply["error"])
        self.assertFalse(self.health())

    def test_detach_reuses_the_saved_password_on_restart(self):
        _, first = self.serve("--detach", "--generate-password")
        self.serve("--stop")
        code, again = self.serve("--detach")
        self.assertEqual(code, 0, again)
        self.assertNotIn("password", again)
        guest = tempfile.TemporaryDirectory()
        self.addCleanup(guest.cleanup)
        code, _ = self.client(
            "join", COORDINATOR_DATA_DIR=guest.name, COORDINATOR_PASSWORD=first["password"], COORDINATOR_BOX="bob",
        )
        self.assertEqual(code, 0)

    def test_detach_with_a_public_url_reports_it(self):
        _, started = self.serve("--detach", "--generate-password", "--public-url", "https://my-own.example")
        self.assertEqual((started["mode"], started["public_url"]), ("public-url", "https://my-own.example"))
        self.assertIn("COORDINATOR_URL=https://my-own.example", started["join_command"])

    def test_messages_survive_a_stop_and_start(self):
        _, started = self.serve("--detach", "--generate-password")
        host = {"COORDINATOR_PASSWORD": started["password"], "COORDINATOR_BOX": "alice"}
        self.assertEqual(self.client("send", "--to", "bob", "kept", **host)[0], 0)
        self.serve("--stop")
        self.serve("--detach")
        code, reply = self.client("read", "--box", "bob", **host)
        self.assertEqual([m["body"] for m in reply["messages"]], ["kept"])

    def test_stop_when_nothing_runs_is_not_an_error(self):
        self.assertEqual(self.serve("--stop"), (0, {"stopped": False, "reason": "not running"}))

    def test_a_foreground_service_cleans_up_on_sigterm_and_blocks_a_second_one(self):
        env = {**self.env, "COORDINATOR_TOKEN": "t"}
        proc = subprocess.Popen(
            [sys.executable, str(ROOT / "serve.py")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        self.addCleanup(proc.wait)
        self.addCleanup(proc.terminate)
        proc.stdout.readline()
        state_file = Path(self.tmp.name) / "service.json"
        for _ in range(100):
            if state_file.exists() and json.loads(state_file.read_text())["ready"]:
                break
            subprocess.run(["sleep", "0.1"])
        second = subprocess.run(
            [sys.executable, str(ROOT / "serve.py")], env=env, capture_output=True, text=True, timeout=20,
        )
        self.assertNotEqual(second.returncode, 0)
        self.assertIn("already running", second.stderr)
        proc.send_signal(signal.SIGTERM)
        proc.wait(timeout=10)
        self.assertFalse(state_file.exists())


if __name__ == "__main__":
    unittest.main()
