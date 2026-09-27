/** Crash only the local official API process and verify Docker's restart policy. */
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

if (process.env.BENCH_ALLOW_DOCKER_MUTATION !== "1")
  throw new Error("Set BENCH_ALLOW_DOCKER_MUTATION=1 for this isolated fault test");
const project = process.env.BENCH_COMPOSE_PROJECT || "transit-hub-official";
const site = new URL(process.env.TRANSIT_SITE_URL || "http://127.0.0.1:8080");
if (!["localhost", "127.0.0.1", "[::1]"].includes(site.hostname))
  throw new Error("This fault test is restricted to a local test deployment");
const output = process.env.BENCH_OUTPUT || "reports/jury-api-restart.json";
const docker = args => execFileSync("docker", args, { encoding: "utf8", timeout: 15000 });
const ids = docker(["ps", "--filter", `label=com.docker.compose.project=${project}`,
  "--filter", "label=com.docker.compose.service=api", "--format", "{{.ID}}"])
  .trim().split(/\s+/).filter(Boolean);
if (ids.length !== 1) throw new Error("Expected exactly one running official API container");
const id = ids[0];
const state = () => {
  const c = JSON.parse(docker(["inspect", id]))[0];
  return { restartCount: c.RestartCount, running: c.State.Running,
    health: c.State.Health?.Status, policy: c.HostConfig.RestartPolicy.Name };
};
const before = state();
if (before.policy !== "unless-stopped" || before.health !== "healthy")
  throw new Error("Expected a healthy API with the configured restart policy");
const started = performance.now();
// Kill the Node application and its launcher inside this one container. This
// models a process crash, unlike `compose stop`, which suppresses auto-restart.
spawnSync("docker", ["exec", "--user", "0", id, "sh", "-c", "kill -9 $(pidof node)"],
  { timeout: 15000, stdio: "ignore" });
let after = before, recoveredAtSec = null;
try {
  while (performance.now() - started < 45000) {
    after = state();
    try {
      const response = await fetch(new URL("/api/v1/forecast", site), { signal: AbortSignal.timeout(3000) });
      if (response.ok && after.health === "healthy" && after.restartCount > before.restartCount) {
        await response.json();
        recoveredAtSec = Math.round((performance.now() - started) / 10) / 100;
        break;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
} finally {
  if (!after.running) docker(["start", id]);
}
const result = { measuredAt: new Date().toISOString(), project, site: site.href, before, after, recoveredAtSec,
  passed: recoveredAtSec !== null };
writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
