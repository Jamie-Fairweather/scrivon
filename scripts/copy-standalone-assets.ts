import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const standaloneDir = path.join(root, ".next", "standalone");
const staticSrc = path.join(root, ".next", "static");
const staticDest = path.join(standaloneDir, ".next", "static");
const publicSrc = path.join(root, "public");
const publicDest = path.join(standaloneDir, "public");

await mkdir(path.dirname(staticDest), { recursive: true });
await cp(staticSrc, staticDest, { recursive: true });
await cp(publicSrc, publicDest, { recursive: true });

console.log("Copied static assets into .next/standalone");
