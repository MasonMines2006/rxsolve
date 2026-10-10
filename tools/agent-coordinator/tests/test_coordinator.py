import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent / "coordinator"
sys.path.insert(0, str(ROOT))

import tunnel  # noqa: E402
import config  # noqa: E402
from service import GuessThrottle, Store, make_server  # noqa: E402

TOKEN = "test-token"


class ServiceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.server = make_server("127.0.0.1", 0, Store(Path(self.tmp.name)), TOKEN)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def call(self, method, path, body=None, token=TOKEN):
        headers = {"X-Coordinator-Token": token} if token else {}
        data = body.encode() if body is not None else None
        request = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request) as resp:
                return resp.status, json.load(resp)
        except urllib.error.HTTPError as err:
            return err.code, json.load(err)

    def test_health_needs_no_token(self):
        self.assertEqual(self.call("GET", "/health", token=None), (200, {"status": "ok"}))

    def test_rejects_missing_and_wrong_token(self):
        self.assertEqual(self.call("GET", "/inbox?box=a", token=None)[0], 401)
        self.assertEqual(self.call("POST", "/inbox?box=a", "x", token="nope")[0], 401)

    def test_bearer_token_is_accepted(self):
        request = urllib.request.Request(
            self.base + "/inbox?box=a", headers={"Authorization": f"Bearer {TOKEN}"}
        )
        with urllib.request.urlopen(request) as resp:
            self.assertEqual(resp.status, 200)

    def test_post_then_read_with_cursor(self):
        self.assertEqual(
            self.call("POST", "/inbox?box=a", "one"), (202, {"box": "a", "id": 1, "duplicate": False})
        )
        self.assertEqual(
            self.call("POST", "/inbox?box=a", "two"), (202, {"box": "a", "id": 2, "duplicate": False})
        )
        _, all_messages = self.call("GET", "/inbox?box=a")
        self.assertEqual([m["body"] for m in all_messages["messages"]], ["one", "two"])
        _, newer = self.call("GET", "/inbox?box=a&since=1")
        self.assertEqual([m["body"] for m in newer["messages"]], ["two"])

    def test_boxes_are_isolated(self):
        self.call("POST", "/inbox?box=a", "for a")
        _, other = self.call("GET", "/inbox?box=b")
        self.assertEqual(other["messages"], [])

    def test_rejects_bad_box_and_cursor(self):
        self.assertEqual(self.call("GET", "/inbox?box=../etc")[0], 400)
        self.assertEqual(self.call("GET", "/inbox?box=a&since=x")[0], 400)

    def test_rejects_bad_labels_and_reply_to(self):
        self.assertEqual(self.call("POST", "/inbox?box=a&from=bad%20name", "x")[0], 400)
        self.assertEqual(self.call("POST", "/inbox?box=a&reply_to=abc", "x")[0], 400)
        self.assertEqual(self.call("POST", "/claim?box=a&id=1&by=bad%20name")[0], 400)
        self.assertEqual(self.call("POST", "/claim?box=a&by=x")[0], 400)

    def test_limit_is_clamped_and_last_id_reported(self):
        for i in range(3):
            self.call("POST", "/inbox?box=a", str(i))
        _, page = self.call("GET", "/inbox?box=a&limit=2")
        self.assertEqual([m["id"] for m in page["messages"]], [1, 2])
        self.assertEqual(page["last_id"], 3)
        _, clamped = self.call("GET", "/inbox?box=a&limit=0")
        self.assertEqual(len(clamped["messages"]), 1)

    def test_rejects_oversized_body(self):
        status, _ = self.call("POST", "/inbox?box=a", "x" * 1_000_001)
        self.assertEqual(status, 413)


class TunnelTest(unittest.TestCase):
    def test_ngrok_pattern_reads_started_tunnel_line(self):
        line = (
            't=2026-10-08T15:00:00+0000 lvl=info msg="started tunnel" obj=tunnels '
            "name=command_line addr=http://localhost:8787 url=https://abc.ngrok-free.app"
        )
        self.assertEqual(tunnel.NGROK.url_pattern.search(line).group(1), "https://abc.ngrok-free.app")

    def test_ngrok_pattern_ignores_other_lines(self):
        self.assertIsNone(tunnel.NGROK.url_pattern.search('msg="client session established"'))

    def test_cloudflared_pattern_reads_quick_tunnel_url(self):
        line = "INF |  https://some-words-here.trycloudflare.com  |"
        self.assertEqual(
            tunnel.CLOUDFLARED.url_pattern.search(line).group(1),
            "https://some-words-here.trycloudflare.com",
        )

    def test_start_returns_url_from_process_output(self):
        script = "import time; print('url=https://x.example', flush=True); time.sleep(30)"
        spec = tunnel.TunnelSpec(
            command=lambda port: [sys.executable, "-c", script],
            url_pattern=tunnel.re.compile(r"url=(https://\S+)"),
        )
        proc, url = tunnel.start(spec, 1, timeout=10)
        proc.terminate()
        self.assertEqual(url, "https://x.example")

    def test_start_fails_when_process_exits_without_url(self):
        spec = tunnel.TunnelSpec(
            command=lambda port: [sys.executable, "-c", "print('boom')"],
            url_pattern=tunnel.re.compile(r"url=(https://\S+)"),
        )
        with self.assertRaises(SystemExit) as ctx:
            tunnel.start(spec, 1, timeout=10)
        self.assertIn("boom", str(ctx.exception))

    def test_start_fails_when_binary_missing(self):
        spec = tunnel.TunnelSpec(
            command=lambda port: ["definitely-not-a-real-binary"],
            url_pattern=tunnel.re.compile(r"x"),
        )
        with self.assertRaises(SystemExit):
            tunnel.start(spec, 1)


class LongPollTest(ServiceTest):
    def test_wait_returns_as_soon_as_a_message_arrives(self):
        threading.Timer(0.3, lambda: self.call("POST", "/inbox?box=a", "hi")).start()
        started = time.monotonic()
        status, reply = self.call("GET", "/inbox?box=a&since=0&wait=10")
        self.assertEqual((status, [m["body"] for m in reply["messages"]]), (200, ["hi"]))
        self.assertLess(time.monotonic() - started, 5)

    def test_wait_returns_empty_when_nothing_arrives(self):
        started = time.monotonic()
        status, reply = self.call("GET", "/inbox?box=a&since=0&wait=1")
        self.assertEqual((status, reply["messages"]), (200, []))
        self.assertGreaterEqual(time.monotonic() - started, 0.9)

    def test_wait_does_not_block_when_messages_already_exist(self):
        self.call("POST", "/inbox?box=a", "one")
        started = time.monotonic()
        _, reply = self.call("GET", "/inbox?box=a&since=0&wait=10")
        self.assertEqual(len(reply["messages"]), 1)
        self.assertLess(time.monotonic() - started, 2)

    def test_wait_must_be_an_integer(self):
        self.assertEqual(self.call("GET", "/inbox?box=a&wait=soon")[0], 400)


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class ThrottleTest(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.tmp = tempfile.TemporaryDirectory()
        self.server = make_server(
            "127.0.0.1", 0, Store(Path(self.tmp.name)), TOKEN, GuessThrottle(self.clock)
        )
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def status(self, token):
        request = urllib.request.Request(self.base + "/inbox?box=a", headers={"X-Coordinator-Token": token})
        try:
            with urllib.request.urlopen(request) as resp:
                return resp.status
        except urllib.error.HTTPError as err:
            return err.code

    def test_wrong_guesses_are_cut_off_but_the_right_token_still_works(self):
        for _ in range(GuessThrottle.MAX_FAILURES):
            self.assertEqual(self.status("wrong"), 401)
        self.assertEqual(self.status("wrong"), 429)
        self.assertEqual(self.status(TOKEN), 200)

    def test_guessing_resumes_after_the_window_clears(self):
        for _ in range(GuessThrottle.MAX_FAILURES + 1):
            self.status("wrong")
        self.clock.now += GuessThrottle.WINDOW_SECONDS + 1
        self.assertEqual(self.status("wrong"), 401)


class PasswordTest(unittest.TestCase):
    def test_same_password_gives_the_same_token_and_another_gives_another(self):
        self.assertEqual(config.token_from_password("correct horse battery"), config.token_from_password("correct horse battery"))
        self.assertNotEqual(config.token_from_password("correct horse battery"), config.token_from_password("correct horse staple"))

    def test_prompt_rejects_short_and_mismatched_passwords(self):
        answers = iter(["short", "long enough one", "different one!", "long enough one", "long enough one"])
        with mock.patch.object(config.sys.stdin, "isatty", return_value=True), \
                mock.patch.object(config.getpass, "getpass", lambda _: next(answers)), \
                mock.patch("builtins.print"):
            self.assertEqual(config.prompt_password(confirm=True), "long enough one")

    def test_prompt_without_a_terminal_exits(self):
        with mock.patch.object(config.sys.stdin, "isatty", return_value=False):
            with self.assertRaises(SystemExit):
                config.prompt_password(confirm=False)


if __name__ == "__main__":
    unittest.main()
