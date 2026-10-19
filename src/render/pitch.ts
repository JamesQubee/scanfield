// The pitch is one plane and one shader: mown stripes, every line marking as a
// distance field (crisp at any resolution, no textures), and the receiver's field
// of view painted onto the grass. One draw call.

import { Color, Mesh, PlaneGeometry, ShaderMaterial, Vector2 } from "three";
import { HALF_L, HALF_W } from "./coords";

const vertexShader = /* glsl */ `
  varying vec2 vP;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vP = vec2(wp.x + ${HALF_L.toFixed(2)}, wp.z + ${HALF_W.toFixed(2)});
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uGrassA;
  uniform vec3 uGrassB;
  uniform vec3 uApron;
  uniform vec3 uLine;
  uniform vec3 uConeTint;
  uniform vec2 uYou;
  uniform float uGaze;
  uniform float uHalf;
  uniform float uRange;
  uniform float uCone;
  uniform float uTime;
  varying vec2 vP;

  const float PI = 3.14159265;
  const float L = 105.0;
  const float W = 68.0;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float sdBox(vec2 p, vec2 c, vec2 h) {
    vec2 d = abs(p - c) - h;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }

  // Distance to the nearest line marking, in metres.
  float markings(vec2 p) {
    // Fold onto our half (and the near touchline for corner arcs).
    vec2 q = vec2(min(p.x, L - p.x), p.y);
    float d = abs(sdBox(p, vec2(L * 0.5, W * 0.5), vec2(L * 0.5, W * 0.5)));
    d = min(d, abs(p.x - L * 0.5));
    d = min(d, abs(length(p - vec2(L * 0.5, W * 0.5)) - 9.15));
    d = min(d, max(length(p - vec2(L * 0.5, W * 0.5)) - 0.18, 0.0));
    d = min(d, abs(sdBox(q, vec2(8.25, W * 0.5), vec2(8.25, 20.16))));
    d = min(d, abs(sdBox(q, vec2(2.75, W * 0.5), vec2(2.75, 9.16))));
    d = min(d, max(length(q - vec2(11.0, W * 0.5)) - 0.15, 0.0));
    if (q.x > 16.5) d = min(d, abs(length(q - vec2(11.0, W * 0.5)) - 9.15));
    vec2 c = vec2(q.x, min(p.y, W - p.y));
    if (c.x > 0.0 && c.y > 0.0) d = min(d, abs(length(c) - 1.0));
    return d;
  }

  void main() {
    vec2 p = vP;
    bool inside = p.x > 0.0 && p.x < L && p.y > 0.0 && p.y < W;
    float stripe = mod(floor(p.x / 5.25), 2.0);
    vec3 col = mix(uGrassA, uGrassB, stripe);
    if (!inside) col = mix(uApron, uApron * 0.94, mod(floor((p.x + 20.0) / 5.25), 2.0));
    // Grain: two octaves of value noise, cheap enough for phones.
    float n = hash(floor(p * 3.0)) * 0.6 + hash(floor(p * 11.0)) * 0.4;
    col *= 0.955 + 0.07 * n;

    float d = markings(p);
    float aa = fwidth(d) * 0.8 + 0.001;
    float line = 1.0 - smoothstep(0.065 - aa, 0.065 + aa, d);
    col = mix(col, uLine, line * 0.92);

    if (uCone > 0.001) {
      vec2 r = p - uYou;
      float dist = length(r);
      float da = abs(mod(atan(r.y, r.x) - uGaze + PI, 2.0 * PI) - PI);
      float soft = 0.035;
      float inCone = (1.0 - smoothstep(uHalf - soft, uHalf + soft, da)) * (1.0 - smoothstep(uRange - 4.0, uRange, dist));
      inCone = max(inCone, 1.0 - smoothstep(1.2, 1.8, dist));
      // Outside what you can see the grass dims; inside it lifts and warms slightly.
      vec3 dim = col * (1.0 - 0.32 * uCone);
      vec3 lit = col * (1.0 + 0.10 * uCone) + uConeTint * 0.08 * uCone;
      col = mix(dim, lit, inCone);
      float edge = (1.0 - smoothstep(0.0, 0.03, abs(da - uHalf))) * (1.0 - smoothstep(uRange - 4.0, uRange, dist)) * smoothstep(1.5, 4.0, dist);
      float pulse = 0.75 + 0.25 * sin(dist * 0.9 - uTime * 6.0);
      col += uConeTint * edge * 0.35 * uCone * pulse;
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export class Pitch {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  readonly uniforms = {
    uGrassA: { value: new Color("#3f9a4b") },
    uGrassB: { value: new Color("#4aa957") },
    uApron: { value: new Color("#3a8a45") },
    uLine: { value: new Color("#f3f7f0") },
    uConeTint: { value: new Color("#fff3b0") },
    uYou: { value: new Vector2(52.5, 34) },
    uGaze: { value: 0 },
    uHalf: { value: 0.6 },
    uRange: { value: 45 },
    uCone: { value: 0 },
    uTime: { value: 0 },
  };

  constructor() {
    // The plane covers the pitch plus the apron up to the advertising boards.
    const geo = new PlaneGeometry(105 + 16, 68 + 14, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new ShaderMaterial({ uniforms: this.uniforms, vertexShader, fragmentShader });
    this.mesh = new Mesh(geo, mat);
    this.mesh.name = "pitch";
  }

  setCone(you: { x: number; y: number }, gaze: number, halfAngle: number, range: number, amount: number): void {
    const u = this.uniforms;
    u.uYou.value.set(you.x, you.y);
    u.uGaze.value = gaze;
    u.uHalf.value = halfAngle;
    u.uRange.value = range;
    u.uCone.value = amount;
  }
}
