// The ball is drawn larger than life (a real one is a few pixels from this camera)
// and rolls by the distance it travels. A soft ring on the grass makes it easy to find.

import { CanvasTexture, Mesh, MeshBasicMaterial, MeshLambertMaterial, Quaternion, RingGeometry, SphereGeometry, SRGBColorSpace, Vector3 } from "three";
import { worldX, worldZ } from "./coords";

export const BALL_RADIUS = 0.3;

function ballTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fbfbf8";
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = "#1c1c1c";
  // Twelve patches at icosahedron vertices, in equirectangular coordinates.
  const lat = Math.atan(0.5);
  const spots: [number, number][] = [[0, Math.PI / 2], [0, -Math.PI / 2]];
  for (let i = 0; i < 5; i++) {
    spots.push([(i * 2 * Math.PI) / 5, lat]);
    spots.push([((i + 0.5) * 2 * Math.PI) / 5, -lat]);
  }
  for (const [lon, la] of spots) {
    const x = ((lon / (2 * Math.PI)) * 256 + 256) % 256;
    const y = (0.5 - la / Math.PI) * 128;
    const rx = 15 / Math.max(Math.cos(la), 0.25);
    for (const dx of [-256, 0, 256]) {
      g.beginPath();
      g.ellipse(x + dx, y, Math.min(rx, 128), 14, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

const axis = new Vector3();
const q = new Quaternion();

export class BallView {
  readonly mesh: Mesh;
  readonly ring: Mesh<RingGeometry, MeshBasicMaterial>;
  private lastX = 0;
  private lastZ = 0;

  constructor() {
    this.mesh = new Mesh(new SphereGeometry(BALL_RADIUS, 20, 14), new MeshLambertMaterial({ map: ballTexture() }));
    this.mesh.name = "ball";
    this.ring = new Mesh(
      new RingGeometry(0.55, 0.72, 32).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: "#fff6c2", transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.ring.renderOrder = 1;
  }

  /** x, y in pitch metres, h = height above the grass. */
  update(x: number, y: number, h: number, time: number): void {
    const wx = worldX(x);
    const wz = worldZ(y);
    const dx = wx - this.lastX;
    const dz = wz - this.lastZ;
    const d = Math.hypot(dx, dz);
    if (d > 1e-4 && d < 5) {
      axis.set(dz / d, 0, -dx / d);
      q.setFromAxisAngle(axis, d / BALL_RADIUS);
      this.mesh.quaternion.premultiply(q);
    }
    this.lastX = wx;
    this.lastZ = wz;
    this.mesh.position.set(wx, BALL_RADIUS + h, wz);
    this.ring.position.set(wx, 0.03, wz);
    const s = 1 + 0.12 * Math.sin(time * 5);
    this.ring.scale.set(s, 1, s);
    this.ring.material.opacity = 0.75 / (1 + h);
  }
}
