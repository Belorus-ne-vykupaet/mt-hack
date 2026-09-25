import type { csvSnapshot } from "../src/mocks/csv-scenario";
import type {
  RouteGeometryDto,
  RouteDto,
} from "../src/shared/api/generated/models";
export type OfficialSnapshot = ReturnType<typeof csvSnapshot> & {
  geometries: RouteGeometryDto[];
};
export class OfficialSource {
  private cached?: OfficialSnapshot;
  private cachedAt = 0;
  private pending?: Promise<OfficialSnapshot>;
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
  async snapshot(): Promise<OfficialSnapshot> {
    if (this.cached && Date.now() - this.cachedAt < 1000)
      return structuredClone(this.cached);
    if (!this.pending) {
      this.pending = this.read<OfficialSnapshot>("/snapshot")
        .then((s) => {
          if (
            !Array.isArray(s.vehicles) ||
            !Array.isArray(s.routes) ||
            !s.summary?.timestamp
          )
            throw new Error("Invalid official snapshot");
          this.cached = s;
          this.cachedAt = Date.now();
          this.stale = false;
          return s;
        })
        .catch((error) => {
          this.stale = true;
          if (this.cached) return this.cached;
          throw error;
        })
        .finally(() => {
          this.pending = undefined;
        });
    }
    return structuredClone(await this.pending);
  }
}
