/** Rules from CLAUDE.md that code can check. */
import { expect, test } from "bun:test";
import { Glob } from "bun";

const ROOT = `${import.meta.dir}/../../..`;
const files = async (dir: string) => Array.fromAsync(new Glob("**/*.ts").scan({ cwd: `${ROOT}/${dir}`, absolute: true }));

test("PBM Sim imports nothing from the RxSolve codebase", async () => {
  for (const f of await files("apps/pbm-sim/src")) {
    const src = await Bun.file(f).text();
    expect(src, f).not.toMatch(/from\s+["'](@rxsolve\/|\.\.\/\.\.\/api)/);
  }
});

test("no model in the PBM Sim: concessions are rule-based", async () => {
  for (const f of await files("apps/pbm-sim/src")) expect(await Bun.file(f).text(), f).not.toContain("anthropic");
});
