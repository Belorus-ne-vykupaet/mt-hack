import { afterEach, expect, it, vi } from "vitest";
import { currentWeatherMasks } from "../src/widgets/weather/current-masks";
import { WEATHER_LOCATIONS } from "../src/entities/weather-current";
import { weatherTiles, MOSCOW_WEATHER_BOUNDS } from "../src/entities/weather";

afterEach(() => vi.unstubAllGlobals());
it("closes an in-flight weather bitmap on cancellation and stops generating remaining masks", async () => {
  vi.stubGlobal(
    "ImageData",
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    },
  );
  const bitmap = { close: vi.fn() };
  let finish!: (image: typeof bitmap) => void;
  const create = vi.fn(
    () =>
      new Promise<typeof bitmap>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal("createImageBitmap", create);
  const abort = new AbortController();
  const result = currentWeatherMasks(
    WEATHER_LOCATIONS.map((point) => ({
      ...point,
      cloudiness: "OVERCAST",
      precipitationType: "RAIN",
      precipitationStrength: "WEAK",
    })),
    weatherTiles([...MOSCOW_WEATHER_BOUNDS]),
    abort.signal,
  );
  expect(create).toHaveBeenCalledOnce();
  abort.abort();
  finish(bitmap);
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  expect(bitmap.close).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledOnce();
});
