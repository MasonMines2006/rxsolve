"use client";
import { useEffect, useRef, useState } from "react";

const DURATION_MS = 500;

/** Eases a displayed number to `target` in a fixed 0.5 s. Jumps straight there when reduced motion is preferred. */
export function useCountUp(target: number): number {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);

  useEffect(() => {
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || shownRef.current === target) {
      shownRef.current = target;
      setShown(target);
      return;
    }
    const from = shownRef.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      const next = t === 1 ? target : from + (target - from) * (1 - (1 - t) ** 3);
      shownRef.current = next;
      setShown(next);
      if (t < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [target]);

  return shown;
}
