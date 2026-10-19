// Players are drawn with one InstancedMesh per body part (torso, head, hair, shorts,
// legs, arms), so 22 players cost the same six draw calls as one. Every matrix is
// composed into preallocated objects: nothing is allocated per frame.
//
// Ghosts (players you remember but cannot currently see) are one more instanced
// mesh with a translucent "memory" shader, and blob shadows are another.

import {
  BufferGeometry,
  CapsuleGeometry,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  BoxGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Team } from "../sim/scenario";
import { worldX, worldZ, yawFromHeading } from "./coords";

export interface PlayerPose {
  team: Team;
  number: number;
  /** Pitch position, metres. */
  x: number;
  y: number;
  /** Body facing, pitch heading (radians). */
  heading: number;
  speed: number;
  /** Stride phase, radians (accumulated by the caller). */
  phase: number;
  /** Head turn relative to the body (shoulder checks), radians. */
  headYaw: number;
  /** Kick animation progress 0..1, or -1. */
  kick: number;
  /** Draw the real body. */
  visible: boolean;
  /** Ghost opacity (0 = no ghost) and where the ghost stands. */
  ghost: number;
  gx: number;
  gy: number;
  gHeading: number;
}

export const KIT = {
  us: { shirt: new Color("#2f6df6"), shorts: new Color("#f5f7fb"), socks: new Color("#2f6df6") },
  them: { shirt: new Color("#ef4444"), shorts: new Color("#1f2937"), socks: new Color("#ef4444") },
};
const GHOST_US = new Color("#8fb4ff");
const GHOST_THEM = new Color("#ff9b9b");
const SKIN = ["#f1c9a5", "#e0ac7e", "#c68a5c", "#8d5a3b", "#6b4228"].map((c) => new Color(c));
const HAIR = ["#2b1d14", "#4a3020", "#151515", "#7a5230", "#c99a5b"].map((c) => new Color(c));

/** Players are drawn larger than life so they read on a phone held upright. */
export const PLAYER_SCALE = 1.45;

// Body layout (metres), player facing +X, standing on y = 0.
const HIP_Y = 0.9;
const HIP_Z = 0.11;
const SHOULDER_Y = 1.47;
const SHOULDER_Z = 0.27;

const m4 = new Matrix4();
const mRoot = new Matrix4();
const mA = new Matrix4();
const mB = new Matrix4();

/** out = root * T(p) * Ry(ry) * Rx(rx) * Rz(rz) * T(c) * S(s) */
function compose(out: Matrix4, root: Matrix4, px: number, py: number, pz: number, ry: number, rx: number, rz: number, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): Matrix4 {
  out.copy(root);
  out.multiply(mA.makeTranslation(px, py, pz));
  if (ry !== 0) out.multiply(mA.makeRotationY(ry));
  if (rx !== 0) out.multiply(mA.makeRotationX(rx));
  if (rz !== 0) out.multiply(mA.makeRotationZ(rz));
  out.multiply(mA.makeTranslation(cx, cy, cz));
  out.multiply(mB.makeScale(sx, sy, sz));
  return out;
}

const ghostVertex = /* glsl */ `
  attribute float aAlpha;
  varying float vAlpha;
  varying vec3 vColor;
  varying float vRim;
  varying float vY;
  void main() {
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vec3 n = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vec3 v = normalize(cameraPosition - wp.xyz);
    vRim = 1.0 - abs(dot(n, v));
    vAlpha = aAlpha;
    vColor = instanceColor;
    vY = wp.y;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const ghostFragment = /* glsl */ `
  uniform float uTime;
  varying float vAlpha;
  varying vec3 vColor;
  varying float vRim;
  varying float vY;
  void main() {
    float lines = 0.72 + 0.28 * step(0.5, fract(vY * 9.0 - uTime * 1.5));
    float a = vAlpha * (0.35 + 0.65 * vRim) * lines;
    gl_FragColor = vec4(vColor * (0.6 + 0.8 * vRim), a);
    #include <colorspace_fragment>
  }
`;

const shadowVertex = /* glsl */ `
  attribute float aAlpha;
  varying float vAlpha;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;
const shadowFragment = /* glsl */ `
  varying float vAlpha;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float a = vAlpha * (1.0 - smoothstep(0.35, 1.0, d));
    gl_FragColor = vec4(0.02, 0.06, 0.03, a);
  }
`;

function instanced(geo: BufferGeometry, count: number, mat: MeshLambertMaterial | ShaderMaterial): InstancedMesh {
  const m = new InstancedMesh(geo, mat, count);
  m.instanceMatrix.setUsage(DynamicDrawUsage);
  m.setColorAt(0, new Color());
  m.instanceColor!.setUsage(DynamicDrawUsage);
  m.frustumCulled = false;
  m.count = 0;
  return m;
}

export class PlayersView {
  readonly torso: InstancedMesh;
  readonly head: InstancedMesh;
  readonly hair: InstancedMesh;
  readonly shorts: InstancedMesh;
  readonly legs: InstancedMesh;
  readonly arms: InstancedMesh;
  readonly ghosts: InstancedMesh;
  readonly shadows: InstancedMesh;
  readonly meshes: InstancedMesh[];
  private readonly ghostAlpha: InstancedBufferAttribute;
  private readonly shadowAlpha: InstancedBufferAttribute;
  readonly ghostMaterial: ShaderMaterial;
  /** World-space anchor above each player's head (real or ghost), for number labels. */
  readonly anchors: Vector3[];

  constructor(readonly max = 24) {
    const lambert = () => new MeshLambertMaterial();
    const torsoGeo = new CapsuleGeometry(0.2, 0.36, 3, 10);
    const headGeo = new SphereGeometry(0.13, 12, 8);
    const hairGeo = new SphereGeometry(0.137, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const shortsGeo = new BoxGeometry(0.26, 0.24, 0.4);
    const legGeo = new CapsuleGeometry(0.075, 0.68, 3, 8);
    const armGeo = new CapsuleGeometry(0.058, 0.5, 3, 8);
    this.torso = instanced(torsoGeo, max, lambert());
    this.head = instanced(headGeo, max, lambert());
    this.hair = instanced(hairGeo, max, lambert());
    this.shorts = instanced(shortsGeo, max, lambert());
    this.legs = instanced(legGeo, max * 2, lambert());
    this.arms = instanced(armGeo, max * 2, lambert());

    // The ghost is a merged, standing silhouette of the same parts.
    const silhouette = mergeGeometries([
      torsoGeo.clone().scale(0.75, 1, 1.15).translate(0, 1.26, 0),
      headGeo.clone().translate(0, 1.73, 0),
      shortsGeo.clone().translate(0, 0.95, 0),
      legGeo.clone().translate(0, HIP_Y - 0.41, HIP_Z),
      legGeo.clone().translate(0, HIP_Y - 0.41, -HIP_Z),
      armGeo.clone().translate(0, SHOULDER_Y - 0.31, SHOULDER_Z),
      armGeo.clone().translate(0, SHOULDER_Y - 0.31, -SHOULDER_Z),
    ].map((g) => g.toNonIndexed()));
    this.ghostMaterial = new ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: ghostVertex,
      fragmentShader: ghostFragment,
      transparent: true,
      depthWrite: false,
    });
    this.ghosts = instanced(silhouette, max, this.ghostMaterial);
    this.ghostAlpha = new InstancedBufferAttribute(new Float32Array(max), 1).setUsage(DynamicDrawUsage);
    this.ghosts.geometry.setAttribute("aAlpha", this.ghostAlpha);
    this.ghosts.renderOrder = 2;

    const shadowGeo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.shadows = instanced(shadowGeo, max + 1, new ShaderMaterial({ vertexShader: shadowVertex, fragmentShader: shadowFragment, transparent: true, depthWrite: false }));
    this.shadowAlpha = new InstancedBufferAttribute(new Float32Array(max + 1), 1).setUsage(DynamicDrawUsage);
    this.shadows.geometry.setAttribute("aAlpha", this.shadowAlpha);
    this.shadows.renderOrder = 1;

    this.meshes = [this.shadows, this.torso, this.head, this.hair, this.shorts, this.legs, this.arms, this.ghosts];
    for (const m of this.meshes) m.name = "players";
    this.anchors = Array.from({ length: max }, () => new Vector3());
  }

  /** Writes every instance for this frame. Ball shadow goes in the last shadow slot. */
  update(poses: readonly PlayerPose[], count: number, time: number, ball?: { x: number; y: number; h: number }): void {
    let real = 0;
    let ghosts = 0;
    let shadows = 0;
    for (let i = 0; i < count; i++) {
      const p = poses[i]!;
      const us = p.team !== "opp";
      const kit = us ? KIT.us : KIT.them;
      if (p.visible) {
        this.writeBody(real, p, kit, time);
        this.anchors[i]!.set(worldX(p.x), 2.2 * PLAYER_SCALE, worldZ(p.y));
        this.writeShadow(shadows++, p.x, p.y, 1.1 * PLAYER_SCALE, 0.45);
        real++;
      }
      if (p.ghost > 0.01) {
        mRoot.makeTranslation(worldX(p.gx), 0, worldZ(p.gy)).multiply(m4.makeRotationY(yawFromHeading(p.gHeading))).multiply(mB.makeScale(PLAYER_SCALE, PLAYER_SCALE, PLAYER_SCALE));
        this.ghosts.setMatrixAt(ghosts, mRoot);
        this.ghosts.setColorAt(ghosts, us ? GHOST_US : GHOST_THEM);
        this.ghostAlpha.setX(ghosts, p.ghost);
        if (!p.visible) {
          this.anchors[i]!.set(worldX(p.gx), 2.2 * PLAYER_SCALE, worldZ(p.gy));
          this.writeShadow(shadows++, p.gx, p.gy, PLAYER_SCALE, 0.18 * Math.min(1, p.ghost * 1.5));
        }
        ghosts++;
      }
    }
    if (ball) this.writeShadow(shadows++, ball.x, ball.y, 0.55 + ball.h * 0.2, 0.4 / (1 + ball.h));
    for (const m of [this.torso, this.head, this.hair, this.shorts]) m.count = real;
    this.legs.count = real * 2;
    this.arms.count = real * 2;
    this.ghosts.count = ghosts;
    this.shadows.count = shadows;
    for (const m of this.meshes) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.ghostAlpha.needsUpdate = true;
    this.shadowAlpha.needsUpdate = true;
    this.ghostMaterial.uniforms.uTime!.value = time;
  }

  private writeShadow(i: number, x: number, y: number, size: number, alpha: number): void {
    mRoot.makeTranslation(worldX(x), 0.02, worldZ(y));
    mRoot.multiply(mB.makeScale(size, 1, size));
    this.shadows.setMatrixAt(i, mRoot);
    this.shadowAlpha.setX(i, alpha);
  }

  private writeBody(i: number, p: PlayerPose, kit: typeof KIT.us, time: number): void {
    const amp = Math.min(p.speed / 6, 1);
    const swing = Math.sin(p.phase) * amp * 0.85;
    const bob = Math.abs(Math.sin(p.phase)) * 0.05 * amp + Math.sin(time * 2.1 + p.number) * 0.006;
    const lean = -0.16 * amp;
    mRoot.makeTranslation(worldX(p.x), bob * PLAYER_SCALE, worldZ(p.y)).multiply(m4.makeRotationY(yawFromHeading(p.heading))).multiply(mB.makeScale(PLAYER_SCALE, PLAYER_SCALE, PLAYER_SCALE));

    // Kick: the right leg draws back, then swings through.
    let kickLeg = 0;
    if (p.kick >= 0) {
      const k = p.kick;
      kickLeg = k < 0.45 ? -0.9 * (k / 0.45) : -0.9 + 2.1 * Math.min(1, (k - 0.45) / 0.35);
      if (k > 0.8) kickLeg *= 1 - (k - 0.8) / 0.2;
    }
    const twist = Math.max(-0.8, Math.min(0.8, p.headYaw * 0.35));
    const headTurn = Math.max(-1.6, Math.min(1.6, p.headYaw)) - twist;

    compose(m4, mRoot, 0, 0.95, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1);
    this.shorts.setMatrixAt(i, m4);
    this.shorts.setColorAt(i, kit.shorts);

    compose(m4, mRoot, 0, 1.03, 0, twist, 0, lean, 0, 0.23, 0, 0.75, 1, 1.15);
    this.torso.setMatrixAt(i, m4);
    this.torso.setColorAt(i, kit.shirt);

    const skin = SKIN[p.number % SKIN.length]!;
    compose(m4, mRoot, -lean * 1.6, 1.73, 0, twist + headTurn, 0, 0, 0, 0, 0, 1, 1, 1);
    this.head.setMatrixAt(i, m4);
    this.head.setColorAt(i, skin);
    compose(m4, mRoot, -lean * 1.6, 1.745, 0, twist + headTurn, 0, 0, -0.012, 0, 0, 1, 1, 1);
    this.hair.setMatrixAt(i, m4);
    this.hair.setColorAt(i, HAIR[(p.number * 7) % HAIR.length]!);

    compose(m4, mRoot, 0, HIP_Y, HIP_Z, 0, 0, swing, 0, -0.41, 0, 1, 1, 1);
    this.legs.setMatrixAt(i * 2, m4);
    this.legs.setColorAt(i * 2, kit.socks);
    compose(m4, mRoot, 0, HIP_Y, -HIP_Z, 0, 0, p.kick >= 0 ? kickLeg : -swing, 0, -0.41, 0, 1, 1, 1);
    this.legs.setMatrixAt(i * 2 + 1, m4);
    this.legs.setColorAt(i * 2 + 1, kit.socks);

    const armOut = 0.12 + amp * 0.08;
    compose(m4, mRoot, 0, SHOULDER_Y, SHOULDER_Z, twist, -armOut, -swing * 0.9, 0, -0.29, 0, 1, 1, 1);
    this.arms.setMatrixAt(i * 2, m4);
    this.arms.setColorAt(i * 2, kit.shirt);
    compose(m4, mRoot, 0, SHOULDER_Y, -SHOULDER_Z, twist, armOut, swing * 0.9, 0, -0.29, 0, 1, 1, 1);
    this.arms.setMatrixAt(i * 2 + 1, m4);
    this.arms.setColorAt(i * 2 + 1, kit.shirt);
  }
}
