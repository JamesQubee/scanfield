// Prints, for every scenario, how the evaluator ranks each option across the
// decision window, so whoever writes the spec can check the intended answer.
//   pnpm scenarios [id-filter]
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { buildScenario, type ScenarioSpec } from "../src/sim/scenario";
import { evaluateAll, matchesIntended } from "../src/eval/evaluate";

const dir = path.resolve(import.meta.dirname, "../scenarios");
const filter = process.argv[2];
const files = readdirSync(dir).filter((f) => f.endsWith(".json") && (!filter || f.includes(filter)));

const pct = (n: number) => `${Math.round(n * 100)}%`.padStart(4);
const ev = (n: number) => (n * 1000).toFixed(1).padStart(6);

for (const f of files) {
  const spec = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as ScenarioSpec;
  const s = buildScenario(spec);
  console.log(`\n=== ${spec.id} (${spec.skill}) intended=${spec.intendedBest} kick=${spec.kickAt}s arrival=${s.arrival.toFixed(2)}s receive=(${s.receiveAt.x.toFixed(1)}, ${s.receiveAt.y.toFixed(1)})`);
  for (const dt of [0, 0.2, 0.4]) {
    const d = evaluateAll(s, s.arrival + dt);
    const sorted = [...d.candidates].sort((a, b) => b.ev - a.ev);
    const rank = sorted.findIndex((c) => matchesIntended(spec.intendedBest, c.option.id)) + 1;
    const top = sorted[0]!;
    const firstOther = sorted.find((c) => !matchesIntended(spec.intendedBest, c.option.id))!;
    const firstIntended = sorted.find((c) => matchesIntended(spec.intendedBest, c.option.id))!;
    console.log(`  t=+${dt.toFixed(1)}  best=${top.option.id}  intended rank=${rank}  margin=${((firstIntended.ev - firstOther.ev) * 1000).toFixed(1)}`);
    if (dt === 0) {
      for (const c of sorted) {
        const th = c.threat ? `${c.threat.id} ${c.threat.margin >= 0 ? "+" : ""}${c.threat.margin.toFixed(2)}s` : "-";
        console.log(`    ${c.option.id.padEnd(14)} ev=${ev(c.ev)}  p=${pct(c.p)}  press=${pct(c.press)}  value=${ev(c.value)}  ${c.succeeds ? "ok " : "CUT"}  threat=${th}`);
      }
    }
  }
}
