export interface WeatherStep {
  time: number;
  generation: number;
}
export interface WeatherTimeline {
  source: "Яндекс Погода";
  configured: boolean;
  steps: WeatherStep[];
  fetchedAt: string;
}
export interface WeatherTile {
  x: number;
  y: number;
  z: number;
}
export type WeatherTileKind = "clouds" | "precipitation";
export const MOSCOW_WEATHER_BOUNDS = [36.8, 55.2, 38.4, 56.3] as const;
export function longitudeTile(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * 2 ** zoom;
}
export function latitudeTile(lat: number, zoom: number): number {
  const radians = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * 2 ** zoom;
}
export function weatherTiles(
  bounds: [number, number, number, number],
): WeatherTile[] {
  const west = Math.max(bounds[0], MOSCOW_WEATHER_BOUNDS[0]),
    south = Math.max(bounds[1], MOSCOW_WEATHER_BOUNDS[1]);
  const east = Math.min(bounds[2], MOSCOW_WEATHER_BOUNDS[2]),
    north = Math.min(bounds[3], MOSCOW_WEATHER_BOUNDS[3]);
  if (west > east || south > north) return [];
  // A bounded, fixed zoom preserves geographic alignment and limits provider requests.
  const z = 8,
    tiles: WeatherTile[] = [];
  for (
    let x = Math.floor(longitudeTile(west, z));
    x <= Math.floor(longitudeTile(east, z));
    x++
  )
    for (
      let y = Math.floor(latitudeTile(north, z));
      y <= Math.floor(latitudeTile(south, z));
      y++
    )
      tiles.push({ x, y, z });
  return tiles;
}
export function chooseWeatherStep(
  steps: WeatherStep[],
  target: number,
): WeatherStep | null {
  const available = steps.filter(
    (s) => Number.isSafeInteger(s.time) && Number.isSafeInteger(s.generation),
  );
  const closest = available.reduce<WeatherStep | null>(
    (best, s) =>
      !best || Math.abs(s.time - target) < Math.abs(best.time - target)
        ? s
        : best,
    null,
  );
  return closest && Math.abs(closest.time - target) <= 20 * 60 ? closest : null;
}
