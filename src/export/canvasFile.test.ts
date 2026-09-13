import { test } from "node:test";
import assert from "node:assert/strict";

import { buildCanvas, serializeCanvas, toHexColor } from "./canvasFile.ts";
import type { CanvasSourceNode } from "./canvasFile.ts";

interface TestNode extends CanvasSourceNode {
	node: { text: string; virtual: boolean; kind: string };
	parent: TestNode | null;
}

/** Deterministic ids, in the order the builder asks for them. */
function counter(): () => string {
	let next = 0;
	return () => (next++).toString(16).padStart(16, "0");
}

function makeNode(
	text: string,
	x: number,
	y: number,
	extra: Partial<TestNode> = {},
): TestNode {
	return {
		node: { text, virtual: false, kind: "heading" },
		x,
		y,
		width: 120,
		height: 40,
		side: 1,
		branch: -1,
		parent: null,
		...extra,
	};
}

/** A virtual root with one branch on each side. */
function balanced(): TestNode[] {
	const root = makeNode("", 400, 300, {
		node: { text: "", virtual: true, kind: "root" },
	});
	const right = makeNode("Right branch", 600, 200, { branch: 0, side: 1, parent: root });
	const left = makeNode("Left branch", 100, 400, { branch: 1, side: -1, parent: root });
	return [root, right, left];
}

test("every node becomes a text card at the coordinates the layout gave it", () => {
	const nodes = [makeNode("Topic", 12.4, 30.6, { width: 100.5, height: 41.2 })];
	const file = buildCanvas({ nodes }, { title: "Plan", branchColor: () => null, nextId: counter() });

	assert.deepEqual(file.nodes, [
		{
			id: "0000000000000000",
			type: "text",
			text: "Topic",
			x: 12,
			y: 31,
			width: 101,
			height: 41,
		},
	]);
	assert.deepEqual(file.edges, []);
});

test("a virtual root is named after the note, a real one keeps its own text", () => {
	const virtual = buildCanvas(
		{ nodes: [makeNode("", 0, 0, { node: { text: "", virtual: true, kind: "root" } })] },
		{ title: "Plan", branchColor: () => null, nextId: counter() },
	);
	assert.equal(virtual.nodes[0].text, "Plan");

	const real = buildCanvas(
		{ nodes: [makeNode("# Real heading", 0, 0)] },
		{ title: "Plan", branchColor: () => null, nextId: counter() },
	);
	assert.equal(real.nodes[0].text, "# Real heading");
});

test("a card's text is its raw markdown, so links and formatting survive", () => {
	const nodes = [makeNode("**bold** and [[note|Label]] and $x^2$", 0, 0)];
	const file = buildCanvas({ nodes }, { title: "Plan", branchColor: () => null, nextId: counter() });
	assert.equal(file.nodes[0].text, "**bold** and [[note|Label]] and $x^2$");
});

test("note content is exported whole, not as the preview the map shows", () => {
	const owner = makeNode("Topic", 0, 0);
	// A body card is synthesised by the view: virtual, like a file-name root,
	// but hanging off the node whose lines it stands for.
	const body = makeNode("first line…", 0, 80, {
		node: { text: "first line…", virtual: true, kind: "body" },
		parent: owner,
	});
	const file = buildCanvas(
		{ nodes: [owner, body] },
		{
			title: "Plan",
			branchColor: () => null,
			nextId: counter(),
			fullText: (item) => (item.node.kind === "body" ? "first line\nsecond line" : null),
		},
	);
	assert.equal(file.nodes[1].text, "first line\nsecond line");
	assert.equal(file.nodes[0].text, "Topic");
});

test("an edge per parent-to-child link, naming the ids of both ends", () => {
	const nodes = balanced();
	const file = buildCanvas({ nodes }, { title: "Plan", branchColor: () => null, nextId: counter() });

	assert.equal(file.nodes.length, 3);
	assert.equal(file.edges.length, 2);
	const [root, right, left] = file.nodes;
	assert.equal(file.edges[0].fromNode, root.id);
	assert.equal(file.edges[0].toNode, right.id);
	assert.equal(file.edges[1].fromNode, root.id);
	assert.equal(file.edges[1].toNode, left.id);
	// Ids are handed out in one run: every node first, then every edge.
	assert.deepEqual(
		[...file.nodes.map((n) => n.id), ...file.edges.map((e) => e.id)],
		[
			"0000000000000000",
			"0000000000000001",
			"0000000000000002",
			"0000000000000003",
			"0000000000000004",
		],
	);
});

test("an edge leaves the face its branch grows from, on either side of the root", () => {
	const file = buildCanvas(
		{ nodes: balanced() },
		{ title: "Plan", branchColor: () => null, nextId: counter() },
	);

	// Right branch: out of the root's right face, into the child's left.
	assert.equal(file.edges[0].fromSide, "right");
	assert.equal(file.edges[0].toSide, "left");
	// Left branch, mirrored.
	assert.equal(file.edges[1].fromSide, "left");
	assert.equal(file.edges[1].toSide, "right");
});

test("branch colours are written per branch, and the root gets none", () => {
	const palette = ["#4f9df7", "#f2994a"];
	const file = buildCanvas(
		{ nodes: balanced() },
		{
			title: "Plan",
			branchColor: (branch) => (branch < 0 ? null : palette[branch]),
			nextId: counter(),
		},
	);

	assert.equal(file.nodes[0].color, undefined);
	assert.equal(file.nodes[1].color, "#4f9df7");
	assert.equal(file.nodes[2].color, "#f2994a");
});

test("with branch colours off, no card carries a colour at all", () => {
	const file = buildCanvas(
		{ nodes: balanced() },
		{ title: "Plan", branchColor: () => null, nextId: counter() },
	);
	for (const node of file.nodes) assert.equal("color" in node, false);
});

test("a branch colour the theme spells another way is converted, or dropped", () => {
	assert.equal(toHexColor("rgb(79, 157, 247)"), "#4f9df7");
	assert.equal(toHexColor("rgba(79, 157, 247, 0.5)"), "#4f9df7");
	assert.equal(toHexColor("rgb(79 157 247 / 50%)"), "#4f9df7");
	assert.equal(toHexColor("#ABC"), "#aabbcc");
	assert.equal(toHexColor("#4F9DF7FF"), "#4f9df7");
	assert.equal(toHexColor("var(--accent)"), null);
	assert.equal(toHexColor(""), null);
	assert.equal(toHexColor(null), null);
});

test("a fully transparent colour is no colour, not black", () => {
	// Canvas has nowhere to keep the alpha, and `rgba(0, 0, 0, 0)` is what a
	// colour nobody set comes back as -- written through, it would paint every
	// card black.
	assert.equal(toHexColor("rgba(0, 0, 0, 0)"), null);
	assert.equal(toHexColor("rgb(255 255 255 / 0%)"), null);
	assert.equal(toHexColor("#0000"), null);
	assert.equal(toHexColor("#4f9df700"), null);
	// Partly transparent still has a colour worth keeping.
	assert.equal(toHexColor("rgba(79, 157, 247, 0.5)"), "#4f9df7");
	assert.equal(toHexColor("#4f9df780"), "#4f9df7");
});

test("the file is serialized tab-indented, the way Obsidian writes one", () => {
	const text = serializeCanvas(
		buildCanvas(
			{ nodes: [makeNode("Topic", 0, 0)] },
			{ title: "Plan", branchColor: () => null, nextId: counter() },
		),
	);

	assert.ok(text.startsWith('{\n\t"nodes": [\n\t\t{\n'), text.slice(0, 40));
	assert.ok(!text.includes("\n    "), "no space indentation anywhere");
	assert.deepEqual(Object.keys(JSON.parse(text)), ["nodes", "edges"]);
});
