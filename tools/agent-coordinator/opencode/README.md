# Agent coordinator plugin for opencode

A single-file opencode plugin (`coordinator.ts`) that connects opencode to the agent coordinator mailbox service. It adds `coordinator_*` tools and pushes incoming messages into the active session. It is meant for opencode running inside Zed through `opencode acp`, and also works in the opencode TUI.

It uses opencode's own mechanisms only: the plugin `event` hook, `client.session.promptAsync`, and `tool` definitions. It does not use Claude Code's session socket or the Python daemon.

## Install

1. Copy `coordinator.ts` to `.opencode/plugin/` in a project, or to `~/.config/opencode/plugin/` for every project. (opencode also accepts the folder name `plugins`.)
2. opencode installs the `@opencode-ai/plugin` import itself at startup. Nothing else to install.
3. Join the coordinator on this computer (see below), set the environment, and start opencode.

## Zed

Run opencode as a custom agent server in `~/.config/zed/settings.json`. Zed starts it with its own environment, so pass the coordinator variables in `env`:

```json
{
  "agent_servers": {
    "OpenCode": {
      "type": "custom",
      "command": "opencode",
      "args": ["acp"],
      "env": {
        "COORDINATOR_URL": "https://<public host>",
        "COORDINATOR_BOX": "bob"
      }
    }
  }
}
```

Open a thread with the `agent: new thread` action and choose OpenCode. The plugin runs inside that `opencode acp` process.

## Join

Reuse the Python client. It validates the password and saves the token to `~/.cache/agent-coordinator/token`, which the plugin reads:

```sh
export COORDINATOR_URL=https://<public host>
export COORDINATOR_BOX=bob
python3 /path/to/agent-coordinator/coordinator/client.py join
```

Without the Python client, write the token file yourself (mode 600) or set `COORDINATOR_PASSWORD` or `COORDINATOR_TOKEN` in the environment. The token is derived the same way as `config.py` (PBKDF2-SHA256, salt `agent-coordinator-v1`, 600,000 rounds). The plugin never logs the token and sends it in `X-Coordinator-Token`, with `ngrok-skip-browser-warning: 1`.

## Environment

| Variable | Default |
| --- | --- |
| `COORDINATOR_URL` | `http://127.0.0.1:8787` |
| `COORDINATOR_BOX` | `$USER` |
| `COORDINATOR_TOKEN` / `COORDINATOR_PASSWORD` | unset. Token order: token, password, token file. |
| `COORDINATOR_DATA_DIR` | `~/.cache/agent-coordinator` (token file and the delivery cursor) |
| `WAIT_SECONDS` | `25` (long poll, at most 30) |
| `IDLE_SECONDS` | `3300`. `0` turns idle gating off. |

## Tools

| Tool | Does |
| --- | --- |
| `coordinator_send` | `POST /inbox`: `to`, `body`, optional `type`, `thread`, `reply_to`, `key` |
| `coordinator_reply` | Looks up message `id` in your box, sends to its sender with the same thread, `reply_to` set, type `answer`, key `reply-<box>-<id>` |
| `coordinator_claim` | `POST /claim`: `id`, optional `box`, `by` (default: session id). `claimed=false` means another agent holds it |
| `coordinator_read` | `GET /inbox`: history of a box after `since` |
| `coordinator_inbox` | Unread messages: those after the delivery cursor that were not pushed yet |

Results are JSON text with an `http_status` field. Network errors come back as `{"error": ...}`.

## Delivery

- A background loop long-polls `GET /inbox?wait=25`. The cursor is saved per box in `<data dir>/opencode-<box>.cursor`. The first run skips the backlog. A restart continues from the cursor.
- Each message goes into the session with `client.session.promptAsync` as a text part, framed like the Claude Code push: `[coordinator message box=... #id from=... type=...]`, a line saying the sender is another agent and not the user, then the body. The model is told to summarize it and not act unless the user asks.
- The cursor advances only after `promptAsync` succeeds. Messages are fetched only while a session can take one, so nothing is lost while opencode is busy.
- Delivery is held while the target session is busy (`session.status` busy or retry) and resumes on `session.idle` or `session.status` idle. A busy mark older than 30 minutes is ignored so a missed idle event cannot stall delivery.
- Target session: the most recently active top-level session, learned from `session.created`, `session.status`, `message.updated` and tool calls, and seeded from `session.list()` at startup. Child sessions (with `parentID`) are never targets.
- Idle gating: when no session activity has happened for `IDLE_SECONDS`, delivery is held, so a message does not wake a session whose prompt cache expired. It resumes with the next activity. Set `IDLE_SECONDS=0` to deliver always.
- Errors go to stderr only (stdout is the ACP JSON-RPC stream). Failures back off from 1s to 60s and never throw into opencode.
- Several opencode processes on the same box and cursor file would split messages between them. Use one box per opencode process, or accept that each message goes to whichever process fetches it.

## Test

```sh
cd opencode
npm install
npm run smoke
```

`test/smoke.mjs` starts `coordinator/serve.py` in a temp data directory with `COORDINATOR_PASSWORD`, loads the plugin with a fake opencode client, and checks send, duplicate key, read, claim conflict, reply, unread, framing, hold while busy, and flush on idle. It needs Node 22.6 or later (type stripping) or Bun, and Python 3.10 or later.

## Unverified

- Whether plugins in `.opencode/plugin/` or `~/.config/opencode/plugin/` load under `opencode acp` in Zed. The ACP docs list custom tools as supported but do not mention plugins.
- Whether a prompt injected with `promptAsync` appears in Zed's agent panel, or only runs on the opencode side. The ACP bridge may not stream user messages it did not originate.
- Whether the model's reply to an injected prompt streams into the Zed thread that is open, and which Zed thread corresponds to the "most recently active" session when several are open.
- Whether `session.status` and `session.idle` events reach the plugin `event` hook under ACP the same way as in the TUI.
- Not tested against a live opencode process. The smoke test uses a fake client and the real service; method names were checked against the published `@opencode-ai/sdk` 1.18.35 and `@opencode-ai/plugin` 1.18.35 type definitions.
- The ACP agent may require a model or agent in the prompt body. The plugin omits both and relies on the session's last choice.
- The docs page for the SDK does not list `promptAsync`. It exists in the generated SDK types and in the server docs as `POST /session/:id/prompt_async`.
