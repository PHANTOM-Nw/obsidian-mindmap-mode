import { test } from "node:test";
import assert from "node:assert/strict";

import { anchorFor } from "./edges.ts";
import type { LayoutNode } from "../layout/tidyTree.ts";

/**
 * Just enough of a laid-out node to anchor a connector to. The rest of
 * `edges.ts` needs a document; the anchor is arithmetic, and the arithmetic is
 * the part that has to know a card from a node box.
 */
function placed(x: number, y: number, cardHeight: number, annotation: number): LayoutNode {
	return {
		x,
		y,
		cardWidth: 120,
		cardHeight,
		width: 120,
		height: cardHeight + annotation,
	} as LayoutNode;
}

test("a connector meets the middle of the card's face", () => {
	const node = placed(100, 200, 40, 0);
	assert.deepEqual(anchorFor(node, true, 1), [220, 220]);
	assert.deepEqual(anchorFor(node, false, 1), [100, 220]);
});

test("an annotation below the card does not drag the anchor down with it", () => {
	const plain = placed(100, 200, 40, 0);
	const annotated = placed(100, 200, 40, 120);
	for (const outgoing of [true, false]) {
		for (const side of [1, -1]) {
			assert.deepEqual(
				anchorFor(annotated, outgoing, side),
				anchorFor(plain, outgoing, side),
			);
		}
	}
});

test("an outgoing edge leaves the face the branch grows from", () => {
	const node = placed(100, 200, 40, 60);
	// Right-hand branch: out of the right face, in at the left.
	assert.deepEqual(anchorFor(node, true, 1), [220, 220]);
	assert.deepEqual(anchorFor(node, false, 1), [100, 220]);
	// Mirrored on the left of the root.
	assert.deepEqual(anchorFor(node, true, -1), [100, 220]);
	assert.deepEqual(anchorFor(node, false, -1), [220, 220]);
});
