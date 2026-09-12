#!/usr/bin/env node
// Runs the two local dev servers together:
//   - Vite SPA  → http://localhost:5173   (npm run dev)
//   - Worker API → http://localhost:8787  (npm run cf:dev, D1 emulated locally)
// Stop both with Ctrl-C.

import { spawn } from "node:child_process";
import process from "node:process";

const children = [];

function run(name, args) {
  console.log(`\x1b[36m[dev:all]\x1b[0m starting ${name} (${args.join(" ")})`);
  const child = spawn(args[0], args.slice(1), {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  children.push(child);
  child.on("exit", (code) => {
    console.log(`\x1b[31m[dev:all]\x1b[0m ${name} exited (code ${code}); shutting down.`);
    shutdown(code ?? 0);
  });
  return child;
}

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      c.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(code), 500).unref();
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => shutdown(0));
}

run("vite (SPA :5173)", ["npm", "run", "dev"]);
run("worker (API :8787)", ["npm", "run", "cf:dev"]);
