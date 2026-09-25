export const source = {
  name: "OpenStreetMap contributors",
  license: "ODbL-1.0",
  url: "https://www.openstreetmap.org/copyright",
};
export function distance(a, b) {
  const rad = Math.PI / 180;
  const x = (b[0] - a[0]) * rad * Math.cos(((a[1] + b[1]) * rad) / 2);
  const y = (b[1] - a[1]) * rad;
  return Math.hypot(x, y) * 6371000;
}
export function emptyNetwork() {
  return {
    version: 1,
    source,
    importedAt: new Date().toISOString(),
    nodes: {},
    edges: [],
    stops: [],
  };
}
export function validateNumber(number) {
  if (
    typeof number !== "string" ||
    !number.trim() ||
    number.length > 20 ||
    !/^[\p{L}\p{N}_-]+$/u.test(number)
  )
    throw new Error(
      "Номер маршрута должен содержать 1–20 букв, цифр, дефисов или подчёркиваний.",
    );
  return number.trim();
}
export function routeFromPath(
  network,
  { number, name, nodeIds, stopIds, relationId = null },
) {
  validateNumber(number);
  if (typeof name !== "string" || name.trim().length < 3 || name.length > 180)
    throw new Error("Укажите название маршрута (3–180 символов).");
  if (nodeIds.length < 2)
    throw new Error("Маршрут должен содержать хотя бы один участок пути.");
  const coordinates = nodeIds.map((id) => network.nodes[id]);
  if (
    coordinates.some((p) => !p || p.length !== 2 || !p.every(Number.isFinite))
  )
    throw new Error("В маршруте отсутствуют координаты узла.");
  const cumulative = [0];
  for (let i = 1; i < coordinates.length; i++)
    cumulative.push(
      cumulative[i - 1] + distance(coordinates[i - 1], coordinates[i]),
    );
  let cursor = 0;
  const stops = stopIds.map((id, i) => {
    const stop = network.stops.find((s) => s.id === String(id));
    if (!stop) throw new Error(`Неизвестная остановка ${id}`);
    const index = nodeIds.indexOf(String(stop.nodeId), cursor);
    if (index < 0)
      throw new Error(
        `Остановка «${stop.name}» не лежит на пути в указанном порядке.`,
      );
    cursor = index;
    return {
      id: stop.id,
      name: stop.name,
      position: stop.position,
      sequence: i + 1,
      distanceM: Math.round(cumulative[index]),
    };
  });
  if (stops.length < 2) throw new Error("Нужны как минимум две остановки.");
  return {
    id: number,
    number,
    name: name.trim(),
    transportType: "bus",
    relationId,
    source: relationId
      ? `https://www.openstreetmap.org/relation/${relationId}`
      : source.url,
    coordinates,
    nodeIds,
    stops,
    lengthM: Math.round(cumulative.at(-1)),
    vehicleCount: 8,
  };
}
export function importRelation(network, document, relationId) {
  const elements = new Map(
    document.elements.map((e) => [`${e.type}/${e.id}`, e]),
  );
  const relation = elements.get(`relation/${relationId}`);
  if (relation?.tags?.route !== "bus")
    throw new Error("Отношение OSM должно быть автобусным маршрутом.");
  const ways = relation.members
    .filter(
      (m) => m.type === "way" && ["", "forward", "backward"].includes(m.role),
    )
    .map((m) => elements.get(`way/${m.ref}`));
  if (!ways.length || ways.some((w) => !w?.tags?.highway))
    throw new Error("Маршрут должен проходить по доступным автобусным дорогам.");
  let path = [];
  for (let i = 0; i < ways.length; i++) {
    let ids = ways[i].nodes.map(String);
    if (!path.length) {
      const next = ways[i + 1]?.nodes.map(String);
      if (next && (ids[0] === next[0] || ids[0] === next.at(-1))) ids.reverse();
      path.push(...ids);
    } else if (path.at(-1) === ids[0]) path.push(...ids.slice(1));
    else if (path.at(-1) === ids.at(-1)) path.push(...ids.reverse().slice(1));
    else
      throw new Error(
        `Разрыв пути перед OSM way ${ways[i].id}. Исправьте данные; прямой соединительный отрезок не создаётся.`,
      );
  }
  const stops = relation.members
    .filter((m) => m.type === "node" && m.role.startsWith("stop"))
    .map((m) => elements.get(`node/${m.ref}`));
  if (stops.length < 2 || stops.some((s) => !s))
    throw new Error("В отношении отсутствуют остановки stop_position.");
  for (const id of path) {
    const n = elements.get(`node/${id}`);
    if (!n) throw new Error(`Отсутствует OSM node ${id}`);
    network.nodes[id] = [n.lon, n.lat];
  }
  const edges = new Set(network.edges.map((e) => e.join(":")));
  for (let i = 1; i < path.length; i++) {
    const pair = [path[i - 1], path[i]];
    if (!edges.has(pair.join(":"))) {
      network.edges.push(pair);
      edges.add(pair.join(":"));
    }
  }
  for (const n of stops) {
    const stop = {
      id: String(n.id),
      nodeId: String(n.id),
      name: n.tags?.name || `Остановка ${n.id}`,
      position: { lon: n.lon, lat: n.lat },
    };
    const index = network.stops.findIndex((s) => s.id === stop.id);
    if (index < 0) network.stops.push(stop);
    else network.stops[index] = stop;
  }
  // The relation gives an ordered, connected shape; trim layover tails beyond stops.
  const start = path.indexOf(String(stops[0].id));
  const end = path.lastIndexOf(String(stops.at(-1).id));
  if (start < 0 || end <= start)
    throw new Error("Конечные остановки не расположены на связном пути.");
  return routeFromPath(network, {
    number: relation.tags.ref,
    name: `${stops[0].tags?.name || relation.tags.from} — ${stops.at(-1).tags?.name || relation.tags.to}`,
    nodeIds: path.slice(start, end + 1),
    stopIds: stops.map((s) => String(s.id)),
    relationId,
  });
}
export function shortestPath(network, start, end) {
  if (start === end) return [start];
  const neighbors = new Map();
  for (const [a, b] of network.edges) {
    if (!neighbors.has(a)) neighbors.set(a, []);
    neighbors.get(a).push(b);
  }
  const best = new Map([[start, 0]]),
    previous = new Map(),
    open = new Set([start]);
  while (open.size) {
    let current = null,
      min = Infinity;
    for (const id of open) {
      const d = best.get(id);
      if (d < min) {
        current = id;
        min = d;
      }
    }
    if (current === end) {
      const result = [end];
      while (result[0] !== start) result.unshift(previous.get(result[0]));
      return result;
    }
    open.delete(current);
    for (const next of neighbors.get(current) || []) {
      const d = min + distance(network.nodes[current], network.nodes[next]);
      if (d < (best.get(next) ?? Infinity)) {
        best.set(next, d);
        previous.set(next, current);
        open.add(next);
      }
    }
  }
  throw new Error(
    `Нет связного пути от остановки ${start} до ${end} в выбранном направлении. Импортируйте недостающий маршрут или выберите другие остановки.`,
  );
}
export function createRoute(network, { number, name, stopIds }) {
  validateNumber(number);
  if (!Array.isArray(stopIds) || stopIds.length < 2)
    throw new Error("Укажите минимум две остановки в порядке движения.");
  if (new Set(stopIds).size !== stopIds.length)
    throw new Error("Остановки не должны повторяться.");
  const stops = stopIds.map((id) => {
    const s = network.stops.find((s) => s.id === String(id));
    if (!s)
      throw new Error(`Неизвестная остановка ${id}. Выполните routes:stops.`);
    return s;
  });
  let nodeIds = [];
  for (let i = 1; i < stops.length; i++) {
    const part = shortestPath(network, stops[i - 1].nodeId, stops[i].nodeId);
    nodeIds.push(...(i === 1 ? part : part.slice(1)));
  }
  if (new Set(nodeIds).size !== nodeIds.length)
    throw new Error(
      "Выбранный порядок остановок приводит к петле или развороту. Уточните промежуточные остановки.",
    );
  return routeFromPath(network, {
    number,
    name: name || `${stops[0].name} — ${stops.at(-1).name}`,
    nodeIds,
    stopIds,
  });
}
