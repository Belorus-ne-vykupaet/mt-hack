export const cloudVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * vec4(vWorld, 1.0);
  }
`;
export const cloudFragment = /* glsl */ `
  precision highp float;
  varying vec3 vWorld;
  uniform mat4 uInverse;
  uniform vec2 uResolution;
  uniform vec3 uCenter;
  uniform vec3 uSize;
  uniform vec3 uLight;
  uniform vec3 uShade;
  uniform float uOpacity;
  uniform float uTime;
  uniform sampler2D uCoverage;
  uniform float uPointMode;
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
  }
  float density(vec3 p) {
    // Georeferenced mask: provider tiles or explicitly approximate point conditions.
    float coverage = texture2D(uCoverage,p.xy+0.5).a;
    coverage = mix(coverage, smoothstep(0.025,0.4,coverage),uPointMode);
    if(coverage < 0.01) return 0.0;
    float vertical = max(0.0,1.0-pow(p.z*2.0,2.0));
    vec3 world = p*uSize+uCenter;
    vec3 q = world/mix(1400.0,850.0,uPointMode) + vec3(0.0,0.0,uTime*0.004);
    float n=noise(q)*0.65+noise(q*2.13)*0.35;
    if (uPointMode > 0.5) {
      // Sculpt a compact billowing volume instead of a transparent Gaussian fog patch.
      return smoothstep(0.18,0.52,coverage*vertical-n*0.55)*1.15;
    }
    return coverage*smoothstep(0.05,0.55,vertical-n*0.55)*0.85;
  }
  void main() {
    vec2 ndc = gl_FragCoord.xy / uResolution * 2.0 - 1.0;
    vec4 near4 = uInverse * vec4(ndc, -1.0, 1.0);
    vec3 origin = near4.xyz / near4.w;
    vec3 ray = normalize(vWorld - origin);
    vec3 invRay = 1.0 / (ray + vec3(0.0000001));
    vec3 a = (uCenter-uSize*0.5-origin)*invRay;
    vec3 b = (uCenter+uSize*0.5-origin)*invRay;
    vec3 entry = min(a,b), leave = max(a,b);
    float start = max(0.0, max(entry.x,max(entry.y,entry.z)));
    float end = min(leave.x,min(leave.y,leave.z));
    if (end <= start) discard;
    float stepSize = (end-start)/24.0;
    vec3 color = vec3(0.0);
    float alpha = 0.0;
    // Stable per-pixel dithering hides bands without temporal shimmer.
    float jitter = fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
    for (int i=0; i<24; i++) {
      vec3 p = (origin + ray*(start+(float(i)+jitter)*stepSize)-uCenter)/uSize;
      float d = density(p);
      vec3 lightProbe = mix(vec3(-0.1,-0.12,0.14),vec3(-550.0,-650.0,600.0)/uSize,uPointMode);
      float lit = clamp(0.65 + p.z*0.85 - density(p+lightProbe)*0.4, 0.0, 1.0);
      float absorb = 1.0-exp(-d*stepSize/min(uSize.z,uSize.x)*3.8);
      float storm = uPointMode * texture2D(uCoverage,p.xy+0.5).r;
      color += (1.0-alpha)*absorb*mix(uShade,uLight,lit)*(1.0-storm*0.4);
      alpha += (1.0-alpha)*absorb;
    }
    if(alpha < 0.005) discard;
    gl_FragColor = vec4(color/max(alpha,0.001), alpha*uOpacity);
  }
`;
export const rainVertex = /* glsl */ `
  attribute vec3 aSeed;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uPixelRatio;
  uniform vec2 uTileCenter;
  uniform float uTileSize;
  uniform sampler2D uCoverage;
  varying float vAlpha;
  varying vec2 vDrop;
  void main() {
    float fall = fract(aSeed.z - uTime*(0.38+aSeed.x*0.2));
    vec2 xy = (aSeed.xy - 0.5)*uTileSize + uTileCenter;
    float coverage = texture2D(uCoverage,aSeed.xy).a;
    // Fall beneath the cloud base. Perspective scales the drop, with a small
    // screen-space minimum so weak rain remains legible at the city overview.
    vec3 p = vec3(xy, 80.0+fall*1250.0);
    vec4 head = projectionMatrix * vec4(p,1.0);
    vec4 tail = projectionMatrix * vec4(p+vec3(-18.0,0.0,130.0),1.0);
    vec2 direction = (tail.xy/tail.w-head.xy/head.w)*uResolution*0.5;
    float extent = length(direction);
    direction = extent > 0.01 ? direction/extent : normalize(vec2(-0.2,1.0));
    float lengthPx = clamp(extent, mix(7.0,12.0,coverage)*uPixelRatio,22.0*uPixelRatio);
    vec2 side = vec2(direction.y,-direction.x);
    float widthPx = mix(1.5,2.3,coverage)*uPixelRatio;
    vec2 offset = direction*position.y*lengthPx + side*position.x*widthPx*0.5;
    head.xy += offset/uResolution*2.0*head.w;
    gl_Position = head;
    vDrop = position.xy;
    vAlpha = step(0.045,coverage)*mix(0.65,1.0,coverage)*
      smoothstep(0.0,0.06,fall)*(1.0-smoothstep(0.92,1.0,fall));
  }
`;
export const rainFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  varying vec2 vDrop;
  void main() {
    float taper = mix(0.95,0.2,vDrop.y);
    float edge = 1.0-smoothstep(taper*0.45,taper,abs(vDrop.x));
    float ends = smoothstep(0.0,0.1,vDrop.y)*(1.0-smoothstep(0.75,1.0,vDrop.y));
    float alpha = edge*ends*vAlpha*uOpacity;
    if(alpha < 0.01) discard;
    gl_FragColor = vec4(uColor,alpha);
  }
`;
