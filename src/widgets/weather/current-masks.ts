import {
  createCurrentWeatherSampler,
  isRaining,
} from "../../entities/weather-current";
import type { CurrentWeatherPoint } from "../../entities/weather-current";
import type { WeatherTile } from "../../entities/weather";
import type { WeatherImage } from "./WeatherLayer";
/** Adapter from point conditions to the same geographic mask interface as production tiles. */
export async function currentWeatherMasks(
  points: CurrentWeatherPoint[],
  tiles: WeatherTile[],
  signal?: AbortSignal,
): Promise<WeatherImage[]> {
  signal?.throwIfAborted();
  const images: WeatherImage[] = [];
  const sampleWeather = createCurrentWeatherSampler(points);
  if (!points.some(isRaining)) return images;
  try {
    for (const tile of tiles) {
      signal?.throwIfAborted();
      const size = 256,
        clouds = new Uint8ClampedArray(size * size * 4),
        rain = new Uint8ClampedArray(size * size * 4);
      for (let y = 0; y < size; y++) {
        const mercatorY = (tile.y + (y + 0.5) / size) / 2 ** tile.z;
        const lat =
          (Math.atan(Math.sinh(Math.PI * (1 - 2 * mercatorY))) * 180) / Math.PI;
        for (let x = 0; x < size; x++) {
          const lon = ((tile.x + (x + 0.5) / size) / 2 ** tile.z) * 360 - 180;
          const sample = sampleWeather(lon, lat),
            i = (y * size + x) * 4;
          clouds[i] = Math.round(sample.rain * 255); // Red channel controls storm shading, alpha controls cover.
          clouds[i + 3] = Math.round(sample.cloud * 255);
          rain[i] = rain[i + 1] = rain[i + 2] = 255;
          rain[i + 3] = Math.round(sample.rain * 255);
        }
      }
      for (const [kind, pixels] of [
        ["clouds", clouds],
        ["precipitation", rain],
      ] as const) {
        if (!pixels.some((value, index) => index % 4 === 3 && value > 0))
          continue;
        const image = await createImageBitmap(
          new ImageData(pixels, size, size),
          { premultiplyAlpha: "none", colorSpaceConversion: "none" },
        );
        images.push({ ...tile, kind, image, approximate: true });
        signal?.throwIfAborted();
      }
    }
    return images;
  } catch (error) {
    images.forEach((i) => i.image.close());
    throw error;
  }
}
