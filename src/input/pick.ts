// Turning a finger into a decision, in O(1)-ish work: one ray against the ground
// plane (no mesh raycasting), then snapping to the nearest teammate in screen space
// with a thumb-sized radius. Uses the camera of the frame the player was looking at.

import { Vector3 } from "three";
import type { V2 } from "../core/math";
import { pitchX, pitchY, worldX, worldZ } from "../render/coords";
import type { FrameCamera } from "../render/stage";

const a = new Vector3();
const b = new Vector3();

/** Ground point under (clientX, clientY), or null when the ray misses the grass (sky). */
export function groundPoint(f: FrameCamera, rect: DOMRect, clientX: number, clientY: number, out: V2): V2 | null {
  const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
  a.set(nx, ny, -1).applyMatrix4(f.projInv).applyMatrix4(f.world);
  b.set(nx, ny, 1).applyMatrix4(f.projInv).applyMatrix4(f.world);
  const dy = b.y - a.y;
  if (dy >= -1e-6) return null;
  const t = -a.y / dy;
  out.x = pitchX(a.x + (b.x - a.x) * t);
  out.y = pitchY(a.z + (b.z - a.z) * t);
  return out;
}

/** Screen position (CSS px, relative to the canvas) of a pitch point at height h. */
export function toScreen(f: FrameCamera, x: number, y: number, h: number, out: { x: number; y: number }): { x: number; y: number } {
  a.set(worldX(x), h, worldZ(y)).applyMatrix4(f.viewProj);
  out.x = (a.x * 0.5 + 0.5) * f.width;
  out.y = (-a.y * 0.5 + 0.5) * f.height;
  return out;
}

const s0 = { x: 0, y: 0 };
const s1 = { x: 0, y: 0 };

/**
 * Nearest candidate to the finger within max(minPx, 0.6 x the player's on-screen height).
 * Players are tall and thin on screen, so the distance is measured to the body's
 * vertical segment, not just to the feet.
 */
export function snapTo<T extends { x: number; y: number }>(f: FrameCamera, rect: DOMRect, clientX: number, clientY: number, candidates: readonly T[], minPx = 40): T | null {
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  let best: T | null = null;
  let bestD = Infinity;
  for (const c of candidates) {
    toScreen(f, c.x, c.y, 0, s0);
    toScreen(f, c.x, c.y, 1.9, s1);
    const height = Math.abs(s0.y - s1.y);
    const radius = Math.max(minPx, 0.6 * height);
    // Distance from the finger to the segment feet-head.
    const vx = s1.x - s0.x;
    const vy = s1.y - s0.y;
    const len2 = vx * vx + vy * vy || 1;
    const k = Math.max(0, Math.min(1, ((px - s0.x) * vx + (py - s0.y) * vy) / len2));
    const d = Math.hypot(px - (s0.x + vx * k), py - (s0.y + vy * k));
    if (d <= radius && d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}
