/**
 * Keeps manifest.json and versions.json in step with package.json.
 *
 * Runs automatically as part of `npm version <patch|minor|major>` via the
 * "version" lifecycle script, so the three files can never drift.
 */
import { readFileSync, writeFileSync } from "node:fs";

const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
	console.error(
		"No target version. Run this through npm, e.g. `npm version patch`, not directly.",
	);
	process.exit(1);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", `${JSON.stringify(versions, null, 2)}\n`);

console.log(`Bumped to ${targetVersion} (minAppVersion ${minAppVersion}).`);
console.log(`Next: git push && git push origin ${targetVersion}`);
