import { test } from "node:test";
import assert from "node:assert/strict";

import { BODY_WIDTH_FACTOR, nodeMaxWidth } from "./nodeWidth.ts";

const SETTING = 340;
const BODY = Math.round(SETTING * BODY_WIDTH_FACTOR);

test("a plain title node is capped at the setting, and nothing else is", () => {
	for (const kind of ["root", "heading", "listitem"] as const) {
		assert.deepEqual(nodeMaxWidth(kind, false, SETTING), { node: SETTING, text: null });
	}
});

test("note content is capped wider than a title", () => {
	assert.deepEqual(nodeMaxWidth("body", false, SETTING), { node: BODY, text: null });
	assert.ok(BODY > SETTING);
});

test("an annotated title node gets note content's width, its title the title's", () => {
	assert.deepEqual(nodeMaxWidth("heading", true, SETTING), { node: BODY, text: SETTING });
	assert.deepEqual(nodeMaxWidth("listitem", true, SETTING), { node: BODY, text: SETTING });
});

test("every cap is a whole number of pixels at every setting the slider offers", () => {
	for (let setting = 140; setting <= 520; setting += 20) {
		for (const hasAnnotation of [false, true]) {
			const { node, text } = nodeMaxWidth("heading", hasAnnotation, setting);
			assert.equal(node, Math.round(node));
			assert.ok(node >= setting, "an annotation narrowed the node");
			assert.ok(text === null || text === setting);
		}
	}
});
