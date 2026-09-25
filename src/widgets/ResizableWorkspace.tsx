import { useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  PointerEvent,
  KeyboardEvent,
  ReactNode,
} from "react";
import { GripHorizontal, GripVertical, RotateCcw } from "lucide-react";

type Layout = { left: number; right: number; height: number };
const defaults: Layout = { left: 218, right: 274, height: 660 };
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
function restore(): Layout {
  try {
    const saved = JSON.parse(
      localStorage.getItem("transit-overview-layout") || "null",
    );
    if (
      saved &&
      Object.values(saved).every(
        (v) => typeof v === "number" && Number.isFinite(v),
      )
    )
      return {
        left: clamp(saved.left || 218, 180, 380),
        right: clamp(saved.right || 274, 240, 520),
        height: clamp(saved.height || 660, 440, 1000),
      };
  } catch {
    /* Storage may be unavailable. */
  }
  return defaults;
}
export function ResizableWorkspace({
  mode,
  children,
}: {
  mode: string;
  children: ReactNode;
}) {
  const [layout, setLayout] = useState(restore);
  const [width, setWidth] = useState(1200);
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    axis: keyof Layout;
    coordinate: number;
    value: number;
  } | null>(null);
  const budget = Math.max(420, width - 360 - 32);
  const left = clamp(layout.left, 180, Math.min(380, budget - 240));
  const right = clamp(layout.right, 240, Math.min(520, budget - left));
  const effective = { left, right, height: layout.height };
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem("transit-overview-layout", JSON.stringify(layout));
      } catch {
        /* Preferences are optional. */
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [layout]);
  const change = (axis: keyof Layout, value: number) =>
    setLayout((s) => ({
      ...s,
      [axis]: clamp(
        value,
        axis === "left" ? 180 : axis === "right" ? 240 : 440,
        axis === "left"
          ? Math.min(380, budget - right)
          : axis === "right"
            ? Math.min(520, budget - left)
            : 1000,
      ),
    }));
  const start = (e: PointerEvent<HTMLDivElement>, axis: keyof Layout) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      axis,
      coordinate: axis === "height" ? e.clientY : e.clientX,
      value: effective[axis],
    };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const delta = (d.axis === "height" ? e.clientY : e.clientX) - d.coordinate;
    change(d.axis, d.value + delta * (d.axis === "right" ? -1 : 1));
  };
  const stop = () => {
    drag.current = null;
  };
  const key = (e: KeyboardEvent<HTMLDivElement>, axis: keyof Layout) => {
    const positive =
      axis === "height"
        ? "ArrowDown"
        : axis === "right"
          ? "ArrowLeft"
          : "ArrowRight";
    const negative =
      axis === "height"
        ? "ArrowUp"
        : axis === "right"
          ? "ArrowRight"
          : "ArrowLeft";
    if (e.key === positive || e.key === negative) {
      e.preventDefault();
      change(axis, effective[axis] + (e.key === positive ? 20 : -20));
    }
    if (e.key === "Home") {
      e.preventDefault();
      setLayout((s) => ({ ...s, [axis]: defaults[axis] }));
    }
  };
  const names = {
    left: "Ширина панели состояния",
    right: "Ширина панели событий",
    height: "Высота рабочей области",
  };
  return (
    <>
      <div
        ref={host}
        className={`workspace ${mode === "analytics" ? "analytics-workspace" : mode === "overview" ? "overview-workspace resizable-workspace" : "flow-workspace"}`}
        style={
          mode === "overview"
            ? ({
                "--panel-left": `${left}px`,
                "--panel-right": `${right}px`,
                "--workspace-height": `${layout.height}px`,
              } as CSSProperties)
            : undefined
        }
      >
        {children}
        {mode === "overview" &&
          (["left", "right", "height"] as const).map((axis) => (
            <div
              key={axis}
              className={`workspace-separator separator-${axis}`}
              role="separator"
              tabIndex={0}
              aria-label={names[axis]}
              aria-orientation={axis === "height" ? "horizontal" : "vertical"}
              aria-valuemin={
                axis === "left" ? 180 : axis === "right" ? 240 : 440
              }
              aria-valuemax={
                axis === "left"
                  ? Math.min(380, budget - right)
                  : axis === "right"
                    ? Math.min(520, budget - left)
                    : 1000
              }
              aria-valuenow={Math.round(effective[axis])}
              onPointerDown={(e) => start(e, axis)}
              onPointerMove={move}
              onPointerUp={stop}
              onPointerCancel={stop}
              onLostPointerCapture={stop}
              onKeyDown={(e) => key(e, axis)}
              title="Перетащите границу · стрелки на клавиатуре · Home для сброса"
            >
              {axis === "height" ? (
                <GripHorizontal size={15} />
              ) : (
                <GripVertical size={14} />
              )}
            </div>
          ))}
      </div>
      {mode === "overview" && (
        <div className="resize-workspace-help">
          <span>
            <GripVertical size={12} />
            Потяните границу, чтобы изменить размер панелей
          </span>
          <button onClick={() => setLayout({ ...defaults })}>
            <RotateCcw size={12} />
            Сбросить размеры
          </button>
        </div>
      )}
    </>
  );
}
