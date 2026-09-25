import { describe, expect, it } from "vitest";
import { matchesSearch, normalizeSearch } from "../src/shared/lib/search";
describe("transport search", () => {
  it("ignores quotation style, punctuation, case and ё", () => {
    expect(
      matchesSearch("Метро «Семёновская» — Сокольники", '"семеновская" метро'),
    ).toBe(true);
    expect(normalizeSearch('  «Ёлки»—"Парк" ')).toBe("елки парк");
  });
  it("matches unordered fragments and a single typo without confusing route numbers", () => {
    expect(matchesSearch("Площадь Сокольники", "сокольн площ")).toBe(true);
    expect(matchesSearch("Сокольники", "Сокольнки")).toBe(true);
    expect(matchesSearch("Маршрут 742", "743")).toBe(false);
    expect(matchesSearch("Сокольники", "несуществующая станция")).toBe(false);
  });
});
