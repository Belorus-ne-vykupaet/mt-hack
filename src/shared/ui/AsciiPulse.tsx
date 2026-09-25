import { useEffect, useRef } from "react";

/** A short, decorative network signal. The canvas stays idle until a background tap. */
export function AsciiPulse({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !host || !context) return;

    let width = 0;
    let height = 0;
    let frame = 0;
    let clearTimer = 0;
    let press: { x: number; y: number } | null = null;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const glyphs = ["─", "─", "─", "·", "+", ":", "/"];

    const resize = () => {
      const bounds = host.getBoundingClientRect();
      const scale = Math.min(window.devicePixelRatio || 1, 1.5);
      width = bounds.width;
      height = bounds.height;
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.clearRect(0, 0, width, height);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const draw = (x: number, y: number, progress: number) => {
      context.clearRect(0, 0, width, height);
      const radius = reducedMotion.matches ? 66 : 24 + progress * 235;
      const band = reducedMotion.matches ? 29 : 58 * (1 - progress) + 24;
      const stepX = 10;
      const stepY = 10;
      const minX = Math.max(0, Math.floor((x - radius - band) / stepX) * stepX);
      const maxX = Math.min(width, x + radius + band);
      const minY = Math.max(0, Math.floor((y - radius - band) / stepY) * stepY);
      const maxY = Math.min(height, y + radius + band);
      context.font = '11px "IBM Plex Mono", monospace';
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = "#a8e6e4";

      for (let row = minY; row <= maxY; row += stepY) {
        for (let column = minX; column <= maxX; column += stepX) {
          const dx = column - x;
          const dy = row - y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const edge = Math.abs(distance - radius) / band;
          if (edge >= 1) continue;
          const grain = ((column * 17 + row * 31) | 0) >>> 0;
          if (grain % 11 === 0) continue;
          context.globalAlpha = (1 - edge) * (reducedMotion.matches ? 0.55 : (1 - progress) * 0.72);
          context.fillText(glyphs[grain % glyphs.length], column, row);
        }
      }
      context.globalAlpha = reducedMotion.matches ? 0.7 : 1 - progress;
      context.fillStyle = "#f2b47d";
      context.fillText("+", x, y);
      context.globalAlpha = 1;
    };

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      if (event.target.closest("a, button, input, select, textarea, [contenteditable='true']")) return;
      press = { x: event.clientX, y: event.clientY };
    };
    const onUp = (event: PointerEvent) => {
      if (!press || Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) {
        press = null;
        return;
      }
      press = null;
      const bounds = host.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      cancelAnimationFrame(frame);
      window.clearTimeout(clearTimer);
      if (reducedMotion.matches) {
        draw(x, y, 0);
        clearTimer = window.setTimeout(() => context.clearRect(0, 0, width, height), 320);
        return;
      }
      const start = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / 820);
        draw(x, y, progress);
        if (progress < 1) frame = requestAnimationFrame(tick);
        else context.clearRect(0, 0, width, height);
      };
      frame = requestAnimationFrame(tick);
    };
    const onCancel = () => { press = null; };
    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onCancel);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(clearTimer);
      observer.disconnect();
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onCancel);
    };
  }, []);

  return <canvas ref={canvasRef} className={`ascii-pulse-layer ${className}`} aria-hidden="true" />;
}
