import { useEffect, useRef, useMemo } from "react";
import * as echarts from "echarts/core";
import { LineChart, BarChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  GraphicComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";
import { useTheme } from "../../app/theme";
echarts.use([
  LineChart,
  BarChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  GraphicComponent,
  CanvasRenderer,
]);

// Adapt legacy chart options as well as new charts to the shared theme.
function themed(value: unknown, palette: Record<string, string>): unknown {
  if (typeof value === "string") return palette[value] || value;
  if (Array.isArray(value)) return value.map((v) => themed(v, palette));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, themed(v, palette)]),
    );
  return value;
}
export function Chart({
  option,
  height = 170,
  label,
}: {
  option: EChartsCoreOption;
  height?: number;
  label: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.EChartsType | undefined>(undefined);
  const theme = useTheme((s) => s.theme);
  const adapted = useMemo(
    () =>
      themed(option, {
        "#ffffff": theme === "dark" ? "#1b292d" : "#fbfbf7",
        "#20231e": theme === "dark" ? "#eff3ed" : "#17292d",
        "#30382c": theme === "dark" ? "#eff3ed" : "#17292d",
        "#d9ddd2": theme === "dark" ? "#43575b" : "#cbd2ce",
        "#e6e9e0": theme === "dark" ? "#34464b" : "#dfe4df",
        "#818875": theme === "dark" ? "#a8b9b8" : "#596b6b",
        "#717a67": theme === "dark" ? "#a8b9b8" : "#596b6b",
        "#547236": theme === "dark" ? "#69c7d8" : "#006f86",
        "#36a8e9": theme === "dark" ? "#69c7d8" : "#006f86",
        "#a88219": theme === "dark" ? "#efc96d" : "#785900",
        "#e8b449": theme === "dark" ? "#efc96d" : "#a27513",
        "#c76816": theme === "dark" ? "#f6a775" : "#9c4924",
        "#ef8b4a": theme === "dark" ? "#f6a775" : "#b55a32",
        "#21ba96": theme === "dark" ? "#78d0b4" : "#087761",
        "#f06479": theme === "dark" ? "#ff8d99" : "#aa3444",
      }) as EChartsCoreOption,
    [option, theme],
  );
  useEffect(() => {
    if (!el.current) return;
    chart.current = echarts.init(el.current, undefined, { renderer: "canvas" });
    const observer = new ResizeObserver(() => chart.current?.resize());
    observer.observe(el.current);
    return () => {
      observer.disconnect();
      chart.current?.dispose();
    };
  }, []);
  useEffect(() => {
    chart.current?.setOption(
      {
        textStyle: { fontFamily: "IBM Plex Sans, sans-serif", fontSize: 11 },
        animationDuration: globalThis.matchMedia?.(
          "(prefers-reduced-motion: reduce)",
        ).matches
          ? 0
          : 300,
        ...adapted,
      },
      { notMerge: true },
    );
  }, [adapted]);
  return (
    <div
      ref={el}
      style={{ height, width: "100%" }}
      role="img"
      aria-label={label}
    />
  );
}
