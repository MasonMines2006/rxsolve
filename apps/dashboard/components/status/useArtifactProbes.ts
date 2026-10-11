"use client";
/** Lazily checks that named artifacts really exist; failures read as "unverified", never as a pass. */
import { useEffect, useState } from "react";
import { artifactUrl } from "@/lib/artifacts";
import type { Probe, Probes } from "@/lib/evidenceChecks";

export function useArtifactProbes(names: string[]): Probes {
  const [probes, setProbes] = useState<Probes>({});
  const key = names.join("|");
  useEffect(() => {
    let dead = false;
    for (const name of names) {
      fetch(artifactUrl(name))
        .then((r) => {
          r.body?.cancel().catch(() => {});
          const p: Probe = r.ok ? "ok" : r.status === 404 ? "missing" : "unverified";
          if (!dead) setProbes((s) => ({ ...s, [name]: p }));
        })
        .catch(() => { if (!dead) setProbes((s) => ({ ...s, [name]: "unverified" })); });
    }
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return probes;
}
