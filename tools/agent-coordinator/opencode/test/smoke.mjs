// Smoke test: starts the real service, loads the plugin with a fake opencode client,
// and drives the tools plus the inbox delivery path. Run: node --experimental-strip-types test/smoke.mjs
import { spawn } from "node:child_process"
import { pbkdf2Sync } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"

const here = dirname(fileURLToPath(import.meta.url))
const serve = join(here, "..", "..", "coordinator", "serve.py")
const dataDir = mkdtempSync(join(tmpdir(), "oc-coord-"))
const port = await new Promise((res) => {
  const srv = createServer().listen(0, "127.0.0.1", () => {
    const p = srv.address().port
    srv.close(() => res(p))
  })
})
Object.assign(process.env, {
  COORDINATOR_URL: `http://127.0.0.1:${port}`,
  COORDINATOR_PORT: String(port),
  COORDINATOR_PASSWORD: "smoke-test-password",
  COORDINATOR_DATA_DIR: dataDir,
  COORDINATOR_BOX: "oc",
  IDLE_SECONDS: "0",
  WAIT_SECONDS: "2",
})
delete process.env.COORDINATOR_TOKEN

const svc = spawn("python3", [serve], { env: process.env, stdio: "ignore" })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn, what, ms = 15000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = await fn()
    if (v) return v
    await sleep(100)
  }
  throw new Error(`timed out waiting for ${what}`)
}

let failed = false
try {
  await waitFor(() => fetch(`${process.env.COORDINATOR_URL}/health`).then((r) => r.ok, () => false), "service")

  const prompts = []
  const client = {
    session: {
      list: async () => ({ data: [{ id: "ses_1", time: { updated: 1 } }] }),
      promptAsync: async (opts) => (prompts.push(opts), { data: undefined }),
    },
  }
  const { CoordinatorPlugin } = await import("../coordinator.ts")
  const hooks = await CoordinatorPlugin({ client })
  const t = hooks.tool
  const ctx = { sessionID: "ses_1" }
  const run = async (name, args) => JSON.parse(await t[name].execute(args, ctx))

  // Tools against the real service. The plugin's own box is "oc"; "peer" plays another agent.
  const sent = await run("coordinator_send", { to: "peer", body: "hello", type: "task", thread: "t1", key: "k1" })
  assert.equal(sent.http_status, 202)
  assert.equal((await run("coordinator_send", { to: "peer", body: "hello", key: "k1" })).duplicate, true)
  const hist = await run("coordinator_read", { box: "peer" })
  assert.equal(hist.messages[0].from, "oc")
  assert.equal(hist.messages[0].thread, "t1")

  // Wait for the first-run cursor, then a message from the peer must be pushed into the session.
  await waitFor(async () => (await run("coordinator_inbox", {})).http_status === 200, "inbox")
  await sleep(500)
  // The peer posts with the token derived from the shared password.
  const tokenHeader = pbkdf2Sync("smoke-test-password", "agent-coordinator-v1", 600000, 32, "sha256").toString("hex")
  const postAs = (body) =>
    fetch(`${process.env.COORDINATOR_URL}/inbox?box=oc&from=peer&type=task&thread=t2`, {
      method: "POST",
      body,
      headers: { "X-Coordinator-Token": tokenHeader },
    })
  assert.equal((await postAs("first job")).status, 202)
  await waitFor(() => prompts.length === 1, "first delivery")
  const text = prompts[0].body.parts[0].text
  assert.equal(prompts[0].path.id, "ses_1")
  assert.ok(text.startsWith("[coordinator message box=oc #1 from=peer type=task thread=t2]"), text)
  assert.ok(text.includes("not from the user"))
  assert.ok(text.endsWith("first job"))

  // The session is now busy locally: a second message is held until the idle event.
  assert.equal((await postAs("second job")).status, 202)
  await sleep(2500)
  assert.equal(prompts.length, 1, "held while busy")
  await hooks.event({ event: { type: "session.idle", properties: { sessionID: "ses_1" } } })
  await waitFor(() => prompts.length === 2, "flush on idle")
  assert.ok(prompts[1].body.parts[0].text.includes("#2"))

  // Claim, reply, unread.
  assert.equal((await run("coordinator_claim", { id: 1, by: "a" })).claimed, true)
  const lost = await run("coordinator_claim", { id: 1, by: "b" })
  assert.equal(lost.claimed, false)
  assert.equal(lost.http_status, 409)
  const reply = await run("coordinator_reply", { id: 1, body: "done" })
  assert.equal(reply.http_status, 202)
  const peerBox = await run("coordinator_read", { box: "peer" })
  const r = peerBox.messages.at(-1)
  assert.deepEqual([r.type, r.thread, r.reply_to, r.body], ["answer", "t2", 1, "done"])
  assert.equal((await run("coordinator_inbox", {})).messages.length, 0)

  // Errors surface as JSON, not throws.
  const bad = await run("coordinator_claim", { id: 999 })
  assert.ok(bad.http_status === 404 || bad.error)
  console.log("smoke: all checks passed")
} catch (err) {
  failed = true
  console.error("smoke: FAILED", err)
} finally {
  svc.kill()
  rmSync(dataDir, { recursive: true, force: true })
  process.exit(failed ? 1 : 0)
}
