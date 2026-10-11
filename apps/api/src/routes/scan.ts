/** Scan handoff route. Owner: MasonMines2006 (off-ticket; see docs/STATUS.md). */
import { handoffScanClaims, MAX_HANDOFF_CLAIMS } from "../scan-handoff";

const badRequest = (error: string) => Response.json({ error }, { status: 400 });

export const scanRoutes = {
  /**
   * Hands selected scan rows to the claim pipeline. Unlike POST /api/opportunity-scan this stores
   * claims, saves the auto-file limit as the pharmacy's policy, and can file appeals.
   * Body: { csv, claim_ids, auto_file_max }.
   */
  "/api/opportunity-scan/handoff": {
    POST: async (req: Request) => {
      const body = await req.json().catch(() => null) as { csv?: unknown; claim_ids?: unknown; auto_file_max?: unknown } | null;
      if (!body || typeof body.csv !== "string" || !body.csv.trim()) return badRequest("csv must be a non-empty string");

      const ids = body.claim_ids;
      const validIds = Array.isArray(ids) && ids.length >= 1 && ids.length <= MAX_HANDOFF_CLAIMS
        && ids.every((id) => typeof id === "string" && id.trim() !== "");
      if (!validIds) return badRequest(`claim_ids must list between 1 and ${MAX_HANDOFF_CLAIMS} claim IDs`);

      const limit = body.auto_file_max;
      if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 0) {
        return badRequest("auto_file_max must be a non-negative dollar amount");
      }

      try {
        return Response.json(await handoffScanClaims({ csv: body.csv, claimIds: ids as string[], autoFileMax: limit }));
      } catch (error) {
        // The scanner throws plain messages for malformed files (missing columns, bad dates).
        return badRequest(error instanceof Error ? error.message : "Unable to hand off these claims");
      }
    },
  },
};
