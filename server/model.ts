import type { VehicleDto } from "../src/shared/api/generated/models";
export function validatePredictions(
  raw: any,
  vehicles: VehicleDto[],
  asOf: string,
) {
  if (
    raw?.asOf !== asOf ||
    typeof raw?.modelVersion !== "string" ||
    !raw.modelVersion ||
    !Array.isArray(raw?.predictions) ||
    raw.predictions.length !== vehicles.length
  )
    throw new Error("Incomplete model response");
  const ids = new Set(vehicles.map((v) => v.id)),
    seen = new Set();
  for (const p of raw.predictions) {
    if (
      !ids.has(p.vehicleId) ||
      seen.has(p.vehicleId) ||
      !Number.isFinite(p.delaySec) ||
      p.delaySec < -3600 ||
      p.delaySec > 86400
    )
      throw new Error("Invalid model prediction");
    seen.add(p.vehicleId);
  }
  return new Map<string, number>(
    raw.predictions.map((p: any) => [p.vehicleId, p.delaySec]),
  );
}
export class ModelProvider {
  status: "baseline" | "connected" | "fallback" = "baseline";
  version = "persistence-v1";
  private cache?: { asOf: string; values: Map<string, number> };
  private pending?: Promise<Map<string, number> | null>;
  private lastAttempt = 0;
  constructor(
    private url = "",
    private key = "",
    private fetcher: typeof fetch = fetch,
  ) {}
  async predict(vehicles: VehicleDto[], asOf: string) {
    if (!this.url) return null;
    if (this.cache?.asOf === asOf) return this.cache.values;
    if (this.pending) {
      await this.pending;
      return this.cache?.asOf === asOf ? this.cache.values : null;
    }
    if (Date.now() - this.lastAttempt < 5000) return null;
    this.lastAttempt = Date.now();
    this.pending = (async () => {
      try {
        const r = await this.fetcher(this.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}),
          },
          body: JSON.stringify({
            schemaVersion: 1,
            asOf,
            horizonSec: 900,
            vehicles,
            externalContext: null,
          }),
          signal: AbortSignal.timeout(2500),
        });
        if (!r.ok) throw new Error("Model error");
        const raw = await r.json(),
          values = validatePredictions(raw, vehicles, asOf);
        this.cache = { asOf, values };
        this.status = "connected";
        this.version = raw.modelVersion;
        return values;
      } catch {
        this.status = "fallback";
        this.version = "persistence-v1";
        return null;
      } finally {
        this.pending = undefined;
      }
    })();
    return this.pending;
  }
}
