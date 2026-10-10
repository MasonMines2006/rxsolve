---
name: host
description: Start, check or stop the coordinator service on this computer (the mailbox other agents connect to), on the local network or through a tunnel. Use when asked to start, host, run, restart or stop a coordinator, or to get the URL and password to give teammates.
---

# Host a coordinator

The session start note gives the absolute paths of `serve.py` and `client.py`. Use them as `<serve.py>` and `<client.py>` below. `serve.py` runs the service in the background and prints one JSON object. Run it with the Bash tool. Do not use `--tunnel` or `--lan` without `--detach`: the command would never return.

## Start

Pick the mode from where the teammates are:

| Teammates are | Command |
| --- | --- |
| On the same network (office Wi-Fi, same VPN) | `python3 <serve.py> --detach --lan --generate-password` |
| On other networks | `python3 <serve.py> --detach --tunnel cloudflared --generate-password` (no account needed; `--tunnel ngrok` if ngrok is set up) |
| Behind a tunnel the user already runs | `python3 <serve.py> --detach --public-url <https url> --generate-password` |

- Set `COORDINATOR_PORT` first if the user wants a port other than 8787.
- If the user did not say where the teammates are, ask. Same network is the simpler and more private choice. Tell the user it is plain HTTP.
- The result is JSON: `urls` (or `public_url`), `join_command`, `password`, `log`. If it has `"error"`, show the user the `log_tail` and stop.
- If it has `"already_running": true`, a service is already up. Report its URLs. The password is not in that output. Only if the user asks for a new password, stop the service and start it again with `--generate-password`. Everyone then has to join again.

## Tell the user

Give the user, once, in plain text:

1. The join URL: the first of `urls`, or `public_url`.
2. The password. It is shown only when it is generated. The user passes it to teammates over a private channel. It is in this transcript, so do not repeat it anywhere else and never send it through the coordinator itself.
3. What teammates do: install the plugin, set `COORDINATOR_URL=<join URL>` and `COORDINATOR_BOX=<their name>`, start Claude Code, and run the `join` skill. `join_command` is the exact command.

Then subscribe this session, which started before the service existed: `COORDINATOR_URL=<join URL> python3 <client.py> subscribe`. Without `COORDINATOR_URL`, the default `http://127.0.0.1:8787` is used.

## Check and stop

- `python3 <serve.py> --status` prints `{"running", "healthy", "urls", ...}`. It exits 1 when nothing is running.
- `python3 <serve.py> --stop` stops the service. Its messages stay on disk and are served again on the next start.
- The service keeps running after this session ends. Tell the user that, and offer `--stop` when they are done.
- On a laptop, the service is down while the computer sleeps or leaves the network.
