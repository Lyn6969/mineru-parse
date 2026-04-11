/* global process */

import fs from "node:fs";
import path from "node:path";

function normalizeTag(value) {
  return value.startsWith("v") ? value : `v${value}`;
}

function readCurrentVersionTag() {
  const pkgPath = path.resolve("package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  return normalizeTag(pkg.version);
}

function extractReleaseNotes(changelog, targetTag) {
  const lines = changelog.split(/\r?\n/);
  let start = -1;
  let end = lines.length;

  for (let i = 0; i < lines.length; i += 1) {
    const headingMatch = lines[i].match(/^##\s+\[?(v?\d+\.\d+\.\d+)\]?\b/);
    if (!headingMatch) continue;
    if (normalizeTag(headingMatch[1]) !== targetTag) continue;
    start = i + 1;
    break;
  }

  if (start === -1) {
    throw new Error(
      `Missing changelog section for ${targetTag} in CHANGELOG.md`,
    );
  }

  for (let i = start; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }

  const notes = lines.slice(start, end).join("\n").trim();
  if (!notes) {
    throw new Error(`Changelog section for ${targetTag} is empty`);
  }

  return `${notes}\n`;
}

const targetTag = normalizeTag(process.argv[2] || readCurrentVersionTag());
const changelogPath = path.resolve("CHANGELOG.md");
const changelog = fs.readFileSync(changelogPath, "utf8");

process.stdout.write(extractReleaseNotes(changelog, targetTag));
