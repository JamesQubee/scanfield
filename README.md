# Scanfield

A mobile-first browser game that trains young footballers to **check their shoulder before the ball arrives** and then make the right decision on the ball.

- While a pass travels to you, tap **Check** (or swipe) to look over a shoulder. The bright cone on the grass is what you can see.
- Players outside your cone are drawn where you **last saw them**, as translucent ghosts. They keep moving, so the picture goes stale.
- When the ball arrives, time slows and you **tap the pitch**: a teammate to pass, open grass to turn and carry, or the passer to set it back.
- The truth is revealed (ghosts slide to where players really were), the ball goes, and a **coach board** scores every option, shows your scanning timeline and explains the best choice.

Built with TypeScript, three.js (WebGL) and Canvas 2D on the client, and a Cloudflare Worker with D1 behind it. Payments are wired for Lemon Squeezy and analytics for PostHog.

## Try it

Live: **https://play.scanfield.workers.dev** (Cloudflare Workers + D1). A 1:30 walkthrough video is at [/walkthrough.mp4](https://play.scanfield.workers.dev/walkthrough.mp4).

| URL | What it shows |
|---|---|
| `/` | Home, three drills (one behind the Pro paywall), progress, settings |
| `/?scene=ht-01-marker-leaves` | One scene straight away: the shape of a single deliverable built from a spec |
| `/?debug=1` | Performance overlay: fps, frame p95, tap→frame time, tap handler time, draw calls |
| `/?tune=1` | Live tuning panel (decision window, speeds, field of view); "Copy settings" exports JSON |
| `/?capture=1` | Fixed-step clock for recordings and tests (frames advance only via `window.__game.step()`) |
| `/?animations=on` | Forces camera shake and confetti on even when the device asks for reduced motion |

## How the "instant tap" works

The response to a tap is drawn in the first frame after the finger lands. Scoring waits for the frame after that.

1. **No browser gesture handling on the pitch.** The canvas has `touch-action: none` (that, not `user-scalable=no`, is what stops iOS double-tap zoom), plus no text selection, no long-press callout and no tap highlight. Edge swipes are left to the OS back gesture.
2. **`pointerdown`, not `click`.** The decision commits when the finger touches the glass. Taps that started before the decision window opened are ignored.
3. **Constant-time hit test.** One ray from the camera *of the frame on screen* against the ground plane (no mesh raycasting), then snapping to the nearest teammate in screen space with a thumb-sized radius (≥ 40 px, measured to the player's whole body).
4. **Feedback before scoring.** The handler only moves pre-built objects: the tap ring, the pass arrow, a DOM ripple via the Web Animations API (no forced reflow), a pre-decoded Web Audio click, and a 12 ms vibration on Android. The evaluator runs in the next frame.
5. **No stalls at the decisive moment.** Every shader is compiled with `renderer.compileAsync` behind the start screen, with every visual state shown once. Nothing toggles a shader program at runtime, and the frame loop allocates nothing.
6. **Cheap frames.** Players are one `InstancedMesh` per body part (about 6 draw calls for 22 players). The pitch is a single shader that draws the markings as distance fields, and shadows are blobs. There are about 20 draw calls and 15k triangles per frame. The pixel ratio is capped at 2 and stepped down between moments if frames run long.
7. **Frame-rate independent.** Positions are functions of time, and memory updates in fixed 120 Hz steps, so 30 fps (iOS Low Power Mode) plays exactly like 120 fps.
8. **Measured, not assumed.** `?debug=1` shows touch → feedback-frame time and the handler's own cost. Every decision sends `input_to_frame_ms` with a device bucket to analytics, so real p95s per device class can be watched after launch.

Measured on emulated phones on a machine without a GPU (so rendering is software and pessimistic): the tap handler takes about 1 ms of JavaScript (3 ms with the CPU slowed 4×), and game logic 0.2–1 ms per frame. See `docs/evidence/perf.md` in the project notes.

## Scenarios are data

Each moment is a JSON file in `scenarios/`: positions and runs as keyframes `[t, x, y]` (metres; x towards the opponent goal), who passes, the pass speed, the coach's explanation, the intended best option and whether the answer depends on scanning.

```jsonc
{
  "id": "ht-01-marker-leaves",
  "skill": "half-turn",
  "intendedBest": "carry",          // or "setback", "pass:<id>", "space:<id>"
  "scanRequired": true,
  "keyEntity": "o8",                 // the player the answer hinges on
  "timed": false,
  "kickAt": 1.2, "passSpeed": 12,
  "you": { "id": "you", "number": 6, "path": [[0, 44, 33], [2.4, 42.5, 33]] },
  "opponents": [{ "id": "o8", "number": 8, "path": [[0, 46, 34], [1.2, 46, 34.5], [2.4, 52, 43.5]] }]
}
```

The evaluator (`src/eval/`) scores every option at the moment you decide. For each defender it works out how long he needs to react and reach the pass line, and compares that with the ball. That gives a probability for each option, which is weighed against what you gain and what a turnover would cost. It is inspired by physics-based pass models such as Spearman's. Tests check every scenario against it:

- the author's intended answer must rank first across the whole decision window;
- it must still rank first in at least 80% of 50 runs with positions and speeds jittered;
- a scenario marked scan-required must keep the key player hidden unless you check late.

`pnpm scenarios` prints the option table for whoever writes the spec.

## Backend

One Worker serves the static game and the API (`run_worker_first` only for `/api/*` and `/ingest/*`):

- `POST /api/players` creates an anonymous player and returns a bearer token; only its hash is stored. Nicknames are filtered so they cannot carry contact details.
- `POST /api/runs` saves a drill as a run plus its moments in one D1 batch, keyed by a client UUID, so resends are harmless. Scores are computed on the server. The client queues runs and retries them, sending with `keepalive`.
- `POST /api/webhooks/lemonsqueezy` reads the raw body and checks `X-Signature` (HMAC-SHA256, constant time). It deduplicates by body hash and ignores out-of-order subscription updates. Personal fields are never stored. See `worker/LEMON_SQUEEZY_NOTES.md`.
- `POST /api/checkout` returns a Lemon Squeezy checkout URL with `checkout[custom][player_id]`. In demo mode it runs a test checkout instead: the server signs a `subscription_created` event and sends it through the same webhook handler.
- `/ingest/*` is a PostHog reverse proxy. `posthog-js` is only loaded when `VITE_POSTHOG_KEY` is set, and then lazily. Without a key, Settings → Analytics events shows what would be sent.

## Run it

```bash
pnpm install
cp .dev.vars.example .dev.vars          # TOKEN_PEPPER and LS_SIGNING_SECRET
pnpm db:migrate:local
pnpm dev                                 # http://127.0.0.1:5540
```

Tests:

```bash
pnpm test:unit      # evaluator, vision/memory, scenario consistency
pnpm test:worker    # API inside workerd with D1
pnpm e2e            # Playwright: WebKit with an iPhone profile, Chrome with a Pixel profile
pnpm typecheck
```

Deploy (Cloudflare):

```bash
wrangler d1 create scanfield             # put the id in wrangler.jsonc
wrangler d1 migrations apply scanfield --remote
wrangler secret put TOKEN_PEPPER
wrangler secret put LS_SIGNING_SECRET
pnpm deploy
```

## Layout

```
src/sim       scenarios, paths, vision cone and memory (no three.js, no DOM)
src/eval      pass / carry / space model, zone value, grading
src/game      moment state machine, world (fairness rule), controller and input
src/render    stage, pitch shader, stadium, instanced players, ball, markers, camera
src/ui        HUD, Canvas 2D coach board, menus, perf overlay, tuning panel
src/platform  API client with outbox, analytics, audio, haptics, storage
worker        Cloudflare Worker routes and libs; migrations/ for D1
scenarios     one JSON file per moment
```

## Credits

three.js (MIT), Barlow Condensed (SIL Open Font License), lil-gui (MIT). Sounds are synthesised in code; the stadium and crowd are drawn procedurally.
