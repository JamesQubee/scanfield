// Small 2D helpers on plain {x, y} objects. Pitch coordinates are metres:
// x runs 0..105 towards the opponent goal, y runs 0..68 across the pitch.

export interface V2 {
  x: number;
  y: number;
}

export const PITCH_LENGTH = 105;
export const PITCH_WIDTH = 68;
export const GOAL_WIDTH = 7.32;

export const v2 = (x: number, y: number): V2 => ({ x, y });
export const dist = (a: V2, b: V2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));
export const smoothstep = (t: number): number => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};

/** Angle of the vector (dx, dy) in radians, 0 = +x (towards the opponent goal). */
export const heading = (dx: number, dy: number): number => Math.atan2(dy, dx);

/** Smallest signed difference a - b, wrapped to (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export function clampToPitch(p: V2, margin = 0.5): V2 {
  return { x: clamp(p.x, margin, PITCH_LENGTH - margin), y: clamp(p.y, margin, PITCH_WIDTH - margin) };
}

/** Writes a + (b - a) * t into out and returns it. */
export function lerpV2(out: V2, a: V2, b: V2, t: number): V2 {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  return out;
}
