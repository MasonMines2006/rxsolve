"""End-to-end tests: real service, client, poller and hook processes over HTTP."""

import json
import os
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

from helpers import ROOT, TOKEN, Poller, Service, free_port

sys.path.insert(0, str(ROOT))
import tunnel  # noqa: E402


class E2ETestCase(unittest.TestCase):
    def setUp(self):
        self.service = Service().start()
        self.pollers = []
        self.addCleanup(self.service.cleanup)
        self.addCleanup(lambda: [p.stop() for p in self.pollers])

    def poller(self, box, session="s1", **env) -> Poller:
        poller = Poller(self.service, box, session, **env)
        self.pollers.append(poller)
        return poller


class ConversationTest(E2ETestCase):
    def test_two_agents_exchange_task_and_reply_with_metadata(self):
        alice = self.poller("alice")
        bob = self.poller("bob")

        code, sent = self.service.client(
            "send", "--to", "bob", "--from", "alice", "--type", "task",
            "--thread", "t1", "review the schema", COORDINATOR_BOX="alice",
        )
        self.assertEqual((code, sent["id"]), (0, 1))
        task = bob.next()
        self.assertEqual(
            (task["from"], task["type"], task["thread"], task["body"]),
            ("alice", "task", "t1", "review the schema"),
        )
        self.assertNotIn("reply_to", task)

        self.service.client(
            "send", "--to", task["from"], "--type", "answer", "--thread", task["thread"],
            "--reply-to", str(task["id"]), "looks good", COORDINATOR_BOX="bob",
        )
        answer = alice.next()
        self.assertEqual((answer["from"], answer["reply_to"], answer["body"]), ("bob", 1, "looks good"))
        bob.expect_none()
        alice.expect_none()

    def test_body_from_stdin_keeps_multiline_and_unicode(self):
        bob = self.poller("bob")
        body = "line one\nline two ✓\n"
        self.service.client("send", "--to", "bob", "-", stdin=body)
        self.assertEqual(bob.next()["body"], body)

    def test_default_sender_is_the_callers_box(self):
        bob = self.poller("bob")
        self.service.client("send", "--to", "bob", "hi", COORDINATOR_BOX="alice")
        self.assertEqual(bob.next()["from"], "alice")

    def test_boxes_do_not_leak_between_agents(self):
        carol = self.poller("carol")
        self.service.client("send", "--to", "bob", "private")
        carol.expect_none()


class SharedBoxTest(E2ETestCase):
    def test_every_session_on_a_box_sees_every_message_once(self):
        first = self.poller("bob", session="s1")
        second = self.poller("bob", session="s2")
        for i in range(3):
            self.service.client("send", "--to", "bob", f"m{i}")
        for poller in (first, second):
            self.assertEqual([poller.next()["body"] for _ in range(3)], ["m0", "m1", "m2"])
            poller.expect_none()

    def test_only_one_session_wins_a_claim(self):
        self.service.client("send", "--to", "bob", "do the thing")
        results = []
        with ThreadPoolExecutor(8) as pool:
            futures = [
                pool.submit(self.service.client, "claim", "--box", "bob", "--id", "1", "--by", f"s{i}")
                for i in range(8)
            ]
            results = [f.result() for f in futures]
        winners = [reply for code, reply in results if code == 0]
        losers = [reply for code, reply in results if code == 1]
        self.assertEqual((len(winners), len(losers)), (1, 7))
        holder = winners[0]["by"]
        self.assertTrue(all(reply == {"claimed": False, "id": 1, "by": holder} for reply in losers))

    def test_claim_is_idempotent_for_the_holder_and_checks_the_message(self):
        self.service.client("send", "--to", "bob", "x")
        self.assertEqual(self.service.client("claim", "--box", "bob", "--id", "1", "--by", "s1")[0], 0)
        self.assertEqual(self.service.client("claim", "--box", "bob", "--id", "1", "--by", "s1")[0], 0)
        self.assertEqual(self.service.client("claim", "--box", "bob", "--id", "1", "--by", "s2")[0], 1)
        self.assertEqual(self.service.client("claim", "--box", "bob", "--id", "99", "--by", "s1")[0], 1)

    def test_claims_are_per_box(self):
        self.service.client("send", "--to", "bob", "x")
        self.service.client("send", "--to", "carol", "y")
        self.assertEqual(self.service.client("claim", "--box", "bob", "--id", "1", "--by", "s1")[0], 0)
        self.assertEqual(self.service.client("claim", "--box", "carol", "--id", "1", "--by", "s2")[0], 0)


class SendTest(E2ETestCase):
    def test_idempotency_key_stores_a_retried_send_once(self):
        _, first = self.service.client("send", "--to", "bob", "--key", "job-1", "go")
        _, retry = self.service.client("send", "--to", "bob", "--key", "job-1", "go")
        self.assertEqual((first["duplicate"], retry["duplicate"]), (False, True))
        self.assertEqual(first["id"], retry["id"])
        _, other = self.service.client("send", "--to", "carol", "--key", "job-1", "go")
        self.assertFalse(other["duplicate"])
        _, inbox = self.service.client("read", "--box", "bob")
        self.assertEqual(len(inbox["messages"]), 1)

    def test_concurrent_senders_get_unique_consecutive_ids(self):
        def post(i):
            return self.service.http("POST", f"/inbox?box=bob&from=a{i}", f"m{i}".encode())[1]["id"]

        with ThreadPoolExecutor(20) as pool:
            ids = list(pool.map(post, range(60)))
        self.assertEqual(sorted(ids), list(range(1, 61)))
        _, inbox = self.service.client("read", "--box", "bob", "--limit", "500")
        self.assertEqual([m["id"] for m in inbox["messages"]], list(range(1, 61)))

    def test_wrong_token_is_rejected_by_every_client_action(self):
        for args in (
            ("send", "--to", "bob", "x"),
            ("read", "--box", "bob"),
            ("claim", "--box", "bob", "--id", "1", "--by", "s1"),
        ):
            code, reply = self.service.client(*args, COORDINATOR_TOKEN="wrong")
            self.assertEqual((code, reply), (1, {"error": "unauthorized"}))

    def test_service_down_gives_a_clean_error(self):
        self.service.stop()
        code, reply = self.service.client("read", "--box", "bob")
        self.assertEqual(code, 1)
        self.assertIn("error", reply)


class PollerTest(E2ETestCase):
    def test_first_run_skips_backlog_and_restart_resumes_without_replay(self):
        self.service.client("send", "--to", "bob", "old")
        bob = self.poller("bob")
        bob.expect_none()
        self.service.client("send", "--to", "bob", "one")
        self.assertEqual(bob.next()["body"], "one")
        bob.wait_for_cursor(self.service.data_dir / "poller-bob-s1.state", 2)
        bob.stop()

        self.service.client("send", "--to", "bob", "missed while down")
        restarted = self.poller("bob")
        self.assertEqual(restarted.next()["body"], "missed while down")
        restarted.expect_none()

    def test_delivers_more_than_one_page_in_order(self):
        for i in range(1, 251):
            self.service.http("POST", "/inbox?box=bob", str(i).encode())
        bob = self.poller("bob", session="late")
        # A new session skips the backlog, so post a second burst after it starts.
        for i in range(251, 451):
            self.service.http("POST", "/inbox?box=bob", str(i).encode())
        bodies = [bob.next(timeout=20)["body"] for _ in range(200)]
        self.assertEqual(bodies, [str(i) for i in range(251, 451)])
        bob.expect_none()

    def test_poller_survives_a_service_restart(self):
        bob = self.poller("bob")
        self.service.stop()
        time.sleep(0.5)
        self.service.start()
        self.service.client("send", "--to", "bob", "after restart")
        self.assertEqual(bob.next()["body"], "after restart")

    def test_idle_session_pauses_delivery_until_activity_resumes(self):
        data_dir = self.service.data_dir
        # No activity file exists yet, but starting the poller touches it. Age it.
        bob = self.poller("bob", session="idle", IDLE_SECONDS="1")
        time.sleep(1.5)
        self.service.client("send", "--to", "bob", "while idle")
        bob.expect_none(wait=1.0)

        hook = subprocess.run(
            [sys.executable, str(ROOT / "hook.py"), "touch"],
            input=json.dumps({"session_id": "idle"}),
            env=self.service.env(), capture_output=True, text=True,
        )
        self.assertEqual(hook.returncode, 0, hook.stderr)
        self.assertTrue((data_dir / "active-idle").exists())
        self.assertEqual(bob.next()["body"], "while idle")


class PersistenceTest(E2ETestCase):
    def test_ids_keys_and_claims_survive_a_service_restart(self):
        self.service.client("send", "--to", "bob", "--key", "k1", "first")
        self.service.client("claim", "--box", "bob", "--id", "1", "--by", "s1")
        self.service.stop()
        self.service.start()

        _, second = self.service.client("send", "--to", "bob", "second")
        self.assertEqual(second["id"], 2)
        _, retry = self.service.client("send", "--to", "bob", "--key", "k1", "first")
        self.assertEqual((retry["id"], retry["duplicate"]), (1, True))
        self.assertEqual(self.service.client("claim", "--box", "bob", "--id", "1", "--by", "s2")[0], 1)
        self.assertEqual(self.service.client("claim", "--box", "bob", "--id", "1", "--by", "s1")[0], 0)

    def test_generated_token_is_saved_with_private_permissions(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {k: v for k, v in os.environ.items() if k != "COORDINATOR_TOKEN"}
            env.update(COORDINATOR_DATA_DIR=tmp, COORDINATOR_PORT=str(free_port()))
            proc = subprocess.Popen(
                [sys.executable, str(ROOT / "service.py")], env=env,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            try:
                token_file = Path(tmp) / "token"
                deadline = time.monotonic() + 10
                while not token_file.exists() and time.monotonic() < deadline:
                    time.sleep(0.05)
                self.assertTrue(len(token_file.read_text().strip()) >= 32)
                self.assertEqual(stat.S_IMODE(token_file.stat().st_mode), 0o600)
            finally:
                proc.terminate()
                proc.wait()


class PasswordJoinTest(unittest.TestCase):
    PASSWORD = "correct horse battery"

    def setUp(self):
        self.service = Service()
        base_env = self.service.env
        self.service.env = lambda **extra: {
            **{k: v for k, v in base_env(**extra).items() if k != "COORDINATOR_TOKEN"},
            "COORDINATOR_PASSWORD": self.PASSWORD,
            **extra,
        }
        self.service.start()
        self.addCleanup(self.service.cleanup)
        self.guest = tempfile.TemporaryDirectory()
        self.addCleanup(self.guest.cleanup)
        self.token_file = Path(self.guest.name) / "token"

    def as_guest(self, *args, password):
        return self.service.client(
            *args, COORDINATOR_DATA_DIR=self.guest.name, COORDINATOR_PASSWORD=password, COORDINATOR_BOX="bob"
        )

    def test_join_with_the_right_password_saves_a_token_that_later_calls_use(self):
        code, reply = self.as_guest("join", password=self.PASSWORD)
        self.assertEqual((code, reply["joined"]), (0, self.service.url))
        self.assertEqual(stat.S_IMODE(self.token_file.stat().st_mode), 0o600)
        code, reply = self.as_guest("send", "--to", "alice", "hello", password="")
        self.assertEqual((code, reply["id"]), (0, 1))

    def test_join_with_a_wrong_password_saves_nothing(self):
        code, reply = self.as_guest("join", password="not the password")
        self.assertEqual(code, 1)
        self.assertIn("wrong password", reply["error"])
        self.assertFalse(self.token_file.exists())

    def test_calls_before_joining_say_how_to_join(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / "client.py"), "read"],
            env={**self.service.env(COORDINATOR_DATA_DIR=self.guest.name, COORDINATOR_PASSWORD="")},
            capture_output=True, text=True, timeout=30,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("client.py join", result.stderr)


class HookTest(unittest.TestCase):
    def run_hook(self, action, tmp, **extra):
        env = {k: v for k, v in os.environ.items() if not k.startswith("CLAUDE_CODE_MESSAGING")}
        env.update({
            "COORDINATOR_DATA_DIR": tmp, "COORDINATOR_BOX": "me", "COORDINATOR_TOKEN": "t",
            "COORDINATOR_SPAWN_DAEMON": "0", **extra,
        })
        env = {k: v for k, v in env.items() if v is not None}
        return subprocess.run(
            [sys.executable, str(ROOT / "hook.py"), action],
            input=json.dumps({"session_id": "s1"}), env=env,
            capture_output=True, text=True, check=True,
        ).stdout

    def note(self, tmp, **extra):
        return json.loads(self.run_hook("start", tmp, **extra))["hookSpecificOutput"]["additionalContext"]

    def test_touch_creates_activity_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.run_hook("touch", tmp)
            self.assertTrue((Path(tmp) / "active-s1").exists())

    def test_notes_point_at_the_host_and_join_skills(self):
        with tempfile.TemporaryDirectory() as tmp:
            note = self.note(tmp, COORDINATOR_TOKEN=None, CLAUDE_CODE_MESSAGING_SOCKET="/tmp/x.sock")
            self.assertIn("join skill", note)
            self.assertIn("host skill", note)
            self.assertIn(str(ROOT / "serve.py"), note)

    def test_start_subscribes_the_session_and_stop_removes_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            note = self.note(tmp, CLAUDE_CODE_MESSAGING_SOCKET="/tmp/x.sock", COORDINATOR_URL="https://t.example/")
            self.assertIn("subscribed to coordinator box me", note)
            self.assertNotIn("Monitor", note)
            self.assertIn(str(ROOT / "client.py"), note)
            entry = json.loads((Path(tmp) / "subs" / "me.s1.json").read_text())
            self.assertEqual((entry["socket"], entry["url"]), ("/tmp/x.sock", "https://t.example"))
            self.assertTrue((Path(tmp) / "active-s1").exists())
            self.run_hook("stop", tmp)
            self.assertFalse((Path(tmp) / "subs" / "me.s1.json").exists())

    def test_autosubscribe_can_be_turned_off(self):
        with tempfile.TemporaryDirectory() as tmp:
            note = self.note(tmp, CLAUDE_CODE_MESSAGING_SOCKET="/tmp/x.sock", COORDINATOR_AUTOSUBSCRIBE="0")
            self.assertIn("subscription is off", note)
            self.assertFalse((Path(tmp) / "subs").exists())

    def test_before_joining_the_note_tells_the_user_to_run_join(self):
        with tempfile.TemporaryDirectory() as tmp:
            note = self.note(tmp, COORDINATOR_TOKEN=None, CLAUDE_CODE_MESSAGING_SOCKET="/tmp/x.sock")
            self.assertIn("client.py join", note)
            self.assertFalse((Path(tmp) / "subs").exists())

    def test_without_an_inbox_socket_the_note_falls_back_to_the_poller(self):
        with tempfile.TemporaryDirectory() as tmp:
            note = self.note(tmp, COORDINATOR_URL="https://t.example")
            self.assertIn("COORDINATOR_SESSION=s1", note)
            self.assertIn("COORDINATOR_URL=https://t.example", note)
            self.assertIn(str(ROOT / "poller.py"), note)


class FakeNgrokApi:
    """Stands in for ngrok's local API (/api/tunnels) on a free port."""

    def __init__(self, tunnels: list):
        payload = json.dumps({"tunnels": tunnels}).encode()

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


def ngrok_tunnel(addr_port: int, url: str, scheme: str = "https") -> dict:
    return {
        "public_url": url.replace("https", scheme, 1),
        "config": {"addr": f"http://localhost:{addr_port}"},
    }


class ServeTunnelTest(unittest.TestCase):
    """serve.py with fake ngrok/cloudflared binaries and a fake ngrok API (no network)."""

    FAKES = {
        "ngrok": (
            "print('t=1 lvl=info msg=\"started tunnel\" obj=tunnels name=command_line '\n"
            "      'addr=http://localhost:8787 url=https://fake.ngrok-free.app', flush=True)"
        ),
        "cloudflared": (
            "import sys\n"
            "print('INF |  https://fake-words.trycloudflare.com  |', file=sys.stderr, flush=True)"
        ),
    }

    def serve(self, *args, fakes=(), api_ports="1", wait_for="public URL", port=None):
        """Run serve.py until `wait_for` is printed. Returns (output lines, port, started tunnels)."""
        bin_dir = tempfile.TemporaryDirectory()
        data_dir = tempfile.TemporaryDirectory()
        self.addCleanup(bin_dir.cleanup)
        self.addCleanup(data_dir.cleanup)
        marker = Path(bin_dir.name) / "started"
        for name in fakes:
            fake = Path(bin_dir.name) / name
            fake.write_text(
                f"#!{sys.executable}\nimport time\nopen({str(marker)!r}, 'a').write({name!r})\n"
                f"{self.FAKES[name]}\ntime.sleep(60)\n"
            )
            fake.chmod(0o755)
        port = port or free_port()
        env = {
            **os.environ,
            "PATH": f"{bin_dir.name}{os.pathsep}/usr/bin{os.pathsep}/bin",
            "COORDINATOR_DATA_DIR": data_dir.name,
            "COORDINATOR_PORT": str(port),
            "COORDINATOR_TOKEN": TOKEN,
            "NGROK_API_PORTS": api_ports,
        }
        proc = subprocess.Popen(
            [sys.executable, str(ROOT / "serve.py"), *args],
            env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        output = []
        threading.Thread(target=lambda: output.extend(proc.stdout), daemon=True).start()

        def stop():
            proc.terminate()
            proc.wait()
            proc.stdout.close()

        self.addCleanup(stop)
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline and not any(wait_for in line for line in output):
            time.sleep(0.1)
        started = marker.read_text() if marker.exists() else ""
        return output, port, started, proc

    def assert_healthy(self, port):
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=5) as resp:
            self.assertEqual(resp.status, 200)

    def test_starts_a_new_ngrok_tunnel(self):
        output, port, started, _ = self.serve("--tunnel", "ngrok", fakes=["ngrok"])
        self.assertIn("public URL: https://fake.ngrok-free.app\n", output)
        self.assertEqual(started, "ngrok")
        self.assert_healthy(port)

    def test_starts_a_new_cloudflared_tunnel(self):
        output, port, started, _ = self.serve("--tunnel", "cloudflared", fakes=["cloudflared"])
        self.assertIn("public URL: https://fake-words.trycloudflare.com\n", output)
        self.assertEqual(started, "cloudflared")
        self.assert_healthy(port)

    def test_reuses_a_running_ngrok_tunnel_for_this_port_without_starting_one(self):
        port = free_port()
        api = FakeNgrokApi([ngrok_tunnel(port, "https://mine.ngrok.app")])
        self.addCleanup(api.close)
        # A fake ngrok binary is on PATH and would print another URL, so a start would show.
        output, _, started, _ = self.serve(
            "--tunnel", "ngrok", fakes=["ngrok"], api_ports=str(api.port), port=port
        )
        self.assertIn("reusing the running ngrok tunnel\n", output)
        self.assertIn("public URL: https://mine.ngrok.app\n", output)
        self.assertEqual(started, "")
        self.assert_healthy(port)

    def test_reuse_works_without_the_ngrok_binary_installed(self):
        port = free_port()
        api = FakeNgrokApi([ngrok_tunnel(port, "https://mine.ngrok.app")])
        self.addCleanup(api.close)
        output, _, _, _ = self.serve("--tunnel", "ngrok", api_ports=str(api.port), port=port)
        self.assertIn("public URL: https://mine.ngrok.app\n", output)

    def test_ngrok_on_another_port_is_not_reused(self):
        api = FakeNgrokApi([ngrok_tunnel(9, "https://other-service.ngrok.app")])
        self.addCleanup(api.close)
        output, _, started, _ = self.serve(
            "--tunnel", "ngrok", fakes=["ngrok"], api_ports=str(api.port)
        )
        self.assertNotIn("reusing the running ngrok tunnel\n", output)
        self.assertIn("public URL: https://fake.ngrok-free.app\n", output)
        self.assertEqual(started, "ngrok")

    def test_public_url_is_printed_and_no_tunnel_is_started(self):
        output, port, started, _ = self.serve(
            "--public-url", "https://my-own.example", fakes=["ngrok", "cloudflared"]
        )
        self.assertIn("public URL: https://my-own.example\n", output)
        self.assertEqual(started, "")
        self.assert_healthy(port)

    def test_lan_listens_on_the_network_and_prints_join_urls(self):
        output, port, started, _ = self.serve("--lan", fakes=["ngrok", "cloudflared"], wait_for="others join with")
        text = "".join(output)
        self.assertIn(f"listening on 0.0.0.0:{port}", text)
        self.assertRegex(text, rf"LAN URL: http://\S+:{port}\n")
        self.assertIn("client.py join", text)
        self.assertEqual(started, "")
        self.assert_healthy(port)
        ip = tunnel.lan_ip()
        if ip:
            urllib.request.urlopen(f"http://{ip}:{port}/health", timeout=5).close()

    def test_without_lan_the_service_stays_on_localhost(self):
        output, port, _, _ = self.serve("--public-url", "https://my-own.example")
        self.assertIn(f"listening on 127.0.0.1:{port}", "".join(output))

    def test_lan_and_a_tunnel_are_mutually_exclusive(self):
        output, _, _, proc = self.serve("--lan", "--tunnel", "ngrok", wait_for="not allowed")
        self.assertTrue(any("not allowed" in line for line in output))
        self.assertNotEqual(proc.wait(timeout=10), 0)

    def test_tunnel_and_public_url_are_mutually_exclusive(self):
        output, _, _, proc = self.serve(
            "--tunnel", "ngrok", "--public-url", "https://x.example", wait_for="not allowed"
        )
        self.assertTrue(any("not allowed" in line for line in output))
        self.assertNotEqual(proc.wait(timeout=10), 0)

    def test_missing_tunnel_binary_exits_with_a_clear_message(self):
        output, _, _, proc = self.serve("--tunnel", "ngrok", wait_for="not installed")
        self.assertTrue(any("ngrok is not installed" in line for line in output))
        self.assertNotEqual(proc.wait(timeout=10), 0)


class LanUrlsTest(unittest.TestCase):
    def test_lists_the_local_name_before_the_ip(self):
        with mock.patch.object(tunnel, "local_hostname", return_value="box.local"), \
                mock.patch.object(tunnel, "lan_ip", return_value="10.0.0.5"):
            self.assertEqual(tunnel.lan_urls(8787), ["http://box.local:8787", "http://10.0.0.5:8787"])

    def test_skips_what_it_cannot_find(self):
        with mock.patch.object(tunnel, "local_hostname", return_value=None), \
                mock.patch.object(tunnel, "lan_ip", return_value="10.0.0.5"):
            self.assertEqual(tunnel.lan_urls(1), ["http://10.0.0.5:1"])
        with mock.patch.object(tunnel, "local_hostname", return_value=None), \
                mock.patch.object(tunnel, "lan_ip", return_value=None):
            self.assertEqual(tunnel.lan_urls(1), [])


class FindExistingNgrokTest(unittest.TestCase):
    def test_matches_https_tunnel_for_the_port_and_skips_the_rest(self):
        api = FakeNgrokApi([
            ngrok_tunnel(9999, "https://other.ngrok.app"),
            ngrok_tunnel(8787, "https://plain.ngrok.app", scheme="http"),
            ngrok_tunnel(8787, "https://mine.ngrok.app"),
        ])
        self.addCleanup(api.close)
        self.assertEqual(tunnel.find_existing_ngrok(8787, (api.port,)), "https://mine.ngrok.app")
        self.assertIsNone(tunnel.find_existing_ngrok(1234, (api.port,)))

    def test_does_not_match_a_port_that_only_shares_a_prefix(self):
        api = FakeNgrokApi([ngrok_tunnel(87870, "https://wrong.ngrok.app")])
        self.addCleanup(api.close)
        self.assertIsNone(tunnel.find_existing_ngrok(8787, (api.port,)))

    def test_unreachable_api_ports_are_skipped(self):
        api = FakeNgrokApi([ngrok_tunnel(8787, "https://mine.ngrok.app")])
        self.addCleanup(api.close)
        self.assertEqual(
            tunnel.find_existing_ngrok(8787, (free_port(), api.port)), "https://mine.ngrok.app"
        )
        self.assertIsNone(tunnel.find_existing_ngrok(8787, (free_port(),)))


if __name__ == "__main__":
    unittest.main()
