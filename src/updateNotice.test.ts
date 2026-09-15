import { test } from "node:test";
import assert from "node:assert/strict";

import { UPDATE_NOTICE, shouldAnnounce, versionToRecord } from "./updateNotice.ts";
import type { UpdateNotice } from "./updateNotice.ts";

/** A notice pinned to whichever version the case is running. */
function pinned(version: string): UpdateNotice {
	return { version, text: "something to say" };
}

test("a first install is told nothing", () => {
	assert.equal(shouldAnnounce(undefined, "1.1.1", true, pinned("1.1.1")), false);
	assert.equal(shouldAnnounce(null, "1.1.1", true, pinned("1.1.1")), false);
});

test("a vault with settings but no record has come from an older release", () => {
	assert.equal(shouldAnnounce(undefined, "1.1.1", false, pinned("1.1.1")), true);
	assert.equal(shouldAnnounce("", "1.1.1", false, pinned("1.1.1")), true);
});

test("the version this vault last ran is announced only when it moved", () => {
	assert.equal(shouldAnnounce("1.1.0", "1.1.1", false, pinned("1.1.1")), true);
	assert.equal(shouldAnnounce("1.1.1", "1.1.1", false, pinned("1.1.1")), false);
	// Nothing is stored on a first install, so a record means the plugin has run
	// here before, whatever the caller thinks of the settings.
	assert.equal(shouldAnnounce("1.1.1", "1.1.1", true, pinned("1.1.1")), false);
});

test("a stored value of the wrong type is read as no record", () => {
	assert.equal(shouldAnnounce(42, "1.1.1", false, pinned("1.1.1")), true);
	assert.equal(shouldAnnounce({ version: "1.1.0" }, "1.1.1", true, pinned("1.1.1")), false);
});

test("a notice left on an older version never shows", () => {
	const stale = pinned("1.1.1");
	assert.equal(shouldAnnounce("1.1.1", "1.1.2", false, stale), false);
	assert.equal(shouldAnnounce("1.1.0", "1.1.2", false, stale), false);
	assert.equal(shouldAnnounce(undefined, "1.1.2", false, stale), false);
});

test("a notice for the running version shows on the load after the update, once", () => {
	const now = pinned("1.1.2");
	assert.equal(shouldAnnounce("1.1.1", "1.1.2", false, now), true);
	// The version is recorded whether or not anything was announced.
	assert.equal(versionToRecord("1.1.1", "1.1.2"), "1.1.2");
	assert.equal(shouldAnnounce("1.1.2", "1.1.2", false, now), false);
});

test("the record is only rewritten when it would change", () => {
	assert.equal(versionToRecord("1.1.0", "1.1.1"), "1.1.1");
	assert.equal(versionToRecord(undefined, "1.1.1"), "1.1.1");
	assert.equal(versionToRecord("1.1.1", "1.1.1"), null);
});

test("the shipped notice names the two fixes of the version it belongs to", () => {
	assert.equal(UPDATE_NOTICE.version, "1.1.2");
	assert.ok(UPDATE_NOTICE.text.includes("outside"));
	assert.ok(UPDATE_NOTICE.text.includes("link"));
});
