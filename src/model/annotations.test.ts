import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown, serialize } from "./parse.ts";
import { annotationText, bodyCardCount } from "./annotations.ts";
import { deleteNode, moveNode, renameNode, reorderDown, replaceBodyRange, setAnnotation } from "./mutate.ts";
import type { ParsedDoc } from "./types.ts";

function named(parsed: ParsedDoc, text: string) {
	const node = [...parsed.byId.values()].find((n) => n.text === text);
	assert.ok(node, `Missing node: ${text}`);
	return node;
}

test("multiline annotations stay attached, preserve blank lines and round-trip CRLF", () => {
	const source = "---\r\ntitle: keep\r\n---\r\n# Root\r\n: first\r\n:\r\n: **third**\r\n\r\n## Child\r\n";
	const p = parseMarkdown(source);
	assert.equal(annotationText(p, p.root), "first\n\n**third**");
	assert.equal(bodyCardCount(p.root), 0);
	assert.equal(p.root.children.length, 1);
	assert.equal(serialize(p), source);
});

test("annotations split mixed paragraphs without consuming their source", () => {
	const p = parseMarkdown("# Root\nintro\n: note\nparagraph\n: another\n");
	assert.equal(annotationText(p, p.root), "note\n\nanother");
	assert.equal(bodyCardCount(p.root), 2);
	const edited = replaceBodyRange(p, p.root, 2, "changed");
	assert.equal(edited.text, "# Root\nintro\n: note\nchanged\n: another\n");
});

test("fences, indented code, colon without space, escapes and quotes stay ordinary body", () => {
	const p = parseMarkdown("# Root\n```md\n: fenced\n```\n~~~\n: tilde\n~~~\n    : code\n:word\n\\: escaped\n> : quote\n: real\n");
	assert.equal(annotationText(p, p.root), "real");
	assert.equal(bodyCardCount(p.root), 1);
});

test("list indentation chooses the owner and does not consume indented code", () => {
	const p = parseMarkdown("# Root\n- Parent\n  : parent\n  - Child\n    : child\n        : code\n: heading\n");
	assert.equal(annotationText(p, p.root), "heading");
	assert.equal(annotationText(p, named(p, "Parent")), "parent");
	assert.equal(annotationText(p, named(p, "Child")), "child");
	assert.equal(bodyCardCount(named(p, "Child")), 1);
});

test("ordered lists and tabs support annotations at their content columns", () => {
	const p = parseMarkdown("10. Ordered\n    : numbered\n\t- Tabbed\n\t  : tabs\n");
	assert.equal(annotationText(p, named(p, "Ordered")), "numbered");
	assert.equal(annotationText(p, named(p, "Tabbed")), "tabs");
});

test("dedented annotations return to the parent list after a nested child", () => {
	const p = parseMarkdown("# Root\n- Parent\n  - Child\n    : child\n  : parent after child\n");
	assert.equal(annotationText(p, named(p, "Parent")), "parent after child");
	assert.equal(annotationText(p, named(p, "Child")), "child");
	assert.equal(annotationText(p, p.root), "");
});

test("turning annotations off restores unsplit ordinary body", () => {
	const p = parseMarkdown("# Root\n: one\n: two\n", { annotations: false });
	assert.deepEqual(p.root.annotationIndices, []);
	assert.equal(bodyCardCount(p.root), 1);
});

test("source filters do not attach discarded nodes' annotations to surviving parents", () => {
	const source = "# Root\n: root\n- Item\n  : item\n## Deep\n: deep\n";
	const headings = parseMarkdown(source, { source: "headings-only" });
	assert.equal(annotationText(headings, headings.root), "root");
	assert.equal(bodyCardCount(headings.root), 1);
	const lists = parseMarkdown(source, { source: "lists-only" });
	assert.equal(annotationText(lists, named(lists, "Item")), "item");
	assert.equal(annotationText(lists, lists.root), "");
	const shallow = parseMarkdown(source, { maxHeadingDepth: 1 });
	assert.equal(annotationText(shallow, shallow.root), "root");
});

test("annotations do not attach to a virtual filename or change node keys", () => {
	const p = parseMarkdown(": preamble\n# A\n: note\n# B\n");
	assert.deepEqual(p.root.annotationIndices, []);
	const a = named(p, "A");
	const next = parseMarkdown(setAnnotation(p, a, "changed\n\nline").text);
	assert.equal(named(next, "A").key, a.key);
	assert.equal(annotationText(next, named(next, "A")), "changed\n\nline");
});

test("annotation editor adds, changes and removes only annotation lines", () => {
	const source = "---\r\nk: v\r\n---\r\n# Root\r\nparagraph  \r\n## Child\r\n";
	const p = parseMarkdown(source);
	const added = setAnnotation(p, p.root, "one\n\nthree");
	assert.equal(added.text, source.replace("# Root\r\n", "# Root\r\n: one\r\n:\r\n: three\r\n"));
	const next = parseMarkdown(added.text);
	assert.equal(setAnnotation(next, next.root, "").text, source);
	assert.equal(setAnnotation(next, next.root, "one\n\nthree").ok, false);
});

test("editing multiple blocks keeps intervening body and consolidates annotations", () => {
	const p = parseMarkdown("# Root\n: first\nkeep\n: last\n");
	assert.equal(setAnnotation(p, p.root, "new\n\ntext").text, "# Root\n: new\n:\n: text\nkeep\n");
});

test("adding an annotation to a task item preserves its checkbox and children", () => {
	const p = parseMarkdown("# Root\n- [x] Task\n  - Child\n");
	const result = setAnnotation(p, named(p, "Task"), "line one\nline two");
	assert.equal(result.text, "# Root\n- [x] Task\n  : line one\n  : line two\n  - Child\n");
	const next = parseMarkdown(result.text);
	assert.equal(annotationText(next, named(next, "Task")), "line one\nline two");
	assert.equal(named(next, "Task").children[0].text, "Child");
});

test("renaming leaves annotations byte-identical and moving converts their indentation", () => {
	const p = parseMarkdown("# Root\n## Topic\n: one\n:\n: two\n## Destination\n- Item\n");
	const topic = named(p, "Topic");
	assert.equal(renameNode(p, topic, "Renamed").text, serialize(p).replace("## Topic", "## Renamed"));
	const moved = moveNode(p, topic, named(p, "Item"));
	assert.ok(moved.ok);
	const next = parseMarkdown(moved.text);
	assert.equal(named(next, "Topic").kind, "listitem");
	assert.equal(annotationText(next, named(next, "Topic")), "one\n\ntwo");
	const back = parseMarkdown(moveNode(next, named(next, "Topic"), named(next, "Destination")).text);
	assert.equal(annotationText(back, named(back, "Topic")), "one\n\ntwo");
});

test("reordering and deleting carry annotations with their owner", () => {
	const p = parseMarkdown("# Root\n## Branch\n### A\n: a\n### B\n: b\n");
	const next = parseMarkdown(reorderDown(p, named(p, "A")).text);
	assert.equal(annotationText(next, named(next, "A")), "a");
	assert.equal(annotationText(next, named(next, "B")), "b");
	const removed = deleteNode(next, named(next, "A"));
	assert.ok(!removed.text.includes(": a"));
	assert.ok(removed.text.includes(": b"));
});

test("annotation writes refuse virtual roots and preserve no-final-newline files", () => {
	const p = parseMarkdown("plain");
	assert.equal(setAnnotation(p, p.root, "no").ok, false);
	const real = parseMarkdown("# Root");
	const added = setAnnotation(real, real.root, "note");
	assert.equal(added.text, "# Root\n: note");
});

test("an explicitly empty annotation can be removed", () => {
	const p = parseMarkdown("# Root\n:\n");
	assert.equal(setAnnotation(p, p.root, "").text, "# Root\n");
});

test("new annotations preserve tab-separated list content columns", () => {
	const p = parseMarkdown("-\tTabbed\n");
	const result = setAnnotation(p, named(p, "Tabbed"), "note");
	const next = parseMarkdown(result.text);
	assert.equal(annotationText(next, named(next, "Tabbed")), "note");
});
