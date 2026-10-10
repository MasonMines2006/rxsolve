/**
 * RxSolve API server (port 8000). Owner: P1.
 * Add endpoints in routes/ (core.ts is P1, messaging.ts is P2), not here.
 */
import { config } from "./config";
import { ensureIndexes } from "./db";
import { bus } from "./events";
import { getLedger, pbmAccount } from "./ledger";
import { emitBalances } from "./ledger/settle";
import { startSpectrum } from "./messaging/spectrum";
import { coreRoutes } from "./routes/core";
import { handleInbound, messagingRoutes } from "./routes/messaging";
import { AUDIO_DIR } from "./voice";

export async function bootstrap({ spectrum = true } = {}) {
  await ensureIndexes();
  await getLedger().ensureAccounts([
    config.pharmacyId, config.platformAccount, ...["PBM_PORTAL", "PBM_EMAIL", "PBM_FAX"].map(pbmAccount),
  ]);
  if (spectrum && (await startSpectrum(handleInbound))) console.log("spectrum: iMessage connected");
  await emitBalances();
}

export function startApi(port = config.port) {
  const server = Bun.serve({
    port,
    routes: {
      ...coreRoutes,
      ...messagingRoutes,
      "/audio/:name": (req) => new Response(Bun.file(`${AUDIO_DIR}/${req.params.name}`)),
    },
    fetch(req, srv) {
      if (new URL(req.url).pathname === "/ws/live" && srv.upgrade(req)) return;
      return Response.json({ error: "not found" }, { status: 404 });
    },
    websocket: {
      open(ws) {
        ws.subscribe("live");
        for (const e of bus.history()) ws.send(JSON.stringify(e));
      },
      message() {},
    },
  });
  const off = bus.on((e) => server.publish("live", JSON.stringify(e)));
  return { server, url: server.url.origin, stop: () => { off(); server.stop(true); } };
}
