import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { welcomeNodes } from "./welcome-model";
import { config } from "../shared/config/env";

type Props = {
  onReady: () => void;
  onUnavailable: () => void;
  paused: boolean;
  chapter: number;
  horizon: number;
  selected: number | null;
  onSelect: (index: number) => void;
  reset: number;
};
type Route = {
  curve: THREE.CatmullRomCurve3;
  material: THREE.MeshStandardMaterial;
  base: THREE.Color;
  risk: boolean;
  points: THREE.Vector3[];
};

export default function IntroScene(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  const markerRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    latest.current = props;
    host.current?.dispatchEvent(new Event("scene-update"));
  }, [props]);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch {
      latest.current.onUnavailable();
      return;
    }
    const mobile = window.innerWidth < 761;
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, mobile ? 1.5 : 1.7),
    );
    renderer.setClearColor(0x101113, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.domElement.setAttribute("aria-hidden", "true");
    el.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(39, 1, 0.1, 100);
    camera.position.set(8.5, 10.8, 12.5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const city = new THREE.Group();
    scene.add(city);
    city.rotation.y = -0.2;
    const ambient = new THREE.HemisphereLight(0xc8d5ed, 0x151723, 2.0);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xe6edff, 3.8);
    key.position.set(-4, 8, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x8097f5, 2.2);
    fill.position.set(6, 3, -6);
    scene.add(fill);
    const rim = new THREE.PointLight(0xa7dce2, 17, 18, 2);
    rim.position.set(-5, 3, -4);
    scene.add(rim);
    const resources: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] =
      [];
    function geometry<T extends THREE.BufferGeometry>(g: T) {
      resources.push(g);
      return g;
    }
    function material<T extends THREE.Material>(m: T) {
      resources.push(m);
      return m;
    }
    const baseMat = material(
      new THREE.MeshStandardMaterial({
        color: 0x171d27,
        metalness: 0.6,
        roughness: 0.55,
      }),
    );
    const disk = new THREE.Mesh(
      geometry(new THREE.CylinderGeometry(5.8, 5.8, 0.16, 128)),
      baseMat,
    );
    disk.position.y = -0.12;
    city.add(disk);
    const innerDisk = new THREE.Mesh(
      geometry(new THREE.CylinderGeometry(5.76, 5.76, 0.015, 128)),
      material(
        new THREE.MeshStandardMaterial({
          color: 0x252d3c,
          metalness: 0.35,
          roughness: 0.8,
        }),
      ),
    );
    innerDisk.position.y = -0.03;
    city.add(innerDisk);
    const edgeMat = material(
      new THREE.MeshBasicMaterial({
        color: 0x8595ba,
        transparent: true,
        opacity: 0.45,
      }),
    );
    const rimMesh = new THREE.Mesh(
      geometry(new THREE.TorusGeometry(5.81, 0.008, 4, 160)),
      edgeMat,
    );
    rimMesh.rotation.x = Math.PI / 2;
    rimMesh.position.y = -0.09;
    city.add(rimMesh);

    let seed = 415;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const riverZ = (x: number) => Math.sin(x * 0.8) * 0.85 + x * 0.28 + 0.45;
    const buildings: {
      x: number;
      z: number;
      width: number;
      depth: number;
      height: number;
      value: number;
    }[] = [];
    // A deliberately schematic city, independent from operational geography.
    for (let x = -5.6; x < 5.6; x += 0.27)
      for (let z = -5.6; z < 5.6; z += 0.27) {
        const radius = Math.hypot(x, z);
        if (
          radius > 5.5 ||
          Math.abs(z - riverZ(x)) < 0.32 ||
          [1.65, 3.05, 4.6].some((r) => Math.abs(radius - r) < 0.13)
        )
          continue;
        const angle = Math.atan2(z, x);
        if (Math.abs(Math.sin(angle * 6)) * radius < 0.14) continue;
        if (random() < 0.12) continue;
        const height =
          0.12 + random() * 0.42 + (radius < 2 ? random() * 0.55 : 0);
        buildings.push({
          x: x + (random() - 0.5) * 0.055,
          z: z + (random() - 0.5) * 0.055,
          width: 0.12 + random() * 0.1,
          depth: 0.12 + random() * 0.1,
          height,
          value: random(),
        });
      }
    const buildingGeo = geometry(new THREE.BoxGeometry(1, 1, 1));
    const buildingMat = material(
      new THREE.MeshStandardMaterial({
        color: 0xb1bfd1,
        metalness: 0.45,
        roughness: 0.55,
      }),
    );
    const blocks = new THREE.InstancedMesh(
      buildingGeo,
      buildingMat,
      buildings.length,
    );
    const dummy = new THREE.Object3D();
    const blockColor = new THREE.Color();
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      dummy.position.set(b.x, b.height / 2, b.z);
      dummy.scale.set(b.width, b.height, b.depth);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      blocks.setMatrixAt(i, dummy.matrix);
      blockColor.setRGB(
        0.15 + b.value * 0.22,
        0.19 + b.value * 0.23,
        0.25 + b.value * 0.26,
      );
      blocks.setColorAt(i, blockColor);
    }
    city.add(blocks);
    // Roof plates catch a restrained blue-white rim light.
    const roofs = new THREE.InstancedMesh(
      geometry(new THREE.PlaneGeometry(1, 1)),
      material(
        new THREE.MeshBasicMaterial({
          color: 0x9caeca,
          transparent: true,
          opacity: 0.23,
          side: THREE.DoubleSide,
        }),
      ),
      buildings.length,
    );
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      dummy.position.set(b.x, b.height + 0.003, b.z);
      dummy.scale.set(b.width * 0.85, b.depth * 0.85, 1);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.updateMatrix();
      roofs.setMatrixAt(i, dummy.matrix);
    }
    city.add(roofs);

    const roadMat = material(
      new THREE.MeshBasicMaterial({
        color: 0x54617b,
        transparent: true,
        opacity: 0.45,
      }),
    );
    for (const radius of [1.65, 3.05, 4.6]) {
      const road = new THREE.Mesh(
        geometry(new THREE.TorusGeometry(radius, 0.025, 4, 160)),
        roadMat,
      );
      road.rotation.x = Math.PI / 2;
      road.position.y = 0.006;
      city.add(road);
    }
    const riverPoints: THREE.Vector3[] = [];
    for (let i = 0; i < 80; i++) {
      const x = -5.7 + (i / 79) * 11.4;
      const z = riverZ(x);
      if (Math.hypot(x, z) < 5.65)
        riverPoints.push(new THREE.Vector3(x, 0.015, z));
    }
    const riverCurve = new THREE.CatmullRomCurve3(riverPoints);
    const river = new THREE.Mesh(
      geometry(new THREE.TubeGeometry(riverCurve, 160, 0.2, 5, false)),
      material(
        new THREE.MeshStandardMaterial({
          color: 0x16263c,
          metalness: 0.9,
          roughness: 0.27,
        }),
      ),
    );
    river.scale.y = 0.12;
    city.add(river);
    for (let edge = 0; edge < 2; edge++) {
      const line = new THREE.Line(
        geometry(
          new THREE.BufferGeometry().setFromPoints(
            riverPoints.map(
              (p) =>
                new THREE.Vector3(
                  p.x,
                  0.016,
                  p.z + (edge === 0 ? -0.22 : 0.22),
                ),
            ),
          ),
        ),
        material(
          new THREE.LineBasicMaterial({
            color: 0x778db0,
            transparent: true,
            opacity: 0.3,
          }),
        ),
      );
      city.add(line);
    }
    const roadVertices: number[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      roadVertices.push(
        Math.cos(a) * 0.3,
        0.012,
        Math.sin(a) * 0.3,
        Math.cos(a) * 5.65,
        0.012,
        Math.sin(a) * 5.65,
      );
    }
    const roadGeo = geometry(new THREE.BufferGeometry());
    roadGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(roadVertices, 3),
    );
    city.add(
      new THREE.LineSegments(
        roadGeo,
        material(
          new THREE.LineBasicMaterial({
            color: 0x8392ac,
            transparent: true,
            opacity: 0.28,
          }),
        ),
      ),
    );

    const routeColors = [0xa6b9ff, 0x8ad2ba, 0xe9e7f4, 0xd39f79, 0x899eee];
    const routes: Route[] = [];
    const addRoute = (pts: THREE.Vector3[], index: number, closed: boolean) => {
      const curve = new THREE.CatmullRomCurve3(pts, closed, "catmullrom", 0.25);
      const base = new THREE.Color(routeColors[index % routeColors.length]);
      const mat = material(
        new THREE.MeshStandardMaterial({
          color: base,
          emissive: base,
          emissiveIntensity: 1.2,
          roughness: 0.4,
          metalness: 0.35,
        }),
      );
      city.add(
        new THREE.Mesh(
          geometry(new THREE.TubeGeometry(curve, 240, 0.022, 6, closed)),
          mat,
        ),
      );
      routes.push({
        curve,
        material: mat,
        base,
        risk: index === 1 || index === 3,
        points: curve.getSpacedPoints(700),
      });
    };
    for (let j = 0; j < 3; j++) {
      const pts: THREE.Vector3[] = [];
      const radius = [1.65, 3.05, 4.6][j];
      for (let i = 0; i < 90; i++) {
        const a = (i / 90) * Math.PI * 2;
        pts.push(
          new THREE.Vector3(
            Math.cos(a) * radius,
            0.12 + Math.sin(a * 3 + j) * 0.045,
            Math.sin(a) * radius,
          ),
        );
      }
      addRoute(pts, j, true);
    }
    addRoute(
      [
        new THREE.Vector3(-4.7, 0.14, -2.3),
        new THREE.Vector3(-2.3, 0.21, -2.1),
        new THREE.Vector3(-0.4, 0.17, -1),
        new THREE.Vector3(0.7, 0.24, 0.2),
        new THREE.Vector3(2.4, 0.2, 1.1),
        new THREE.Vector3(4.8, 0.13, 2.3),
      ],
      3,
      false,
    );
    addRoute(
      [
        new THREE.Vector3(-2.4, 0.13, 4.6),
        new THREE.Vector3(-1.6, 0.22, 3.35),
        new THREE.Vector3(-0.8, 0.17, 1.6),
        new THREE.Vector3(-1, 0.22, -0.2),
        new THREE.Vector3(0.6, 0.18, -2.4),
        new THREE.Vector3(1.7, 0.13, -5),
      ],
      4,
      false,
    );
    addRoute(
      [
        new THREE.Vector3(-5.3, 0.15, 0.4),
        new THREE.Vector3(-3.4, 0.18, 0.8),
        new THREE.Vector3(-1.8, 0.24, 1.6),
        new THREE.Vector3(0.7, 0.15, 1.9),
        new THREE.Vector3(2.4, 0.2, 1.1),
        new THREE.Vector3(4.8, 0.14, -1.6),
      ],
      0,
      false,
    );

    const vehicleMat = material(
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.65, 3.3) }),
    );
    const vehicles = new THREE.InstancedMesh(
      geometry(new THREE.SphereGeometry(0.041, 7, 5)),
      vehicleMat,
      54,
    );
    city.add(vehicles);
    const tailGeo = geometry(new THREE.BufferGeometry());
    const tailPos = new Float32Array(54 * 2 * 3);
    tailGeo.setAttribute("position", new THREE.BufferAttribute(tailPos, 3));
    const tails = new THREE.LineSegments(
      tailGeo,
      material(
        new THREE.LineBasicMaterial({
          color: 0xb9d4ff,
          transparent: true,
          opacity: 0.8,
        }),
      ),
    );
    city.add(tails);
    const stationMat = material(
      new THREE.MeshBasicMaterial({ color: 0xe5edff }),
    );
    for (const route of routes)
      for (let i = 0; i < 10; i++) {
        const p = route.curve.getPoint(i / 10);
        const station = new THREE.Mesh(
          geometry(new THREE.TorusGeometry(0.065, 0.012, 5, 16)),
          stationMat,
        );
        station.rotation.x = Math.PI / 2;
        station.position.copy(p);
        city.add(station);
      }
    const nodePositions = welcomeNodes.map(
      (n) => new THREE.Vector3(...n.position),
    );
    const signals = nodePositions.map((position) => {
      const group = new THREE.Group();
      group.position.copy(position);
      city.add(group);
      const beacon = new THREE.Mesh(
        geometry(new THREE.CylinderGeometry(0.013, 0.013, 1.2, 6)),
        material(
          new THREE.MeshBasicMaterial({
            color: 0xa8c3ff,
            transparent: true,
            opacity: 0.55,
          }),
        ),
      );
      beacon.position.y = 0.6;
      group.add(beacon);
      const halo = new THREE.Mesh(
        geometry(new THREE.RingGeometry(0.15, 0.175, 48)),
        material(
          new THREE.MeshBasicMaterial({
            color: 0xb5c8ff,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide,
          }),
        ),
      );
      halo.rotation.x = -Math.PI / 2;
      group.add(halo);
      return { group, halo, beacon };
    });
    const forecast = new THREE.Group();
    city.add(forecast);
    const forecastMaterial = material(
      new THREE.MeshBasicMaterial({
        color: 0xff9564,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    const forecastArea = new THREE.Mesh(
      geometry(new THREE.CircleGeometry(1.1, 64)),
      forecastMaterial,
    );
    forecastArea.rotation.x = -Math.PI / 2;
    forecastArea.position.set(2.4, 0.055, 1.1);
    forecast.add(forecastArea);
    const forecastRingMat = material(
      new THREE.MeshBasicMaterial({
        color: 0xffb27f,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    const forecastRing = new THREE.Mesh(
      geometry(new THREE.RingGeometry(1.05, 1.07, 80)),
      forecastRingMat,
    );
    forecastRing.rotation.x = -Math.PI / 2;
    forecastRing.position.copy(forecastArea.position);
    forecastRing.position.y = 0.06;
    forecast.add(forecastRing);
    // Fine orbit and cardinal ticks give the model a measured, physical scale.
    const orbit = new THREE.Mesh(
      geometry(new THREE.TorusGeometry(6.15, 0.006, 4, 160)),
      material(
        new THREE.MeshBasicMaterial({
          color: 0x8c9bb6,
          transparent: true,
          opacity: 0.3,
        }),
      ),
    );
    orbit.rotation.x = Math.PI / 2;
    orbit.position.y = -0.15;
    city.add(orbit);
    const ticks: number[] = [];
    for (let i = 0; i < 80; i++) {
      const a = (i / 80) * Math.PI * 2;
      const outer = i % 5 === 0 ? 6.3 : 6.22;
      ticks.push(
        Math.cos(a) * 6.16,
        -0.15,
        Math.sin(a) * 6.16,
        Math.cos(a) * outer,
        -0.15,
        Math.sin(a) * outer,
      );
    }
    const ticksGeo = geometry(new THREE.BufferGeometry());
    ticksGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(ticks, 3),
    );
    city.add(
      new THREE.LineSegments(
        ticksGeo,
        material(
          new THREE.LineBasicMaterial({
            color: 0x7687a9,
            transparent: true,
            opacity: 0.4,
          }),
        ),
      ),
    );

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.36, 0.5, 1.1);
    composer.addPass(bloom);
    const outputPass = new OutputPass();
    composer.addPass(outputPass);
    let hostLeft = 0;
    let viewportWidth = window.innerWidth;
    let width = 1,
      height = 1,
      raf = 0,
      elapsed = config.visualTest ? 18 : 0,
      last = performance.now();
    let pointerX = 0,
      pointerY = 0,
      dragging = false,
      lastX = 0,
      lastY = 0,
      userRotation = 0,
      userTilt = 0;
    let notifiedReady = false;
    let inView = true,
      previousReset = latest.current.reset,
      settleUntil = 0,
      scrollProgress = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const tmp = new THREE.Vector3();
    const targetColor = new THREE.Color();
    const riskColor = new THREE.Color(0xff9c67);
    const actionColor = new THREE.Color(0x95dfba);
    const resize = () => {
      const box = el.getBoundingClientRect();
      width = box.width;
      hostLeft = box.left;
      viewportWidth = window.innerWidth;
      height = box.height;
      renderer.setSize(width, height);
      composer.setSize(width, height);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
      invalidate();
    };
    const move = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      pointerX = (event.clientX - rect.left) / width - 0.5;
      pointerY = (event.clientY - rect.top) / height - 0.5;
      if (dragging) {
        userRotation += (event.clientX - lastX) * 0.005;
        userTilt = THREE.MathUtils.clamp(
          userTilt + (event.clientY - lastY) * 0.002,
          -0.2,
          0.3,
        );
        lastX = event.clientX;
        lastY = event.clientY;
      }
      invalidate();
    };
    const down = (event: PointerEvent) => {
      if ((event.target as HTMLElement).closest("button")) return;
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      el.setPointerCapture(event.pointerId);
    };
    const up = () => {
      dragging = false;
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.target !== el) return;
      if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(
          event.key,
        )
      ) {
        event.preventDefault();
        if (event.key === "ArrowLeft") userRotation -= 0.2;
        if (event.key === "ArrowRight") userRotation += 0.2;
        if (event.key === "ArrowUp") userTilt = Math.max(-0.2, userTilt - 0.05);
        if (event.key === "ArrowDown")
          userTilt = Math.min(0.3, userTilt + 0.05);
        if (event.key === "Home") {
          userRotation = 0;
          userTilt = 0;
        }
        invalidate();
      }
    };
    const scroll = () => {
      scrollProgress = Math.min(
        1,
        Math.max(0, window.scrollY / window.innerHeight),
      );
      invalidate();
    };
    function invalidate() {
      settleUntil = performance.now() + 1000;
      if (!raf && !document.hidden && inView)
        raf = requestAnimationFrame(render);
    }
    function render(now: number) {
      raf = 0;
      const dt = THREE.MathUtils.clamp((now - last) / 1000, 0, 0.05);
      last = now;
      if (document.hidden || !inView) return;
      const p = latest.current;
      const automatic = !p.paused && !reduced.matches && !config.visualTest;
      if (automatic) elapsed += dt;
      if (previousReset !== p.reset) {
        userRotation = 0;
        userTilt = 0;
        pointerX = 0;
        pointerY = 0;
        previousReset = p.reset;
      }
      const lerp = reduced.matches ? 1 : 1 - Math.exp(-dt * 5);
      const targetRotation =
        -0.2 +
        userRotation +
        (p.chapter === 1 ? 0.25 : p.chapter === 2 ? -0.18 : 0) +
        (reduced.matches
          ? 0
          : pointerX * 0.06 +
            Math.sin(elapsed * 0.07) * 0.04 +
            scrollProgress * 0.18);
      city.rotation.y = THREE.MathUtils.lerp(
        city.rotation.y,
        targetRotation,
        lerp,
      );
      city.rotation.x = THREE.MathUtils.lerp(
        city.rotation.x,
        userTilt + (reduced.matches ? 0 : pointerY * 0.025),
        lerp,
      );
      const forecastAmount = p.horizon / 15;
      for (let i = 0; i < routes.length; i++) {
        const route = routes[i];
        targetColor.copy(route.base);
        if (route.risk && forecastAmount > 0)
          targetColor.lerp(
            p.chapter === 2 ? actionColor : riskColor,
            forecastAmount,
          );
        route.material.color.lerp(targetColor, lerp);
        route.material.emissive.copy(route.material.color);
        route.material.emissiveIntensity = route.risk
          ? 1.2 + forecastAmount * 0.7
          : 1.0;
      }
      forecastMaterial.opacity = THREE.MathUtils.lerp(
        forecastMaterial.opacity,
        forecastAmount * (p.chapter === 2 ? 0.035 : 0.13),
        lerp,
      );
      forecastRingMat.opacity = THREE.MathUtils.lerp(
        forecastRingMat.opacity,
        forecastAmount * 0.7,
        lerp,
      );
      forecastRingMat.color.copy(p.chapter === 2 ? actionColor : riskColor);
      forecastMaterial.color.copy(forecastRingMat.color);
      const scale = 0.55 + forecastAmount * 0.95;
      forecast.scale.set(scale, 1, scale);
      forecast.position.set(2.4 * (1 - scale), 0, 1.1 * (1 - scale));
      for (let i = 0; i < 54; i++) {
        const route = routes[i % routes.length];
        const progress =
          (i / 54 +
            elapsed * (0.016 + (i % 4) * 0.002) +
            forecastAmount * 0.12) %
          1;
        const idx = Math.floor(progress * 700);
        const point = route.points[idx];
        dummy.position.copy(point);
        dummy.position.y += 0.018;
        dummy.scale.setScalar(i % 7 === 0 ? 1.4 : 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        vehicles.setMatrixAt(i, dummy.matrix);
        const tail = route.points[Math.max(0, idx - 9)];
        const offset = i * 6;
        tailPos[offset] = point.x;
        tailPos[offset + 1] = point.y + 0.012;
        tailPos[offset + 2] = point.z;
        tailPos[offset + 3] = tail.x;
        tailPos[offset + 4] = tail.y + 0.012;
        tailPos[offset + 5] = tail.z;
      }
      vehicles.instanceMatrix.needsUpdate = true;
      tailGeo.attributes.position.needsUpdate = true;
      city.updateMatrixWorld();
      for (let i = 0; i < signals.length; i++) {
        const s = signals[i];
        s.halo.scale.setScalar(
          p.selected === i ? 1.8 : 1 + Math.sin(elapsed * 1.3 + i) * 0.12,
        );
        s.beacon.scale.y = p.selected === i ? 1.25 : 1;
        const marker = markerRefs.current[i];
        if (marker) {
          tmp.copy(nodePositions[i]);
          tmp.y += 1.2;
          tmp.applyMatrix4(city.matrixWorld).project(camera);
          const x = (tmp.x * 0.5 + 0.5) * width;
          const y = (-tmp.y * 0.5 + 0.5) * height;
          marker.style.transform = `translate(${x}px,${y}px) translate(-20px,-50%)`;
          marker.dataset.side =
            x + hostLeft + 190 > viewportWidth - 16 ? "left" : "right";
          marker.style.visibility = tmp.z > 1 ? "hidden" : "visible";
        }
      }
      composer.render();
      if (!notifiedReady) {
        notifiedReady = true;
        latest.current.onReady();
      }
      if (automatic || dragging || now < settleUntil)
        raf = requestAnimationFrame(render);
    }
    const visibility = () => {
      last = performance.now();
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else invalidate();
    };
    const contextLost = (event: Event) => {
      event.preventDefault();
      latest.current.onUnavailable();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    const intersection = new IntersectionObserver(
      (entries) => {
        inView = entries[0].isIntersecting;
        if (inView) {
          last = performance.now();
          invalidate();
        } else {
          cancelAnimationFrame(raf);
          raf = 0;
        }
      },
      { rootMargin: "80px" },
    );
    intersection.observe(el);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("keydown", keydown);
    el.addEventListener("scene-update", invalidate);
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("scroll", scroll, { passive: true });
    reduced.addEventListener("change", invalidate);
    resize();
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      intersection.disconnect();
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("keydown", keydown);
      el.removeEventListener("scene-update", invalidate);
      window.removeEventListener("scroll", scroll);
      document.removeEventListener("visibilitychange", visibility);
      reduced.removeEventListener("change", invalidate);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      for (const resource of resources) resource.dispose();
      blocks.dispose();
      roofs.dispose();
      vehicles.dispose();
      bloom.dispose();
      outputPass.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return (
    <div
      ref={host}
      className="intro-scene"
      tabIndex={0}
      role="group"
      aria-label="3D-модель города. Вращайте перетаскиванием или клавишами со стрелками. Home сбрасывает ракурс."
    >
      {welcomeNodes.map((node, index) => (
        <button
          key={node.name}
          ref={(el) => {
            markerRefs.current[index] = el;
          }}
          className="welcome-node-marker"
          aria-label={`Исследовать узел ${node.name}`}
          aria-pressed={props.selected === index}
          onClick={() => props.onSelect(index)}
        >
          <i aria-hidden="true" />
          <span>
            {node.route} · {node.name}
          </span>
        </button>
      ))}
    </div>
  );
}
