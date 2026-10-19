// One "picture" camera per moment: behind our half, looking up the pitch, framed
// so every player that matters fits the screen in portrait or landscape. The rig
// flies in for the establishing shot and can shake on an interception.

import { MathUtils, PerspectiveCamera, Vector3 } from "three";
import { worldX, worldZ } from "./coords";

export interface Shot {
  position: Vector3;
  target: Vector3;
  fov: number;
}

const tmpCam = new PerspectiveCamera();
const v = new Vector3();

/**
 * Finds the camera distance that fits all points (pitch metres) inside a safe area:
 * x within ±0.92 of the screen, y between -0.80 (bottom, above the buttons) and 0.70
 * (top, below the header).
 */
export function framePicture(points: readonly { x: number; y: number }[], focus: { x: number; y: number }, aspect: number, elevationDeg = 52): Shot {
  const fov = aspect < 0.8 ? 56 : 44;
  tmpCam.fov = fov;
  tmpCam.aspect = aspect;
  tmpCam.near = 0.5;
  tmpCam.far = 600;
  tmpCam.updateProjectionMatrix();
  const el = MathUtils.degToRad(elevationDeg);
  // Start from the middle of the points, pulled towards the receiver.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const target = new Vector3(worldX((minX + maxX) / 2), 0, worldZ((minY + maxY) * 0.25 + focus.y * 0.5));
  const place = (d: number) => {
    tmpCam.position.set(target.x - Math.cos(el) * d, Math.sin(el) * d, target.z);
    tmpCam.lookAt(target);
    tmpCam.updateMatrixWorld();
  };
  // Keep clear of the header (top) and the thumb buttons (bottom corners).
  const TOP = 0.62;
  const BOTTOM = aspect < 0.8 ? -0.6 : -0.7;
  const bounds = () => {
    let lo = Infinity, hi = -Infinity, side = 0;
    for (const p of points) {
      v.set(worldX(p.x), 0, worldZ(p.y)).project(tmpCam);
      lo = Math.min(lo, v.y);
      side = Math.max(side, Math.abs(v.x));
      v.set(worldX(p.x), 3, worldZ(p.y)).project(tmpCam);
      hi = Math.max(hi, v.y);
    }
    return { lo, hi, side };
  };
  const fit = () => {
    let lo = 8;
    let hi = 300;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      place(mid);
      const b = bounds();
      if (b.side <= 0.92 && b.lo >= BOTTOM && b.hi <= TOP) hi = mid;
      else lo = mid;
    }
    place(hi);
    return hi;
  };
  // Fit, then slide the target so the picture sits in the middle of the safe band; repeat.
  for (let k = 0; k < 4; k++) {
    const d = fit();
    const b = bounds();
    const off = (b.lo + b.hi) / 2 - (BOTTOM + TOP) / 2;
    // Screen-up is +x on the pitch; a rough metres-per-NDC at this distance is enough.
    target.x += off * d * Math.tan(MathUtils.degToRad(fov / 2)) * 0.9;
  }
  fit();
  return { position: tmpCam.position.clone(), target, fov };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class CameraRig {
  private from: Shot | null = null;
  private to: Shot | null = null;
  private start = 0;
  private duration = 1;
  private shakeUntil = -1;
  private shakeAmp = 0;
  private readonly pos = new Vector3();
  private readonly look = new Vector3();

  constructor(private readonly camera: PerspectiveCamera) {}

  cut(shot: Shot): void {
    this.from = null;
    this.to = shot;
  }

  flyTo(shot: Shot, now: number, duration: number, from?: Shot): void {
    this.from = from ?? this.current();
    this.to = shot;
    this.start = now;
    this.duration = duration;
  }

  /** An establishing shot: high in the corner behind our goal, looking at the play. */
  static establishing(shot: Shot): Shot {
    const position = shot.target.clone().add(new Vector3(-48, 46, -38));
    return { position, target: shot.target.clone(), fov: shot.fov };
  }

  shake(now: number, amp = 0.35, duration = 0.35): void {
    this.shakeUntil = now + duration;
    this.shakeAmp = amp;
  }

  get settled(): boolean {
    return !this.from;
  }

  current(): Shot {
    return { position: this.camera.position.clone(), target: this.look.clone(), fov: this.camera.fov };
  }

  update(now: number): void {
    const to = this.to;
    if (!to) return;
    if (this.from) {
      const k = Math.min(1, (now - this.start) / this.duration);
      const e = ease(k);
      this.pos.lerpVectors(this.from.position, to.position, e);
      this.look.lerpVectors(this.from.target, to.target, e);
      this.camera.fov = MathUtils.lerp(this.from.fov, to.fov, e);
      if (k >= 1) this.from = null;
    } else {
      this.pos.copy(to.position);
      this.look.copy(to.target);
      this.camera.fov = to.fov;
    }
    this.camera.position.copy(this.pos);
    if (now < this.shakeUntil) {
      const a = this.shakeAmp * ((this.shakeUntil - now) / 0.35);
      this.camera.position.x += Math.sin(now * 91) * a;
      this.camera.position.y += Math.sin(now * 73 + 1) * a * 0.6;
      this.camera.position.z += Math.sin(now * 67 + 2) * a;
    }
    this.camera.lookAt(this.look);
    this.camera.updateProjectionMatrix();
  }
}
