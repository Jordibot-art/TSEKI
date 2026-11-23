#!/usr/bin/env node
/**
 * Syncs canonical pure TypeScript modules from /shared into standalone sub-apps
 * (such as teacher-web/src/lib) so Vercel Root Directory deploys stay self-contained
 * while guaranteeing zero code drift across Mobile & Teacher Web.
 *
 * Usage:
 *   node scripts/syncSharedCore.mjs          # syncs files
 *   node scripts/syncSharedCore.mjs --check  # fails with exit code 1 if any copy drifted
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const SYNC_TARGETS = [
  {
    source: "shared/teacherApproval.ts",
    dest: "teacher-web/src/lib/teacherApproval.ts",
  },
  {
    source: "shared/teacherRegistration.ts",
    dest: "teacher-web/src/lib/teacherRegistration.ts",
  },
  {
    source: "shared/itemAnalysisCore.ts",
    dest: "teacher-web/src/lib/itemAnalysisCore.ts",
  },
];

const HEADER_COMMENT = "// AUTO-SYNCED FROM /shared — edit the canonical file in /shared and run `npm run sync:shared`.\n";
const checkOnly = process.argv.includes("--check");

let drifted = false;

for (const { source, dest } of SYNC_TARGETS) {
  const srcPath = path.join(repoRoot, source);
  const destPath = path.join(repoRoot, dest);

  if (!fs.existsSync(srcPath)) {
    console.error(`[syncSharedCore] Missing canonical source: ${source}`);
    process.exit(1);
  }

  const canonical = HEADER_COMMENT + fs.readFileSync(srcPath, "utf8").replace(/\r\n/g, "\n");
  const current = fs.existsSync(destPath)
    ? fs.readFileSync(destPath, "utf8").replace(/\r\n/g, "\n")
    : "";

  if (canonical !== current) {
    if (checkOnly) {
      console.error(`[syncSharedCore] DRIFT DETECTED: ${dest} differs from ${source}`);
      drifted = true;
    } else {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, canonical, "utf8");
      console.log(`[syncSharedCore] Synced ${source} -> ${dest}`);
    }
  } else if (!checkOnly) {
    console.log(`[syncSharedCore] Up to date: ${dest}`);
  }
}

if (checkOnly) {
  if (drifted) {
    console.error("Run `npm run sync:shared` to synchronize shared modules.");
    process.exit(1);
  }
  console.log(`[syncSharedCore] All ${SYNC_TARGETS.length} shared core modules are in sync.`);
}
