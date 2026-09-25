import { useEffect, useRef, useState } from "react";
export function useAnimatedHorizon(target: number, immediate: boolean) {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    if (immediate) {
      current.current = target;
      return;
    }
    const start = current.current,
      started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / 280),
        next = start + (target - start) * (1 - (1 - t) ** 3);
      current.current = next;
      setValue(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, immediate]);
  return immediate ? target : value;
}
