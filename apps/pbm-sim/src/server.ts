/**
 * PBM Sim (port 8100). Owner: P1.
 * Standalone: imports nothing from @rxsolve/* (apps/api/test/boundaries.test.ts enforces it). It shares
 * no code or database with the agents and exposes only what a real PBM exposes, plus the /dev door.
 */
import { devRoutes } from "./doors/dev";
import { faxRoutes } from "./doors/fax";
import { inboxRoutes } from "./doors/inbox";
import { portalRoutes } from "./doors/portal";
import { appeals, claims } from "./store";
import { switchClaim } from "./switch";

export function startSim(port = Number(process.env.PBM_SIM_PORT ?? 8100)) {
  const server = Bun.serve({
    port,
    routes: {
      "/api/health": () => Response.json({ status: "ok", claims: claims.length, appeals: appeals.size }),
      "/switch/claim": { POST: switchClaim },
      ...devRoutes,
      ...portalRoutes,
      ...inboxRoutes,
      ...faxRoutes,
    },
    fetch: () => Response.json({ error: "not found" }, { status: 404 }),
  });
  return { server, url: server.url.origin, stop: () => server.stop(true) };
}
