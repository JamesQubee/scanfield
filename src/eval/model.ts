// Model constants. They are deliberately few and physical (seconds, metres, m/s)
// so a coach can reason about them; ?tune=1 exposes them for live tweaking.

export interface ModelParams {
  /** Speed of a short pass along the ground, m/s; longer passes are hit harder. */
  passSpeed: number;
  /** Extra pass speed per metre of distance, m/s per m. */
  passSpeedPerM: number;
  /** Hardest pass, m/s. */
  passSpeedMax: number;
  /** Your body shields the first part of a pass from a marker on your back, m. */
  passShield: number;
  /** Time from the ball reaching you to it leaving your foot (control + pass), s. */
  passRelease: number;
  /** Carrying speed with the ball, m/s. */
  carrySpeed: number;
  /** Time to turn with the ball before carrying, s. */
  turnRelease: number;
  /** How far a carry goes before we judge it, m. */
  carryLength: number;
  /** Defender reaction time once the ball is played, s. */
  reaction: number;
  /** Defender top speed (youth), m/s. */
  defenderSpeed: number;
  /** Teammate run speed onto a ball into space, m/s. */
  runnerSpeed: number;
  /** How close a defender must get to a moving ball to cut it out, m. */
  interceptReach: number;
  /** Tackle reach against a carrier, m. */
  tackleReach: number;
  /** Softness of the interception race, s (bigger = less certain). */
  raceSoftness: number;
  /** Extra time lost by a heavy first touch (ball arrived while you looked away), s. */
  heavyTouch: number;
  /** Losing the ball costs this much on top of the counter-attack threat (shape lost, momentum gone). */
  turnoverCost: number;
  /** Highest grade for a choice that gets cut out. */
  failedCap: number;
  /** EV gap that maps to a grade of 0. */
  gradeScale: number;
  /** EV gaps this small still count as the right answer. */
  tieAbs: number;
  tieRel: number;
}

export const DEFAULT_PARAMS: ModelParams = {
  passSpeed: 13,
  passSpeedPerM: 0.2,
  passSpeedMax: 20,
  passShield: 1,
  passRelease: 0.3,
  carrySpeed: 5.5,
  turnRelease: 0.35,
  carryLength: 4.5,
  reaction: 0.3,
  defenderSpeed: 6.5,
  runnerSpeed: 7,
  interceptReach: 0.9,
  tackleReach: 1.2,
  raceSoftness: 0.12,
  heavyTouch: 0.25,
  turnoverCost: 0.015,
  failedCap: 35,
  gradeScale: 0.04,
  tieAbs: 0.0015,
  tieRel: 0.08,
};
