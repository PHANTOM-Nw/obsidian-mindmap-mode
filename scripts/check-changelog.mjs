/**
 * Guards — and extracts — this version's section of CHANGELOG.md.
 *
 * The release workflow pastes the section straight into the GitHub release
 * notes, so a missing or empty one ships a release that says nothing about what
 * changed. `npm run check` runs this too, which is the point: the omission
 * surfaces before the tag is pushed, and the tag is the hard part to take back
 * — it is what Obsidian resolves a download from.
 *
 * The version checked is `manifest.json`'s. In CI, `check-version.mjs` has
 * already proved the release tag equals it, so there is nothing else to reconcile.
 *
 * Modes:
 *   (none)      validate, and say what was found
 *   --print     write the section body to stdout — these are the release notes
 *   --previous  write the version released before it to stdout, or nothing
 */
import { readFileSync } from "node:fs";

const CHANGELOG = "CHANGELOG.md";

/** `## [1.2.3] - 2026-07-27`, with the brackets and the date both optional. */
const RELEASE_HEADING = /^##\s+\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?/;

/** Any level-2 heading — what ends a section, even an unreleased or trailing one. */
const SECTION_END = /^##(?!#)\s/;

const mode = process.argv[2] ?? "";

function fail(...problems) {
	console.error("\nChangelog check failed:\n");
	for (const problem of problems) console.error(` • ${problem}\n`);
	process.exit(1);
}

const { version } = JSON.parse(readFileSync("manifest.json", "utf8"));

let source;
try {
	source = readFileSync(CHANGELOG, "utf8");
} catch {
	fail(
		`${CHANGELOG} is missing.\n` +
			`   Fix: create it, starting with a "## [${version}]" section.`,
	);
}

const lines = source.split(/\r?\n/);

/** Released versions, in the order they appear — newest first by convention. */
const releases = [];
for (const [index, line] of lines.entries()) {
	const match = RELEASE_HEADING.exec(line);
	if (match) releases.push({ version: match[1], line: index });
}

const at = releases.findIndex((release) => release.version === version);
if (at === -1) {
	fail(
		`${CHANGELOG} has no section for ${version}.\n` +
			`   Fix: add "## [${version}] - <YYYY-MM-DD>" above the newest section,\n` +
			`        and list what changed under it.`,
	);
}

let end = lines.length;
for (let index = releases[at].line + 1; index < lines.length; index++) {
	if (SECTION_END.test(lines[index])) {
		end = index;
		break;
	}
}

const body = lines
	.slice(releases[at].line + 1, end)
	.join("\n")
	.trim();

// A section holding nothing but its own subheadings is the same omission as no
// section at all — it just fails later, in front of whoever downloads the release.
const written = body
	.split("\n")
	.some((line) => line.trim() && !line.trimStart().startsWith("#"));

if (!written) {
	fail(
		`${CHANGELOG}'s ${version} section is empty.\n` +
			`   Fix: write what changed under "## [${version}]".`,
	);
}

const previous = releases[at + 1]?.version ?? "";

if (mode === "--print") {
	process.stdout.write(`${body}\n`);
} else if (mode === "--previous") {
	if (previous) process.stdout.write(`${previous}\n`);
} else {
	const entries = body.split("\n").filter((line) => /^\s*[-*]\s/.test(line));
	console.log(
		`Changelog check passed: ${version} has ${entries.length} entr${entries.length === 1 ? "y" : "ies"}` +
			`${previous ? `, released after ${previous}` : " (first release)"}.`,
	);
}
