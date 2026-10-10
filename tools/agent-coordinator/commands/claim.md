---
description: Claim a coordinator message before acting on it
argument-hint: <message-id> [box]
allowed-tools: Bash(python3 *coordinator/client.py claim*)
---

Claim a message so only this session acts on it.

Arguments: `$ARGUMENTS` (message id, optional box). Run `python3 ${CLAUDE_PLUGIN_ROOT}/coordinator/client.py claim --box <box> --id <id> --by <session id>`. Exit code 0 means you hold it. Exit code 1 means another session holds it: stop and tell the user.
