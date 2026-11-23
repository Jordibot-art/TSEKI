#!/usr/bin/env node
/**
 * Unified cross-platform test runner executing all TSEKI automated unit & regression suites.
 * Usage: node scripts/runAllTests.mjs
 */

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const hasAdminDeps = fs.existsSync(path.join(repoRoot, "admin-web", "node_modules"));

const TEST_SUITES = [
  // Security, Auth, Quota & Shared Core
  { label: "Security, Approval, Item Analysis & Unicode Guards", cmd: "npx", args: ["tsx", "lib/ai/__tests__/testSecurityAndCoreGuards.ts"] },
  { label: "2-Step Verified Teacher Registration", cmd: "npx", args: ["tsx", "lib/ai/__tests__/testTeacherRegistration.ts"] },
  ...(hasAdminDeps
    ? [{ label: "Admin Backend Security Guards", cmd: "npx", args: ["tsx", "server/testAdminSecurity.ts"], cwd: path.join(repoRoot, "admin-web") }]
    : []),
  { label: "Shared Core Parity Check", cmd: "node", args: ["scripts/syncSharedCore.mjs", "--check"] },
  { label: "AI Quota Logic", cmd: "npx", args: ["tsx", "lib/ai/__tests__/testAiQuotaLogic.ts"] },
  { label: "Backup AI Failover", cmd: "npx", args: ["tsx", "lib/ai/__tests__/runBackupAiFailoverTest.ts"] },
  { label: "Alert Store", cmd: "npx", args: ["tsx", "lib/ai/__tests__/testAlertStore.ts"] },
  { label: "Item Analysis", cmd: "npx", args: ["tsx", "lib/ai/__tests__/testItemAnalysis.ts"] },
  { label: "Roster Matching", cmd: "npx", args: ["tsx", "lib/ai/__tests__/testRosterMatching.ts"] },
  { label: "Review Flow", cmd: "npx", args: ["tsx", "lib/ai/__tests__/testReviewFlow.ts"] },
  { label: "Delete Verification & Grade Edit", cmd: "npx", args: ["tsx", "lib/ai/__tests__/testDeleteVerifyAndGradeEdit.ts"] },
  { label: "Assessment Detection & Grade Sheet", cmd: "npx", args: ["tsx", "lib/ai/__tests__/testAssessmentDetectionAndGradeSheet.ts"] },
  { label: "Low Confidence & Crop", cmd: "npx", args: ["tsx", "lib/ai/__tests__/testLowConfidenceAndCrop.ts"] },

  // Print Engine, Export & Scanner Geometry
  { label: "Excel Score Export", cmd: "npx", args: ["tsx", "lib/printEngine/__tests__/runExcelScoreTest.ts"] },
  { label: "Print Engine Step 1", cmd: "npx", args: ["tsx", "lib/printEngine/__tests__/runStep1Tests.ts"] },
  { label: "Print Engine Step 2", cmd: "npx", args: ["tsx", "lib/printEngine/__tests__/runStep2Tests.ts"] },
  { label: "Print Engine Step 3", cmd: "npx", args: ["tsx", "lib/printEngine/__tests__/runStep3Tests.ts"] },
  { label: "Target Export", cmd: "npx", args: ["tsx", "lib/printEngine/__tests__/targetExportTest.ts"] },
  { label: "Font & Symbols", cmd: "npx", args: ["tsx", "lib/printEngine/__tests__/fontSymbolsTest.ts"] },
  { label: "Print Engine Smoke Check", cmd: "npx", args: ["tsx", "lib/printEngine/__tests__/runSmokeTestCheck.ts"] },
  { label: "Export Cancellation", cmd: "npx", args: ["tsx", "lib/printEngine/__tests__/testExportCancellation.ts"] },
  { label: "Long Header Fit", cmd: "npx", args: ["tsx", "lib/printEngine/__tests__/testLongHeaderFit.ts"] },
  { label: "Responsive Bond Layout", cmd: "npx", args: ["tsx", "lib/printEngine/__tests__/testResponsiveBondLayout.ts"] },
  { label: "Photo Quality Check", cmd: "npx", args: ["tsx", "lib/printEngine/__tests__/runPhotoQualityTest.ts"] },
  { label: "Reticle Crop", cmd: "npx", args: ["tsx", "lib/printEngine/__tests__/testReticleCrop.ts"] },
  { label: "All Phone Resolutions", cmd: "node", args: ["lib/printEngine/__tests__/testAllPhoneResolutions.cjs"] },
];

const isWin = process.platform === "win32";
let passed = 0;
const failed = [];

console.log(`\nRunning ${TEST_SUITES.length} TSEKI automated test suites...\n`);

for (const suite of TEST_SUITES) {
  const start = Date.now();
  const executable = isWin && suite.cmd === "npx" ? "npx.cmd" : suite.cmd;
  const res = spawnSync(executable, suite.args, {
    cwd: suite.cwd || repoRoot,
    stdio: "pipe",
    encoding: "utf8",
    shell: isWin,
  });

  const elapsed = Date.now() - start;
  if (res.status === 0) {
    passed++;
    console.log(`  [PASS] ${suite.label} (${elapsed}ms)`);
  } else {
    failed.push({
      label: suite.label,
      status: res.status,
      output: (res.stderr || res.stdout || "").trim().slice(0, 1200),
    });
    console.error(`  [FAIL] ${suite.label} (exit ${res.status}, ${elapsed}ms)`);
  }
}

console.log(`\nSummary: ${passed}/${TEST_SUITES.length} suites passed.`);

if (failed.length > 0) {
  console.error("\nFailed suite details:");
  for (const f of failed) {
    console.error(`\n--- ${f.label} ---\n${f.output}`);
  }
  process.exit(1);
}
