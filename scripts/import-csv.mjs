import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { readTables, normalizeFeed } from "./lib/csv-feed.mjs";
const args = process.argv.slice(2),
  arg = (name, fallback) =>
    args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
try {
  const directory = resolve(arg("--dir", "admin/csv/example"));
  const profile = JSON.parse(
    await readFile(
      resolve(arg("--profile", "admin/csv/profiles/default.json")),
      "utf8",
    ),
  );
  const feed = normalizeFeed(await readTables(directory, profile), profile);
  console.log(
    `${feed.label}: ${feed.routes.length} маршрутов, ${feed.trips.length} рейсов, ${feed.observations.length} сообщений; ${feed.start} — ${feed.end}.`,
  );
  if (args.includes("--check"))
    console.log("Проверка успешна. Файлы не изменены.");
  else {
    const out = resolve(arg("--out", "src/data/imported-feed.json"));
    await mkdir(dirname(out), { recursive: true });
    const temp = out + `.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(feed) + "\n");
    await rename(temp, out);
    console.log(
      "Импорт сохранён. Для просмотра: VITE_MOCK_SCENARIO=csv pnpm dev (или pnpm build для preview).",
    );
  }
} catch (e) {
  console.error(`Импорт отклонён: ${e.message}`);
  process.exitCode = 1;
}
