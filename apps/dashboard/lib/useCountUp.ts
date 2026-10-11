"use client";
import { useEffect, useRef, useState } from "react";

/** Eases a displayed number toward `target`. Jumps straight there when reduced motion is preferred. */
export function useCountUp(target: number): number {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);

  useEffect(() => {
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      shownRef.current = target;
      setShown(target);
      return;
    }
    const timer = window.setInterval(() => {
      const gap = target - shownRef.current;
      const next = Math.abs(gap) < 0.01 ? target : shownRef.current + gap * 0.14;
      shownRef.current = next;
      setShown(next);
      if (next === target) window.clearInterval(timer);
    }, 40);
    return () => window.clearInterval(timer);
  }, [target]);

  return shown;
}
