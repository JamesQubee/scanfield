// Everything drawn on the grass to talk to the player: the "you" ring, tappable
// targets, the tap burst and the pass arrows. All are created up front and only
// moved or shown, so a tap can be answered in the very next frame.

import { Color, DynamicDrawUsage, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, RingGeometry, ShaderMaterial } from "three";
import { worldX, worldZ } from "./coords";

const arrowVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const arrowFragment = /* glsl */ `
  uniform float uLen;
  uniform float uTime;
  uniform float uAlpha;
  uniform float uDash;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float along = vUv.x * uLen;
    float across = abs(vUv.y - 0.5) * 2.0;
    float head = min(1.8, uLen * 0.45);
    float hw = along > uLen - head ? (uLen - along) / head : 0.34;
    float aa = 0.08;
    float body = 1.0 - smoothstep(hw - aa, hw + aa, across);
    float dash = along > uLen - head ? 1.0 : mix(1.0, 0.35 + 0.65 * step(0.42, fract(along * 0.55 - uTime * 1.6)), uDash);
    float a = body * dash * uAlpha * smoothstep(0.0, 0.6, along);
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;

export class Arrow {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  constructor(color: string, width: number) {
    const geo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0);
    const mat = new ShaderMaterial({
      uniforms: {
        uLen: { value: 1 },
        uTime: { value: 0 },
        uAlpha: { value: 1 },
        uDash: { value: 1 },
        uColor: { value: new Color(color) },
      },
      vertexShader: arrowVertex,
      fragmentShader: arrowFragment,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new Mesh(geo, mat);
    this.mesh.scale.z = width;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }

  /** Points from a to b (pitch metres). */
  set(ax: number, ay: number, bx: number, by: number): void {
    const len = Math.max(0.5, Math.hypot(bx - ax, by - ay));
    this.mesh.position.set(worldX(ax), 0.05, worldZ(ay));
    this.mesh.rotation.y = -Math.atan2(by - ay, bx - ax);
    this.mesh.scale.x = len;
    this.mesh.material.uniforms.uLen!.value = len;
    this.mesh.visible = true;
  }

  tick(time: number, alpha: number): void {
    this.mesh.material.uniforms.uTime!.value = time;
    this.mesh.material.uniforms.uAlpha!.value = alpha;
  }
}

const m = new Matrix4();

export class Markers {
  readonly you: Mesh<RingGeometry, MeshBasicMaterial>;
  readonly targets: InstancedMesh;
  readonly tap: Mesh<RingGeometry, MeshBasicMaterial>;
  readonly choice = new Arrow("#ffffff", 1.3);
  readonly best = new Arrow("#ffd23f", 1.3);
  private tapStart = -1;

  constructor() {
    this.you = new Mesh(
      new RingGeometry(1.0, 1.35, 40).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: "#ffe14d", transparent: true, opacity: 0.95, depthWrite: false }),
    );
    this.you.renderOrder = 2;
    this.targets = new InstancedMesh(
      new RingGeometry(1.25, 1.55, 36).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.8, depthWrite: false }),
      24,
    );
    this.targets.instanceMatrix.setUsage(DynamicDrawUsage);
    this.targets.count = 0;
    this.targets.frustumCulled = false;
    this.targets.renderOrder = 2;
    this.tap = new Mesh(
      new RingGeometry(0.8, 1.0, 40).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false }),
    );
    this.tap.renderOrder = 4;
    this.tap.visible = false;
  }

  get all(): Mesh[] {
    return [this.you, this.targets, this.tap, this.choice.mesh, this.best.mesh];
  }

  setYou(x: number, y: number, time: number, visible: boolean): void {
    this.you.visible = visible;
    this.you.position.set(worldX(x), 0.04, worldZ(y));
    const s = 1 + 0.08 * Math.sin(time * 4);
    this.you.scale.set(s, 1, s);
  }

  setTargets(points: readonly { x: number; y: number }[], count: number, time: number): void {
    const s = 1 + 0.1 * Math.sin(time * 5);
    for (let i = 0; i < count; i++) {
      const p = points[i]!;
      m.makeScale(s, 1, s).setPosition(worldX(p.x), 0.045, worldZ(p.y));
      this.targets.setMatrixAt(i, m);
    }
    this.targets.count = count;
    this.targets.instanceMatrix.needsUpdate = true;
  }

  /** Called from the input handler: shows the burst on the next frame. */
  burst(x: number, y: number, time: number): void {
    this.tap.position.set(worldX(x), 0.06, worldZ(y));
    this.tap.visible = true;
    this.tapStart = time;
    this.tickTap(time);
  }

  tickTap(time: number): void {
    if (this.tapStart < 0) return;
    const k = (time - this.tapStart) / 0.45;
    if (k >= 1) {
      this.tap.visible = false;
      this.tapStart = -1;
      return;
    }
    const s = 0.6 + 1.8 * (1 - (1 - k) * (1 - k));
    this.tap.scale.set(s, 1, s);
    this.tap.material.opacity = 1 - k;
  }
}
