/** Settings from the shared root .env (BUILD_PLAN.md section 19). Owner: P1. Tests mutate this object. */
const env = (k: string, d = "") => process.env[k] ?? d;
const num = (k: string, d: number) => Number(process.env[k] ?? d);

export const config = {
  port: num("API_PORT", 8000),
  databaseUrl: env("DATABASE_URL"), // TigerData (Postgres) connection string; empty -> in-memory store (fine for local dev and tests)
  agentApiKey: env("AGENT_API_KEY"),

  ledgerBackend: env("LEDGER_BACKEND", "local") as "local" | "nessie",
  nessieKey: env("NESSIE_KEY"),
  nessieApiKey: env("NESSIE_API_KEY"),
  nessieVersion: env("NESSIE_VERSION", "v1"),

  photonProjectId: env("PHOTON_PROJECT_ID"), // empty -> messages render only in the dashboard
  photonProjectSecret: env("PHOTON_PROJECT_SECRET"),
  elevenlabsApiKey: env("ELEVENLABS_API_KEY"),
  elevenlabsVoiceId: env("ELEVENLABS_VOICE_ID"),

  pbmSimUrl: env("PBM_SIM_URL", "http://localhost:8100"),
  adapterMode: env("ADAPTER_MODE", "direct") as "direct" | "real",

  pharmacyId: env("PHARMACY_ID", "PH-MEADOWBROOK"),
  platformAccount: env("PLATFORM_ACCOUNT", "RXSOLVE-PLATFORM"),
  pharmacistPhone: env("PHARMACIST_PHONE"),
  wholesalerContact: env("WHOLESALER_CONTACT"),

  feePct: 0.25,
  pollIntervalMs: num("POLL_INTERVAL_MS", 500),
  resolutionTimeoutMs: num("RESOLUTION_TIMEOUT_MS", 120_000), // demo-scale stand-in for the statutory deadline
};
