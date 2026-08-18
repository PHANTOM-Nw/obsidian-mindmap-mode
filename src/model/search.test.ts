import { test } from "node:test";
import assert from "node:assert/strict";

import { parseMarkdown } from "./parse.ts";
import { hiddenAncestorKeys, refoldKeys, searchTree } from "./search.ts";
import { walk } from "./types.ts";
import type { MindNode, ParsedDoc } from "./types.ts";

const NOTE = `# Focus Note

Intro paragraph mentioning paragraphonly.

## **bold** text

- [[Mindmap Demo|Read the demo]]
- 第一章 标题
- [ ] focus item
- \`code focus\`

## Deep

- one
	- two
		- three
			- deep focus target
`;

const doc = parseMarkdown(NOTE, { title: "Untitled" });

/** Every match's text, which is also its document order. */
function found(parsed: ParsedDoc, text: string, regex = false): string[] {
	return searchTree(parsed.root, { text, regex }).matches.map((m) => m.text);
}

function nodeNamed(parsed: ParsedDoc, text: string): MindNode {
	const hits: MindNode[] = [];
	walk(parsed.root, (node) => {
		if (node.text === text) hits.push(node);
	});
	assert.equal(hits.length, 1, `expected exactly one node named ${text}`);
	return hits[0];
}

test("matches come back in document order", () => {
	assert.deepEqual(found(doc, "focus"), [
		"Focus Note",
		"focus item",
		"code focus",
		"deep focus target",
	]);
});

test("a substring query is case-insensitive", () => {
	assert.deepEqual(found(doc, "FOCUS ITEM"), ["focus item"]);
	assert.deepEqual(found(doc, "dEeP fOcUs"), ["deep focus target"]);
});

test("an empty query finds nothing rather than everything", () => {
	const result = searchTree(doc.root, { text: "", regex: false });
	assert.deepEqual(result.matches, []);
	assert.equal(result.invalid, false);
	assert.deepEqual(searchTree(doc.root, { text: "", regex: true }).matches, []);
});

test("a regex is anchored, alternated and case-insensitive as written", () => {
	assert.deepEqual(found(doc, "^第", true), ["第一章 标题"]);
	assert.deepEqual(found(doc, "^(one|two)$", true), ["one", "two"]);
	assert.deepEqual(found(doc, "focus note", true), ["Focus Note"]);
});

test("a pattern that will not compile reports itself instead of throwing", () => {
	const result = searchTree(doc.root, { text: "(", regex: true });
	assert.deepEqual(result.matches, []);
	assert.equal(result.invalid, true);
	// Only regex mode compiles anything; the same text is a plain substring.
	assert.equal(searchTree(doc.root, { text: "(", regex: false }).invalid, false);
});

test("a regex does not carry lastIndex from one node to the next", () => {
	// With a `g` flag the second sibling would resume mid-string and the third
	// would miss outright.
	const repeated = parseMarkdown("- aa\n- aa\n- aa\n", { title: "Untitled" });
	assert.equal(found(repeated, "a", true).length, 3);
	assert.equal(found(repeated, "a").length, 3);
});

test("a node deep in the tree is found; folding is not the model's business", () => {
	const target = nodeNamed(doc, "deep focus target");
	assert.equal(target.level, 4);
	assert.deepEqual(found(doc, "deep focus target"), ["deep focus target"]);
});

test("a virtual root is skipped, a promoted h1 root is not", () => {
	const virtual = parseMarkdown("- alpha\n- beta\n", { title: "Untitled" });
	assert.equal(virtual.root.virtual, true);
	assert.deepEqual(found(virtual, "untitled"), []);

	assert.equal(doc.root.virtual, false);
	assert.deepEqual(found(doc, "Focus Note"), ["Focus Note"]);
});

test("CJK text is matched as written", () => {
	assert.deepEqual(found(doc, "第一章"), ["第一章 标题"]);
	assert.deepEqual(found(doc, "标题"), ["第一章 标题"]);
});

test("matching is done on what the card shows, not on the markup", () => {
	// Markers are stripped, so a query may span them.
	assert.deepEqual(found(doc, "bold text"), ["bold text"]);
	// A wikilink is its label; the target it points at is not on the card.
	assert.deepEqual(found(doc, "Read the demo"), ["Read the demo"]);
	assert.deepEqual(found(doc, "Mindmap Demo"), []);
	// Code shows its content, so the backticks are not part of the text.
	assert.deepEqual(found(doc, "code focus"), ["code focus"]);
});

test("note content is out of scope in v1", () => {
	assert.deepEqual(found(doc, "paragraphonly"), []);
	assert.ok(doc.root.bodyRanges.length > 0);
});

test("a checkbox is not part of the text it precedes", () => {
	assert.deepEqual(found(doc, "[ ] focus"), []);
	assert.equal(nodeNamed(doc, "focus item").checkbox, " ");
});

test("every match resolves back to the same node by key and by id", () => {
	for (const match of searchTree(doc.root, { text: "o", regex: false }).matches) {
		const byKey = doc.byKey.get(match.key);
		const byId = doc.byId.get(match.id);
		assert.ok(byKey, `key ${match.key} is not in byKey`);
		assert.equal(byKey, byId);
	}
});

test("hiddenAncestorKeys names only the ancestors actually in the way", () => {
	const target = nodeNamed(doc, "deep focus target");
	const one = nodeNamed(doc, "one");
	const three = nodeNamed(doc, "three");

	assert.deepEqual(hiddenAncestorKeys(target, new Set()), []);
	// Outermost first, and only the collapsed ones.
	assert.deepEqual(hiddenAncestorKeys(target, new Set([three.key, one.key])), [
		one.key,
		three.key,
	]);
	// A node collapsed in its own right is not hiding itself.
	assert.deepEqual(hiddenAncestorKeys(target, new Set([target.key])), []);
});

test("refoldKeys hands back every branch except the one holding the match", () => {
	const deep = nodeNamed(doc, "Deep");
	const one = nodeNamed(doc, "one");
	const two = nodeNamed(doc, "two");
	const three = nodeNamed(doc, "three");
	const target = nodeNamed(doc, "deep focus target");
	const elsewhere = nodeNamed(doc, "**bold** text");

	const revealed = new Set([deep.key, one.key, two.key, three.key, elsewhere.key]);

	// Nothing left to keep: everything the search opened goes back.
	assert.deepEqual(new Set(refoldKeys(revealed, null)), revealed);

	// The chain that keeps the match on the map survives whole, the branch four
	// levels up included; the unrelated branch does not.
	assert.deepEqual(refoldKeys(revealed, target), [elsewhere.key]);

	// A node is not its own ancestor, and neither is anything below it: keeping
	// `two` keeps only what is above `two`.
	assert.deepEqual(new Set(refoldKeys(revealed, two)), new Set([two.key, three.key, elsewhere.key]));

	// A match nothing was opened for still costs nothing.
	assert.deepEqual(refoldKeys(new Set(), target), []);
});
