import { MercatorCoordinate } from "maplibre-gl";
import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as LibreMap,
} from "maplibre-gl";
import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  InstancedBufferGeometry,
  InstancedBufferAttribute,
  Camera,
  Color,
  LinearFilter,
  Matrix4,
  Mesh,
  Scene,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import type { WeatherTile, WeatherTileKind } from "../../entities/weather";
import {
  cloudVertex,
  cloudFragment,
  rainVertex,
  rainFragment,
} from "./shaders";
export interface WeatherAppearance {
  enabled: boolean;
  clouds: boolean;
  rainfall: boolean;
  animate: boolean;
  intensity: number;
  dark: boolean;
}
export interface WeatherImage extends WeatherTile {
  kind: WeatherTileKind;
  image: ImageBitmap;
  approximate?: boolean;
}
const origin = MercatorCoordinate.fromLngLat([37.62, 55.75]);
const unit = origin.meterInMercatorCoordinateUnits();
const worldMatrix = new Matrix4()
  .makeTranslation(origin.x, origin.y, 0)
  .scale(new Vector3(unit, unit, unit));
const random = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
type Cloud = Mesh<BoxGeometry, ShaderMaterial>;
type Rain = Mesh<InstancedBufferGeometry, ShaderMaterial>;

/** Render georeferenced provider masks using MapLibre's own camera/context. */
export class WeatherLayer implements CustomLayerInterface {
  id = "transit-weather";
  type = "custom" as const;
  renderingMode = "3d" as const;
  private map?: LibreMap;
  private renderer?: WebGLRenderer;
  private scene = new Scene();
  private camera = new Camera();
  private settings: WeatherAppearance = {
    enabled: false,
    clouds: true,
    rainfall: true,
    animate: false,
    intensity: 0.7,
    dark: false,
  };
  private clouds: Cloud[] = [];
  private rain: Rain[] = [];
  private textures: Texture[] = [];
  private inverse = new Matrix4();
  private resolution = new Vector2();
  private timer?: ReturnType<typeof setTimeout>;
  private visible = true;
  private time = 0;
  private last = 0;
  private disposed = false;
  private observer?: IntersectionObserver;
  private visibility = () => {
    this.last = performance.now();
    if (document.hidden) this.stop();
    else this.map?.triggerRepaint();
  };
  private stop() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
  configure(settings: WeatherAppearance) {
    this.settings = settings;
    if (!settings.enabled || !settings.animate) this.stop();
    this.last = performance.now();
    this.map?.triggerRepaint();
  }
  onAdd(map: LibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl as WebGL2RenderingContext,
    });
    this.renderer.autoClear = false;
    this.observer = new IntersectionObserver((entries) => {
      this.visible = entries[0]?.isIntersecting ?? true;
      this.last = performance.now();
      if (!this.visible) this.stop();
      else map.triggerRepaint();
    });
    this.observer.observe(map.getCanvas());
    document.addEventListener("visibilitychange", this.visibility);
  }
  private clearImages() {
    [...this.clouds, ...this.rain].forEach((mesh) => {
      mesh.geometry.dispose();
      mesh.material.dispose();
      this.scene.remove(mesh);
    });
    this.textures.forEach((t) => {
      (t.image as ImageBitmap).close();
      t.dispose();
    });
    this.textures = [];
    this.clouds = [];
    this.rain = [];
  }
  setImages(images: WeatherImage[]) {
    if (this.disposed) {
      images.forEach((i) => i.image.close());
      return;
    }
    this.clearImages();
    for (const tile of images) {
      const texture = new Texture(tile.image);
      texture.flipY = false; // XYZ tiles are north-up; local +Y points south.
      texture.minFilter = texture.magFilter = LinearFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
      this.textures.push(texture);
      const size = 1 / 2 ** tile.z / unit;
      const center = new Vector3(
        ((tile.x + 0.5) / 2 ** tile.z - origin.x) / unit,
        ((tile.y + 0.5) / 2 ** tile.z - origin.y) / unit,
        1500,
      );
      if (tile.kind === "clouds") {
        const thickness = tile.approximate ? 2200 : 1100;
        const material = new ShaderMaterial({
          vertexShader: cloudVertex,
          fragmentShader: cloudFragment,
          transparent: true,
          depthWrite: false,
          depthTest: false,
          side: BackSide,
          uniforms: {
            uInverse: { value: this.inverse },
            uResolution: { value: this.resolution },
            uCenter: { value: center },
            uSize: { value: new Vector3(size, size, thickness) },
            uLight: { value: new Color() },
            uShade: { value: new Color() },
            uOpacity: { value: 0 },
            uTime: { value: 0 },
            uCoverage: { value: texture },
            uPointMode: { value: tile.approximate ? 1 : 0 },
          },
        });
        const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
        mesh.position.copy(center);
        mesh.scale.set(size, size, thickness);
        mesh.frustumCulled = false;
        this.clouds.push(mesh);
        this.scene.add(mesh);
      } else {
        // Seed drops inside wet pixels, rather than scattering almost all of them
        // across the dry viewport. Positions remain attached to geography on pan.
        const canvas = document.createElement("canvas");
        canvas.width = tile.image.width;
        canvas.height = tile.image.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) continue;
        context.drawImage(tile.image, 0, 0);
        const pixels = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        const wet: number[] = [];
        for (let i = 0; i < pixels.length / 4; i++) {
          if (pixels[i * 4 + 3] > 12) wet.push(i);
        }
        if (!wet.length) continue;
        const mobile = matchMedia("(max-width: 700px)").matches;
        const count = Math.round(
          Math.min(
            1600,
            90 + (wet.length / (canvas.width * canvas.height)) * 12000,
          ) * (mobile ? 0.65 : 1),
        );
        const geometry = new InstancedBufferGeometry();
        geometry.setAttribute(
          "position",
          new BufferAttribute(
            new Float32Array([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]),
            3,
          ),
        );
        geometry.setIndex([0, 1, 2, 2, 1, 3]);
        const seed = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          const pixel = wet[Math.floor(random(i + 1) * wet.length)];
          seed.set(
            [
              ((pixel % canvas.width) + 0.5) / canvas.width,
              (Math.floor(pixel / canvas.width) + 0.5) / canvas.height,
              random(i + 5381),
            ],
            i * 3,
          );
        }
        geometry.setAttribute("aSeed", new InstancedBufferAttribute(seed, 3));
        geometry.instanceCount = count;
        const material = new ShaderMaterial({
          vertexShader: rainVertex,
          fragmentShader: rainFragment,
          transparent: true,
          depthWrite: false,
          depthTest: false,
          uniforms: {
            uTime: { value: 0 },
            uResolution: { value: this.resolution },
            uPixelRatio: { value: 1 },
            uTileCenter: { value: new Vector2(center.x, center.y) },
            uTileSize: { value: size },
            uCoverage: { value: texture },
            uOpacity: { value: 0 },
            uColor: { value: new Color() },
          },
        });
        const mesh = new Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.renderOrder = 100;
        this.rain.push(mesh);
        this.scene.add(mesh);
      }
    }
    const canvas = this.map?.getCanvas();
    if (canvas) {
      canvas.dataset.weatherCloudTiles = String(this.clouds.length);
      canvas.dataset.weatherRainTiles = String(this.rain.length);
    }
    this.map?.triggerRepaint();
  }
  render(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    args: CustomRenderMethodInput,
  ) {
    const s = this.settings,
      map = this.map;
    if (
      !map ||
      !this.renderer ||
      this.disposed ||
      !s.enabled ||
      !this.visible ||
      document.hidden
    )
      return;
    const now = performance.now();
    if (s.animate)
      this.time += Math.min((now - (this.last || now)) / 1000, 0.1);
    this.last = now;
    this.camera.projectionMatrix
      .fromArray(args.defaultProjectionData.mainMatrix)
      .multiply(worldMatrix);
    this.inverse.copy(this.camera.projectionMatrix).invert();
    this.resolution.set(gl.drawingBufferWidth, gl.drawingBufferHeight);
    // The tile footprint NEVER drifts or follows the camera. Only its microtexture evolves.
    this.clouds.forEach((mesh) => {
      mesh.visible = s.clouds;
      const u = mesh.material.uniforms;
      u.uTime.value = this.time;
      u.uOpacity.value =
        s.intensity * (u.uPointMode.value ? 0.9 : s.dark ? 0.65 : 0.8);
      u.uLight.value.set(s.dark ? "#b9ccdf" : "#ffffff");
      u.uShade.value.set(s.dark ? "#3b4e67" : "#8495a7");
    });
    this.rain.forEach((mesh) => {
      mesh.visible = s.rainfall;
      const u = mesh.material.uniforms;
      u.uPixelRatio.value = gl.drawingBufferWidth / map.getCanvas().clientWidth;
      u.uTime.value = this.time;
      u.uOpacity.value = s.intensity * (s.dark ? 0.95 : 0.85);
      u.uColor.value.set(s.dark ? "#a9ddff" : "#196c9b");
    });
    this.renderer.resetState();
    this.renderer.setViewport(
      0,
      0,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
    );
    this.renderer.render(this.scene, this.camera);
    this.renderer.resetState();
    map.getCanvas().dataset.weatherRendered = String(
      Number(map.getCanvas().dataset.weatherRendered || 0) + 1,
    );
    if (
      s.animate &&
      ((s.clouds && this.clouds.length) || (s.rainfall && this.rain.length)) &&
      !this.timer
    )
      this.timer = setTimeout(() => {
        this.timer = undefined;
        if (!this.disposed) map.triggerRepaint();
      }, 33);
  }
  onRemove() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.observer?.disconnect();
    this.observer = undefined;
    document.removeEventListener("visibilitychange", this.visibility);
    this.clearImages();
    this.renderer?.dispose();
    this.renderer = undefined;
    this.scene.clear();
    this.map = undefined;
  }
}
