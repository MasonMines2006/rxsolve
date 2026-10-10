---
description: Start the coordinator service on this computer
argument-hint: [lan|tunnel|public-url <https url>]
---

Start the coordinator service. Follow the `host` skill. Use `$ARGUMENTS` to pick the mode (LAN, a tunnel, or an existing public URL); if it is empty, ask the user where teammates are. Report the join URL and the generated password to the user once, and remind them the service keeps running after the session ends.
