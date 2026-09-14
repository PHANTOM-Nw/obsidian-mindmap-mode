import { test } from "node:test";
import assert from "node:assert/strict";

import { UPDATE_NOTICE, shouldAnnounce, versionToRecord } from "./updateNotice.ts";

test("a first install is told nothing", () => {
	assert.equal(shouldAnnounce(undefined, "1.1.1", true), false);
	assert.equal(shouldAnnounce(null, "1.1.1", true), false);
});

test("a vault with settings but no record has come from an older release", () => {
	assert.equal(shouldAnnounce(undefined, "1.1.1", false), true);
	assert.equal(shouldAnnounce("", "1.1.1", false), true);
});

test("the version this vault last ran is announced only when it moved", () => {
	assert.equal(shouldAnnounce("1.1.0", "1.1.1", false), true);
	assert.equal(shouldAnnounce("1.1.1", "1.1.1", false), false);
	// Nothing is stored on a first install, so a record means the plugin has run
	// here before, whatever the caller thinks of the settings.
	assert.equal(shouldAnnounce("1.1.1", "1.1.1", true), false);
});

test("a stored value of the wrong type is read as no record", () => {
	assert.equal(shouldAnnounce(42, "1.1.1", false), true);
	assert.equal(shouldAnnounce({ version: "1.1.0" }, "1.1.1", true), false);
});

test("the record is only rewritten when it would change", () => {
	assert.equal(versionToRecord("1.1.0", "1.1.1"), "1.1.1");
	assert.equal(versionToRecord(undefined, "1.1.1"), "1.1.1");
	assert.equal(versionToRecord("1.1.1", "1.1.1"), null);
});

test("the notice names the syntax and where to turn it off", () => {
	assert.ok(UPDATE_NOTICE.includes(": text"));
	assert.ok(UPDATE_NOTICE.includes("Inline annotations"));
});
