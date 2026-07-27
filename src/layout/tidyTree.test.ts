import { test } from "node:test";
import assert from "node:assert/strict";

import { createLayoutNode, layoutTree } from "./tidyTree.ts";
import type { LayoutNode, LayoutOptions, Side } from "./tidyTree.ts";
import type { MindNode } from "../model/types.ts";

const OPTS: LayoutOptions = {
	mode: "balanced",
	horizontalGap: 60,
	verticalGap: 12,
	padding: 40,
};

let counter = 0;

function mindNode(text: string): MindNode {
	counter++;
	return {
		id: `n${counter}`,
		key: `k${counter}`,
		kind: "listitem",
		virtual: false,
		text,
		level: 1,
		indentWidth: 0,
		indent: "",
		marker: "-",
		spacing: " ",
		checkbox: null,
		checkboxSpacing: "",
		suffix: "",
		lineStart: counter,
		blockEnd: counter,
		bodyRanges: [],
		children: [],
		parent: null,
	};
}

/** Build a layout tree with fixed card sizes, standing in for DOM measurement. */
function build(
	spec: { w?: number; h?: number; children?: unknown[] },
	parent: LayoutNode | null = null,
	depth = 0,
): LayoutNode {
	const layout = createLayoutNode(mindNode(`node-${counter}`), parent, depth);
	layout.width = spec.w ?? 120;
	layout.height = spec.h ?? 30;
	for (const child of spec.children ?? []) {
		layout.children.push(
			build(child as { w?: number; h?: number; children?: unknown[] }, layout, depth + 1),
		);
	}
	return layout;
}

function leaf(w = 120, h = 30) {
	return { w, h };
}

function overlaps(a: LayoutNode, b: LayoutNode): boolean {
	const xOverlap = a.x < b.x + b.width && b.x < a.x + a.width;
	const yOverlap = a.y < b.y + b.height && b.y < a.y + a.height;
	return xOverlap && yOverlap;
}

function assertNoOverlaps(nodes: LayoutNode[]): void {
	for (let i = 0; i < nodes.length; i++) {
		for (let j = i + 1; j < nodes.length; j++) {
			assert.ok(
				!overlaps(nodes[i], nodes[j]),
				`cards overlap: ${nodes[i].node.text} and ${nodes[j].node.text}`,
			);
		}
	}
}

test("a single node lays out inside its own bounds", () => {
	const root = build(leaf(200, 40));
	const result = layoutTree(root, OPTS);
	assert.equal(result.width, 200 + OPTS.padding * 2);
	assert.equal(result.height, 40 + OPTS.padding * 2);
	assert.equal(root.x, OPTS.padding);
	assert.equal(root.y, OPTS.padding);
});

test("children sit to the right of their parent with the requested gap", () => {
	const root = build({ children: [leaf(), leaf()] });
	layoutTree(root, { ...OPTS, mode: "right" });
	for (const child of root.children) {
		assert.equal(child.x, root.x + root.width + OPTS.horizontalGap);
	}
});

test("a parent is centred on the span of its children", () => {
	const root = build({ children: [leaf(), leaf(), leaf()] });
	layoutTree(root, { ...OPTS, mode: "right" });

	const first = root.children[0];
	const last = root.children[root.children.length - 1];
	const span = (first.y + first.height / 2 + (last.y + last.height / 2)) / 2;
	assert.ok(Math.abs(root.y + root.height / 2 - span) < 0.001);
});

test("siblings are separated by exactly the vertical gap", () => {
	const root = build({ children: [leaf(120, 30), leaf(120, 30)] });
	layoutTree(root, { ...OPTS, mode: "right" });
	const [a, b] = root.children;
	assert.equal(b.y - (a.y + a.height), OPTS.verticalGap);
});

test("no two cards overlap in a deep, uneven tree", () => {
	const root = build({
		w: 180,
		h: 44,
		children: [
			{ children: [leaf(), { children: [leaf(), leaf(), leaf()] }, leaf()] },
			{ children: [{ children: [{ children: [leaf(200, 60)] }] }] },
			leaf(90, 80),
			{ children: [leaf(), leaf()] },
			{ children: [{ children: [leaf(), leaf()] }, leaf(300, 20)] },
		],
	});
	const result = layoutTree(root, OPTS);
	assertNoOverlaps(result.nodes);
});

test("no two cards overlap in single-sided mode either", () => {
	const root = build({
		children: [
			{ children: [leaf(), { children: [leaf(), leaf()] }] },
			{ children: [leaf(), leaf(), leaf()] },
			leaf(),
		],
	});
	const result = layoutTree(root, { ...OPTS, mode: "right" });
	assertNoOverlaps(result.nodes);
});

test("a tall parent pushes its children down instead of overlapping them", () => {
	const root = build({ children: [{ h: 400, children: [leaf(120, 20), leaf(120, 20)] }] });
	const result = layoutTree(root, { ...OPTS, mode: "right" });
	assertNoOverlaps(result.nodes);
	const tall = root.children[0];
	assert.ok(tall.y >= OPTS.padding - 0.001, "the tall card escaped the top boundary");
});

test("balanced mode puts branches on both sides of the root", () => {
	const root = build({ children: [leaf(), leaf(), leaf(), leaf()] });
	layoutTree(root, OPTS);

	const right = root.children.filter((c) => c.side === 1);
	const left = root.children.filter((c) => c.side === -1);
	assert.ok(right.length > 0, "nothing on the right");
	assert.ok(left.length > 0, "nothing on the left");

	for (const child of right) assert.ok(child.x > root.x + root.width);
	for (const child of left) assert.ok(child.x + child.width < root.x);
});

test("balanced mode keeps document order down the right, then the left", () => {
	const root = build({ children: [leaf(), leaf(), leaf(), leaf()] });
	layoutTree(root, OPTS);
	const sides = root.children.map((c) => c.side);
	// Once it flips to the left it never flips back.
	const firstLeft = sides.indexOf(-1);
	assert.ok(firstLeft > 0);
	assert.ok(sides.slice(firstLeft).every((s) => s === -1));
});

test("a single branch is not split across both sides", () => {
	const root = build({ children: [leaf()] });
	layoutTree(root, OPTS);
	assert.equal(root.children[0].side, 1);
});

test("branch indices propagate to every descendant for colouring", () => {
	const root = build({
		children: [{ children: [{ children: [leaf()] }] }, { children: [leaf()] }],
	});
	const result = layoutTree(root, OPTS);
	for (const node of result.nodes) {
		if (node === root) continue;
		let top = node;
		while (top.parent && top.parent !== root) top = top.parent;
		assert.equal(node.branch, root.children.indexOf(top));
	}
});

test("reported bounds contain every card plus padding", () => {
	const root = build({
		children: [{ children: [leaf(240, 50), leaf()] }, leaf(), { children: [leaf()] }],
	});
	const result = layoutTree(root, OPTS);

	for (const node of result.nodes) {
		assert.ok(node.x >= 0, "a card sits left of the canvas");
		assert.ok(node.y >= 0, "a card sits above the canvas");
		assert.ok(node.x + node.width <= result.width, "a card overflows the width");
		assert.ok(node.y + node.height <= result.height, "a card overflows the height");
	}

	const minX = Math.min(...result.nodes.map((n) => n.x));
	const minY = Math.min(...result.nodes.map((n) => n.y));
	assert.equal(minX, OPTS.padding);
	assert.equal(minY, OPTS.padding);
});

test("laying out the same tree twice gives the same result", () => {
	// The view relies on this: when MathJax finishes flushing its stylesheet the
	// cards are re-measured and re-placed without rebuilding any DOM, so a second
	// pass over the same LayoutNode tree must not drift.
	const root = build({
		children: [
			{ children: [leaf(240, 50), { children: [leaf(), leaf(90, 60)] }] },
			leaf(),
			{ children: [leaf(), leaf()] },
			{ children: [leaf(300, 20)] },
		],
	});

	const first = layoutTree(root, OPTS);
	const snapshot = first.nodes.map((n) => ({
		id: n.node.id,
		x: n.x,
		y: n.y,
		width: n.width,
		height: n.height,
		side: n.side,
		branch: n.branch,
	}));

	const second = layoutTree(root, OPTS);
	assert.equal(second.width, first.width);
	assert.equal(second.height, first.height);

	const byId = new Map(second.nodes.map((n) => [n.node.id, n]));
	assert.equal(byId.size, snapshot.length);
	for (const before of snapshot) {
		const after = byId.get(before.id);
		assert.ok(after, `node ${before.id} disappeared on the second pass`);
		assert.deepEqual(
			{
				id: after.node.id,
				x: after.x,
				y: after.y,
				width: after.width,
				height: after.height,
				side: after.side,
				branch: after.branch,
			},
			before,
		);
	}
});

test("weight decides the split, so folding cannot move a branch across", () => {
	// Four branches whose real sizes are 4, 1, 1, 1. Folding the heavy one makes
	// every *visible* branch a leaf, which on leaf count alone would move the
	// split from after the first branch to after the second -- branch 2 would
	// jump from the left of the root to the right. Weights come from the whole
	// note, so they pin the split either way.
	const sidesFor = (unfolded: boolean, weighted: boolean): Side[] => {
		const heavy = { children: [leaf(), leaf(), leaf(), leaf()] };
		const root = build({
			children: [unfolded ? heavy : leaf(), leaf(), leaf(), leaf()],
		});
		if (weighted) {
			[4, 1, 1, 1].forEach((w, i) => {
				root.children[i].weight = w;
			});
		}
		layoutTree(root, OPTS);
		return root.children.map((c) => c.side);
	};

	// The bug this guards against: without weights the sides really do change.
	assert.notDeepEqual(sidesFor(true, false), sidesFor(false, false));

	assert.deepEqual(sidesFor(true, true), [1, -1, -1, -1]);
	assert.deepEqual(sidesFor(false, true), [1, -1, -1, -1]);
});

test("without a weight the split still falls back to the visible leaves", () => {
	const root = build({
		children: [{ children: [leaf(), leaf(), leaf(), leaf()] }, leaf(), leaf()],
	});
	layoutTree(root, OPTS);
	// The heavy first branch alone reaches half the leaves, so it takes the
	// right on its own and the two light ones go left.
	assert.deepEqual(
		root.children.map((c) => c.side),
		[1, -1, -1],
	);
});
