import type { csvSnapshot } from "../src/mocks/csv-scenario";
import type {
  RouteGeometryDto,
  RouteDto,
  VehicleDto,
} from "../src/shared/api/generated/models";
export type OfficialSnapshot = Omit<ReturnType<typeof csvSnapshot>, "vehicles" | "routes"> & {
  vehicles: VehicleDto[];
  routes: RouteDto[];
  geometries: RouteGeometryDto[];
};
export class OfficialSource {
  private cached?: OfficialSnapshot;
  private cachedAt = 0;
  private pending?: Promise<OfficialSnapshot>;
  private nextRetryAt = 0;
  private failures = 0;
  private upstreamRequests = 0;
  stale = false;
  constructor(
    readonly url: string,
    readonly routes: RouteDto[],
  ) {}
  async read<T>(path: string): Promise<T> {
    const response = await fetch(`${this.url}${path}`, {
      signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) throw new Error(`Official backend: ${response.status}`);
    return response.json() as Promise<T>;
  }
  private refresh(): Promise<OfficialSnapshot> {
    if (!this.pending) {
      this.upstreamRequests += 1;
      this.pending = this.read<OfficialSnapshot>("/snapshot")
        .then((s) => {
          if (
            !Array.isArray(s.vehicles) ||
            !Array.isArray(s.routes) ||
            !Array.isArray(s.alerts) ||
            !Array.isArray(s.segments) ||
            !Array.isArray(s.points) ||
            !Array.isArray(s.geometries) ||
            !s.summary?.timestamp
          )
            throw new Error("Invalid official snapshot");
          this.cached = s;
          this.cachedAt = Date.now();
          this.stale = false;
          this.failures = 0;
          this.nextRetryAt = 0;
          return s;
        })
        .catch((error) => {
          this.stale = true;
          this.failures += 1;
          this.nextRetryAt = Date.now() + Math.min(
            15000,
            1000 * 2 ** Math.min(this.failures - 1, 4),
          );
          throw error;
        })
        .finally(() => {
          this.pending = undefined;
        });
    }
    return this.pending;
  }
  async snapshot(): Promise<OfficialSnapshot> {
    const now = Date.now();
    if (this.cached) {
      // Keep REST and WebSocket responsive while refreshing a large snapshot.
      // The previous timestamp is preserved, so stale data cannot masquerade as new.
      if (now - this.cachedAt >= 1000 && now >= this.nextRetryAt && !this.pending)
        void this.refresh().catch(() => undefined);
      return structuredClone(this.cached);
    }
    if (now < this.nextRetryAt)
      throw new Error("Official backend retry cooldown");
    return structuredClone(await this.refresh());
  }
  diagnostics() {
    return {
      stale: this.stale,
      upstreamRequests: this.upstreamRequests,
      consecutiveFailures: this.failures,
      cacheAgeMs: this.cached ? Math.max(0, Date.now() - this.cachedAt) : null,
      retryInMs: Math.max(0, this.nextRetryAt - Date.now()),
    };
  }
}
