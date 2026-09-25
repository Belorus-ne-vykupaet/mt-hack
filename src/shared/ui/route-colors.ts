// Stable route identity colors: independent of filters, theme and forecast risk.
const routeIds = [
  "м3",
  "с344",
  "е70",
  "м6",
  "м40",
  "370",
  "345",
  "т78",
  "м3к",
  "116",
  "м1",
  "418",
  "м34",
  "м90",
  "384",
];
const palette: [number, number, number][] = [
  [59, 130, 246],
  [249, 115, 22],
  [168, 85, 247],
  [20, 184, 166],
  [236, 72, 153],
  [234, 179, 8],
  [132, 204, 22],
  [6, 182, 212],
  [239, 68, 68],
  [99, 102, 241],
  [16, 185, 129],
  [217, 70, 239],
  [180, 130, 70],
  [14, 116, 144],
  [190, 24, 93],
];
export function routeRgb(routeId: string): [number, number, number] {
  const index = routeIds.indexOf(routeId);
  if (index >= 0) return palette[index];
  const hash = Array.from(routeId).reduce(
    (n, c) => (n * 31 + c.charCodeAt(0)) >>> 0,
    0,
  );
  return palette[hash % palette.length];
}
