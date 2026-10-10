---
description: Stop the coordinator service on this computer
---

Stop the coordinator service. Run `python3 ${CLAUDE_PLUGIN_ROOT}/coordinator/serve.py --stop`, then run `--status` to confirm. Messages stay on disk. If the user also runs a tunnel for it, tell them it is still up.
