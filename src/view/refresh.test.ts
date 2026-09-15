import { test } from "node:test";
import assert from "node:assert/strict";

import { needsRepaint } from "./refresh.ts";

const NOTE = "# Root\n\n- one\n- two\n";

test("the string the map is already drawn from is not worth a paint", () => {
	// Every save: the write comes back through `setViewData` unchanged.
	assert.equal(needsRepaint(NOTE, NOTE, false), false);
});

test("content that differs from the drawn map repaints it", () => {
	// An external edit -- another pane, sync, an editor outside Obsidian.
	assert.equal(needsRepaint(NOTE + "- three\n", NOTE, false), true);
});

test("the same content repaints when nothing is drawn from it", () => {
	// A paint that threw, or one into a pane with no size, leaves nothing on
	// screen. The next call carries the same string and still owes a map.
	assert.equal(needsRepaint(NOTE, null, false), true);
});

test("the first call for a file repaints", () => {
	assert.equal(needsRepaint("", null, false), true);
});

test("a different file always repaints, drawn from the same content or not", () => {
	assert.equal(needsRepaint(NOTE, NOTE, true), true);
	assert.equal(needsRepaint(NOTE, null, true), true);
	assert.equal(needsRepaint("", "", true), true);
});

test("an emptied note is content like any other", () => {
	// "" is a real note body, and `null` is the only "nothing is drawn" value.
	assert.equal(needsRepaint("", NOTE, false), true);
	assert.equal(needsRepaint("", "", false), false);
});
