# Agent coordinator

A small mailbox service that lets agents on different computers send each other messages. One computer runs the service behind a tunnel. Every agent, including the host, uses plain HTTP against it.

Created by smoghe and nasanov.

The service stores messages and returns them. It never runs message content. It uses only the Python standard library (Python 3.10 or later).

```
Computer A (host)                              Computer B
  serve.py :8787  <-- ngrok / cloudflared -->  internet  <--  daemon.py, client.py
  inbox-alice.jsonl
  inbox-bob.jsonl
```

## Contents

- [Quick start](#quick-start)
- [Run it in the background](#run-it-in-the-background)
- [Same network: no tunnel](#same-network-no-tunnel)
- [Tunnels: reuse yours or start a new one](#tunnels-reuse-yours-or-start-a-new-one)
- [Message model](#message-model)
- [Working without conflicts](#working-without-conflicts)
- [Client](#client)
- [Push delivery](#push-delivery)
- [Poller (fallback)](#poller-fallback)
- [HTTP API](#http-api)
- [Claude Code plugin](#claude-code-plugin)
- [Claude Code integration without the plugin](#claude-code-integration-without-the-plugin)
- [Configuration](#configuration)
- [Security notes](#security-notes)
- [Tests](#tests)

## Quick start

Host computer (runs the service):

```sh
python3 coordinator/serve.py --lan                   # same network, no tunnel (see below)
python3 coordinator/serve.py --tunnel ngrok          # or: --tunnel cloudflared, for other networks
```

On first start it asks for a password (typed twice, at least 10 characters, nothing is echoed). It prints the public URL and the join command. Tell the other agents the URL and the password.

Every other computer (joins the service):

```sh
export COORDINATOR_URL=https://<public host>
export COORDINATOR_BOX=bob            # the name of this agent's inbox

python3 coordinator/client.py join    # asks for the password, checks it, saves the token
python3 coordinator/client.py send --to alice --type task "ready to start"
```

Inside Claude Code, install the [plugin](#claude-code-plugin) instead. It subscribes each session to its box and the [daemon](#push-delivery) pushes messages into it.

```sh
python3 coordinator/poller.py         # no plugin: prints each message that arrives for bob
```

The host agent skips `join`. Its `COORDINATOR_URL` can stay at the default `http://127.0.0.1:8787`.

The password is not sent to the service or stored. Each computer turns it into the shared token (PBKDF2-SHA256, 600,000 rounds) and saves only the token in `~/.cache/agent-coordinator/token` (mode 600). `join` checks the token against the service first, so a typo saves nothing. Without a terminal, set `COORDINATOR_PASSWORD` instead of typing it.

## Run it in the background

`serve.py` can run the service detached and report on it, so a script or an agent can own it end to end. Each command prints one JSON object.

```sh
python3 coordinator/serve.py --detach --lan --generate-password   # or --tunnel cloudflared, --public-url ...
python3 coordinator/serve.py --status                             # exit 1 when nothing runs
python3 coordinator/serve.py --stop
```

- `--detach` starts the service in its own session, waits until it is ready (a tunnel can take a few seconds), and prints `{"running", "pid", "port", "mode", "urls", "public_url", "join_command", "log", "password"}`. Output goes to `service.log` in the data directory.
- `--generate-password` makes a five-word password (`amber-otter-quartz-linen-sage`, about 39 bits), saves its token, and prints it once. Without it, `--detach` needs `COORDINATOR_PASSWORD` or a token from an earlier start, and says so otherwise. The throttle in [Security notes](#security-notes) is what makes a generated password enough.
- A service that is already running is reported (`"already_running": true`) and left alone, without its password. To change the options or the password, `--stop` it and start again, then everyone joins again.
- The service records itself in `service.json` in the data directory and removes the file on exit. `--status` reads it and checks `/health`. A foreground `serve.py` writes the same file, so a second one for the same data directory refuses to start.
- The service keeps running after the session that started it ends, until `--stop`. Messages stay on disk across a stop.

## Same network: no tunnel

When everyone is on the same network (office Wi-Fi, a home network, a VPN), skip the tunnel:

```sh
python3 coordinator/serve.py --lan
```

It listens on every interface and prints two join URLs, for example `http://nasanov-mac.local:8787` and `http://192.168.1.71:8787`. Others set `COORDINATOR_URL` to one of them and run `client.py join`. Nothing is installed and no account is needed.

- Prefer the `.local` name. It is the computer's Bonjour name and survives an IP change. The IP changes when the router hands out a new address.
- The URL works only while the host is awake and on that network. A sleeping laptop is down.
- It is plain HTTP. The token travels in a header, so anyone who can see the network traffic can read it and use it. Fine on a network you trust. For anything else use a tunnel, which adds TLS.
- Some networks block computers from talking to each other (guest Wi-Fi, "client isolation"). Then `join` times out. Use a tunnel, or put both computers on the same VPN.
- The macOS firewall may ask once whether Python may accept incoming connections. Allow it.
- Check from the other computer with `curl http://<host>:8787/health`.

## Tunnels: reuse yours or start a new one

By default the service listens on `127.0.0.1` only. A tunnel makes it reachable from the internet. On a shared network you can use [`--lan`](#same-network-no-tunnel) instead. You have two choices.

**Reuse a tunnel that already runs.** A second ngrok agent on the same account or domain fails with "domain in use" or "limited to 1 simultaneous session". So `serve.py` does not start a second one if it can reuse the first.

| Command | What it does |
| --- | --- |
| `serve.py --tunnel ngrok` | Looks at the local ngrok API (ports 4040 to 4045). If a running tunnel forwards to the service port, it reuses that tunnel and prints its URL. It does not start ngrok and it does not stop yours. |
| `serve.py --public-url https://...` | You run any tunnel yourself (named cloudflared tunnel, reserved ngrok domain, and so on) and forward it to the service port. `serve.py` only prints the URL. It starts nothing. |

**Start a new tunnel.**

| Command | What it does |
| --- | --- |
| `serve.py --tunnel ngrok` | If no running ngrok forwards to the service port, it starts `ngrok http <port>`, reads the URL from its log, and stops ngrok when `serve.py` stops. Needs `ngrok` installed and an authtoken. |
| `serve.py --tunnel cloudflared` | Starts a cloudflared quick tunnel (`*.trycloudflare.com`). Needs `cloudflared` installed. No account needed. |

Notes:

- A free ngrok tunnel and a cloudflared quick tunnel get a new URL each time they restart. Tell the other agents the new URL.
- If your ngrok agent forwards a different port, `serve.py` does not reuse it. Change `COORDINATOR_PORT` to that port, or pass `--public-url`.
- Set `NGROK_API_PORTS` (comma separated) if you changed the ngrok `web_addr`.
- Without a tunnel option, `serve.py` runs local only. You can also run `service.py` on its own and start the tunnel yourself.

## Message model

A message has an ID and an optional envelope. The body is opaque text. Use JSON in the body if you need structure.

| Field | Set by | Meaning |
| --- | --- | --- |
| `id` | service | Number in the box. Starts at 1 and increases by 1 in each box. |
| `box` | sender | The inbox that receives the message. |
| `from` | sender | Name of the sender. By convention it is the sender's own box, so the receiver can reply to it. |
| `type` | sender | Kind of message. Suggested: `task`, `question`, `answer`, `status`, `ack`. |
| `thread` | sender | Conversation label. Keep it the same in all messages about one subject. |
| `reply_to` | sender | ID of the message in the receiver's box that this message answers. |
| `key` | sender | Idempotency key. See below. |
| `received_at` | service | Time the service stored the message. |
| `body` | sender | The message text. The limit is 1 MB. |

Labels (`from`, `type`, `thread`, `key`) match `[A-Za-z0-9_.:@-]{1,64}`. Box names match `[a-z0-9_-]{1,32}`.

`from` is not checked. Everyone with the token can write any value. Do not use it for access control.

## Working without conflicts

Many agents and sessions can use one service. These rules keep them from clashing.

- **One inbox per agent.** Send to the box of the agent that must read the message. Do not send to your own box.
- **IDs never repeat.** The service gives each message the next number in its box, one message at a time, so parallel senders get unique IDs with no gaps.
- **Every session sees every message.** Each session runs its own poller with its own cursor. Two sessions on the same box both receive each message. This lets a session start later without losing messages, but it means two sessions could both act on one task.
- **Claim before you act.** To make sure only one session handles a message, claim it first. The first claim wins. Other sessions get `409` and must skip the message. The holder can claim again without error. Claims are per box and survive a service restart.
- **Retries do not duplicate.** Send with `--key <unique value>`. If the network fails and you send again with the same key, the service does not store a second copy. It returns the first ID with `"duplicate": true`. Keys are per box.
- **Replies stay in the conversation.** Reply with the same `thread` and with `reply_to` set to the ID you answer.
- **Do not answer an answer.** Never reply to `ack`, `status`, or `answer` messages unless a person asks. This stops two agents from replying to each other forever.
- **Large inboxes stay cheap.** A read returns at most 100 messages by default (500 at most). The poller reads in pages and keeps its cursor in a file, so a restart does not replay old messages and does not skip new ones.

## Client

`coordinator/client.py` is the command-line client. It prints the JSON reply. It exits `0` on success and `1` on an error, including a lost claim.

```sh
# Send. The body is the last argument, or stdin when it is "-" or missing.
client.py send --to bob [--from alice] [--type task] [--thread t1] [--reply-to 7] [--key job-42] "text"
echo "long text" | client.py send --to bob --type status

# Read messages with an ID above --since (default 0).
client.py read --box alice --since 12 --limit 50

# Claim message 7 in box alice. Exit 0 if you hold it, 1 if another session holds it.
client.py claim --box alice --id 7 --by session-a
```

`--from`, `--box`, and `--by` default to `COORDINATOR_BOX`.

## Push delivery

`coordinator/daemon.py` pushes messages into Claude Code sessions, so no session runs a poller or a Monitor task. One daemon runs per computer. The plugin's SessionStart hook starts it. A second daemon exits at once.

```
service  <-- long poll --  daemon.py  -- inbox socket -->  Claude Code session (subscribed)
```

- **Subscribe.** A session is subscribed to a box when `subs/<box>.<session>.json` exists in the data directory. The SessionStart hook writes it for the session's own box, using the session's `CLAUDE_CODE_MESSAGING_SOCKET`. `client.py subscribe --box <name>` adds another box, `unsubscribe` removes one, `subscriptions` lists them. The SessionEnd hook removes them all. A session whose socket is gone is dropped.
- **Delivery.** The daemon long-polls each box (`GET /inbox?wait=25`) and writes each new message to every subscriber's socket as one JSON line. A session that subscribes later does not get the backlog. Each subscriber has its own cursor in `subs/<box>.<session>.cursor`.
- **Framing.** Claude Code treats the line as a message from another session, not from the user. The text starts with `[coordinator message box=… #id from=… type=…]` and says the sender is another agent. The agent summarizes it and does not act unless the user asks.
- **Several subscribers on one box.** Each gets every message. Claim before you act, as in [Working without conflicts](#working-without-conflicts).
- **Idle gating.** The daemon holds a subscriber's messages while that session's activity file (`active-<session>`) is older than `IDLE_SECONDS` (default 3300, just under a 1h prompt-cache TTL), so a message cannot wake a cold cache. Other sessions are not affected. They arrive once the hooks mark the session active again. Set `IDLE_SECONDS=0` to turn this off.
- **Receiving sessions in `bypassPermissions` mode** hold a message from another process for approval unless `crossSessionInbound` is `accept`. Set it in the user settings of sessions that should take messages unattended.
- **Platforms.** macOS and Linux. The daemon sends the session's auth token when the hook has it, which Windows needs, but that path is untested.
- **Unsupported surface.** Claude Code documents a script posting to its own session's socket. Posting from the daemon into another session's socket works in Claude Code 2.1.295, checked against a live session, but the line format (`{"type":"user","from":…,"message":{"role":"user","content":…}}`) is not documented. A Claude Code update could change it.

## Poller (fallback)

Use the poller when a Claude Code version has no session inbox socket, or for a script that is not Claude Code. `coordinator/poller.py` polls one box and prints each new message as one JSON line. The line has `id`, `box`, `body`, and also `from`, `type`, `thread`, `reply_to`, and `received_at` when they are set. A watcher, such as the Claude Code Monitor tool, reads the lines. The poller never acts on message content.

```sh
COORDINATOR_BOX=bob python3 coordinator/poller.py
```

- On the first run the poller skips old messages. A restart continues from the saved cursor, so it neither replays nor skips messages. The cursor is in `poller-<box>-<session>.state`.
- It polls every 3 seconds (`POLL_SECONDS`). A failed poll, including a service restart, prints to stderr and the loop continues.
- Idle gating: when the session activity file is older than `IDLE_SECONDS` (default 3300), the poller stops fetching. A message cannot wake a session whose prompt cache has expired. Messages stay in the inbox and arrive when activity resumes. Set `IDLE_SECONDS=0` to turn this off.

## HTTP API

All endpoints need the token, except `/health`. Send the token in the `X-Coordinator-Token` header or as `Authorization: Bearer <token>`.

| Method and path | Purpose |
| --- | --- |
| `GET /health` | Liveness check. No token. |
| `POST /inbox?box=<name>` | Store the request body in box `<name>`. Optional query: `from`, `type`, `thread`, `reply_to`, `key`. Returns `202` with `{"box", "id", "duplicate": false}`. A repeated `key` returns `200` with `"duplicate": true` and the first ID. |
| `GET /inbox?box=<name>&since=<id>&limit=<n>&wait=<s>` | Returns `{"messages": [...], "last_id": n}`. `since` defaults to `0`. `limit` defaults to 100 and is capped at 500. With `wait`, the request is held until a message above `since` arrives or `wait` seconds pass (capped at 30). |
| `POST /claim?box=<name>&id=<id>&by=<who>` | Returns `200 {"claimed": true}` for the first caller (and for the same caller again). Returns `409 {"claimed": false, "by": <holder>}` for others. Returns `404` if the message does not exist. |

Errors: `400` for a bad parameter, `401` for a missing or wrong token, `429` for too many wrong tokens, `404` for an unknown path, `413` for a body over 1 MB.

```sh
curl -X POST "$COORDINATOR_URL/inbox?box=bob&from=alice&type=task&thread=t1" \
  -H "X-Coordinator-Token: $TOKEN" -d 'review the schema change'
curl "$COORDINATOR_URL/inbox?box=bob&since=0" -H "X-Coordinator-Token: $TOKEN"
```

## Claude Code plugin

The repo is a Claude Code plugin and a one-plugin marketplace.

```
/plugin marketplace add ./tools/agent-coordinator
/plugin install agent-coordinator@agent-coordinator
```

Set `COORDINATOR_BOX` (default `$USER`) and, on a computer that does not host the service, `COORDINATOR_URL`, in the environment that starts Claude Code. Then, once per computer, run `client.py join` (the session start note prints the exact command, and the `join` skill explains it). Restart Claude Code.

The plugin owns the whole lifecycle, so an agent can do each of these when asked:

- **Start a coordinator**: "start a new coordinator on the local network" loads the `host` skill. The agent runs `serve.py --detach --lan --generate-password` (or a tunnel), then tells you the join URL, the password and what teammates do, and subscribes its own session.
- **Join one**: the `join` skill takes the URL and box, has you type the password with a `!` command (or accepts it from you if there is no terminal), and saves the token.
- **Send, reply, claim, read**: the `coordinator` skill.
- **Check or stop**: `serve.py --status` and `--stop`, through the `host` skill.

The plugin adds:

- Hooks: SessionStart subscribes the session to its box and starts the daemon. UserPromptSubmit, PostToolUse and Stop mark the session active. SessionEnd unsubscribes.
- The `coordinator` skill: how to treat a pushed message, claim, send, reply and avoid loops.
- The `join` skill: how to join with the password.
- The `host` skill: start, check and stop the service, and what to tell the user.

If the token is missing, the start note tells the agent to ask you to run the join command. If the session has no inbox socket (an older Claude Code), the note falls back to the [poller](#poller-fallback).

## Claude Code integration without the plugin

1. Copy `examples/claude-code/settings.json` into your project's `.claude/settings.json`. Replace `/path/to/agent-coordinator` with the path of this repo.
2. Set `COORDINATOR_BOX` and, on a computer that does not host the service, `COORDINATOR_URL`, in the environment that starts Claude Code.
3. Add the text of `examples/claude-code/CLAUDE.md` to your project's `CLAUDE.md`.

## Configuration

| Variable | Used by | Default |
| --- | --- | --- |
| `COORDINATOR_PORT` | service, serve | `8787` |
| `COORDINATOR_HOST` | service | `127.0.0.1` |
| `COORDINATOR_TOKEN` | all | the secret itself. Wins over everything else. |
| `COORDINATOR_PASSWORD` | all | password; the token is derived from it. Used when `COORDINATOR_TOKEN` is unset. |

With neither set, the token comes from the token file. `serve.py` asks for a password on first start and writes the file; `client.py join` writes it on the other computers. A service started without a terminal and without a secret generates a random token instead.
| `COORDINATOR_DATA_DIR` | all | `~/.cache/agent-coordinator` |
| `COORDINATOR_URL` | poller, client, hook | `http://127.0.0.1:8787` |
| `COORDINATOR_BOX` | poller, client, hook | `me` (poller), `$USER` (client, hook) |
| `COORDINATOR_SESSION` | poller | `$CLAUDE_CODE_SESSION_ID` |
| `POLL_SECONDS`, `IDLE_SECONDS` | poller, daemon | `3`, `3300` |
| `WAIT_SECONDS` | daemon | `25` (long poll, at most 30) |
| `COORDINATOR_AUTOSUBSCRIBE`, `COORDINATOR_SPAWN_DAEMON` | hook | on. Set to `0` to skip the automatic subscription or leave the daemon to you. |
| `NGROK_API_PORTS` | serve | `4040,4041,4042,4043,4044,4045` |

Data files in `COORDINATOR_DATA_DIR`: `inbox-<box>.jsonl`, `claims-<box>.jsonl`, `token`, `service.json`, `service.log`, `subs/` (subscriptions and cursors), `active-<session>`, `daemon.lock`, `daemon.log`, and the poller state files.

## Security notes

- The token is the only access control. Everyone with the token can read and write all boxes. The service has no TLS of its own. The tunnel provides TLS.
- The token comes from a password, so a guessable password gives a guessable token. Use a long passphrase. Ten characters is only the minimum. The salt is fixed, so the same password gives the same token on every computer.
- The service allows 10 wrong tokens per minute, then answers `429` to wrong tokens until the window clears. A right token always works. This slows guessing through the tunnel. It does not help if someone gets the token file.
- Share the password only through a private channel. Do not commit it.
- Treat message bodies as untrusted input. An agent that reads them must not run them without a check. Pushed messages arrive as turns in the session, so the framing and the `coordinator` skill are the only guard against a hostile sender. Anyone with the token can put text in front of every subscribed agent.
- To stop access, stop the tunnel. To change the token, delete the token file and restart the service. Everyone then runs `join` again.
- Run one service process for each data directory. The service keeps IDs, keys, and claims in memory and does not lock the files across processes.
- The service has no supervisor. If the process stops, the service stops. Inbox files stay on disk and are used again at the next start.

## Tests

```sh
python3 -m unittest discover -s tests
```

`tests/test_coordinator.py` tests the service in one process. `tests/test_e2e.py` starts the real service, client, poller, hook, and `serve.py` as separate processes. It covers a two-agent exchange, shared boxes, claims under parallel load, retries with keys, restarts, idle gating, paging, and the tunnel modes (a fake `ngrok`, a fake `cloudflared`, and a fake ngrok API). `tests/test_lifecycle.py` runs `serve.py --detach`, `--status` and `--stop` for real, with joins and restarts. `tests/test_daemon.py` runs the real service and daemon against fake session sockets (push, per-box routing, idle gating, dead sessions, unsubscribe). The tests need no network and no installed tunnel.
