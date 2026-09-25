// Repository-only CSV adapter. No protocol or column names are assumed to be official.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
export function parseCsv(text, delimiter = ",") {
  if (![",", ";", "\t"].includes(delimiter))
    throw new Error("Разделитель: запятая, точка с запятой или tab.");
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [],
    cell = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else cell += c;
    } else if (c === '"') {
      if (cell || closed)
        throw new Error("Кавычка внутри неэкранированного поля.");
      quoted = true;
    } else if (c === delimiter || c === "\n" || c === "\r") {
      row.push(cell);
      cell = "";
      closed = false;
      if (c !== delimiter) {
        if (c === "\r" && text[i + 1] === "\n") i++;
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
    } else {
      if (closed) throw new Error("Лишние символы после закрывающей кавычки.");
      cell += c;
    }
  }
  if (quoted) throw new Error("Незакрытая кавычка CSV.");
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const headers = rows.shift()?.map((h) => h.trim());
  if (
    !headers?.length ||
    headers.some((h) => !h) ||
    new Set(headers).size !== headers.length
  )
    throw new Error("Пустые или повторяющиеся заголовки CSV.");
  return {
    headers,
    rows: rows.map((values, i) => {
      if (values.length !== headers.length)
        throw new Error(
          `Строка ${i + 2}: ожидалось ${headers.length} полей, получено ${values.length}.`,
        );
      return Object.fromEntries(headers.map((h, j) => [h, values[j].trim()]));
    }),
  };
}
export function timestamp(value, format = "iso", offset = "+03:00") {
  let ms;
  if (format === "unix_s" || format === "unix_ms") {
    if (!/^-?\d+(\.\d+)?$/.test(value))
      throw new Error(`Некорректный Unix timestamp: ${value}`);
    ms = Number(value) * (format === "unix_s" ? 1000 : 1);
  } else {
    let s = value;
    if (format === "local") {
      if (!/^[+-]\d{2}:\d{2}$/.test(offset))
        throw new Error("Укажите utcOffset, например +03:00.");
      s = s.replace(" ", "T") + offset;
    } else if (format !== "iso")
      throw new Error(`Неизвестный формат времени ${format}`);
    if (
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(s)
    )
      throw new Error(`Нужна дата и время с часовым поясом: ${value}`);
    const day = s.slice(0, 10),
      date = new Date(day + "T00:00:00Z");
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== day
    )
      throw new Error(`Несуществующая дата: ${value}`);
    ms = Date.parse(s);
  }
  if (!Number.isFinite(ms)) throw new Error(`Некорректное время: ${value}`);
  return new Date(ms).toISOString();
}
const required = {
  routes: ["route_id", "route_number", "route_name"],
  stops: ["stop_id", "stop_name", "lat", "lon"],
  schedule: [
    "trip_id",
    "vehicle_id",
    "route_id",
    "stop_id",
    "stop_sequence",
    "arrival_time",
    "departure_time",
  ],
  telemetry: [
    "timestamp",
    "trip_id",
    "vehicle_id",
    "lat",
    "lon",
    "speed",
    "delay",
    "next_stop_id",
  ],
  shapes: ["route_id", "point_sequence", "lat", "lon"],
};
export async function readTables(directory, profile) {
  const tables = {};
  for (const [kind, fields] of Object.entries(required)) {
    const spec = profile.tables?.[kind];
    if (!spec?.file || !spec.columns)
      throw new Error(`Нет настройки таблицы ${kind}.`);
    const parsed = parseCsv(
      await readFile(resolve(directory, spec.file), {
        encoding: profile.encoding || "utf8",
      }),
      spec.delimiter || profile.delimiter || ",",
    );
    for (const field of fields) {
      const column = spec.columns[field];
      if (!column || !parsed.headers.includes(column))
        throw new Error(
          `${kind}: отсутствует столбец для ${field} (${column || "не задан"}).`,
        );
    }
    tables[kind] = parsed.rows.map((row) =>
      Object.fromEntries(fields.map((f) => [f, row[spec.columns[f]]])),
    );
    if (!tables[kind].length) throw new Error(`${kind}: таблица пуста.`);
  }
  return tables;
}
export function normalizeFeed(tables, profile = {}) {
  const units = { speed: "kmh", delay: "seconds", ...profile.units };
  if (
    !["kmh", "mps"].includes(units.speed) ||
    !["seconds", "minutes"].includes(units.delay)
  )
    throw new Error("Неизвестные единицы скорости/задержки.");
  const number = (v, field) => {
    if (v === undefined || String(v).trim() === "")
      throw new Error(`Пустое число: ${field}`);
    const s = String(v).replace(profile.decimal === "," ? "," : /$^/, ".");
    if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s) || !Number.isFinite(Number(s)))
      throw new Error(`Не число ${field}: ${v}`);
    return Number(s);
  };
  const integer = (v, field) => {
    const n = number(v, field);
    if (!Number.isInteger(n) || n < 1)
      throw new Error(`${field}: нужно положительное целое.`);
    return n;
  };
  const position = (r) => {
    const lat = number(r.lat, "lat"),
      lon = number(r.lon, "lon");
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180)
      throw new Error("Координаты вне WGS84.");
    return { lat, lon };
  };
  const id = (v, field) => {
    if (typeof v !== "string" || !v.trim())
      throw new Error(`Пустой идентификатор ${field}`);
    return v;
  };
  const unique = (items, key, kind) => {
    const map = new Map();
    for (const r of items) {
      const k = id(r[key], key);
      if (map.has(k)) throw new Error(`${kind}: повтор ID ${k}`);
      map.set(k, r);
    }
    return map;
  };
  const routes = unique(tables.routes, "route_id", "routes");
  const stops = unique(tables.stops, "stop_id", "stops");
  for (const s of stops.values()) {
    id(s.stop_name, "stop_name");
    position(s);
  }
  const trips = new Map();
  for (const [i, r] of tables.schedule.entries()) {
    if (!routes.has(r.route_id) || !stops.has(r.stop_id))
      throw new Error(
        `schedule, строка ${i + 2}: неизвестный маршрут/остановка.`,
      );
    id(r.trip_id, "trip_id");
    id(r.vehicle_id, "vehicle_id");
    const arrival = timestamp(
        r.arrival_time,
        profile.time?.schedule,
        profile.time?.utcOffset,
      ),
      departure = timestamp(
        r.departure_time,
        profile.time?.schedule,
        profile.time?.utcOffset,
      );
    if (departure < arrival)
      throw new Error(`Рейс ${r.trip_id}: отправление раньше прибытия.`);
    const trip = trips.get(r.trip_id) || {
      id: r.trip_id,
      routeId: r.route_id,
      vehicleId: r.vehicle_id,
      stops: [],
    };
    if (trip.routeId !== r.route_id || trip.vehicleId !== r.vehicle_id)
      throw new Error(`Рейс ${r.trip_id}: меняется маршрут/автобус.`);
    const stop = stops.get(r.stop_id);
    trip.stops.push({
      id: r.stop_id,
      name: stop.stop_name,
      position: position(stop),
      sequence: integer(r.stop_sequence, "stop_sequence"),
      arrival,
      departure,
      dwellSec: (Date.parse(departure) - Date.parse(arrival)) / 1000,
    });
    trips.set(r.trip_id, trip);
  }
  const patterns = new Map();
  for (const trip of trips.values()) {
    trip.stops.sort((a, b) => a.sequence - b.sequence);
    if (
      trip.stops.length < 2 ||
      new Set(trip.stops.map((s) => s.sequence)).size !== trip.stops.length
    )
      throw new Error(
        `Рейс ${trip.id}: нужны минимум 2 остановки с уникальным порядком.`,
      );
    trip.stops.forEach((s, i) => {
      if (i && s.arrival < trip.stops[i - 1].departure)
        throw new Error(`Рейс ${trip.id}: время идёт назад.`);
    });
    const signature = trip.stops.map((s) => s.id).join("|");
    if (patterns.has(trip.routeId) && patterns.get(trip.routeId) !== signature)
      throw new Error(
        `Маршрут ${trip.routeId}: разные направления/варианты остановок. Разделите route_id по направлению.`,
      );
    patterns.set(trip.routeId, signature);
  }
  const geometries = [];
  for (const routeId of routes.keys()) {
    const shape = tables.shapes
      .filter((s) => s.route_id === routeId)
      .map((s) => ({
        ...position(s),
        sequence: integer(s.point_sequence, "point_sequence"),
      }))
      .sort((a, b) => a.sequence - b.sequence);
    if (
      shape.length < 2 ||
      new Set(shape.map((s) => s.sequence)).size !== shape.length
    )
      throw new Error(
        `Маршрут ${routeId}: нужна геометрия с уникальным порядком точек.`,
      );
    if (!patterns.has(routeId))
      throw new Error(`Маршрут ${routeId}: нет расписания.`);
    geometries.push({
      type: "Feature",
      properties: { route_id: routeId },
      geometry: {
        type: "LineString",
        coordinates: shape.map((p) => [p.lon, p.lat]),
      },
    });
  }
  if (tables.shapes.some((s) => !routes.has(s.route_id)))
    throw new Error("shapes: неизвестный маршрут.");
  const seen = new Set();
  const observations = tables.telemetry
    .map((r, i) => {
      const trip = trips.get(r.trip_id);
      if (!trip || trip.vehicleId !== r.vehicle_id)
        throw new Error(
          `telemetry, строка ${i + 2}: неизвестный рейс или несовпадающий автобус.`,
        );
      const stop = trip.stops.find((s) => s.id === r.next_stop_id);
      if (!stop)
        throw new Error(`telemetry, строка ${i + 2}: остановки нет в рейсе.`);
      const time = timestamp(
        r.timestamp,
        profile.time?.telemetry,
        profile.time?.utcOffset,
      );
      const key = r.vehicle_id + "|" + time;
      if (seen.has(key))
        throw new Error(`telemetry: повтор автобуса/времени ${key}`);
      seen.add(key);
      const speed =
        number(r.speed, "speed") * (units.speed === "mps" ? 3.6 : 1);
      if (speed < 0 || speed > 160)
        throw new Error(`telemetry: скорость вне 0–160 км/ч (${speed}).`);
      const delay =
        number(r.delay, "delay") * (units.delay === "minutes" ? 60 : 1);
      return {
        id: r.vehicle_id,
        trip_id: r.trip_id,
        route_id: trip.routeId,
        position: position(r),
        speed_kmh: speed,
        current_delay_sec: delay,
        predicted_delay_sec: delay,
        risk_probability: 0,
        risk_level: "normal",
        bearing_deg: 0,
        status: "active",
        next_stop: stop,
        updated_at: time,
      };
    })
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  return {
    version: 1,
    label: profile.label || "Импорт CSV",
    source: "csv",
    forecast: "persistence",
    start: observations[0].updated_at,
    end: observations.at(-1).updated_at,
    routes: [...routes.values()].map((r) => ({
      id: r.route_id,
      number: id(r.route_number, "route_number"),
      name: id(r.route_name, "route_name"),
      transport_type: "bus",
      current_delay_sec: 0,
      predicted_delay_sec: 0,
      risk_probability: 0,
      risk_level: "normal",
      vehicle_count: 0,
      stops: [...trips.values()].find((t) => t.routeId === r.route_id).stops,
    })),
    trips: [...trips.values()],
    geometries,
    observations,
  };
}
