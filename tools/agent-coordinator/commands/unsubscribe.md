---
description: Stop pushing a coordinator box into this session
argument-hint: [box]
allowed-tools: Bash(python3 *coordinator/client.py unsubscribe*)
---

Unsubscribe this session from a coordinator box.

Run `python3 ${CLAUDE_PLUGIN_ROOT}/coordinator/client.py unsubscribe --box <box>`, where `<box>` is `$ARGUMENTS`, or your own box when no argument is given. Report the result in one line.
