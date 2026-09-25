/** Provider-neutral current conditions. Shapes derived from points are illustrative. */
export const CLOUD_COVER = {
  CLEAR: 0,
  PARTLY: 0.2,
  SIGNIFICANT: 0.45,
  CLOUDY: 0.75,
  OVERCAST: 1,
} as const;
export const PRECIP_STRENGTH = {
  ZERO: 0,
  WEAK: 0.3,
  AVERAGE: 0.55,
  STRONG: 0.8,
  VERY_STRONG: 1,
} as const;
export type PrecipitationType = "NO_TYPE" | "RAIN" | "SLEET" | "SNOW" | "HAIL";
export const WEATHER_LOCATIONS = [
  { id: "nw", name: "Северо-запад", lat: 55.9, lon: 37.36 },
  { id: "n", name: "Север", lat: 55.9, lon: 37.62 },
  { id: "ne", name: "Северо-восток", lat: 55.9, lon: 37.88 },
  { id: "w", name: "Запад", lat: 55.75, lon: 37.36 },
  { id: "center", name: "Центр", lat: 55.75, lon: 37.62 },
  { id: "e", name: "Восток", lat: 55.75, lon: 37.88 },
  { id: "sw", name: "Юго-запад", lat: 55.6, lon: 37.36 },
  { id: "s", name: "Юг", lat: 55.6, lon: 37.62 },
  { id: "se", name: "Юго-восток", lat: 55.6, lon: 37.88 },
  {
    id: "inner_nw",
    name: "Между центром и северо-западом",
    lat: 55.825,
    lon: 37.49,
  },
  {
    id: "inner_ne",
    name: "Между центром и северо-востоком",
    lat: 55.825,
    lon: 37.75,
  },
  {
    id: "inner_sw",
    name: "Между центром и юго-западом",
    lat: 55.675,
    lon: 37.49,
  },
  {
    id: "inner_se",
    name: "Между центром и юго-востоком",
    lat: 55.675,
    lon: 37.75,
  },
] as const;
/** Four cell centres connect to their corners; original grid edges remain neighbours. */
export const WEATHER_NEIGHBORS: readonly (readonly [string, string])[] = [
  ["nw", "n"],
  ["n", "ne"],
  ["w", "center"],
  ["center", "e"],
  ["sw", "s"],
  ["s", "se"],
  ["nw", "w"],
  ["w", "sw"],
  ["n", "center"],
  ["center", "s"],
  ["ne", "e"],
  ["e", "se"],
  ...(
    [
      ["inner_nw", "nw", "n", "w", "center"],
      ["inner_ne", "n", "ne", "center", "e"],
      ["inner_sw", "w", "center", "sw", "s"],
      ["inner_se", "center", "e", "s", "se"],
    ] as const
  ).flatMap(([middle, ...corners]) =>
    corners.map((corner) => [middle, corner] as const),
  ),
];
export interface CurrentWeatherPoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  cloudiness: keyof typeof CLOUD_COVER;
  precipitationType: PrecipitationType;
  precipitationStrength: keyof typeof PRECIP_STRENGTH;
}
export interface CurrentWeatherSnapshot {
  schemaVersion: 1;
  source: "Яндекс Погода";
  mode: "current-points";
  fetchedAt: string;
  refreshAfterSec: number;
  points: CurrentWeatherPoint[];
  unavailablePoints: string[];
}
export function isRaining(point: CurrentWeatherPoint) {
  return (
    (point.precipitationType === "RAIN" ||
      point.precipitationType === "SLEET") &&
    PRECIP_STRENGTH[point.precipitationStrength] > 0
  );
}
export function weatherPointLabel(point: CurrentWeatherPoint) {
  if (point.precipitationStrength !== "ZERO") {
    if (point.precipitationType === "RAIN") return "Дождь";
    if (point.precipitationType === "SLEET") return "Дождь со снегом";
    if (point.precipitationType === "SNOW") return "Снег";
    if (point.precipitationType === "HAIL") return "Град";
  }
  return point.cloudiness === "CLEAR"
    ? "Ясно"
    : point.cloudiness === "OVERCAST"
      ? "Пасмурно"
      : "Облачно";
}
/** Build once per snapshot. A dry/unknown node never creates a cloud or a bridge. */
export function createCurrentWeatherSampler(points: CurrentWeatherPoint[]) {
  const wet = points
    .filter(isRaining)
    .map((point) => ({
      ...point,
      x: (point.lon - 37.62) * 62500,
      y: (point.lat - 55.75) * 111320,
    }));
  const byId = new Map(wet.map((point) => [point.id, point]));
  const links = WEATHER_NEIGHBORS.flatMap(([from, to]) => {
    const a = byId.get(from),
      b = byId.get(to);
    return a && b
      ? [
          {
            a,
            b,
            dx: b.x - a.x,
            dy: b.y - a.y,
            length2: (b.x - a.x) ** 2 + (b.y - a.y) ** 2,
          },
        ]
      : [];
  });
  return (lon: number, lat: number) => {
    const x = (lon - 37.62) * 62500,
      y = (lat - 55.75) * 111320;
    let cloud = 0,
      rain = 0;
    const profile = (distance: number, radius: number) => {
      const t = Math.min(1, Math.max(0, (radius - distance) / (radius * 0.45)));
      return t * t * (3 - 2 * t);
    };
    for (const point of wet) {
      const distance = Math.hypot(x - point.x, y - point.y);
      cloud = Math.max(cloud, profile(distance, 4500));
      rain = Math.max(
        rain,
        PRECIP_STRENGTH[point.precipitationStrength] * profile(distance, 2500),
      );
    }
    for (const link of links) {
      const t = Math.max(
        0,
        Math.min(
          1,
          ((x - link.a.x) * link.dx + (y - link.a.y) * link.dy) / link.length2,
        ),
      );
      const distance = Math.hypot(
        x - link.a.x - t * link.dx,
        y - link.a.y - t * link.dy,
      );
      // A continuous bank between neighbouring wet samples, with softly varied edges.
      const width = 3000 + 350 * Math.sin(x / 1700 + y / 2300);
      cloud = Math.max(cloud, profile(distance, width));
    }
    return { cloud, rain };
  };
}
export function sampleCurrentWeather(
  points: CurrentWeatherPoint[],
  lon: number,
  lat: number,
) {
  return createCurrentWeatherSampler(points)(lon, lat);
}
