// How valuable it is to have the ball at a spot. A simple, published-shape curve
// (progress up the pitch plus shot threat near goal), not a fitted dataset.

import { GOAL_WIDTH, PITCH_LENGTH, PITCH_WIDTH, type V2 } from "../core/math";

const GOAL_Y = PITCH_WIDTH / 2;
const HALF_GOAL = GOAL_WIDTH / 2;

/** Value of us having the ball at (x, y), attacking towards x = 105. */
export function zoneValue(x: number, y: number): number {
  const fx = Math.min(Math.max(x / PITCH_LENGTH, 0), 1);
  const off = (y - GOAL_Y) / GOAL_Y;
  const progress = 0.12 * Math.pow(fx, 2.2) * (1 - 0.35 * off * off);
  const dx = Math.max(PITCH_LENGTH - x, 0.01);
  const dy = y - GOAL_Y;
  const d = Math.hypot(dx, dy);
  // Angle the goal mouth subtends from (x, y).
  const theta = Math.abs(Math.atan2(dy + HALF_GOAL, dx) - Math.atan2(dy - HALF_GOAL, dx));
  const shot = 0.3 * Math.exp(-d / 14) * Math.sqrt(theta / Math.PI);
  return 0.002 + progress + shot;
}

export const valueAt = (p: V2): number => zoneValue(p.x, p.y);

/** Value to the opponent of winning the ball at p (they attack towards x = 0). */
export const oppValueAt = (p: V2): number => zoneValue(PITCH_LENGTH - p.x, PITCH_WIDTH - p.y);
