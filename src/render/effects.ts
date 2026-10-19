// Confetti for a perfect decision: a fixed pool of instanced paper bits.

import { Color, DoubleSide, DynamicDrawUsage, Euler, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3 } from "three";
import { rng } from "../core/rng";
import { worldX, worldZ } from "./coords";

const N = 140;
const COLORS = ["#ffd23f", "#2f6df6", "#ffffff", "#22c55e", "#ff6b6b", "#7dd3fc"].map((c) => new Color(c));
const m = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const s = new Vector3(1, 1, 1);
const p = new Vector3();

export class Confetti {
  readonly mesh: InstancedMesh;
  private readonly pos = new Float32Array(N * 3);
  private readonly vel = new Float32Array(N * 3);
  private readonly rot = new Float32Array(N * 3);
  private start = -10;
  private last = 0;
  private readonly r = rng(11);

  constructor() {
    this.mesh = new InstancedMesh(new PlaneGeometry(0.22, 0.13), new MeshBasicMaterial({ side: DoubleSide }), N);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    for (let i = 0; i < N; i++) this.mesh.setColorAt(i, COLORS[i % COLORS.length]!);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 5;
  }

  fire(x: number, y: number, now: number): void {
    const r = this.r;
    for (let i = 0; i < N; i++) {
      this.pos[i * 3] = worldX(x) + (r() - 0.5) * 1.5;
      this.pos[i * 3 + 1] = 1 + r() * 1.5;
      this.pos[i * 3 + 2] = worldZ(y) + (r() - 0.5) * 1.5;
      const a = r() * Math.PI * 2;
      const sp = 2 + r() * 5;
      this.vel[i * 3] = Math.cos(a) * sp;
      this.vel[i * 3 + 1] = 6 + r() * 7;
      this.vel[i * 3 + 2] = Math.sin(a) * sp;
      this.rot[i * 3] = r() * 6;
      this.rot[i * 3 + 1] = r() * 6;
      this.rot[i * 3 + 2] = r() * 6;
    }
    this.start = now;
    this.last = now;
    this.mesh.visible = true;
  }

  update(now: number): void {
    if (!this.mesh.visible) return;
    const dt = Math.min(0.05, now - this.last);
    this.last = now;
    if (now - this.start > 2.2) {
      this.mesh.visible = false;
      return;
    }
    for (let i = 0; i < N; i++) {
      const j = i * 3;
      this.vel[j + 1]! -= 9 * dt;
      // Paper drifts: strong drag once falling.
      const drag = this.vel[j + 1]! < 0 ? 0.9 : 0.99;
      this.vel[j]! *= drag;
      this.vel[j + 2]! *= drag;
      if (this.vel[j + 1]! < -2.2) this.vel[j + 1] = -2.2;
      this.pos[j]! += this.vel[j]! * dt;
      this.pos[j + 1] = Math.max(0.05, this.pos[j + 1]! + this.vel[j + 1]! * dt);
      this.pos[j + 2]! += this.vel[j + 2]! * dt;
      this.rot[j]! += dt * 7;
      this.rot[j + 1]! += dt * 5;
      e.set(this.rot[j]!, this.rot[j + 1]!, this.rot[j + 2]!);
      q.setFromEuler(e);
      p.set(this.pos[j]!, this.pos[j + 1]!, this.pos[j + 2]!);
      m.compose(p, q, s);
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
