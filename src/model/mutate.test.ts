import { test } from "node:test";
import assert from "node:assert/strict";

import { parseMarkdown, serialize } from "./parse.ts";
import { walk } from "./types.ts";
import type { MindNode, ParsedDoc } from "./types.ts";
import {
	addChild,
	addSibling,
	addSiblingBefore,
	canMove,
	canReorder,
	deleteNode,
	indentNode,
	moveAfter,
	moveBefore,
	moveNode,
	outdentNode,
	renameNode,
	replaceBodyRange,
	toggleCheckbox,
} from "./mutate.ts";
import type { Mutation } from "./mutate.ts";

const F = "```";
const FRONTMATTER = ["---", "title: Fixture", "tags: [x]", "---"].join("\n");
const CODE_LINE = 'const keep = "  # untouched  ";';

const FIXTURE = [
	FRONTMATTER,
	"",
	"# Root",
	"",
	"Intro paragraph.",
	"",
	"## Alpha",
	"",
	"- one",
	"  - one-a",
	"  - [ ] task",
	"- two",
	"",
	"## Beta",
	"",
	`${F}js`,
	"// # not a heading",
	CODE_LINE,
	F,
	"",
	"### Gamma",
	"",
	"Tail.",
	"",
].join("\n");

function parse(text = FIXTURE): ParsedDoc {
	return parseMarkdown(text, { title: "Fixture" });
}

function find(parsed: ParsedDoc, text: string): MindNode {
	let hit: MindNode | null = null;
	walk(parsed.root, (n) => {
		if (n.text === text && !hit) hit = n;
	});
	if (!hit) throw new Error(`no node with text "${text}"`);
	return hit;
}

function lines(text: string): string[] {
	return text.split("\n");
}

// --- targeted behaviour ------------------------------------------------------

test("rename keeps indent, marker, checkbox and trailing suffix", () => {
	const p = parse("# R\n\n-   [x]   done   \n\n## H ##\n");
	const item = find(p, "done");
	const renamed = renameNode(p, item, "finished");
	assert.ok(renamed.ok);
	assert.ok(lines(renamed.text).includes("-   [x]   finished   "));

	const p2 = parse(renamed.text);
	const heading = find(p2, "H");
	const r2 = renameNode(p2, heading, "Header");
	assert.ok(lines(r2.text).includes("## Header ##"));
});

test("rename is rejected on a virtual root", () => {
	const p = parse("- a\n- b\n");
	assert.equal(p.root.virtual, true);
	assert.equal(renameNode(p, p.root, "nope").ok, false);
});

test("rename flattens newlines rather than corrupting the line", () => {
	const source = "# R\n\n- a\n";
	const p = parse(source);
	const out = renameNode(p, find(p, "a"), "line one\nline two");
	assert.ok(lines(out.text).includes("- line one line two"));
	// Pasting a multi-line value must not split the node into two lines.
	assert.equal(parse(out.text).doc.lines.length, p.doc.lines.length);
});

test("addChild mimics existing children", () => {
	const p = parse();
	// Alpha's children are list items, so a new child is a list item too.
	const out = addChild(p, find(p, "Alpha"), "three");
	assert.ok(lines(out.text).includes("- three"));
	// It lands after the last existing child's subtree.
	const ls = lines(out.text);
	assert.equal(ls[ls.indexOf("- two") + 1], "- three");
});

test("addChild under a childless heading makes a deeper heading", () => {
	const p = parse();
	const out = addChild(p, find(p, "Gamma"), "Delta");
	assert.ok(lines(out.text).includes("#### Delta"));
	// Headings get blank-line padding.
	const ls = lines(out.text);
	const i = ls.indexOf("#### Delta");
	assert.equal(ls[i - 1], "");
});

test("addChild under an H6 falls back to a list item", () => {
	const p = parse("# R\n\n###### Deep\n");
	const out = addChild(p, find(p, "Deep"), "item");
	assert.ok(lines(out.text).includes("- item"));
});

test("addChild under a list item nests with the detected indent unit", () => {
	const tabs = parse("# R\n\n- a\n\t- b\n");
	assert.equal(tabs.indentUnit, "\t");
	const out = addChild(tabs, find(tabs, "b"), "c");
	assert.ok(lines(out.text).includes("\t\t- c"));

	const spaces = parse("# R\n\n- a\n  - b\n");
	const out2 = addChild(spaces, find(spaces, "b"), "c");
	assert.ok(lines(out2.text).includes("    - c"));
});

test("addChild on an empty note creates an outline, not a competing H1", () => {
	const p = parse("");
	const out = addChild(p, p.root, "first");
	assert.ok(lines(out.text).includes("- first"));
	assert.equal(parse(out.text).root.virtual, true);
});

test("addSibling copies the prefix and advances ordered markers", () => {
	const p = parse("# R\n\n1. first\n2. second\n");
	const out = addSibling(p, find(p, "first"), "inserted");
	// Inserted straight after "first", numbered one higher.
	const ls = lines(out.text);
	assert.equal(ls[ls.indexOf("1. first") + 1], "2. inserted");

	const bullets = parse("# R\n\n* a\n");
	const out2 = addSibling(bullets, find(bullets, "a"), "b");
	assert.ok(lines(out2.text).includes("* b"));
});

test("addSibling is rejected on the root", () => {
	const p = parse();
	assert.equal(addSibling(p, p.root, "x").ok, false);
});

test("addSiblingBefore lands above the node and keeps its marker", () => {
	const p = parse("# R\n\n1. first\n2. second\n");
	const out = addSiblingBefore(p, find(p, "second"), "inserted");
	const ls = lines(out.text);
	// The marker is copied rather than advanced: this item takes second's place.
	assert.equal(ls[ls.indexOf("2. second") - 1], "2. inserted");
});

test("addSiblingBefore pads a heading with its blank line", () => {
	const p = parse();
	const out = addSiblingBefore(p, find(p, "Beta"), "Mid");
	const ls = lines(out.text);
	const i = ls.indexOf("## Mid");
	assert.ok(i > 0);
	assert.equal(ls[i + 1], "");
	assert.equal(ls[i + 2], "## Beta");
});

test("addSiblingBefore is rejected on the root", () => {
	const p = parse();
	assert.equal(addSiblingBefore(p, p.root, "x").ok, false);
});

test("delete removes the whole subtree and tidies the seam", () => {
	const p = parse();
	const out = deleteNode(p, find(p, "Alpha"));
	const ls = lines(out.text);
	assert.ok(!ls.includes("## Alpha"));
	assert.ok(!ls.includes("- one"));
	assert.ok(!ls.includes("  - [ ] task"));
	assert.ok(!ls.includes("- two"));
	// Beta and everything after it survive.
	assert.ok(ls.includes("## Beta"));
	assert.ok(ls.includes(CODE_LINE));
	// No run of two blank lines is left behind.
	assert.ok(!out.text.includes("\n\n\n"));
});

test("delete is rejected on the root", () => {
	const p = parse();
	assert.equal(deleteNode(p, p.root).ok, false);
});

test("toggleCheckbox cycles none -> unchecked -> checked -> none", () => {
	let text = "# R\n\n- plain\n";
	let p = parse(text);
	text = toggleCheckbox(p, find(p, "plain")).text;
	assert.ok(lines(text).includes("- [ ] plain"));

	p = parse(text);
	text = toggleCheckbox(p, find(p, "plain")).text;
	assert.ok(lines(text).includes("- [x] plain"));

	p = parse(text);
	text = toggleCheckbox(p, find(p, "plain")).text;
	assert.ok(lines(text).includes("- plain"));
});

test("toggleCheckbox is rejected on headings", () => {
	const p = parse();
	assert.equal(toggleCheckbox(p, find(p, "Alpha")).ok, false);
});

// --- moving ------------------------------------------------------------------

test("moving a heading under a heading re-levels the whole subtree", () => {
	const p = parse("# R\n\n## A\n\n### A1\n\n## B\n");
	const out = moveNode(p, find(p, "A"), find(p, "B"));
	assert.equal(
		out.text,
		"# R\n\n## B\n\n### A\n\n#### A1\n",
	);
});

test("moving a heading under a list item converts the subtree to list items", () => {
	// "host" must sit under B, not under A, or the move would be into a descendant.
	const p = parse("# R\n\n## A\n\n### A1\n\n## B\n\n- host\n");
	const out = moveNode(p, find(p, "A"), find(p, "host"));
	assert.ok(out.ok);
	const ls = lines(out.text);
	assert.ok(ls.includes("- host"));
	assert.ok(ls.includes("  - A"));
	assert.ok(ls.includes("    - A1"));
	assert.ok(!ls.some((l) => l.startsWith("#") && l.includes("A1")));
	assert.equal(serialize(parse(out.text)), out.text);
});

test("moving a list item under a heading lifts it to a top-level list", () => {
	const p = parse("# R\n\n## A\n\n- x\n  - y\n\n## B\n");
	const out = moveNode(p, find(p, "y"), find(p, "B"));
	const ls = lines(out.text);
	assert.ok(ls.includes("- y"));
	// It is no longer nested under x.
	assert.ok(!ls.includes("  - y"));
	assert.ok(ls.indexOf("- y") > ls.indexOf("## B"));
});

test("a checkbox survives a round trip through heading form", () => {
	const p = parse("# R\n\n## H\n\n- [x] task\n");
	const up = moveNode(p, find(p, "task"), p.root);
	// Under the root heading it stays a list item, so the checkbox is intact.
	assert.ok(lines(up.text).includes("- [x] task"));

	// Force the conversion by making it a child of a heading-level node.
	const p2 = parse("# R\n\n## H\n\n### Deep\n");
	const p3 = parse(addChild(p2, find(p2, "Deep"), "leaf").text);
	assert.ok(lines(serialize(p3)).includes("#### leaf"));
});

test("moving onto a descendant or onto itself is refused", () => {
	const p = parse();
	const alpha = find(p, "Alpha");
	const one = find(p, "one");
	const oneA = find(p, "one-a");

	assert.equal(canMove(alpha, oneA), false);
	assert.equal(canMove(one, one), false);
	assert.equal(moveNode(p, alpha, oneA).ok, false);
	assert.equal(moveNode(p, one, one).ok, false);
	assert.equal(canMove(one, alpha), true);
});

test("moving into an ancestor whose block ends with the moved node works", () => {
	const p = parse("# R\n\n## A\n\n- x\n  - y\n");
	const out = moveNode(p, find(p, "y"), find(p, "A"));
	assert.ok(out.ok);
	const ls = lines(out.text);
	assert.ok(ls.includes("- x"));
	assert.ok(ls.includes("- y"));
	assert.ok(!ls.includes("  - y"));
	assert.equal(serialize(parse(out.text)), out.text);
});

// --- reordering among siblings ------------------------------------------------

const ORDERED = "# R\n\n## H\n\n- a\n  - a1\n- b\n- c\n";

test("moveBefore drops the node directly above its new sibling", () => {
	const p = parse(ORDERED);
	const out = moveBefore(p, find(p, "c"), find(p, "a"));
	assert.equal(out.text, "# R\n\n## H\n\n- c\n- a\n  - a1\n- b\n");
});

test("moveAfter clears the target's whole subtree, not just its line", () => {
	const p = parse(ORDERED);
	const out = moveAfter(p, find(p, "c"), find(p, "a"));
	// Below a1, which belongs to a -- landing between a and a1 would adopt it.
	assert.equal(out.text, "# R\n\n## H\n\n- a\n  - a1\n- c\n- b\n");
});

test("reordering headings keeps their blank-line padding", () => {
	const source = "# R\n\n## H\n\n### A\n\ntext A\n\n### B\n\ntext B\n";
	const p = parse(source);
	const out = moveBefore(p, find(p, "B"), find(p, "A"));
	assert.equal(out.text, "# R\n\n## H\n\n### B\n\ntext B\n\n### A\n\ntext A\n");
});

test("first-level branches are never reordered", () => {
	const p = parse();
	const alpha = find(p, "Alpha");
	const beta = find(p, "Beta");
	const two = find(p, "two");

	// Alpha and Beta hang off the root, where the layout owns the order.
	assert.equal(canReorder(beta, alpha), false);
	assert.equal(canReorder(two, alpha), false);
	assert.equal(moveBefore(p, beta, alpha).ok, false);
	assert.equal(moveAfter(p, beta, alpha).ok, false);
	// The root has no siblings at all.
	assert.equal(canReorder(alpha, p.root), false);
	// Reparenting a first-level branch is still allowed.
	assert.equal(canMove(beta, alpha), true);
});

test("reordering is allowed from the second level down", () => {
	const p = parse();
	assert.equal(canReorder(find(p, "two"), find(p, "one")), true);
	assert.equal(canReorder(find(p, "one-a"), find(p, "task")), true);
	assert.equal(canReorder(find(p, "Gamma"), find(p, "task")), true);
	// Beside your own descendant means "under yourself", which is refused.
	assert.equal(canReorder(find(p, "one"), find(p, "one-a")), false);
	assert.equal(canReorder(find(p, "task"), find(p, "task")), false);
});

test("indent nests under the previous sibling; the first child is refused", () => {
	const p = parse("# R\n\n- a\n- b\n");
	assert.equal(indentNode(p, find(p, "a")).ok, false);
	const out = indentNode(p, find(p, "b"));
	assert.equal(out.text, "# R\n\n- a\n  - b\n");
});

test("outdent lifts a node to sit after its old parent", () => {
	const p = parse("# R\n\n- a\n  - b\n  - c\n");
	const out = outdentNode(p, find(p, "b"));
	assert.equal(out.text, "# R\n\n- a\n  - c\n- b\n");
});

test("outdent is refused for a direct child of the root", () => {
	const p = parse("# R\n\n- a\n");
	assert.equal(outdentNode(p, find(p, "a")).ok, false);
});

// --- body ranges -------------------------------------------------------------

test("replaceBodyRange rewrites only that block", () => {
	const p = parse();
	const beta = find(p, "Beta");
	assert.ok(beta.bodyRanges.length > 0);
	const out = replaceBodyRange(p, beta, 0, "replaced body");
	assert.ok(out.text.includes("replaced body"));
	assert.ok(!out.text.includes(CODE_LINE));
	// Neighbours are untouched.
	assert.ok(out.text.startsWith(FRONTMATTER));
	assert.ok(out.text.includes("### Gamma"));
	assert.ok(out.text.includes("- one"));
});

// --- invariants across every operation ---------------------------------------

type Op = [string, (p: ParsedDoc, n: MindNode) => Mutation];

const OPS: Op[] = [
	["rename", (p, n) => renameNode(p, n, "renamed text")],
	["addChild", (p, n) => addChild(p, n, "new child")],
	["addSibling", (p, n) => addSibling(p, n, "new sibling")],
	["addSiblingBefore", (p, n) => addSiblingBefore(p, n, "new sibling")],
	["toggleCheckbox", (p, n) => toggleCheckbox(p, n)],
	["indent", (p, n) => indentNode(p, n)],
	["outdent", (p, n) => outdentNode(p, n)],
];

function everyNode(p: ParsedDoc): MindNode[] {
	const all: MindNode[] = [];
	walk(p.root, (n) => all.push(n));
	return all;
}

test("no operation ever touches frontmatter", () => {
	for (const [name, op] of [...OPS, ["delete", deleteNode] as Op]) {
		const p = parse();
		for (const node of everyNode(p)) {
			const out = op(p, node);
			if (!out.ok) continue;
			assert.ok(
				out.text.startsWith(FRONTMATTER + "\n"),
				`${name} on "${node.text}" disturbed frontmatter`,
			);
		}
	}
});

test("every mutation re-parses and round-trips exactly", () => {
	for (const [name, op] of [...OPS, ["delete", deleteNode] as Op]) {
		const p = parse();
		for (const node of everyNode(p)) {
			const out = op(p, node);
			if (!out.ok) continue;
			const reparsed = parseMarkdown(out.text, { title: "Fixture" });
			assert.equal(
				serialize(reparsed),
				out.text,
				`${name} on "${node.text}" produced text that does not round-trip`,
			);
		}
	}
});

test("non-destructive operations preserve fenced code verbatim", () => {
	for (const [name, op] of OPS) {
		const p = parse();
		for (const node of everyNode(p)) {
			const out = op(p, node);
			if (!out.ok) continue;
			assert.ok(
				out.text.includes(CODE_LINE),
				`${name} on "${node.text}" damaged the code block`,
			);
			assert.ok(
				out.text.includes("// # not a heading"),
				`${name} on "${node.text}" damaged the code block`,
			);
		}
	}
});

test("every legal move round-trips and keeps code content intact", () => {
	const p = parse();
	const nodes = everyNode(p);
	let performed = 0;

	for (const node of nodes) {
		for (const target of nodes) {
			if (!canMove(node, target)) continue;
			const out = moveNode(p, node, target);
			if (!out.ok) continue;
			performed++;

			const reparsed = parseMarkdown(out.text, { title: "Fixture" });
			assert.equal(
				serialize(reparsed),
				out.text,
				`move "${node.text}" -> "${target.text}" did not round-trip`,
			);
			assert.ok(
				out.text.startsWith(FRONTMATTER + "\n"),
				`move "${node.text}" -> "${target.text}" disturbed frontmatter`,
			);
			// The code line may gain indentation, but its content is untouched.
			assert.ok(
				out.text.includes(CODE_LINE),
				`move "${node.text}" -> "${target.text}" damaged code content`,
			);
			// Nothing is ever lost or duplicated.
			assert.equal(
				out.text.split("- two").length - 1,
				1,
				`move "${node.text}" -> "${target.text}" duplicated a node`,
			);
		}
	}
	assert.ok(performed > 20, `expected a broad sweep of moves, ran ${performed}`);
});

test("every legal reorder round-trips and keeps code content intact", () => {
	const p = parse();
	const nodes = everyNode(p);
	let performed = 0;

	for (const node of nodes) {
		for (const target of nodes) {
			if (!canReorder(node, target)) continue;
			for (const [name, drop] of [
				["before", moveBefore],
				["after", moveAfter],
			] as Array<[string, typeof moveBefore]>) {
				const out = drop(p, node, target);
				assert.ok(out.ok, `${name} "${node.text}" -> "${target.text}" was refused`);
				performed++;

				const label = `${name} "${node.text}" -> "${target.text}"`;
				const reparsed = parseMarkdown(out.text, { title: "Fixture" });
				assert.equal(serialize(reparsed), out.text, `${label} did not round-trip`);
				assert.ok(out.text.startsWith(FRONTMATTER + "\n"), `${label} disturbed frontmatter`);
				assert.ok(out.text.includes(CODE_LINE), `${label} damaged code content`);

				// Exactly one copy survives, and it hangs off the target's parent.
				// A list item that became a heading carries its checkbox along as
				// literal text, so match on the tail rather than the whole title.
				const moved = everyNode(reparsed).filter(
					(n) => n.text === node.text || n.text.endsWith(`] ${node.text}`),
				);
				assert.equal(moved.length, 1, `${label} lost or duplicated the node`);
				assert.equal(
					moved[0].parent?.text,
					target.parent?.text,
					`${label} did not land beside the target`,
				);
			}
		}
	}
	assert.ok(performed > 20, `expected a broad sweep of reorders, ran ${performed}`);
});

test("focusLine resolves to a real node after re-parsing", () => {
	for (const [name, op] of OPS) {
		const p = parse();
		for (const node of everyNode(p)) {
			const out = op(p, node);
			if (!out.ok || out.focusLine < 0) continue;
			const reparsed = parseMarkdown(out.text, { title: "Fixture" });
			let found = false;
			walk(reparsed.root, (n) => {
				if (n.lineStart === out.focusLine) found = true;
			});
			assert.ok(found, `${name} on "${node.text}" left a dangling focusLine`);
		}
	}
});
