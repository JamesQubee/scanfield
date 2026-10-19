// Android Chrome supports the Vibration API; iOS Safari has none, so on iPhone the
// tap is confirmed by the visual and the sound only.

let enabled = true;

export function buzz(ms: number): void {
  if (!enabled) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not allowed without a user gesture, or not supported */
  }
}

export function setHaptics(on: boolean): void {
  enabled = on;
}
