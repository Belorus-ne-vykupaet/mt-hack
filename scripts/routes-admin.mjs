#!/usr/bin/env node
// Repository-only administration: never imported by Vite or served from public/.
import { readFile, writeFile, rename, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createRoute, importRelation } from "./lib/bus-catalog.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const networkFile = resolve(root, "admin/data/bus-network.json");
const catalogFile = resolve(root, "src/data/moscow-buses.json");
const [command, ...args] = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? undefined : args[index + 1];
};
async function atomic(file, value) {
  const temp = file + ".tmp";
  await writeFile(temp, JSON.stringify(value) + "\n");
  await rename(temp, file);
}
let ownsLock = false;
const lock = resolve(root, "admin/data/.routes-lock");
try {
  if (!["stops", "add", "import", "validate"].includes(command))
    throw new Error(
      "Команды: stops [--search название], add --number номер --stops id,id [--name название] [--dry-run], import --relation ID [--replace] [--dry-run], validate.",
    );
  const mutates =
    ["add", "import"].includes(command) && !args.includes("--dry-run");
  if (mutates) {
    await mkdir(lock);
    ownsLock = true;
  }
  const network = JSON.parse(await readFile(networkFile, "utf8"));
  const catalog = JSON.parse(await readFile(catalogFile, "utf8"));
  if (command === "stops") {
    const search = (option("search") || "").toLocaleLowerCase("ru");
    const stops = network.stops.filter((s) =>
      `${s.id} ${s.name}`.toLocaleLowerCase("ru").includes(search),
    );
    for (const s of stops) console.log(`${s.id}\t${s.name}`);
    console.log(
      `Найдено: ${stops.length}. Используйте ID остановок в порядке движения; разные платформы имеют разные ID.`,
    );
  } else if (command === "validate") {
    const edges = new Set(network.edges.map((e) => e.join(":"))),
      ids = new Set();
    for (const r of catalog.routes) {
      if (ids.has(r.id)) throw new Error(`Повтор номера ${r.id}`);
      ids.add(r.id);
      for (let i = 1; i < r.nodeIds.length; i++)
        if (!edges.has(`${r.nodeIds[i - 1]}:${r.nodeIds[i]}`))
          throw new Error(
            `Маршрут ${r.id}: участок отсутствует на автобусных дорогах.`,
          );
    }
    console.log(
      `Проверено ${catalog.routes.length} маршрутов. Все участки проходят по импортированным автобусным дорогам.`,
    );
  } else {
    let route;
    if (command === "add")
      route = createRoute(network, {
        number: option("number"),
        name: option("name"),
        stopIds: (option("stops") || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
    else {
      const relationId = Number(option("relation"));
      if (!Number.isSafeInteger(relationId) || relationId <= 0)
        throw new Error("Укажите числовой ID отношения OSM.");
      const response = await fetch(
        `https://api.openstreetmap.org/api/0.6/relation/${relationId}/full.json`,
        {
          signal: AbortSignal.timeout(60000),
          headers: { "User-Agent": "TransitHub route admin" },
        },
      );
      if (!response.ok)
        throw new Error(
          `OSM вернул HTTP ${response.status}. Каталог не изменён.`,
        );
      route = importRelation(network, await response.json(), relationId);
    }
    const existing = catalog.routes.findIndex((r) => r.number === route.number);
    if (existing >= 0 && !args.includes("--replace"))
      throw new Error(
        `Маршрут ${route.number} уже есть. Для намеренной замены добавьте --replace.`,
      );
    if (existing >= 0) catalog.routes[existing] = route;
    else catalog.routes.push(route);
    if (!args.includes("--dry-run")) {
      // An interrupted catalog write leaves only extra graph coverage, never a broken route.
      if (command === "import") await atomic(networkFile, network);
      await atomic(catalogFile, catalog);
    }
    console.log(
      `${args.includes("--dry-run") ? "Проверен без сохранения" : "Сохранён"} маршрут ${route.number}: ${route.name}. Остановок: ${route.stops.length}, длина: ${(route.lengthM / 1000).toFixed(1)} км.`,
    );
    if (!args.includes("--dry-run"))
      console.log(
        "Проверьте git diff, выполните pnpm build и перезапустите preview. В dev каталог обновляется автоматически.",
      );
  }
} catch (error) {
  console.error(
    error.code === "EEXIST"
      ? "Другой администратор уже изменяет каталог."
      : error.message,
  );
  process.exitCode = 1;
} finally {
  if (ownsLock) await rm(lock, { recursive: true });
}
