/**
 * Step artifacts: files under the evidence dir that the dashboard opens from a channel message's
 * `attachments`. This module serves them and writes the snapshots the adapters add.
 */
import { mkdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { EVIDENCE_DIR } from "./agents/packet";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const TYPES: Record<string, string> = {
  pdf: "application/pdf", html: "text/html; charset=utf-8", png: "image/png",
  txt: "text/plain; charset=utf-8", json: "application/json",
};

/** Reduces an id to the artifact filename charset. */
export const safeId = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^[._-]+/, "") || "x";

export const escapeHtml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** Writes one artifact; a failure logs a warning and returns null so it never fails a filing. */
export async function writeArtifact(dir: string, name: string, data: string | Uint8Array): Promise<string | null> {
  try {
    mkdirSync(dir, { recursive: true });
    await Bun.write(join(dir, name), data);
    return name;
  } catch (e) {
    console.warn(`artifact ${name} not written: ${(e as Error).message}`);
    return null;
  }
}

/** Serves one file from `dir` for a validated bare name. */
export async function serveArtifact(name: string, dir = EVIDENCE_DIR): Promise<Response> {
  if (!NAME.test(name) || name.includes("..")) return Response.json({ error: "bad artifact name" }, { status: 400 });
  const root = resolve(dir);
  const path = resolve(root, name);
  if (!path.startsWith(root + sep)) return Response.json({ error: "bad artifact name" }, { status: 400 });
  const f = Bun.file(path);
  if (!(await f.exists())) return Response.json({ error: "not found" }, { status: 404 });
  const ext = name.split(".").pop()!.toLowerCase();
  const headers: Record<string, string> = {
    "content-type": TYPES[ext] ?? "application/octet-stream",
    "x-content-type-options": "nosniff",
    "content-disposition": `inline; filename="${name}"`,
  };
  if (ext === "html") headers["content-security-policy"] = "sandbox";
  return new Response(f, { headers });
}
