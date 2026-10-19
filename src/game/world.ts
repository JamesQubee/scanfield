// Builds the 3D scene and, every frame, turns the moment's state into poses.
// The fairness rule lives here: until you decide, a player you cannot see is
// drawn only where you last saw him (a ghost), never where he really is.

import { DirectionalLight, HemisphereLight } from "three";
import { angleDiff, heading, smoothstep, type V2 } from "../core/math";
import { BallView } from "../render/ball";
import { framePicture, type Shot } from "../render/cameraRig";
import { Confetti } from "../render/effects";
import { Markers } from "../render/markers";
import { Pitch } from "../render/pitch";
import { PlayersView, type PlayerPose } from "../render/players";
import { buildStadium } from "../render/stadium";
import type { Stage } from "../render/stage";
import { posAt, type Entity } from "../sim/scenario";
import type { Moment } from "./moment";

const STRIDE = 1.7;

interface Track {
  prev: V2;
  heading: number;
  speed: number;
  phase: number;
}

export interface Label {
  number: number;
  team: "us" | "them";
  you: boolean;
  ghost: boolean;
  /** Index into players.anchors. */
  anchor: number;
}

const tmp: V2 = { x: 0, y: 0 };
const ballTmp = { x: 0, y: 0, h: 0 };

export class World {
  readonly pitch = new Pitch();
  readonly players = new PlayersView(24);
  readonly ball = new BallView();
  readonly markers = new Markers();
  readonly confetti = new Confetti();
  readonly poses: PlayerPose[] = Array.from({ length: 24 }, () => ({
    team: "mate",
    number: 0,
    x: 0,
    y: 0,
    heading: 0,
    speed: 0,
    phase: 0,
    headYaw: 0,
    kick: -1,
    visible: true,
    ghost: 0,
    gx: 0,
    gy: 0,
    gHeading: 0,
  }));
  readonly labels: Label[] = [];
  /** Drawn positions of teammates you can pass to (decide phase), with ids. */
  readonly targets: { id: string; x: number; y: number }[] = [];
  private tracks = new Map<string, Track>();
  private lastTau = 0;
  coneAmount = 0;

  constructor(readonly stage: Stage) {
    const s = stage.scene;
    s.add(new HemisphereLight("#eaf4ff", "#3d6b3a", 2.1));
    const sun = new DirectionalLight("#fff4e0", 1.7);
    sun.position.set(-40, 80, -30);
    s.add(sun);
    s.add(buildStadium(), this.pitch.mesh, ...this.players.meshes, this.ball.mesh, this.ball.ring, ...this.markers.all, this.confetti.mesh);
  }

  /** The picture camera for a moment: everyone who matters on screen. */
  shotFor(moment: Moment): Shot {
    // Frame what matters: you, the passer, teammates you could pass to and the
    // opponents near you. Far-away players may sit at the edge or just off it.
    const s = moment.scenario;
    const pts: V2[] = [s.receiveAt, s.kickFrom];
    for (const e of s.all) {
      for (const t of [0, s.arrival]) {
        const p = posAt(e, t);
        const d = Math.hypot(p.x - s.receiveAt.x, p.y - s.receiveAt.y);
        if (e.team === "mate" ? d <= 25 : d <= 18) pts.push(p);
      }
    }
    return framePicture(pts, s.receiveAt, this.stage.width / this.stage.height);
  }

  reset(): void {
    this.tracks.clear();
    this.lastTau = 0;
    this.coneAmount = 0;
    this.markers.choice.mesh.visible = false;
    this.markers.best.mesh.visible = false;
    this.markers.targets.count = 0;
  }

  /** Writes every pose and marker for this frame. `now` is clock time (s). */
  sync(moment: Moment, now: number, dt: number): void {
    const s = moment.scenario;
    const tau = moment.tau;
    const dTau = Math.max(0, tau - this.lastTau);
    this.lastTau = tau;
    const phase = moment.phase;
    const decided = phase === "outcome" || phase === "review";
    const revealK = decided ? smoothstep((now - moment.outcomeStart) / 0.35) : 0;
    const ghostFade = decided ? Math.max(0, 1 - (now - moment.outcomeStart) / 0.9) : 1;
    const vision = moment.vision;
    const ball = moment.ballPos(tau, ballTmp);
    const me = moment.truePos(s.you, tau, { x: 0, y: 0 });

    this.labels.length = 0;
    this.targets.length = 0;
    let n = 0;
    for (const e of s.all) {
      const pose = this.poses[n]!;
      const truth = moment.truePos(e, tau, tmp);
      const track = this.track(e, truth);
      // Animation follows how far the player moved in game time.
      const moved = Math.hypot(truth.x - track.prev.x, truth.y - track.prev.y);
      const speed = dTau > 1e-4 ? moved / dTau : track.speed * Math.exp(-dt * 6);
      track.speed += (Math.min(speed, 9) - track.speed) * Math.min(1, dt * 10);
      track.phase += (moved / STRIDE) * Math.PI * 2;
      const toBall = heading(ball.x - truth.x, ball.y - truth.y);
      let want = track.speed > 0.8 && moved > 1e-4 ? heading(truth.x - track.prev.x, truth.y - track.prev.y) : toBall;
      if (e === s.you && !decided) want = vision.bodyYaw(tau);
      track.heading += angleDiff(want, track.heading) * Math.min(1, dt * 9);
      track.prev.x = truth.x;
      track.prev.y = truth.y;

      pose.team = e.team;
      pose.number = e.number;
      pose.x = truth.x;
      pose.y = truth.y;
      pose.heading = track.heading;
      pose.speed = track.speed;
      pose.phase = track.phase;
      pose.headYaw = e === s.you && !decided ? vision.scanOffset(tau) : 0;
      pose.kick = this.kick(moment, e, tau);
      pose.visible = true;
      pose.ghost = 0;

      if (e !== s.you) {
        const mem = vision.memory.get(e.id)!;
        if (phase === "play" || phase === "decide") {
          if (!mem.live) {
            pose.visible = false;
            pose.ghost = Math.min(0.8, Math.max(0.15, 0.8 * (1 - (tau - mem.t) / 2.5)));
            pose.gx = mem.x;
            pose.gy = mem.y;
            pose.gHeading = heading(me.x - mem.x, me.y - mem.y);
          }
        } else if (decided) {
          const g = moment.ghostAtDecision.get(e.id);
          if (g) {
            // Reveal: the real player slides from where you thought he was to where he is.
            pose.x = g.x + (truth.x - g.x) * revealK;
            pose.y = g.y + (truth.y - g.y) * revealK;
            pose.ghost = 0.55 * ghostFade;
            pose.gx = g.x;
            pose.gy = g.y;
            pose.gHeading = heading(me.x - g.x, me.y - g.y);
          }
        }
      }
      if (phase === "decide" && e.team === "mate") {
        this.targets.push({ id: e.id, x: pose.visible ? pose.x : pose.gx, y: pose.visible ? pose.y : pose.gy });
      }
      this.labels.push({ number: e.number, team: e.team === "opp" ? "them" : "us", you: e === s.you, ghost: !pose.visible && pose.ghost > 0, anchor: n });
      n++;
    }
    this.players.update(this.poses, n, now, ball);
    this.ball.update(ball.x, ball.y, ball.h, now);

    // Field of view on the grass: on while the ball travels, held while you decide.
    const want = phase === "play" ? 1 : phase === "decide" ? 0.85 : 0;
    this.coneAmount += (want - this.coneAmount) * Math.min(1, dt * 8);
    this.pitch.setCone(me, vision.gazeYaw(Math.min(tau, s.arrival)), vision.params.halfAngle, vision.params.range, this.coneAmount);
    this.pitch.uniforms.uTime.value = now;

    this.markers.setYou(me.x, me.y, now, true);
    this.markers.setTargets(this.targets, this.targets.length, now);
    this.markers.tickTap(now);
    const fade = decided ? Math.max(0, 1 - (now - moment.outcomeStart - 1.2) / 0.6) : 1;
    this.markers.choice.tick(now, fade);
    this.markers.best.tick(now, phase === "review" ? 1 : 0);
    this.confetti.update(now);
  }

  private track(e: Entity, p: V2): Track {
    let t = this.tracks.get(e.id);
    if (!t) {
      t = { prev: { x: p.x, y: p.y }, heading: 0, speed: 0, phase: e.number };
      this.tracks.set(e.id, t);
    }
    return t;
  }

  private kick(moment: Moment, e: Entity, tau: number): number {
    const s = moment.scenario;
    if (e === s.passer) {
      const k = (tau - (moment.spec.kickAt - 0.2)) / 0.45;
      if (k >= 0 && k <= 1) return k;
    }
    const b = moment.ball;
    if (e === s.you && b && b.holder !== s.you.id && moment.result?.choice) {
      const k = (tau - (b.t0 - 0.2)) / 0.45;
      if (k >= 0 && k <= 1) return k;
    }
    return -1;
  }
}
