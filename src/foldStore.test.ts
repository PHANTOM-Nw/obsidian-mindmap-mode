import { test } from "node:test";
import assert from "node:assert/strict";

import {
	MAX_REMEMBERED_NOTES,
	forgetFolder,
	forgetNote,
	putNoteState,
	readStore,
	renameFolder,
	renameNote,
} from "./foldStore.ts";
import type { FoldStore } from "./foldStore.ts";

/** A store with `count` notes, oldest first, so eviction order is nameable. */
function stackOf(count: number, prefix = "n"): FoldStore {
	const store: FoldStore = {};
	for (let i = 0; i < count; i++) {
		store[`${prefix}${i}.md`] = { collapsed: [`h:${i}`], at: i };
	}
	return store;
}

// --- reading whatever is on disk --------------------------------------------

test("a store round-trips through read", () => {
	const store = putNoteState({}, "Notes/a.md", { collapsed: ["h:x"], focusKey: "h:x", focusId: "0.1" }, 7);
	assert.deepEqual(readStore(store), store);
});

test("junk in data.json reads as an empty store rather than throwing", () => {
	for (const raw of [null, undefined, 42, "text", [], true]) {
		assert.deepEqual(readStore(raw), {});
	}
});

test("only the unreadable entries are dropped", () => {
	const raw = {
		"good.md": { collapsed: ["h:a"], at: 1 },
		"no-array.md": { collapsed: "h:a", at: 1 },
		"null.md": null,
		"array.md": [],
		"": { collapsed: [], at: 1 },
	};
	assert.deepEqual(readStore(raw), { "good.md": { collapsed: ["h:a"], at: 1 } });
});

test("a bad field inside a readable entry is dropped, not the entry", () => {
	const store = readStore({
		"a.md": { collapsed: ["h:a", 5, null, "h:b"], focusKey: 9, focusId: "0.1", at: "soon" },
	});
	assert.deepEqual(store, { "a.md": { collapsed: ["h:a", "h:b"], focusId: "0.1", at: 0 } });
});

test("an oversized file on disk is cut down on the way in", () => {
	const store = readStore(stackOf(MAX_REMEMBERED_NOTES + 5));
	assert.equal(Object.keys(store).length, MAX_REMEMBERED_NOTES);
	assert.equal("n0.md" in store, false);
	assert.equal(`n${MAX_REMEMBERED_NOTES + 4}.md` in store, true);
});

// --- writing -----------------------------------------------------------------

test("writing the same note replaces its state rather than accumulating", () => {
	let store = putNoteState({}, "a.md", { collapsed: ["h:one"] }, 1);
	store = putNoteState(store, "a.md", { collapsed: ["h:two"] }, 2);
	assert.deepEqual(store, { "a.md": { collapsed: ["h:two"], at: 2 } });
});

test("the stored collapsed list is a copy, so a later view edit cannot reach it", () => {
	const live = ["h:one"];
	const store = putNoteState({}, "a.md", { collapsed: live }, 1);
	live.push("h:two");
	assert.deepEqual(store["a.md"].collapsed, ["h:one"]);
});

test("an absent focus is stored as absent, not as undefined", () => {
	const store = putNoteState({}, "a.md", { collapsed: [] }, 1);
	assert.equal("focusKey" in store["a.md"], false);
	assert.equal("focusId" in store["a.md"], false);
});

test("the least recently used note is the one evicted", () => {
	const store = putNoteState(stackOf(MAX_REMEMBERED_NOTES), "new.md", { collapsed: [] }, 999);
	assert.equal(Object.keys(store).length, MAX_REMEMBERED_NOTES);
	assert.equal("new.md" in store, true);
	assert.equal("n0.md" in store, false, "the oldest went");
	assert.equal("n1.md" in store, true, "the next oldest stayed");
});

test("re-writing a note refreshes it past the eviction line", () => {
	let store = stackOf(MAX_REMEMBERED_NOTES);
	store = putNoteState(store, "n0.md", { collapsed: [] }, 500);
	store = putNoteState(store, "new.md", { collapsed: [] }, 999);
	assert.equal("n0.md" in store, true, "touched, so no longer the oldest");
	assert.equal("n1.md" in store, false, "which makes this one the oldest");
});

test("notes written in the same pass evict in a fixed order", () => {
	const store: FoldStore = {};
	for (let i = 0; i < MAX_REMEMBERED_NOTES + 1; i++) store[`n${i}.md`] = { collapsed: [], at: 5 };
	const kept = readStore(store);
	assert.equal(Object.keys(kept).length, MAX_REMEMBERED_NOTES);
	assert.equal("n0.md" in kept, false, "ties break on path, so the first name goes");
});

test("an empty path is refused rather than stored", () => {
	assert.deepEqual(putNoteState({}, "", { collapsed: ["h:a"] }, 1), {});
});

// --- forgetting ---------------------------------------------------------------

test("forgetting removes one note and returns the same store when it has none", () => {
	const store = putNoteState({}, "a.md", { collapsed: [] }, 1);
	assert.deepEqual(forgetNote(store, "a.md"), {});
	assert.equal(forgetNote(store, "b.md"), store, "unchanged means the same object");
});

test("deleting a folder forgets the notes under it and nothing beside it", () => {
	let store: FoldStore = {};
	store = putNoteState(store, "Archive/old.md", { collapsed: [] }, 1);
	store = putNoteState(store, "Archive/deep/older.md", { collapsed: [] }, 2);
	store = putNoteState(store, "Archive-2024/kept.md", { collapsed: [] }, 3);
	store = putNoteState(store, "Archive.md", { collapsed: [] }, 4);

	assert.deepEqual(Object.keys(forgetFolder(store, "Archive")).sort(), [
		"Archive-2024/kept.md",
		"Archive.md",
	]);
});

// --- following a move ----------------------------------------------------------

test("a renamed note keeps its state", () => {
	const store = putNoteState({}, "a.md", { collapsed: ["h:x"], focusKey: "h:x" }, 1);
	const moved = renameNote(store, "a.md", "Notes/b.md");
	assert.deepEqual(moved, { "Notes/b.md": { collapsed: ["h:x"], focusKey: "h:x", at: 1 } });
});

test("renaming a note nothing is remembered about changes nothing", () => {
	const store = putNoteState({}, "a.md", { collapsed: [] }, 1);
	assert.equal(renameNote(store, "gone.md", "b.md"), store);
	assert.equal(renameNote(store, "a.md", "a.md"), store);
});

test("a renamed folder carries the notes inside it, prefix matches only", () => {
	let store: FoldStore = {};
	store = putNoteState(store, "Archive/old.md", { collapsed: ["h:x"] }, 1);
	store = putNoteState(store, "Archive/deep/older.md", { collapsed: ["h:y"] }, 2);
	store = putNoteState(store, "Archive-2024/kept.md", { collapsed: ["h:z"] }, 3);

	const moved = renameFolder(store, "Archive", "Attic");
	assert.deepEqual(Object.keys(moved).sort(), [
		"Archive-2024/kept.md",
		"Attic/deep/older.md",
		"Attic/old.md",
	]);
	assert.deepEqual(moved["Attic/deep/older.md"], { collapsed: ["h:y"], at: 2 });
});

test("renaming a folder holding nothing remembered changes nothing", () => {
	const store = putNoteState({}, "Notes/a.md", { collapsed: [] }, 1);
	assert.equal(renameFolder(store, "Archive", "Attic"), store);
});
