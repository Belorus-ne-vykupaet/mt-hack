/* eslint-disable react/set-state-in-effect -- Synchronizes state with the external MapLibre lifecycle, including initialization failures. */
import { WeatherControl } from "./weather/WeatherControl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Map as LibreMap, AttributionControl } from "maplibre-gl";
import type { Layer, PickingInfo } from "@deck.gl/core";
import { MapLibreOverlay } from "@deck.gl/maplibre";
import {
  PathLayer,
  ScatterplotLayer,
  TextLayer,
  IconLayer,
  ColumnLayer,
} from "@deck.gl/layers";
import { ScenegraphLayer } from "@deck.gl/mesh-layers";
import { AmbientLight, DirectionalLight, LightingEffect } from "@deck.gl/core";
import { buildStopColumns, columnTooltip } from "../entities/map-columns";
import type { RiskColumn } from "../entities/map-columns";
import {
  prepareRoutePaths,
  anchorVehicles,
  projectVehicle,
} from "../entities/vehicle-motion";
import type { ProjectedVehicle } from "../entities/vehicle-motion";
import { useAnimatedHorizon } from "./useAnimatedHorizon";
import { delayAt, riskAt } from "../entities/forecast";
import {
  Layers,
  Crosshair,
  Plus,
  Minus,
  MapPin,
  TriangleAlert,
  RotateCcw,
  Box,
} from "lucide-react";
import type { Route, Vehicle, Geometry, Segment } from "../entities/models";
import { useUi } from "../app/store";
import { useTheme } from "../app/theme";
import { config } from "../shared/config/env";
import { routeRgb } from "../shared/ui/route-colors";
import { riskRgb, minutes, horizonLabel } from "../shared/ui/format";
import "maplibre-gl/dist/maplibre-gl.css";

const MOSCOW: [number, number] = [37.68, 55.76];
export default function NetworkMap({
  mode,
  routes,
  vehicles,
  geometries,
  segments,
}: {
  mode: "overview" | "flow";
  routes: Route[];
  vehicles: Vehicle[];
  geometries: Geometry[];
  segments: Segment[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<LibreMap | undefined>(undefined);
  const overlay = useRef<MapLibreOverlay | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [weatherMap, setWeatherMap] = useState<LibreMap | null>(null);
  const [failed, setFailed] = useState(false);
  const [busReady, setBusReady] = useState(false);
  const [busFailed, setBusFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [orientation, setOrientation] = useState({ bearing: 0, pitch: 0 });
  const [zoom, setZoom] = useState(11.6);
  const [columnsVisible, setColumnsVisible] = useState(true);
  const [generation, setGeneration] = useState(0);
  const ui = useUi();
  const { theme } = useTheme();
  const lastFocus = useRef(-1);
  const camera = useRef<{
    center: [number, number];
    zoom: number;
    bearing: number;
    pitch: number;
  } | null>(null);
  const dark = theme === "dark";
  const styleUrl = dark ? config.darkMapStyleUrl : config.mapStyleUrl;
  const reducedMotion = globalThis.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const duration = config.visualTest || reducedMotion ? 0 : 800;
  const animatedHorizon = useAnimatedHorizon(
    ui.forecastOffsetMin,
    !!reducedMotion || config.visualTest,
  );
  const paths = useMemo(() => prepareRoutePaths(geometries), [geometries]);
  const anchors = useMemo(
    () => anchorVehicles(vehicles, paths),
    [vehicles, paths],
  );
  const displayedVehicles = useMemo(
    () => anchors.map((a) => projectVehicle(a, animatedHorizon)),
    [anchors, animatedHorizon],
  );
  const selectedDisplayVehicle = displayedVehicles.find(
    (v) => v.id === ui.selectedVehicleId,
  );

  useEffect(() => {
    if (!host.current) return;
    // The external WebGL instance is being replaced; invalidate its readiness.
    // eslint-disable-next-line react/set-state-in-effect
    setReady(false);
    setWeatherMap(null);
    setBusReady(false);
    // eslint-disable-next-line react/set-state-in-effect
    setLoading(true);
    // eslint-disable-next-line react/set-state-in-effect
    setFailed(false);
    lastFocus.current = -1;
    let m: LibreMap;
    let disposed = false;
    let releaseDeckCanvas: (() => void) | undefined;
    try {
      m = new LibreMap({
        container: host.current,
        style: styleUrl,
        center: camera.current?.center || MOSCOW,
        zoom: camera.current?.zoom || 10.3,
        pitch: camera.current?.pitch || 0,
        bearing: camera.current?.bearing || 0,
        maxPitch: 75,
        pitchWithRotate: true,
        bearingSnap: 7,
        attributionControl: false,
      });
    } catch {
      setFailed(true);
      setLoading(false);
      return;
    }
    map.current = m;
    m.addControl(new AttributionControl({ compact: true }), "bottom-right");
    m.on("style.load", () => {
      setLoading(false);
      setFailed(false);
      // Retain the provider's geometry and attribution, with readable Russian labels.
      for (const layer of m.getStyle().layers) {
        if (
          layer.type === "symbol" &&
          layer.layout?.["text-field"] &&
          /place|water_name|road_label/.test(layer.id)
        ) {
          m.setLayoutProperty(layer.id, "text-field", [
            "coalesce",
            ["get", "name:ru"],
            ["get", "name:nonlatin"],
            ["get", "name"],
          ]);
          if (dark) {
            m.setPaintProperty(layer.id, "text-color", "#8b9eb5");
            m.setPaintProperty(layer.id, "text-halo-color", "#0c1724");
          }
        }
        if (!dark) continue;
        if (layer.type === "background")
          m.setPaintProperty(layer.id, "background-color", "#0c1724");
        if (layer.type === "fill") {
          const color =
            layer.id === "water"
              ? "#143047"
              : /park|wood/.test(layer.id)
                ? "#102b2c"
                : layer.id === "building"
                  ? "#17263a"
                  : "#101d2c";
          m.setPaintProperty(layer.id, "fill-color", color);
          if (layer.id === "building")
            m.setPaintProperty(layer.id, "fill-outline-color", "#23354a");
        }
        if (layer.type === "line")
          m.setPaintProperty(
            layer.id,
            "line-color",
            layer.id.includes("water")
              ? "#143047"
              : /casing|boundary/.test(layer.id)
                ? "#34475e"
                : "#1c2e43",
          );
      }

      if (m.getSource("openmaptiles") && !m.getLayer("transit-buildings"))
        m.addLayer({
          id: "transit-buildings",
          type: "fill-extrusion",
          source: "openmaptiles",
          "source-layer": "building",
          minzoom: 12,
          layout: { visibility: "none" },
          paint: {
            "fill-extrusion-color": dark ? "#26364c" : "#c9d6e5",
            "fill-extrusion-height": [
              "coalesce",
              ["get", "render_height"],
              ["get", "height"],
              8,
            ],
            "fill-extrusion-base": [
              "coalesce",
              ["get", "render_min_height"],
              0,
            ],
            "fill-extrusion-opacity": 0.75,
          },
        });
      if (!overlay.current) {
        overlay.current = new MapLibreOverlay({
          interleaved: true,
          onDeviceInitialized: (device) => {
            // deck.finalize() leaves the shared luma canvas observer alive.
            // This canvas belongs exclusively to this MapLibre instance.
            const release = () => device.canvasContext?.destroy();
            if (disposed) release();
            else releaseDeckCanvas = release;
          },
          effects: [
            new LightingEffect({
              ambientLight: new AmbientLight({
                color: [255, 255, 255],
                intensity: 1.8,
              }),
              sun: new DirectionalLight({
                color: [255, 248, 235],
                intensity: 2,
                direction: [-2, -3, -5],
              }),
            }),
          ],
          layers: [],
          getTooltip: ({ object }: PickingInfo) => {
            if (!object) return null;
            let text = "";
            if ("speedKmh" in object) {
              const v = object as ProjectedVehicle;
              text = `ТС ${v.id.replace("vehicle-", "")} · маршрут ${v.routeId}\nСкорость ${Math.round(v.speedKmh)} км/ч\nСейчас ${minutes(v.currentDelaySec)} мин\nЧерез 15 мин ${minutes(v.predictedDelaySec)} мин${v.forecastMinutes > 0 ? `\n${horizonLabel(v.forecastMinutes)} · расчётное положение по скорости и задержке` : ""}`;
            } else if ("delay" in object) {
              const c = object as RiskColumn;
              const horizon = useUi.getState().forecastOffsetMin;
              text = columnTooltip(c, horizon);
            } else if ("name" in object && "sequence" in object) {
              text = `Остановка «${String(object.name)}»`;
            } else if ("coordinates" in object && "currentDelaySec" in object) {
              const segment = object as Segment;
              text = `Маршрут ${segment.routeId} · отдельный участок\n${horizonLabel(useUi.getState().forecastOffsetMin)}: ${minutes(delayAt(segment, useUi.getState().forecastOffsetMin))} мин\nОстальные участки оцениваются независимо`;
            }
            return text
              ? {
                  text,
                  style: {
                    backgroundColor: dark ? "#132036" : "#ffffff",
                    color: dark ? "#e7edf7" : "#1b2c45",
                    fontSize: "12px",
                    padding: "14px",
                    border: "1px solid " + (dark ? "#2c3b51" : "#dce5ef"),
                    borderRadius: "8px",
                    lineHeight: "1.8",
                    maxWidth: "280px",
                  },
                }
              : null;
          },
        });
        m.addControl(overlay.current);
      }
      setReady(true);
      setWeatherMap(m);
    });
    m.on("zoomend", () => setZoom(m.getZoom()));
    m.on("moveend", () =>
      setOrientation({ bearing: m.getBearing(), pitch: m.getPitch() }),
    );
    m.on("error", () => {
      setFailed(true);
      setLoading(false);
    });
    m.on("idle", () => {
      if (m.isStyleLoaded() && m.areTilesLoaded()) setFailed(false);
    });
    const timeout = setTimeout(() => {
      if (!m.isStyleLoaded()) {
        setFailed(true);
        setLoading(false);
      }
    }, 30000);
    const resize = new ResizeObserver(() => m.resize());
    resize.observe(host.current);
    return () => {
      disposed = true;
      camera.current = {
        center: m.getCenter().toArray() as [number, number],
        zoom: m.getZoom(),
        pitch: m.getPitch(),
        bearing: m.getBearing(),
      };
      clearTimeout(timeout);
      resize.disconnect();
      // Release the shared-context weather renderer before MapLibre destroys GL.
      if (m.getLayer("transit-weather")) m.removeLayer("transit-weather");
      overlay.current?.finalize();
      releaseDeckCanvas?.();
      releaseDeckCanvas = undefined;
      m.remove();
      map.current = undefined;
      overlay.current = undefined;
    };
  }, [styleUrl, dark, generation]);

  useEffect(() => {
    if (!ready || !map.current) return;
    if (mode === "flow") {
      map.current.dragRotate.enable();
      map.current.touchZoomRotate.enableRotation();
      map.current.touchPitch.enable();
    } else {
      map.current.dragRotate.disable();
      map.current.touchZoomRotate.disableRotation();
      map.current.touchPitch.disable();
    }
    // Interrupt the previous transition and always target a complete view.
    map.current.stop();
    map.current.easeTo({
      pitch: mode === "flow" ? 52 : 0,
      bearing: mode === "flow" ? map.current.getBearing() : 0,
      duration,
    });
    if (map.current.getLayer("transit-buildings"))
      map.current.setLayoutProperty(
        "transit-buildings",
        "visibility",
        mode === "flow" ? "visible" : "none",
      );
  }, [mode, ready, duration]);

  useEffect(() => {
    if (!ready || !ui.selectedRouteId || lastFocus.current === ui.focusVersion)
      return;
    const geometry = geometries.find((g) => g.routeId === ui.selectedRouteId);
    const v = displayedVehicles.find((v) => v.id === ui.selectedVehicleId);
    const stop = routes
      .find((r) => r.id === ui.selectedRouteId)
      ?.stops.find((s) => s.id === ui.selectedStopId);
    if (v || stop) {
      lastFocus.current = ui.focusVersion;
      const p = (v || stop)!.position;
      map.current?.flyTo({
        center: [p.lon, p.lat],
        zoom: 14,
        pitch: mode === "flow" ? 52 : 0,
        duration,
      });
    } else if (geometry?.coordinates.length) {
      lastFocus.current = ui.focusVersion;
      const p = geometry.coordinates;
      map.current?.fitBounds(
        [
          [Math.min(...p.map((c) => c[0])), Math.min(...p.map((c) => c[1]))],
          [Math.max(...p.map((c) => c[0])), Math.max(...p.map((c) => c[1]))],
        ],
        { padding: 60, maxZoom: 13, duration },
      );
    }
  }, [
    ui.focusVersion,
    ready,
    ui.selectedRouteId,
    ui.selectedVehicleId,
    ui.selectedStopId,
    geometries,
    displayedVehicles,
    routes,
    mode,
    duration,
  ]);

  const data = useMemo(
    () =>
      geometries
        .map((g) => ({ ...g, route: routes.find((r) => r.id === g.routeId) }))
        .filter(
          (g): g is Geometry & { route: Route } =>
            !!g.route && g.coordinates.length > 1,
        ),
    [geometries, routes],
  );
  const initialFit = useRef(false);
  const fitNetwork = useCallback(() => {
    const points = [
      ...geometries.flatMap((g) => g.coordinates),
      ...vehicles.map((v) => [v.position.lon, v.position.lat]),
    ];
    if (!points.length) return;
    map.current?.fitBounds(
      [
        [
          Math.min(...points.map((p) => p[0])),
          Math.min(...points.map((p) => p[1])),
        ],
        [
          Math.max(...points.map((p) => p[0])),
          Math.max(...points.map((p) => p[1])),
        ],
      ],
      { padding: 55, maxZoom: 12, duration, pitch: mode === "flow" ? 52 : 0 },
    );
  }, [geometries, vehicles, duration, mode]);
  useEffect(() => {
    if (ready && data.length && !initialFit.current) {
      initialFit.current = true;
      if (!ui.selectedRouteId && (!camera.current || config.officialMode))
        fitNetwork();
    }
  }, [ready, data, ui.selectedRouteId, fitNetwork]);
  const columns = useMemo(
    () => buildStopColumns(segments, routes, ui.forecastOffsetMin, vehicles),
    [segments, routes, vehicles, ui.forecastOffsetMin],
  );
  useEffect(() => {
    if (!ready || !overlay.current) return;
    const selected = ui.selectedRouteId;
    const color = (
      id: string,
      risk: Route["riskLevel"],
    ): [number, number, number, number] => [
      ...riskRgb[risk],
      selected && id !== selected ? 35 : 225,
    ];
    const layers: Layer[] = [
      new PathLayer({
        id: "route-selection",
        data: ui.routesVisible
          ? data.filter((d) => d.routeId === selected)
          : [],
        getPath: (d) => d.coordinates,
        getColor: [60, 170, 235, 95],
        getWidth: 13,
        widthUnits: "pixels",
      }),
      new PathLayer({
        id: "routes",
        data: ui.routesVisible ? data : [],
        getPath: (d) => d.coordinates,
        getColor: (d) =>
          [122, 142, 165, selected && d.routeId !== selected ? 25 : 65] as [
            number,
            number,
            number,
            number,
          ],
        getWidth: (d) => (d.routeId === selected ? 4 : 1.7),
        widthUnits: "pixels",
        pickable: true,
        onClick: ({ object }) => {
          if (object) ui.selectRoute(object.routeId);
        },
      }),
      new PathLayer<Segment>({
        id: "risk-segments",
        data: ui.routesVisible
          ? [...segments].sort(
              (a, b) =>
                Number(a.routeId === selected) -
                  Number(b.routeId === selected) ||
                a.riskProbability - b.riskProbability,
            )
          : [],
        getPath: (d) => d.coordinates as [number, number][],
        getColor: (d) => color(d.routeId, riskAt(d, ui.forecastOffsetMin)),
        getWidth: (d) =>
          d.routeId === selected
            ? 5
            : riskAt(d, ui.forecastOffsetMin) === "normal"
              ? 2
              : 3.5,
        widthUnits: "pixels",
        pickable: true,
        onClick: ({ object }) => {
          if (object) ui.selectRoute(object.routeId);
        },
      }),
      new ScatterplotLayer<ProjectedVehicle>({
        id: "vehicle-risk-halos",
        billboard: mode !== "flow",
        data: ui.vehiclesVisible
          ? displayedVehicles.filter(
              (v) =>
                mode === "flow" || riskAt(v, ui.forecastOffsetMin) !== "normal",
            )
          : [],
        getPosition: (d) => [d.position.lon, d.position.lat, 8],
        getRadius: zoom < 11 ? 12 : 18,
        radiusUnits: "pixels",
        getFillColor: (d) => [
          ...(mode === "flow"
            ? routeRgb(d.routeId)
            : riskRgb[riskAt(d, ui.forecastOffsetMin)]),
          selected && d.routeId !== selected ? 30 : mode === "flow" ? 85 : 55,
        ],
        getLineColor: (d) => [
          ...(mode === "flow"
            ? routeRgb(d.routeId)
            : riskRgb[riskAt(d, ui.forecastOffsetMin)]),
          selected && d.routeId !== selected ? 130 : 255,
        ],
        updateTriggers: {
          getFillColor: [mode, selected, ui.forecastOffsetMin],
          getLineColor: [mode, selected, ui.forecastOffsetMin],
        },
        stroked: true,
        lineWidthMinPixels: 1.5,
        pickable: true,
        onClick: ({ object }) => {
          if (object) ui.selectVehicle(object.id, object.routeId);
        },
      }),
      new ScatterplotLayer<ProjectedVehicle>({
        id: "vehicles",
        billboard: true,
        data:
          ui.vehiclesVisible && (mode !== "flow" || busFailed)
            ? displayedVehicles
            : [],
        getPosition: (d) => [d.position.lon, d.position.lat, 9],
        getFillColor: (d) => [
          ...riskRgb[riskAt(d, ui.forecastOffsetMin)],
          selected && d.routeId !== selected ? 155 : 255,
        ],
        getLineColor: dark ? [10, 16, 27, 255] : [255, 255, 255, 255],
        lineWidthMinPixels: 2,
        stroked: true,
        getRadius: (d) =>
          d.id === ui.selectedVehicleId ? 16 : zoom < 11 ? 8 : 12,
        radiusUnits: "pixels",
        updateTriggers: {
          getFillColor: [ui.forecastOffsetMin, selected],
          getRadius: [ui.selectedVehicleId, zoom],
        },
        pickable: true,
        onClick: ({ object }) => {
          if (object) ui.selectVehicle(object.id, object.routeId);
        },
      }),
      new IconLayer<ProjectedVehicle>({
        id: "vehicle-icons",
        parameters: { depthCompare: "always", depthWriteEnabled: false },
        data:
          ui.vehiclesVisible && (mode !== "flow" || busFailed)
            ? displayedVehicles
            : [],
        iconAtlas: "/bus-icon.svg",
        iconMapping: {
          bus: { x: 0, y: 0, width: 32, height: 32, mask: true },
        },
        getIcon: () => "bus",
        getPosition: (d) => [d.position.lon, d.position.lat, 10],
        getSize: (d) =>
          d.id === ui.selectedVehicleId ? 28 : zoom < 11 ? 15 : 23,
        getColor: (d) => [
          255,
          255,
          255,
          selected && d.routeId !== selected ? 190 : 255,
        ],
        billboard: true,
        updateTriggers: {
          getColor: [selected],
          getSize: [ui.selectedVehicleId, zoom],
        },
        pickable: true,
        onClick: ({ object }) => {
          if (object) ui.selectVehicle(object.id, object.routeId);
        },
      }),
      new ScatterplotLayer({
        id: "stops",
        data: ui.routesVisible
          ? (routes.find((r) => r.id === selected)?.stops || []).filter(
              (s, i, all) =>
                zoom >= 13 ||
                s.id === ui.selectedStopId ||
                i === 0 ||
                i === all.length - 1 ||
                i % 5 === 0,
            )
          : [],
        getPosition: (d) => [d.position.lon, d.position.lat],
        getRadius: (d) => (d.id === ui.selectedStopId ? 6 : 3),
        radiusUnits: "pixels",
        getFillColor: dark ? [20, 35, 54] : [255, 255, 255],
        getLineColor: [78, 182, 244],
        lineWidthMinPixels: 1.2,
        stroked: true,
        pickable: true,
        onClick: ({ object }) => {
          if (object && selected) ui.selectStop(object.id, selected);
        },
      }),
      new TextLayer({
        id: "route-labels",
        updateTriggers: { getText: [ui.forecastOffsetMin] },
        characterSet: "auto",
        data: ui.routesVisible && mode === "overview" ? data.slice(0, 5) : [],
        getPosition: (d) => d.coordinates[Math.floor(d.coordinates.length / 2)],
        getText: (d) =>
          `${config.officialMode ? `ТС ${d.route.number}` : d.routeId}  ${minutes(d.route.currentDelaySec + ((d.route.predictedDelaySec - d.route.currentDelaySec) * ui.forecastOffsetMin) / 15)} мин`,
        getColor: dark ? [231, 237, 247] : [27, 44, 69],
        getSize: 11,
        background: true,
        getBackgroundColor: dark ? [16, 26, 41, 245] : [255, 255, 255, 245],
        backgroundPadding: [8, 6],
        getPixelOffset: [0, -23],
        fontFamily: '"IBM Plex Sans", sans-serif',
        fontWeight: 500,
        pickable: true,
        onClick: ({ object }) => {
          if (object) ui.selectRoute(object.routeId);
        },
      }),
    ];
    if (mode === "flow" && columnsVisible)
      layers.push(
        new ColumnLayer<RiskColumn>({
          id: "delay-columns",
          data: columns,
          diskResolution: 4,
          angle: 45,
          radius: 65,
          extruded: true,
          elevationScale: 2.8,
          getPosition: (d) => d.position as [number, number],
          getElevation: (d) => Math.max(5, d.delay),
          getFillColor: (d) => color(d.routeId, d.riskLevel),
          getLineColor: (d) => [...riskRgb[d.riskLevel], 255],
          stroked: true,
          lineWidthMinPixels: 0.7,
          opacity: 0.8,
          material: { ambient: 0.65, diffuse: 0.6, shininess: 20 },
          pickable: true,
          autoHighlight: true,
          highlightColor: [100, 180, 255, 120],
          transitions: reducedMotion ? {} : { getElevation: 100 },
        }),
      );
    if (mode === "flow" && !busFailed)
      layers.push(
        new ScenegraphLayer<ProjectedVehicle>({
          id: "bus-models",
          data: ui.vehiclesVisible ? displayedVehicles : [],
          scenegraph: "/models/bus.glb",
          getPosition: (d) => [d.position.lon, d.position.lat, 1],
          // The normalized bus is Y-up, +Z forward; deck uses Z-up and yaw around Z.
          getOrientation: (d) => [0, 180 - d.headingDeg, 90],
          getScale: (d) =>
            d.id === ui.selectedVehicleId
              ? [0.75, 0.5625, 1.25]
              : [0.6, 0.45, 1],
          // The unit-length bus needs 2.7× the scale of the former tram model.
          sizeScale: 7.8 * 2.7,
          sizeMinPixels: (zoom < 11 ? 15 : 21) * 2.7,
          sizeMaxPixels: 54 * 2.7,
          getColor: (d) => [
            255,
            255,
            255,
            selected && d.routeId !== selected ? 170 : 255,
          ],
          updateTriggers: {
            getColor: [selected],
            getScale: [ui.selectedVehicleId],
          },
          _lighting: "pbr",
          getScene: (gltf) => {
            if (gltf?.scenes?.[0]) {
              queueMicrotask(() => setBusReady(true));
              return gltf.scenes[0];
            }
            return null;
          },
          onError: () => {
            setBusFailed(true);
            return true;
          },
          pickable: true,
          onClick: ({ object }) => {
            if (object) ui.selectVehicle(object.id, object.routeId);
          },
        }),
      );
    overlay.current.setProps({ layers });
  }, [
    ready,
    data,
    displayedVehicles,
    mode,
    ui,
    zoom,
    routes,
    columns,
    segments,
    columnsVisible,
    busFailed,
    dark,
    reducedMotion,
  ]);

  return (
    <div
      className="map-shell"
      role="region"
      aria-label="Интерактивная карта транспортной сети Москвы"
      data-map-ready={ready}
      data-map-mode={mode}
      data-bus-models={
        mode === "flow" && ui.vehiclesVisible && busReady && !busFailed
          ? displayedVehicles.length
          : 0
      }
      data-bus-model-status={
        busFailed ? "fallback" : busReady ? "ready" : "pending"
      }
      data-selected-vehicle-heading={selectedDisplayVehicle?.headingDeg}
      data-map-theme={theme}
      data-forecast-offset={ui.forecastOffsetMin}
      data-selected-vehicle-position={
        selectedDisplayVehicle
          ? `${selectedDisplayVehicle.position.lon},${selectedDisplayVehicle.position.lat}`
          : undefined
      }
      data-bearing={Math.round(orientation.bearing)}
      data-pitch={Math.round(orientation.pitch)}
      data-local-segments={segments.length}
      data-affected-vehicles={
        vehicles.filter((v) => v.riskLevel !== "normal").length
      }
      data-column-labels="0"
      data-columns={mode === "flow" && columnsVisible ? columns.length : 0}
    >
      <div className="map-canvas" ref={host} />
      <div className="map-top">
        <div className="map-location">
          <MapPin size={13} />
          <strong>Москва</strong>
          <span>Автобусная сеть</span>
        </div>
        <div className="map-view-controls">
          {mode === "flow" && ready && weatherMap && !config.officialMode && (
            <WeatherControl map={weatherMap} dark={dark} />
          )}
          <button
            className="map-mode-toggle"
            aria-label={
              mode === "flow"
                ? "Переключить карту в 2D"
                : "Переключить карту в 3D"
            }
            aria-pressed={mode === "flow"}
            onClick={() =>
              ui.set({ mapMode: mode === "flow" ? "overview" : "flow" })
            }
          >
            <Box size={15} />
            <span>2D</span>
            <span className={mode === "flow" ? "active" : ""}>3D</span>
          </button>
        </div>
      </div>
      <div className="map-buttons">
        <button
          title="Слои карты"
          aria-label="Слои карты"
          aria-expanded={ui.layersOpen}
          onClick={() => ui.set({ layersOpen: !ui.layersOpen })}
        >
          <Layers size={18} />
        </button>
        <button aria-label="Приблизить" onClick={() => map.current?.zoomIn()}>
          <Plus size={19} />
        </button>
        <button aria-label="Отдалить" onClick={() => map.current?.zoomOut()}>
          <Minus size={19} />
        </button>
        <button
          aria-label="Вся сеть"
          onClick={() => {
            ui.clear();
            fitNetwork();
          }}
        >
          <Crosshair size={18} />
        </button>
      </div>
      {ui.layersOpen && (
        <div className="layers-popover">
          <strong>Слои карты</strong>
          <label>
            <input
              type="checkbox"
              checked={ui.routesVisible}
              onChange={(e) => ui.set({ routesVisible: e.target.checked })}
            />
            Маршруты и риск
          </label>
          <label>
            <input
              type="checkbox"
              checked={ui.vehiclesVisible}
              onChange={(e) => ui.set({ vehiclesVisible: e.target.checked })}
            />
            Транспорт
          </label>
          {mode === "flow" && (
            <label>
              <input
                type="checkbox"
                checked={columnsVisible}
                onChange={(e) => setColumnsVisible(e.target.checked)}
              />
              Столбцы задержек
            </label>
          )}
        </div>
      )}
      {loading && <div className="map-notice">Загрузка карты Москвы…</div>}
      {failed && (
        <div className="map-notice" role="status">
          <TriangleAlert size={16} />
          Картографическая подложка недоступна
          <button onClick={() => setGeneration((n) => n + 1)}>
            <RotateCcw size={14} />
            Повторить
          </button>
        </div>
      )}
      {!loading && !routes.length && (
        <div className="map-notice">Нет маршрутов для выбранных фильтров</div>
      )}
      <div className="map-legend">
        <span>
          {ui.forecastOffsetMin > 0
            ? config.officialMode
              ? "Прогноз к остановке · 10–15 мин"
              : `Прогноз · ${horizonLabel(ui.forecastOffsetMin)}`
            : "Текущий риск задержки"}
        </span>
        <small className="local-risk-key">
          {mode === "flow"
            ? "Кольцо — маршрут · линии и столбцы — риск"
            : "Линии — участки · значки — автобусы"}
        </small>
        <div>
          {(["normal", "elevated", "high", "critical"] as const).map((r, i) => (
            <span key={r}>
              <i style={{ background: `rgb(${riskRgb[r].join(",")})` }} />
              {["Норма", "Внимание", "Высокий", "Критический"][i]}
            </span>
          ))}
        </div>
      </div>
      {ui.forecastOffsetMin > 0 && (
        <div className="map-position-caption">
          {config.officialMode
            ? "Позиции по GPS · цвет по прогнозу"
            : `Расчётные позиции · ${horizonLabel(ui.forecastOffsetMin)}`}
        </div>
      )}
      {mode === "flow" && busFailed && (
        <div className="map-model-notice" role="status">
          Модель недоступна · транспорт показан значками
        </div>
      )}
      <div className="map-counter">
        {ui.vehiclesVisible ? vehicles.length : 0} ТС <span>на карте</span>
      </div>
    </div>
  );
}
