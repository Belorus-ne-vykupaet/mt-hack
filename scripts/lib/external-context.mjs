// Provider-neutral, time-safe join for optional external features.
// availableAt is when the collector actually received the record, not its valid time.
export function contextAt(records, { routeId, issuedAt, targetAt }) {
  const issued = Date.parse(issuedAt),
    target = Date.parse(targetAt);
  if (!Number.isFinite(issued) || !Number.isFinite(target) || target < issued)
    throw new Error("Invalid prediction times");
  const eligible = records
    .filter((r) => {
      const [available, from, to, expires] = [
        r.availableAt,
        r.validFrom,
        r.validTo,
        r.expiresAt,
      ].map(Date.parse);
      return (
        [available, from, to, expires].every(Number.isFinite) &&
        (r.routeId === routeId || r.routeId === "*") &&
        available <= issued &&
        expires >= issued &&
        from <= target &&
        target <= to
      );
    })
    .sort((a, b) => Date.parse(b.availableAt) - Date.parse(a.availableAt));
  const weather = eligible.find((r) => r.kind === "weather"),
    traffic = eligible.find((r) => r.kind === "traffic");
  return {
    precipitationMm: weather?.values.precipitationMm ?? null,
    temperatureC: weather?.values.temperatureC ?? null,
    trafficTravelTimeRatio: traffic?.values.travelTimeRatio ?? null,
    weatherMissing: !weather,
    trafficMissing: !traffic,
    weatherSource: weather?.source ?? null,
    trafficSource: traffic?.source ?? null,
  };
}
