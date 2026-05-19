import * as esbuild from "esbuild";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const outdir = path.join(root, "dist-electron");

await esbuild.build({
  entryPoints: {
    main: path.join(root, "electron", "main.ts"),
    preload: path.join(root, "electron", "preload.ts"),
  },
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outdir,
  external: ["electron"],
  sourcemap: true,
});

console.log("Built Electron main and preload");
