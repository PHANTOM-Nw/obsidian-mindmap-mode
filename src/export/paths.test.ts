import { test } from "node:test";
import assert from "node:assert/strict";

import { joinPath, nextFreePath, takenBy } from "./paths.ts";

/** A vault that holds exactly these paths. */
const holding = (...paths: string[]) => {
	const taken = new Set(paths);
	return (path: string): boolean => taken.has(path);
};

test("an untaken path is used as it stands", () => {
	assert.equal(nextFreePath(holding(), "Notes", "Plan", "canvas"), "Notes/Plan.canvas");
});

test("a taken path grows Obsidian's duplicate suffix", () => {
	assert.equal(
		nextFreePath(holding("Notes/Plan.svg"), "Notes", "Plan", "svg"),
		"Notes/Plan 1.svg",
	);
});

test("the suffix counts up until something is free", () => {
	const vault = holding("Notes/Plan.png", "Notes/Plan 1.png", "Notes/Plan 2.png");
	assert.equal(nextFreePath(vault, "Notes", "Plan", "png"), "Notes/Plan 3.png");
});

test("a gap in the run is filled rather than skipped", () => {
	const vault = holding("Notes/Plan.png", "Notes/Plan 2.png");
	assert.equal(nextFreePath(vault, "Notes", "Plan", "png"), "Notes/Plan 1.png");
});

test("a note at the vault root exports to the vault root", () => {
	assert.equal(nextFreePath(holding(), "", "Plan", "html"), "Plan.html");
	assert.equal(nextFreePath(holding(), "/", "Plan", "html"), "Plan.html");
});

test("the suffix goes before the extension, not before a dot in the name", () => {
	// "notes.v2" is the whole basename: the export adds one extension to it, and
	// the duplicate suffix goes in front of that one, not inside the name.
	assert.equal(nextFreePath(holding(), "Notes", "notes.v2", "svg"), "Notes/notes.v2.svg");
	assert.equal(
		nextFreePath(holding("Notes/notes.v2.svg"), "Notes", "notes.v2", "svg"),
		"Notes/notes.v2 1.svg",
	);
});

test("a folder path is joined with one separator, and the root with none", () => {
	assert.equal(joinPath("a/b", "c.md"), "a/b/c.md");
	assert.equal(joinPath("", "c.md"), "c.md");
	assert.equal(joinPath("/", "c.md"), "c.md");
});

test("a name taken in another case is taken", () => {
	// The vault path is case-sensitive, the disk under it usually is not. A
	// folder already holding "plan.svg" will not take a "Plan.svg", so the
	// export has to see that name as spoken for and move on to the next one.
	const folder = takenBy(["plan.svg", "Other.md"]);
	assert.equal(folder("Notes/Plan.svg"), true);
	assert.equal(folder("Notes/PLAN.SVG"), true);
	assert.equal(folder("Notes/other.md"), true);
	assert.equal(folder("Notes/Plan 1.svg"), false);

	assert.equal(nextFreePath(folder, "Notes", "Plan", "svg"), "Notes/Plan 1.svg");
});

test("a folder listing only speaks for its own folder", () => {
	const folder = takenBy(["plan.svg"]);
	// The predicate is handed whole paths and compares the last segment, so a
	// name is matched wherever the caller says the folder is.
	assert.equal(folder("plan.svg"), true);
	assert.equal(folder("a/b/c/plan.svg"), true);
});

test("a vault that answers yes forever is refused rather than looped over", () => {
	assert.throws(() => nextFreePath(() => true, "", "Plan", "svg"), /No free path/);
});
