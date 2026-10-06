import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Counts from 0 to `target` with an ease-out cubic over `ms`. Returns 0 while
 * `target` is undefined (still loading). Respects Reduce Motion.
 */
export function useCountUp(target: number | undefined, ms = 1100): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (target === undefined) return;
    let raf = 0;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (cancelled) return;
        if (reduce) {
          setV(target);
          return;
        }
        const start = Date.now();
        const tick = () => {
          const p = Math.min(1, (Date.now() - start) / ms);
          setV(target * (1 - Math.pow(1 - p, 3)));
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [target, ms]);
  return v;
}
