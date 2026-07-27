/**
 * Guards the three places a version has to agree, plus the release tag.
 *
 * Obsidian installs a plugin by fetching assets from the GitHub release whose
 * tag equals `manifest.json` version *exactly* — a `v` prefix is the single most
 * common reason a release silently fails to install. Catching it here turns a
 * confusing non-install into a build failure with a fix attached.
 *
 * Set RELEASE_TAG to also validate the tag being released.
 */
import { readFileSync } from "node:fs";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));

const pkg = read("package.json");
const manifest = read("manifest.json");
const versions = read("versions.json");

const problems = [];
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

// --- manifest completeness ---------------------------------------------------
for (const field of [
	"id",
	"name",
	"version",
	"minAppVersion",
	"description",
	"author",
]) {
	if (!manifest[field]) problems.push(`manifest.json is missing "${field}".`);
}
if (typeof manifest.isDesktopOnly !== "boolean") {
	problems.push('manifest.json needs "isDesktopOnly" as a boolean.');
}
if (manifest.version && !SEMVER.test(manifest.version)) {
	problems.push(
		`manifest.json version "${manifest.version}" is not semver (e.g. 1.0.0).`,
	);
}

// --- the three files must agree ----------------------------------------------
if (pkg.version !== manifest.version) {
	problems.push(
		`package.json version (${pkg.version}) != manifest.json version (${manifest.version}).\n` +
			`   Fix: npm version ${manifest.version} --no-git-tag-version`,
	);
}
if (!(manifest.version in versions)) {
	problems.push(
		`versions.json has no entry for ${manifest.version}.\n` +
			`   Fix: add "${manifest.version}": "${manifest.minAppVersion}" to versions.json`,
	);
} else if (versions[manifest.version] !== manifest.minAppVersion) {
	problems.push(
		`versions.json maps ${manifest.version} to minAppVersion ${versions[manifest.version]}, ` +
			`but manifest.json says ${manifest.minAppVersion}.`,
	);
}

// --- the release tag ----------------------------------------------------------
const tag = (process.env.RELEASE_TAG ?? "").trim();
if (tag) {
	if (/^v/i.test(tag)) {
		problems.push(
			`Tag "${tag}" starts with "v". Obsidian requires the tag to equal the manifest ` +
				`version exactly, with no prefix.\n` +
				`   Fix: git tag -d ${tag} && git push --delete origin ${tag}\n` +
				`        git tag -a ${manifest.version} -m "${manifest.version}" && git push origin ${manifest.version}`,
		);
	} else if (tag !== manifest.version) {
		problems.push(
			`Tag "${tag}" does not match manifest.json version "${manifest.version}".\n` +
				`   Either retag as ${manifest.version}, or bump the manifest to ${tag}.`,
		);
	}
}

if (problems.length > 0) {
	console.error("\nVersion check failed:\n");
	for (const problem of problems) console.error(` • ${problem}\n`);
	process.exit(1);
}

console.log(
	`Version check passed: ${manifest.id} ${manifest.version} ` +
		`(requires Obsidian >= ${manifest.minAppVersion})${tag ? `, tag "${tag}" matches` : ""}.`,
);
