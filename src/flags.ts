// URL switches. ?scene=<id> opens one scene (the paid-trial deliverable shape),
// ?debug=1 shows the performance overlay, ?tune=1 the live tuning panel,
// ?capture=1 a fixed-step clock for recordings and tests, ?animations=on|off
// overrides reduced-motion.

const q = new URLSearchParams(location.search);

export const FLAGS = {
  scene: q.get("scene"),
  drill: q.get("drill"),
  debug: q.get("debug") === "1",
  tune: q.get("tune") === "1",
  capture: q.get("capture") === "1",
  animations: q.get("animations") as "on" | "off" | null,
};
