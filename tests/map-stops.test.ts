import { expect, it } from "vitest";
import { uniquePhysicalStops } from "../src/entities/map-stops";
import type { Stop } from "../src/entities/models";

const stop = (id: string, lon: number, lat: number): Stop => ({
  id,
  name: id,
  sequence: 0,
  position: { lon, lat },
});

it("draws one marker per physical stop despite repeated schedule trips", () => {
  const stops = Array.from({ length: 664 }, (_, index) =>
    stop(String(index), 37.4 + (index % 81) * 0.001, 55.7),
  );
  const markers = uniquePhysicalStops(stops, null);
  expect(markers).toHaveLength(81);
  expect(new Set(markers.map((item) => item.id)).size).toBe(81);
});

it("keeps the selected arrival clickable without merging opposite platforms", () => {
  const markers = uniquePhysicalStops([
    stop("first", 37.4, 55.7),
    stop("opposite", 37.4003, 55.7),
    stop("selected-arrival", 37.4000001, 55.7000001),
  ], "selected-arrival");
  expect(markers.map((item) => item.id)).toEqual(["selected-arrival", "opposite"]);
});
