// Product analytics. With a PostHog project key (VITE_POSTHOG_KEY) the real
// posthog-js is loaded lazily, after the first frame, through the Worker's /ingest
// proxy. Without a key, events stay on the device and the in-app inspector shows
// exactly what would have been sent.

type Props = Record<string, string | number | boolean | null>;

export interface TrackedEvent {
  name: string;
  props: Props;
  at: number;
}

interface PostHogLike {
  capture(name: string, props?: Props): void;
  identify(id: string): void;
}

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const recent: TrackedEvent[] = [];
const listeners = new Set<() => void>();
let ph: PostHogLike | null = null;
let loading: Promise<void> | null = null;
const pending: TrackedEvent[] = [];
let distinctId: string | null = null;

export const analyticsMode: "posthog" | "local" = KEY ? "posthog" : "local";

/** Coarse device bucket, for latency and frame-rate breakdowns per device class. */
export function deviceClass(): string {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad|iPod/.test(ua) ? "ios" : /Android/.test(ua) ? "android" : /Mac/.test(ua) ? "mac" : /Windows/.test(ua) ? "windows" : "other";
  const cores = navigator.hardwareConcurrency || 0;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return `${os}-${cores}c${mem ? `-${mem}gb` : ""}`;
}

function load(): Promise<void> {
  if (!KEY || loading) return loading ?? Promise.resolve();
  loading = import("posthog-js").then(({ default: posthog }) => {
    posthog.init(KEY, {
      api_host: "/ingest",
      ui_host: "https://us.posthog.com",
      autocapture: false,
      capture_pageview: true,
      disable_session_recording: true,
      person_profiles: "identified_only",
      persistence: "localStorage",
    });
    ph = posthog as unknown as PostHogLike;
    if (distinctId) ph.identify(distinctId);
    for (const e of pending.splice(0)) ph.capture(e.name, e.props);
  });
  return loading;
}

export function track(name: string, props: Props = {}): void {
  const e: TrackedEvent = { name, props, at: Date.now() };
  recent.unshift(e);
  if (recent.length > 60) recent.pop();
  for (const f of listeners) f();
  if (!KEY) return;
  if (ph) ph.capture(name, props);
  else {
    pending.push(e);
    // Never on the critical path: load once the browser is idle-ish.
    setTimeout(() => void load(), 1500);
  }
}

export function identify(id: string): void {
  distinctId = id;
  ph?.identify(id);
}

export function recentEvents(): readonly TrackedEvent[] {
  return recent;
}

export function onEvents(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
