#!/usr/bin/env node
/**
 * package.json is the single source of truth for the app version.
 *
 * Android needs two derived values and they must never drift from it:
 *   versionName — the human string, identical to package.json
 *   versionCode — a monotonically increasing integer; Android refuses to
 *                 install an APK whose code is not higher than the installed
 *                 one, so this is what actually gates updates.
 *
 * versionCode = major*10000 + minor*100 + patch, which keeps 1.2.3 (10203)
 * strictly below 1.3.0 (10300) and gives 99 slots for each position. Editing
 * build.gradle by hand is how you ship 1.1.0 that phones refuse to install
 * because its code is still 1.
 *
 *   node scripts/sync-version.mjs          # write
 *   node scripts/sync-version.mjs --check  # verify only, non-zero if drifted
 */
import { readFileSync, writeFileSync } from 'node:fs';

const GRADLE = 'android/app/build.gradle';
const checkOnly = process.argv.includes('--check');

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
if (!m) {
  console.error(`package.json version "${version}" is not a plain semver x.y.z`);
  process.exit(1);
}
const [, major, minor, patch] = m.map(Number);
if (minor > 99 || patch > 99) {
  console.error(`version ${version}: minor and patch must stay under 100 for the versionCode scheme`);
  process.exit(1);
}
const versionCode = major * 10000 + minor * 100 + patch;

const gradle = readFileSync(GRADLE, 'utf8');

// Read the CURRENT values rather than diffing a string rewrite.
//
// The previous check compared the post-replace text with the original, which
// cannot tell "already in sync" from "the regex matched nothing". A
// build.gradle whose version lines had been edited into a form the pattern no
// longer recognises — say `versionCode project.findProperty("vc") ?: 1` —
// produced an identical string and the gate reported success, which is exactly
// the "phones refuse the upgrade" failure this script exists to prevent.
const codeMatch = /versionCode\s+(\d+)/.exec(gradle);
const nameMatch = /versionName\s+"([^"]*)"/.exec(gradle);

if (!codeMatch || !nameMatch) {
  console.error(`${GRADLE}: could not find a literal versionCode/versionName to read.`);
  console.error('Expected lines like:  versionCode 10000   /   versionName "1.0.0"');
  console.error('A computed or property-driven version cannot be verified here, and an');
  console.error('unverifiable version is how a release ships that phones refuse to install.');
  process.exit(1);
}

const currentCode = Number(codeMatch[1]);
const currentName = nameMatch[1];

if (checkOnly) {
  const problems = [];
  if (currentName !== version) problems.push(`versionName is "${currentName}", expected "${version}"`);
  if (currentCode !== versionCode) problems.push(`versionCode is ${currentCode}, expected ${versionCode}`);
  if (problems.length > 0) {
    console.error(`${GRADLE} is out of sync with package.json:`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error('Run: npm run sync:version');
    process.exit(1);
  }
  console.log(`version in sync: ${version} (code ${versionCode})`);
} else {
  const updated = gradle
    .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
    .replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);
  writeFileSync(GRADLE, updated);
  console.log(`${GRADLE} -> versionName "${version}", versionCode ${versionCode}`);
}
