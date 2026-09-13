import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown, serialize } from "./parse.ts";
import { annotationText, bodyCardCount } from "./annotations.ts";
import {
	deleteNode, indentNode, moveBefore, moveNode, outdentNode,
	renameNode, reorderDown, setAnnotation, toggleCheckbox,
} from "./mutate.ts";
import type { ParsedDoc } from "./types.ts";

function item(parsed: ParsedDoc, text: string) {
	const found = [...parsed.byId.values()].find((node) => node.text === text);
	assert.ok(found, `Missing item: ${text}`);
	return found;
}

for (const marker of ["-", "*", "+", "1.", "10.", "1)", "123)"]) {
	test(`${marker} list annotations preserve multiline text, paragraphs and sibling ownership`, () => {
		const indent = " ".repeat(marker.length + 1);
		const source = `${marker} First\n${indent}: line one\n${indent}: line two\n${indent}:\n${indent}: paragraph two\n${marker} Second\n${indent}: second only\n`;
		const parsed = parseMarkdown(source);
		assert.equal(annotationText(parsed, item(parsed, "First")), "line one\nline two\n\nparagraph two");
		assert.equal(annotationText(parsed, item(parsed, "Second")), "second only");
		assert.equal(bodyCardCount(item(parsed, "First")), 0);
		assert.equal(item(parsed, "First").children.length, 0);
		assert.equal(parsed.root.children.length, 2);
		assert.equal(serialize(parsed), source);
	});
}

for (const checkbox of [" ", "x", "X"]) {
	test(`[${checkbox}] task annotations survive edits and checkbox toggling`, () => {
		const source = `# Root\n- [${checkbox}] Task\n  : old\n  - Child\n    : child\n`;
		const parsed = parseMarkdown(source);
		const changed = parseMarkdown(setAnnotation(parsed, item(parsed, "Task"), "new\n\nparagraph").text);
		assert.equal(item(changed, "Task").checkbox, checkbox);
		assert.equal(annotationText(changed, item(changed, "Task")), "new\n\nparagraph");
		const toggled = parseMarkdown(toggleCheckbox(changed, item(changed, "Task")).text);
		assert.equal(annotationText(toggled, item(toggled, "Task")), "new\n\nparagraph");
		assert.equal(annotationText(toggled, item(toggled, "Child")), "child");
		assert.equal(item(toggled, "Child").parent, item(toggled, "Task"));
	});
}

for (const unit of ["  ", "    ", "\t"]) {
	test(`${JSON.stringify(unit)} nested lists assign annotations at all three levels`, () => {
		const source = `# Root\n- Parent\n${unit}: parent before\n${unit}- Child\n${unit}${unit}: child before\n${unit}${unit}- Grandchild\n${unit}${unit}  : grandchild\n${unit}  : child after\n  : parent after\n`;
		const parsed = parseMarkdown(source);
		assert.equal(annotationText(parsed, item(parsed, "Parent")), "parent before\n\nparent after");
		assert.equal(annotationText(parsed, item(parsed, "Child")), "child before\n\nchild after");
		assert.equal(annotationText(parsed, item(parsed, "Grandchild")), "grandchild");
		assert.equal(annotationText(parsed, parsed.root), "");
		assert.equal(serialize(parsed), source);
	});
}

test("list annotations coexist with paragraphs and fenced or indented code", () => {
	const source = "# Root\n- Item\n  : first\n  paragraph\n  ```md\n  : fenced\n  ```\n      : indented code\n  : last\n";
	const parsed = parseMarkdown(source);
	const node = item(parsed, "Item");
	assert.equal(annotationText(parsed, node), "first\n\nlast");
	assert.equal(bodyCardCount(node), 1);
	const updated = setAnnotation(parsed, node, "updated");
	assert.equal(updated.text, "# Root\n- Item\n  : updated\n  paragraph\n  ```md\n  : fenced\n  ```\n      : indented code\n");
});

test("lists-only documents retain annotations and title rename preserves their exact bytes", () => {
	const source = "- First\r\n  : first  \r\n  :\r\n  : final\r\n- Second\r\n  : second\r\n";
	const parsed = parseMarkdown(source, { source: "lists-only" });
	assert.equal(annotationText(parsed, item(parsed, "First")), "first  \n\nfinal");
	assert.equal(renameNode(parsed, item(parsed, "First"), "Renamed").text, source.replace("- First", "- Renamed"));
});

test("indent and outdent carry list annotations without changing siblings", () => {
	const source = "# Root\n- First\n  : first\n- Second\n  : second\n  :\n  : more\n";
	const parsed = parseMarkdown(source);
	const nested = parseMarkdown(indentNode(parsed, item(parsed, "Second")).text);
	assert.equal(item(nested, "Second").parent, item(nested, "First"));
	assert.equal(annotationText(nested, item(nested, "Second")), "second\n\nmore");
	assert.equal(annotationText(nested, item(nested, "First")), "first");
	const restored = parseMarkdown(outdentNode(nested, item(nested, "Second")).text);
	assert.equal(item(restored, "Second").parent, restored.root);
	assert.equal(annotationText(restored, item(restored, "Second")), "second\n\nmore");
	assert.equal(annotationText(restored, item(restored, "First")), "first");
});

test("reordering and deleting list subtrees preserve only the remaining owners' annotations", () => {
	const source = "# Root\n## Branch\n- First\n  : first\n  - Child\n    : child\n- Second\n  : second\n";
	const parsed = parseMarkdown(source);
	const reordered = parseMarkdown(reorderDown(parsed, item(parsed, "First")).text);
	assert.deepEqual(item(reordered, "Branch").children.map((node) => node.text), ["Second", "First"]);
	assert.equal(annotationText(reordered, item(reordered, "First")), "first");
	assert.equal(annotationText(reordered, item(reordered, "Child")), "child");
	const deleted = parseMarkdown(deleteNode(reordered, item(reordered, "First")).text);
	assert.equal(annotationText(deleted, item(deleted, "Second")), "second");
	assert.ok(!serialize(deleted).includes(": first"));
	assert.ok(!serialize(deleted).includes(": child"));
});

test("moving a list across parents and converting it to a heading preserves annotations", () => {
	const parsed = parseMarkdown("# Root\n## Branch\n### A\n- Item\n  : note\n  :\n  : more\n### B\n- Target\n  : target\n");
	const moved = parseMarkdown(moveNode(parsed, item(parsed, "Item"), item(parsed, "Target")).text);
	assert.equal(item(moved, "Item").parent, item(moved, "Target"));
	assert.equal(annotationText(moved, item(moved, "Item")), "note\n\nmore");
	const converted = moveBefore(moved, item(moved, "Item"), item(moved, "B"));
	assert.ok(converted.ok);
	const heading = parseMarkdown(converted.text);
	assert.equal(item(heading, "Item").kind, "heading");
	assert.equal(annotationText(heading, item(heading, "Item")), "note\n\nmore");
	assert.equal(annotationText(heading, item(heading, "Target")), "target");
});

test("an unindented annotation after a list belongs to the heading, not the list item", () => {
	const parsed = parseMarkdown("# Root\n- Item\n  : item\n: heading\n");
	assert.equal(annotationText(parsed, item(parsed, "Item")), "item");
	assert.equal(annotationText(parsed, parsed.root), "heading");
});
