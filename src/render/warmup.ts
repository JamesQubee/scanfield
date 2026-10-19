// Compiles every shader the game will need before the first moment, behind the
// start screen. A program compiled lazily at the decision moment would stall the
// very frame that has to answer the tap.

import type { Game } from "../game/game";
import type { ScenarioSpec } from "../sim/scenario";

export async function warmUp(game: Game, spec: ScenarioSpec): Promise<void> {
  void spec;
  const w = game.world;
  const r = game.stage.renderer;
  // Make every state visible once: ghosts, arrows, tap ring, targets, confetti, field of view.
  const restore: [{ visible: boolean }, boolean][] = [];
  for (const o of [w.markers.choice.mesh, w.markers.best.mesh, w.markers.tap, w.confetti.mesh]) {
    restore.push([o, o.visible]);
    o.visible = true;
  }
  const counts = w.players.meshes.map((m) => m.count);
  for (const m of w.players.meshes) m.count = Math.max(1, m.count);
  w.markers.targets.count = 1;
  const cone = w.pitch.uniforms.uCone.value;
  w.pitch.uniforms.uCone.value = 1;
  try {
    await r.compileAsync(game.stage.scene, game.stage.camera);
    game.stage.render();
  } finally {
    for (const [o, v] of restore) o.visible = v;
    w.players.meshes.forEach((m, i) => (m.count = counts[i]!));
    w.markers.targets.count = 0;
    w.pitch.uniforms.uCone.value = cone;
  }
}
