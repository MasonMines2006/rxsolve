# Design: hosted, multi-channel coordinator

Status: draft. Nothing in this document is built yet. It records the decisions so far and the open questions, so we can continue later.

## Goals

- Host the coordinator in AWS instead of on a laptop behind a tunnel.
- Keep messages in durable storage.
- Let anyone create their own channel. A channel is a group of N agents that share one token and one unique URL.

## Current state

- One process (`coordinator/service.py`) serves one set of inboxes, protected by one shared token.
- It listens on `127.0.0.1`. A tunnel (ngrok or cloudflared) makes it reachable.
- Storage is `inbox-<box>.jsonl` and `claims-<box>.jsonl` in `COORDINATOR_DATA_DIR`.
- IDs, idempotency keys, and claims are held in memory. The service does not lock files across processes. It must run as exactly one process for each data directory.
- Clients (`client.py`, `poller.py`, `hook.py`) build requests as `$COORDINATOR_URL` + `/inbox` or `/claim`.

## Hosting

Decision: host in AWS and drop the tunnel. The tunnel exists only because the host is a laptop with no public address.

Shape:

- ECS Fargate, one task, behind an ALB with an ACM certificate.
- An EFS volume mounted at `COORDINATOR_DATA_DIR`.
- `COORDINATOR_HOST=0.0.0.0`. `/health` is the target group check.
- A Dockerfile (none exists yet). The service has no dependencies.

Constraints:

- Run exactly one task. Do not autoscale.
- Set the ECS deployment to minimum healthy 0% and maximum 100%. A rolling deploy would otherwise run two writers on the same files.
- A task restart means about a minute of downtime. The poller logs failed polls and retries, so this is safe.

Alternative kept in reserve: a cloudflared named tunnel gives a stable URL with no public ingress. Cloudflare Access can add SSO in front. Use it only if the service must stay off the open internet. We do not plan to use ngrok.

## Durable storage

Decision: EFS plus AWS Backup. No code change is needed for this.

Weak points of the current code on EFS:

- `Store.read()` (`service.py`) reads the inbox file from line 1 on every poll and holds the global lock. On EFS each read has network latency. Cost grows with inbox size, and one slow read blocks all writes.
- `Store.append()` does not call `fsync`. On NFS the file close flushes to the server, so a crash loses at most the message being written. Add `fsync` if this loss is not acceptable.
- Files grow without limit. There is no retention or compaction.
- EFS replication is not a backup. A bad delete is replicated like any other write.

Options if EFS is not enough:

| Option | Code change | Result |
| --- | --- | --- |
| EFS + AWS Backup (chosen) | None | Durable, single task only |
| EBS volume on the task or EC2 | None | Faster local reads, one AZ, single task only |
| SQLite on EFS | Moderate | Indexed reads, but SQLite locking on NFS is unreliable |
| DynamoDB (one item per message, atomic counter per box, conditional write for claims) | Rewrite `Store` | Many tasks allowed, no scan cost |

Plan: start with EFS. Move to DynamoDB only if we need more than one task or the scan cost shows up. `Store` is the only class that touches storage, so a later swap stays local.

## Channels

A channel is a group of N agents. All members share one token and one URL. Anyone can create a channel.

- The channel ID is a random string in the URL path: `https://<host>/c/<id>`.
- Each channel has its own token.
- `POST /channels` creates a channel. It returns the URL and the token once.
- The service keeps one `Store` per channel. The data is in `<data_dir>/<channel-id>/`. The `Store` class does not change.
- The service keeps only a hash of each token. It strips `/c/<id>` from the path, finds the channel, and checks the token against that channel.
- Inside a channel nothing changes: boxes, claims, idempotency keys, and the message model work as today.
- The client, poller, and hook need no change. Members set `COORDINATOR_URL` to the channel URL.

Why the channel is not a pair with two tokens: we considered one token for each party in a pair, so the service could verify `from`. We chose one shared token for the whole group. The cost is that `from` stays unverified, as it is today.

## Decisions

| Decision | Reason |
| --- | --- |
| No tunnel in AWS | The ALB gives a stable HTTPS URL. A tunnel adds a hop and a vendor. |
| Fargate + EFS, not plain EC2 | EC2 with systemd is simpler but has no replacement on failure. |
| Keep file storage for now | Load is small (a few pollers at 3 s intervals). DynamoDB is not needed yet. |
| Path prefix `/c/<id>`, not subdomains | Subdomains need a wildcard certificate and DNS. |
| One shared token for each channel | Matches the group model. Members need only one URL and one token. |
| `from` stays unverified | All members share one token, so the service cannot tell them apart. |
| Token hashes stored on the data volume | The Secrets Manager secret is no longer needed. The hashes must be in the backup. |
| Single task | IDs, keys, claims, and per-channel locks are in memory. |

## Open questions

1. **Who may create a channel?** Open creation is the simplest. Without limits, anyone can create unlimited channels and fill the disk. Choose between:
   - Open creation with a WAF rate rule, a cap on channels and bytes, and idle-channel expiry.
   - Company SSO at the ALB for `POST /channels`. Members outside the company then need a bypass for `/c/*`.
2. **Retention.** How long does a channel live? What deletes an idle channel and its files?
3. **Read cost.** Add an in-memory offset index to `Store.read()`, or wait for DynamoDB?
4. **`fsync` on append.** Add it or accept the small loss window?
5. **Token and channel rotation.** How does a channel owner replace a leaked token or delete a channel? A channel needs an owner credential for this.
6. **Terraform.** Is there an existing module or ECS pattern in the voice team's repos to extend? Do not create a new module without asking.
7. **Channel limits.** Maximum boxes for each channel, maximum bytes for each channel, and request rate for each channel.

## Security notes

- The token is the only access control inside a channel. Everyone with the token can read and write all boxes in that channel.
- The channel URL is unguessable, but do not treat it as a secret on its own. The token is the secret.
- The service has no rate limit and no TLS of its own. The ALB provides TLS. Add a WAF rate rule.
- Message bodies are untrusted input.
- Share channel URLs and tokens only through a private channel. Do not commit them.

## Future directions: differentiation

Status: ideas only. Nothing here is decided or built.

A Slack channel with one bot for each agent can already carry messages between agents. This project must not compete as a messaging service. It should be a task handoff layer for agent sessions. The items below are in priority order.

### 1. Wake a live session

The poller, the Claude Code Monitor tool, the hook, and idle gating already do this. Slack cannot push a message into a running Claude Code session. Build on this first.

### 2. Task lifecycle

Today `task`, `ack`, `status`, and `answer` are only labels. The service does not track them.

- Track the state of each task: queued, claimed, done, failed.
- Let a claim expire (a lease). A crashed session then releases its task.
- Let the sender of a task read its final result without a poll of the whole box.

### 3. Server-side loop limits

The rule "do not answer an answer" is only a convention. The service could enforce it:

- A maximum number of hops for each thread.
- A rate limit for each box and for each thread.

### 4. Verified sender

`from` is not checked now, because all members of a channel share one token. This reverses the earlier decision in [Decisions](#decisions) to keep one shared token.

- Give each member its own token, so the service can set `from` itself.
- This matters because message bodies from other agents are a prompt injection risk. An agent that acts on a task needs to know who sent it.
- Cost: channel creation and token handling get more complex. Open question 5 (token rotation) grows with it.

### 5. Slack as a view

Mirror each channel into Slack, read-only, so people can follow the agents. Slack is then a viewer and not a competitor. Do not make Slack the transport.

### What not to do

The hosted multi-channel design adds channel creation, retention, and per-channel limits. This moves the project toward a small Slack. Build items 2 to 4 before it, and keep the hosted design simple.

### Open questions

1. **Cross-company use.** Do users need agents in different companies to talk? If not, "no Slack account needed" is not a differentiator, and items 1 and 2 must carry the project.
2. **Slack bot-to-bot.** Confirm whether a Slack app can send a direct message to another app. If it cannot, two bots must share a channel and filter each other's messages. This strengthens the case for this project in one-to-one use.
3. **Slack rate limits.** Check the limits for many agents that poll at the same time.
