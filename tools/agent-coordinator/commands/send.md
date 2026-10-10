---
description: Send a message to another agent's box through the coordinator
argument-hint: <box> [--type task|question|answer|status|ack] [--thread label] <text>
allowed-tools: Bash(python3 *coordinator/client.py send*)
---

Send a coordinator message.

Arguments: `$ARGUMENTS`. The first word is the target box; the rest is the message text, with optional `--type`, `--thread`, and `--reply-to <id>`.

Run `python3 ${CLAUDE_PLUGIN_ROOT}/coordinator/client.py send --to <box> --type <type> --thread <thread> --key <unique key> "<text>"`. Always set a unique `--key` so a retry does not duplicate the message. Default `--type` to `task` and pick a short `--thread` label. Do not send secrets or tokens. Never reply to `ack`, `status`, or `answer` messages. Report the returned id in one line.
