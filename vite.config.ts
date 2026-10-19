import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// SCANFIELD_STATE points the local D1 database somewhere else (the e2e server uses
// its own, so tests never touch the dev data).
const state = process.env.SCANFIELD_STATE;

export default defineConfig({
  plugins: [cloudflare({ ...(state ? { persistState: { path: state } } : {}), inspectorPort: false })],
  build: {
    target: "es2022",
    // three is most of the bundle; keep it in its own long-cached chunk.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: "three", test: /node_modules[\\/]three[\\/]/ }],
        },
      },
    },
  },
});
