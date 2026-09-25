import {
  WEATHER_LOCATIONS,
  WEATHER_NEIGHBORS,
  isRaining,
  sampleCurrentWeather,
} from "../src/entities/weather-current";
import type { CurrentWeatherPoint } from "../src/entities/weather-current";
import { expect, it } from "vitest";
import {
  chooseWeatherStep,
  latitudeTile,
  longitudeTile,
  weatherTiles,
  MOSCOW_WEATHER_BOUNDS,
} from "../src/entities/weather";
import { YandexWeather } from "../server/yandex-weather";
import { createApi } from "../server/app";
const now = Math.floor(Date.now() / 1000);
const step = { timestamp: String(now), genTime: String(now - 60) };
const timeline = () =>
  Response.json({ data: { weatherByPoint: { nowcast: { steps: [step] } } } });
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
it("aligns XYZ tiles with Moscow's Mercator coordinates and clips out-of-region requests", () => {
  const tiles = weatherTiles([...MOSCOW_WEATHER_BOUNDS]);
  expect(tiles.length).toBeLessThanOrEqual(9);
  expect(tiles).toContainEqual({
    z: 8,
    x: Math.floor(longitudeTile(37.62, 8)),
    y: Math.floor(latitudeTile(55.75, 8)),
  });
  expect(weatherTiles([-10, 0, 0, 10])).toEqual([]);
});
it("selects the nearest supplied forecast frame, never invents stale times", () => {
  const steps = [
    { time: now, generation: now - 60 },
    { time: now + 600, generation: now - 60 },
  ];
  expect(chooseWeatherStep(steps, now + 550)?.time).toBe(now + 600);
  expect(chooseWeatherStep(steps, now + 5000)).toBeNull();
});
it("does not contact Yandex without a configured key", async () => {
  let calls = 0;
  const provider = new YandexWeather("", true, async () => {
    calls++;
    return timeline();
  });
  expect(provider.configured).toBe(false);
  await expect(provider.timeline()).rejects.toThrow("не подключена");
  expect(calls).toBe(0);
});
it("authenticates server-side, preserves frame/projection/XYZ and deduplicates calls", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const provider = new YandexWeather(
    "test-weather-secret",
    true,
    async (input, init) => {
      requests.push({ url: String(input), init });
      return String(input).includes("graphql")
        ? timeline()
        : new Response(png, { headers: { "Content-Type": "image/png" } });
    },
  );
  const [a, b] = await Promise.all([provider.timeline(), provider.timeline()]);
  expect(a).toEqual(b);
  expect(requests).toHaveLength(1);
  expect(JSON.stringify(a)).not.toContain("secret");
  const tile = weatherTiles([...MOSCOW_WEATHER_BOUNDS])[0];
  const load = () =>
    provider.tile("clouds", tile.z, tile.x, tile.y, now, now - 60);
  const [first, second] = await Promise.all([load(), load()]);
  expect(first).toEqual(second);
  await load();
  expect(requests).toHaveLength(2);
  const request = requests[1];
  const url = new URL(request.url);
  expect(url.pathname).toContain("cloudiness_tile");
  expect(url.searchParams.get("proj")).toBe("EPSG:3857");
  expect(url.searchParams.get("x")).toBe(String(tile.x));
  expect(url.searchParams.get("for_date")).toBe(String(now));
  expect(new Headers(request.init?.headers).get("X-Yandex-Weather-Key")).toBe(
    "test-weather-secret",
  );
  await expect(provider.tile("clouds", 0, 0, 0, now, now - 60)).rejects.toThrow(
    "Недопустимый",
  );
  await expect(
    provider.tile("clouds", tile.z, tile.x, tile.y, now + 1, now - 60),
  ).rejects.toThrow("устарел");
});
it("does not forward provider secrets or interpret HTML/denied access as clear weather", async () => {
  const denied = new YandexWeather(
    "private",
    true,
    async () => new Response("private", { status: 403 }),
  );
  await expect(denied.timeline()).rejects.toThrow("отклонил доступ");
  const basic = new YandexWeather("private", true, async () =>
    Response.json({
      errors: [{ message: "access denied for basic role" }],
      data: {
        weatherByPoint: {
          nowcast: { steps: [{ timestamp: null, genTime: null }] },
        },
      },
    }),
  );
  await expect(basic.timeline()).rejects.toThrow("тариф не даёт доступ");
  const corrupt = new YandexWeather("private", true, async (url) =>
    String(url).includes("graphql")
      ? timeline()
      : new Response("<html>private</html>", {
          headers: { "Content-Type": "text/html" },
        }),
  );
  const tile = weatherTiles([...MOSCOW_WEATHER_BOUNDS])[0];
  await expect(
    corrupt.tile("clouds", tile.z, tile.x, tile.y, now, now - 60),
  ).rejects.toThrow("формат");
});
it("serves weather through the authenticated API without exposing the provider key", async () => {
  const api = createApi({
    token: "test-session",
    yandexWeatherKey: "private-provider-key",
    fetcher: async (url, init) =>
      String(url).includes("graphql")
        ? String(init?.body).includes("nowcast")
          ? timeline()
          : Response.json({
              data: {
                center: {
                  now: {
                    cloudiness: "CLOUDY",
                    precType: "RAIN",
                    precStrength: "WEAK",
                  },
                },
              },
            })
        : new Response(png, { headers: { "Content-Type": "image/png" } }),
  });
  await new Promise<void>((resolve) =>
    api.server.listen(0, "127.0.0.1", resolve),
  );
  const base = `http://127.0.0.1:${(api.server.address() as { port: number }).port}/api/v1/external/yandex-weather`;
  try {
    expect((await fetch(`${base}/status`)).status).toBe(401);
    const headers = { Cookie: "transit_api_session=test-session" };
    expect((await fetch(`${base}/current`)).status).toBe(401);
    const current = await (await fetch(`${base}/current`, { headers })).json();
    expect(current.mode).toBe("current-points");
    expect(current.points[0].precipitationType).toBe("RAIN");
    expect(current.unavailablePoints).toHaveLength(12);
    expect(JSON.stringify(current)).not.toContain("private-provider-key");
    const status = await (await fetch(`${base}/status`, { headers })).json();
    expect(status).toEqual({ configured: true, source: "Яндекс Погода" });
    const frames = await (await fetch(`${base}/timeline`, { headers })).json();
    expect(frames.steps).toEqual([{ time: now, generation: now - 60 }]);
    expect(JSON.stringify(frames)).not.toContain("private-provider-key");
    const tile = weatherTiles([...MOSCOW_WEATHER_BOUNDS])[0];
    const response = await fetch(
      `${base}/tiles/clouds/${tile.z}/${tile.x}/${tile.y}?time=${now}&generation=${now - 60}`,
      { headers },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toContain("private");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
    expect(
      (
        await fetch(`${base}/status`, {
          headers: { ...headers, Origin: "https://unrelated.example" },
        })
      ).status,
    ).toBe(403);
  } finally {
    await api.close();
  }
});

it("normalizes current point weather with bounded aliases and shares its fifteen-minute cache", async () => {
  let calls = 0;
  const provider = new YandexWeather("private", true, async (_url, init) => {
    calls++;
    const query = JSON.parse(String(init?.body)).query;
    expect(query).not.toContain("nowcast");
    expect(query.match(/weatherByPoint/g)).toHaveLength(13);
    return Response.json({
      data: Object.fromEntries(
        WEATHER_LOCATIONS.map((p) => [
          p.id,
          {
            now: {
              cloudiness: "CLOUDY",
              precType: p.id === "center" ? "RAIN" : "NO_TYPE",
              precStrength: p.id === "center" ? "STRONG" : "ZERO",
            },
          },
        ]),
      ),
    });
  });
  const [a, b] = await Promise.all([provider.current(), provider.current()]);
  expect(a).toEqual(b);
  await provider.current();
  expect(calls).toBe(1);
  expect(a.points).toHaveLength(13);
  expect(a.mode).toBe("current-points");
  expect(a.points.filter(isRaining)).toHaveLength(1);
  expect(a.refreshAfterSec).toBe(900);
  expect(JSON.stringify(a)).not.toContain("private");
});
it("omits unknown or missing point readings instead of claiming clear weather, and backs off failures", async () => {
  const partial = new YandexWeather("private", true, async () =>
    Response.json({
      data: {
        center: {
          now: {
            cloudiness: "PARTLY",
            precType: "NO_TYPE",
            precStrength: "ZERO",
          },
        },
        n: {
          now: {
            cloudiness: "new-enum",
            precType: "RAIN",
            precStrength: "STRONG",
          },
        },
      },
    }),
  );
  const data = await partial.current();
  expect(data.points).toHaveLength(1);
  expect(data.unavailablePoints).toHaveLength(12);
  let calls = 0;
  const broken = new YandexWeather("private", true, async () => {
    calls++;
    return Response.json({ data: null, errors: [{ message: "private" }] });
  });
  await expect(broken.current()).rejects.toThrow(
    "не предоставил текущую погоду",
  );
  await expect(broken.current()).rejects.toThrow(
    "не предоставил текущую погоду",
  );
  expect(calls).toBe(1);
});
it("bounds illustrative rain to wet points and keeps dry cloud fringes, clear sky, missing data and snow distinct", () => {
  const point: CurrentWeatherPoint = {
    ...WEATHER_LOCATIONS[4],
    cloudiness: "OVERCAST",
    precipitationType: "RAIN",
    precipitationStrength: "STRONG",
  };
  expect(
    sampleCurrentWeather([point], point.lon, point.lat).rain,
  ).toBeGreaterThan(0);
  const fringe = sampleCurrentWeather([point], point.lon + 0.05, point.lat);
  expect(fringe.rain).toBe(0);
  expect(fringe.cloud).toBeGreaterThan(0);
  expect(sampleCurrentWeather([point], point.lon + 0.5, point.lat)).toEqual({
    cloud: 0,
    rain: 0,
  });
  expect(sampleCurrentWeather([], point.lon, point.lat)).toEqual({
    cloud: 0,
    rain: 0,
  });
  expect(
    sampleCurrentWeather(
      [
        {
          ...point,
          cloudiness: "CLEAR",
          precipitationType: "NO_TYPE",
          precipitationStrength: "ZERO",
        },
      ],
      point.lon,
      point.lat,
    ),
  ).toEqual({ cloud: 0, rain: 0 });
  expect(
    sampleCurrentWeather(
      [{ ...point, precipitationType: "SNOW" }],
      point.lon,
      point.lat,
    ).rain,
  ).toBe(0);
});

it("uses thirteen samples and joins every adjacent wet pair, never across a dry or missing neighbour", () => {
  expect(WEATHER_LOCATIONS).toHaveLength(13);
  const make = (id: string, wet = true): CurrentWeatherPoint => ({
    ...WEATHER_LOCATIONS.find((p) => p.id === id)!,
    cloudiness: "OVERCAST",
    precipitationType: wet ? "RAIN" : "NO_TYPE",
    precipitationStrength: wet ? "STRONG" : "ZERO",
  });
  for (const [aId, bId] of WEATHER_NEIGHBORS) {
    const a = make(aId),
      b = make(bId),
      lon = (a.lon + b.lon) / 2,
      lat = (a.lat + b.lat) / 2;
    expect(
      sampleCurrentWeather([a, b], lon, lat).cloud,
      `${aId} → ${bId}`,
    ).toBeGreaterThan(0.9);
    expect(sampleCurrentWeather([a, make(bId, false)], lon, lat).cloud).toBe(0);
    expect(sampleCurrentWeather([a], lon, lat).cloud).toBe(0);
  }
  expect(
    sampleCurrentWeather(
      [make("nw"), make("n", false), make("ne")],
      37.62,
      55.9,
    ).cloud,
  ).toBe(0);
  expect(
    sampleCurrentWeather(
      WEATHER_LOCATIONS.map((p) => make(p.id, false)),
      37.62,
      55.75,
    ),
  ).toEqual({ cloud: 0, rain: 0 });
});
