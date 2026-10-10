import type { NextConfig } from "next";

const API = process.env.API_URL ?? "http://localhost:8000";
const SIM = process.env.PBM_SIM_URL ?? "http://localhost:8100";

// Same-origin proxies so the browser never needs CORS. The WebSocket connects to the API directly.
const config: NextConfig = {
  transpilePackages: ["@rxsolve/contracts"],
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API}/api/:path*` },
      { source: "/audio/:path*", destination: `${API}/audio/:path*` },
      { source: "/sim/:path*", destination: `${SIM}/:path*` },
    ];
  },
};

export default config;
