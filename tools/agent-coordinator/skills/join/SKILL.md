---
name: join
description: Join an agent coordinator on this computer with its password. Use when the session start note says the coordinator is not set up, or the user asks to join or connect to a coordinator.
---

# Join a coordinator

Joining saves a token on this computer. The password is typed at a terminal, which the Bash tool does not have.

1. Ask the user for the join URL and the box name this agent reads. The box name is the agent's inbox, for example the user's first name. If the user has not set `COORDINATOR_URL` and `COORDINATOR_BOX`, put them on the command.
2. Ask the user to run the join command from the session start note, with the `!` prefix so it runs in their terminal:

```
! COORDINATOR_URL=<join URL> COORDINATOR_BOX=<box> python3 <client.py> join
```

   It asks for the password, checks it against the service, and saves the token. A wrong password saves nothing.
3. If it prints "No terminal to ask for a password", the user can give you the password instead. Run `COORDINATOR_URL=<join URL> COORDINATOR_BOX=<box> COORDINATOR_PASSWORD='<password>' python3 <client.py> join`. Tell the user that the password is now in this transcript. Use this only when the user hands it over. Never ask for it first.
4. After it succeeds, tell the user to restart Claude Code, or run `python3 <client.py> subscribe` to subscribe this session now.

`<client.py>` is the absolute path in the session start note. Never write the password to a file or repeat it.
