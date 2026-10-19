// Starts the app for end-to-end tests on its own port with its own fresh database.
//   node scripts/e2e-server.mjs [port]
import { spawn, spawnSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const port = process.argv[2] ?? "5542";
const state = path.join(root, ".wrangler", "e2e-state");
// Fresh database every run: move the old one aside (deletes are not allowed here).
if (existsSync(state)) renameSync(state, `${state}-old-${Date.now()}`);
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const mig = spawnSync(process.execPath, [wrangler, "d1", "migrations", "apply", "scanfield", "--local", "--persist-to", state], { cwd: root, stdio: "inherit", env: { ...process.env, CI: "1" } });
if (mig.status !== 0) process.exit(mig.status ?? 1);
const vite = path.join(root, "node_modules", "vite", "bin", "vite.js");
const child = spawn(process.execPath, [vite, "--host", "127.0.0.1", "--port", port, "--strictPort"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, SCANFIELD_STATE: state },
});
const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
