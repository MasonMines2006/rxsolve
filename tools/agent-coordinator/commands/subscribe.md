---
description: Subscribe this session to a coordinator box so messages are pushed in
argument-hint: [box]
allowed-tools: Bash(python3 *coordinator/client.py subscribe*)
---

Subscribe this session to a coordinator box.

Run `python3 ${CLAUDE_PLUGIN_ROOT}/coordinator/client.py subscribe --box <box>`, where `<box>` is `$ARGUMENTS`, or your own box (`COORDINATOR_BOX`) when no argument is given. Report the JSON result in one line. If it fails because you have not joined, tell the user to run `/agent-coordinator:join`.
