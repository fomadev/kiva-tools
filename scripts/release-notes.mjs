// Release notes for a version tag, taken from CHANGELOG.md.
//
//   node scripts/release-notes.mjs v1.2.0          prints the notes
//   node scripts/release-notes.mjs --check v1.2.0  only checks
//
// Fails when the tag does not match the version of package.json, or when
// CHANGELOG.md has no section for that version: a release always says what
// changed.

import fs from "node:fs";

const args = process.argv.slice(2);
const check = args[0] === "--check";
const tag = check ? args[1] : args[0];
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

function fail(message) {
  console.error(`release-notes: ${message}`);
  process.exit(1);
}

if (!tag) fail("give the tag, for example v1.0.0");
if (tag.replace(/^v/, "") !== pkg.version) {
  fail(`the tag ${tag} does not match the version ${pkg.version} of package.json; change one of them`);
}

const changelog = fs.readFileSync("CHANGELOG.md", "utf8").replace(/\r\n/g, "\n");
const lines = changelog.split("\n");
const start = lines.findIndex((l) => new RegExp(`^## \\[?${pkg.version.replace(/\./g, "\\.")}\\]?(\\s|$)`).test(l));
if (start < 0) fail(`CHANGELOG.md has no "## ${pkg.version}" section; describe what changed first`);
let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
if (end < 0) end = lines.length;
const notes = lines.slice(start + 1, end).join("\n").trim();
if (!notes) fail(`the "## ${pkg.version}" section of CHANGELOG.md is empty`);

if (check) {
  console.log(`${tag}: package.json and CHANGELOG.md agree.`);
  process.exit(0);
}

const vsix = `${pkg.name}-${pkg.version}.vsix`;
console.log(`${notes}

---

### Install

Download \`${vsix}\` below, then in VS Code: **Extensions** view → **...** menu → **Install from VSIX...**, or:

\`\`\`bash
code --install-extension ${vsix}
\`\`\`

### Publish on the Marketplace

Upload \`${vsix}\` at https://marketplace.visualstudio.com/manage/publishers/${pkg.publisher} → **${pkg.displayName}** → **...** → **Update**.`);
