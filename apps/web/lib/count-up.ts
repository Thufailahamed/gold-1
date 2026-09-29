"use client";

import { useEffect, useState } from "react";

/**
 * Counts from 0 to `target` with an ease-out cubic over `ms`.
 * Returns 0 while `target` is undefined (still loading) so callers can
 * render a placeholder instead of a number they do not have yet.
 */
export function useCountUp(target: number | undefined, ms = 1100): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (target === undefined) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setV(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setV(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}
