// Static surroundings, merged so the whole stadium costs five draw calls:
// stands with a painted crowd, advertising boards, goal frames and floodlights,
// goal nets, and a sky dome.

import {
  BackSide,
  DoubleSide,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { rng } from "../core/rng";
import { HALF_L, HALF_W } from "./coords";

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function texture(c: HTMLCanvasElement, repeat = true): Texture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

function crowdTexture(): Texture {
  const [c, g] = canvas(512, 256);
  g.fillStyle = "#24324a";
  g.fillRect(0, 0, 512, 256);
  const r = rng(7);
  const shirts = ["#e94f4f", "#f3f3f3", "#2b6fff", "#ffd23f", "#1f2937", "#ff8c42", "#5ec2ff", "#c3e88d"];
  // Rows of seats, each with a supporter: a shirt and a head.
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 40; col++) {
      if (r() < 0.12) continue;
      const x = col * 12.8 + 6 + (r() - 0.5) * 3;
      const y = row * 16 + 10;
      g.fillStyle = shirts[Math.floor(r() * shirts.length)]!;
      g.fillRect(x - 4, y - 1, 8, 7);
      g.fillStyle = r() < 0.5 ? "#f1c9a5" : r() < 0.5 ? "#a8754f" : "#6b4a33";
      g.beginPath();
      g.arc(x, y - 4, 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  return texture(c);
}

function boardTexture(): Texture {
  const [c, g] = canvas(1024, 64);
  const panels = [
    ["#0f172a", "#7dd3fc", "SCANFIELD"],
    ["#f59e0b", "#111827", "SEE IT FIRST"],
    ["#16a34a", "#ffffff", "CHECK YOUR SHOULDER"],
    ["#1d4ed8", "#ffffff", "HALF-TURN"],
  ] as const;
  const w = 1024 / panels.length;
  panels.forEach(([bg, fg, text], i) => {
    g.fillStyle = bg;
    g.fillRect(i * w, 0, w, 64);
    g.fillStyle = fg;
    g.font = "800 30px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, i * w + w / 2, 34);
  });
  return texture(c);
}

function netTexture(): Texture {
  const [c, g] = canvas(64, 64);
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = "rgba(255,255,255,0.9)";
  g.lineWidth = 3;
  g.strokeRect(0, 0, 64, 64);
  const t = texture(c);
  return t;
}

/** A quad with UVs in metres / tile, so textures tile evenly whatever the size. */
function quad(a: number[], b: number[], c: number[], d: number[], tileU: number, tileV: number): BufferGeometry {
  const g = new BufferGeometry();
  const lenU = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!) / tileU;
  const lenV = Math.hypot(d[0]! - a[0]!, d[1]! - a[1]!, d[2]! - a[2]!) / tileV;
  g.setAttribute("position", new Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
  g.setAttribute("uv", new Float32BufferAttribute([0, 0, lenU, 0, lenU, lenV, 0, 0, lenU, lenV, 0, lenV], 2));
  g.computeVertexNormals();
  return g;
}

function stands(): Mesh {
  const parts: BufferGeometry[] = [];
  const gap = 7;
  const depth = 20;
  const rise = 13;
  // Long sides (along x) and ends (along z). Each stand is a rake facing the pitch.
  const longX = HALF_L + 2;
  const endZ = HALF_W + 2;
  for (const side of [-1, 1]) {
    const z0 = side * (HALF_W + gap);
    const z1 = side * (HALF_W + gap + depth);
    // Wind the quad so its front faces the pitch.
    const a = [-longX, 0, z0];
    const b = [longX, 0, z0];
    const c = [longX, rise, z1];
    const d = [-longX, rise, z1];
    parts.push(side < 0 ? quad(b, a, d, c, 12.8, 3) : quad(a, b, c, d, 12.8, 3));
    const x0 = side * (HALF_L + gap + 1);
    const x1 = side * (HALF_L + gap + 1 + depth * 0.8);
    const e = [x0, 0, -endZ];
    const f = [x0, 0, endZ];
    const g2 = [x1, rise * 0.8, endZ];
    const h = [x1, rise * 0.8, -endZ];
    parts.push(side < 0 ? quad(e, f, g2, h, 12.8, 3) : quad(f, e, h, g2, 12.8, 3));
  }
  const tex = crowdTexture();
  return new Mesh(mergeGeometries(parts), new MeshLambertMaterial({ map: tex, side: DoubleSide }));
}

function boards(): Mesh {
  const parts: BufferGeometry[] = [];
  const h = 0.9;
  const off = 4;
  const along = (len: number, x: number, z: number, rotY: number) => {
    const g = new BoxGeometry(len, h, 0.15);
    // UVs: repeat the 4-panel strip every 32 m along the board.
    const uv = g.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (len / 32));
    g.rotateY(rotY);
    g.translate(x, h / 2, z);
    parts.push(g);
  };
  along(105 + 2 * off, 0, -(HALF_W + off), 0);
  along(105 + 2 * off, 0, HALF_W + off, Math.PI);
  along(68 + 2 * off, -(HALF_L + off), 0, Math.PI / 2);
  along(68 + 2 * off, HALF_L + off, 0, -Math.PI / 2);
  return new Mesh(mergeGeometries(parts), new MeshBasicMaterial({ map: boardTexture() }));
}

function frames(): Mesh {
  const parts: BufferGeometry[] = [];
  const r = 0.07;
  for (const end of [-1, 1]) {
    const x = end * HALF_L;
    for (const zs of [-1, 1]) {
      const post = new CylinderGeometry(r, r, 2.44, 8);
      post.translate(x, 1.22, zs * 3.66);
      parts.push(post);
    }
    const bar = new CylinderGeometry(r, r, 7.32 + 2 * r, 8);
    bar.rotateX(Math.PI / 2);
    bar.translate(x, 2.44, 0);
    parts.push(bar);
  }
  // Floodlight masts in the corners.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const mast = new CylinderGeometry(0.35, 0.5, 34, 6);
      mast.translate(sx * (HALF_L + 14), 17, sz * (HALF_W + 16));
      parts.push(mast);
      const head = new BoxGeometry(5, 3, 1);
      head.lookAt(new Vector3(-sx, -0.6, -sz));
      head.translate(sx * (HALF_L + 14), 34, sz * (HALF_W + 16));
      parts.push(head);
    }
  }
  return new Mesh(mergeGeometries(parts.map((p) => p.toNonIndexed())), new MeshLambertMaterial({ color: new Color("#f4f6f8") }));
}

function nets(): Mesh {
  const parts: BufferGeometry[] = [];
  for (const end of [-1, 1]) {
    const x = end * HALF_L;
    const back = x + end * 2;
    // Back, roof and two sides of the net box.
    parts.push(quad([back, 0, -3.66], [back, 0, 3.66], [back, 2.44, 3.66], [back, 2.44, -3.66], 0.25, 0.25));
    parts.push(quad([x, 2.44, -3.66], [back, 2.44, -3.66], [back, 2.44, 3.66], [x, 2.44, 3.66], 0.25, 0.25));
    for (const zs of [-1, 1]) parts.push(quad([x, 0, zs * 3.66], [back, 0, zs * 3.66], [back, 2.44, zs * 3.66], [x, 2.44, zs * 3.66], 0.25, 0.25));
  }
  const mat = new MeshBasicMaterial({ map: netTexture(), transparent: true, opacity: 0.85, alphaTest: 0.3, side: DoubleSide, depthWrite: false });
  return new Mesh(mergeGeometries(parts), mat);
}

function sky(): Mesh {
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: { uTop: { value: new Color("#3d86d8") }, uHorizon: { value: new Color("#cfe6f7") } },
    vertexShader: /* glsl */ `
      varying float vH;
      void main() {
        vH = normalize(position).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      varying float vH;
      void main() {
        gl_FragColor = vec4(mix(uHorizon, uTop, smoothstep(0.0, 0.45, vH)), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new Mesh(new SphereGeometry(450, 24, 12), mat);
  m.renderOrder = -1;
  return m;
}

export function buildStadium(): Group {
  const g = new Group();
  g.name = "stadium";
  g.add(sky(), stands(), boards(), frames(), nets());
  return g;
}
