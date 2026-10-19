// Sound effects synthesised once into AudioBuffers (no files, nothing to license).
// The context is unlocked on the first user gesture; iOS also needs a silent buffer
// played inside that gesture. Sound is a bonus: the iPhone mute switch silences
// Web Audio, so nothing important is said only with sound.

type Sfx = "tap" | "kick" | "touch" | "scan" | "good" | "bad" | "whistle" | "cheer" | "ooh";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<Sfx, AudioBuffer>();
let enabled = true;
let crowd: AudioBufferSourceNode | null = null;
let crowdGain: GainNode | null = null;

function render(seconds: number, fn: (t: number, i: number) => number, rate = 22050): AudioBuffer {
  const b = ctx!.createBuffer(1, Math.ceil(seconds * rate), rate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = fn(i / rate, i);
  return b;
}

let seed = 1;
const noise = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed / 2147483647) * 2 - 1;
};

function build(): void {
  const env = (t: number, a: number, d: number) => (t < a ? t / a : Math.exp(-(t - a) / d));
  buffers.set("tap", render(0.09, (t) => Math.sin(2 * Math.PI * (1400 - 5000 * t) * t) * env(t, 0.002, 0.025) * 0.6));
  buffers.set("kick", render(0.22, (t) => (Math.sin(2 * Math.PI * 95 * t) * 0.9 + noise() * 0.5 * Math.exp(-t / 0.01)) * env(t, 0.002, 0.06)));
  buffers.set("touch", render(0.16, (t) => (Math.sin(2 * Math.PI * 130 * t) * 0.7 + noise() * 0.25 * Math.exp(-t / 0.008)) * env(t, 0.002, 0.04)));
  let lp = 0;
  buffers.set("scan", render(0.24, (t) => {
    lp += (noise() - lp) * (0.05 + 0.5 * Math.sin(Math.PI * (t / 0.24)));
    return lp * Math.sin(Math.PI * (t / 0.24)) * 0.9;
  }));
  buffers.set("good", render(0.5, (t) => (Math.sin(2 * Math.PI * 784 * t) * env(t, 0.005, 0.12) + Math.sin(2 * Math.PI * 1175 * t) * env(Math.max(0, t - 0.09), 0.005, 0.18) * (t > 0.09 ? 1 : 0)) * 0.35));
  buffers.set("bad", render(0.35, (t) => Math.sign(Math.sin(2 * Math.PI * 140 * t)) * env(t, 0.005, 0.12) * 0.18));
  buffers.set("whistle", render(0.45, (t) => Math.sin(2 * Math.PI * (2900 + 120 * Math.sin(2 * Math.PI * 38 * t)) * t) * (t < 0.4 ? Math.min(1, t / 0.02) : Math.max(0, 1 - (t - 0.4) / 0.05)) * 0.22));
  let band = 0;
  buffers.set("cheer", render(1.6, (t) => {
    band += (noise() - band) * 0.25;
    return band * Math.sin(Math.PI * Math.min(1, t / 1.6)) * 1.1;
  }));
  let o = 0;
  buffers.set("ooh", render(1.0, (t) => {
    o += (noise() - o) * 0.08;
    return (o * 1.6 + Math.sin(2 * Math.PI * (210 + 30 * t) * t) * 0.08) * Math.sin(Math.PI * t);
  }));
}

/** Call inside a user gesture (click / pointerup). Safe to call more than once. */
export function unlockAudio(): void {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC({ latencyHint: "interactive" });
      master = ctx.createGain();
      master.gain.value = enabled ? 0.9 : 0;
      master.connect(ctx.destination);
      build();
    }
    if (ctx.state !== "running") void ctx.resume();
    // iOS: a sound started inside the gesture keeps the context unlocked.
    const s = ctx.createBufferSource();
    s.buffer = ctx.createBuffer(1, 1, 22050);
    s.connect(master!);
    s.start();
  } catch {
    ctx = null;
  }
}

export function play(name: Sfx, volume = 1): void {
  if (!ctx || !master || !enabled) return;
  const b = buffers.get(name);
  if (!b) return;
  const src = ctx.createBufferSource();
  src.buffer = b;
  const g = ctx.createGain();
  g.gain.value = volume;
  src.connect(g).connect(master);
  src.start();
}

/** A low crowd bed under the game. */
export function crowdOn(level = 0.12): void {
  if (!ctx || !master || crowd) return;
  let w = 0;
  const b = render(3, () => {
    w += (noise() - w) * 0.03;
    return w * 2.2;
  });
  crowd = ctx.createBufferSource();
  crowd.buffer = b;
  crowd.loop = true;
  crowdGain = ctx.createGain();
  crowdGain.gain.value = level;
  crowd.connect(crowdGain).connect(master);
  crowd.start();
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  if (master) master.gain.value = on ? 0.9 : 0;
}

export function soundEnabled(): boolean {
  return enabled;
}

/** Keep the context running after the tab comes back. */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && ctx && ctx.state !== "running") void ctx.resume();
});
