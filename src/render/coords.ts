// Pitch metres (x towards their goal, y across) <-> three.js world (X = x, Z = y, centred).
// With the camera behind our half looking up the pitch, +Z is screen-right.

import { PITCH_LENGTH, PITCH_WIDTH } from "../core/math";

export const HALF_L = PITCH_LENGTH / 2;
export const HALF_W = PITCH_WIDTH / 2;

export const worldX = (x: number): number => x - HALF_L;
export const worldZ = (y: number): number => y - HALF_W;
export const pitchX = (wx: number): number => wx + HALF_L;
export const pitchY = (wz: number): number => wz + HALF_W;

/** Yaw for three.js rotation.y so that an object's +X axis points along pitch heading h. */
export const yawFromHeading = (h: number): number => -h;
