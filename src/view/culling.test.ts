import { test } from "node:test";
import assert from "node:assert/strict";

import {
	clampedMargin,
	covers,
	edgeInView,
	emptyPlan,
	overlaps,
	planCull,
	viewBoxFrom,
	viewBoxOf,
} from "./culling.ts";
import type { Box, CullScan, ViewBox } from "./culling.ts";

/** A viewport 1000x600, camera at the origin, no zoom. */
const plain = (margin = 0): ViewBox => {
	const view = viewBoxOf(1000, 600, 0, 0, 1, margin);
	assert.ok(view, "a viewport with a size always has a view box");
	return view;
};

const box = (x: number, y: number, width = 100, height = 30): Box => ({ x, y, width, height });

test("an unmoved, unzoomed viewport shows exactly its own pixels", () => {
	assert.deepEqual(plain(), { left: 0, top: 0, right: 1000, bottom: 600 });
});

test("panning the camera moves the view box the other way", () => {
	// The content was dragged 200px right and 100px down, so what is on screen
	// is the region starting 200px to the *left* of the content origin.
	assert.deepEqual(viewBoxOf(1000, 600, 200, 100, 1), {
		left: -200,
		top: -100,
		right: 800,
		bottom: 500,
	});
});

test("zooming out shows more content, not less", () => {
	const view = viewBoxOf(1000, 600, 0, 0, 0.5);
	assert.deepEqual(view, { left: 0, top: 0, right: 2000, bottom: 1200 });
});

test("the margin is screen pixels, so the zoom scales it too", () => {
	// 100 screen pixels of margin at half zoom is 200 content pixels.
	assert.deepEqual(viewBoxOf(1000, 600, 0, 0, 0.5, 100), {
		left: -200,
		top: -200,
		right: 2200,
		bottom: 1400,
	});
});

test("a viewport with no size has no view box", () => {
	assert.equal(viewBoxOf(0, 600, 0, 0, 1), null);
	assert.equal(viewBoxOf(1000, 0, 0, 0, 1), null);
	assert.equal(viewBoxOf(1000, 600, 0, 0, 0), null);
});

test("a card inside the view is kept, one past it is not", () => {
	const view = plain();
	assert.equal(overlaps(box(10, 10), view), true);
	assert.equal(overlaps(box(1200, 10), view), false);
	assert.equal(overlaps(box(10, 900), view), false);
	assert.equal(overlaps(box(-500, 10), view), false);
});

test("a card straddling the edge counts as inside", () => {
	const view = plain();
	// Sticking out on the right, on the left, off the top.
	assert.equal(overlaps(box(960, 300), view), true);
	assert.equal(overlaps(box(-40, 300), view), true);
	assert.equal(overlaps(box(300, -20), view), true);
});

test("touching the edge is not overlapping it", () => {
	const view = plain();
	// A card whose right edge lands exactly on left: nothing of it is on screen.
	assert.equal(overlaps(box(-100, 300), view), false);
	assert.equal(overlaps(box(1000, 300), view), false);
});

test("the margin is what keeps a card alive just off screen", () => {
	const justOff = box(1100, 300);
	assert.equal(overlaps(justOff, plain()), false);
	assert.equal(overlaps(justOff, plain(400)), true);
});

test("a box covers itself, and anything it contains", () => {
	const outer: ViewBox = { left: 0, top: 0, right: 100, bottom: 100 };
	assert.equal(covers(outer, outer), true);
	assert.equal(covers(outer, { left: 10, top: 10, right: 90, bottom: 90 }), true);
	assert.equal(covers(outer, { left: -1, top: 10, right: 90, bottom: 90 }), false);
	assert.equal(covers(outer, { left: 10, top: 10, right: 101, bottom: 90 }), false);
});

test("a missing box never covers, so the connectors get redrawn", () => {
	const some: ViewBox = { left: 0, top: 0, right: 100, bottom: 100 };
	assert.equal(covers(null, some), false);
	assert.equal(covers(some, null), false);
	assert.equal(covers(null, null), false);
});

test("a connector with an anchor on screen is drawn", () => {
	const view = plain();
	assert.equal(edgeInView(900, 300, 1400, 300, 4, view), true);
	assert.equal(edgeInView(1400, 300, 900, 300, 4, view), true);
});

test("a connector crossing the view with both anchors outside is still drawn", () => {
	const view = plain();
	// Left of the screen to right of it: the curve runs straight through.
	assert.equal(edgeInView(-500, 300, 1500, 300, 4, view), true);
	// Above to below.
	assert.equal(edgeInView(500, -400, 500, 900, 4, view), true);
});

test("a connector wholly past the view is dropped", () => {
	const view = plain();
	assert.equal(edgeInView(1200, 300, 1600, 300, 4, view), false);
	assert.equal(edgeInView(300, 700, 600, 900, 4, view), false);
});

test("the stroke pad keeps a connector that only its own width puts on screen", () => {
	const view = plain();
	// Two anchors two pixels past the right edge: the curve itself misses, but a
	// 3px stroke drawn on it would not.
	assert.equal(edgeInView(1002, 300, 1002, 400, 0, view), false);
	assert.equal(edgeInView(1002, 300, 1002, 400, 4, view), true);
});

test("metrics and a margin give the same box as the numbers do", () => {
	const metrics = { width: 1000, height: 600, tx: 200, ty: 100, scale: 0.5 };
	assert.deepEqual(viewBoxFrom(metrics, 100), viewBoxOf(1000, 600, 200, 100, 0.5, 100));
	assert.deepEqual(viewBoxFrom(metrics), viewBoxOf(1000, 600, 200, 100, 0.5));
});

test("a screen margin is left alone until the zoom makes it enormous", () => {
	// 1600 screen pixels is 1600 content pixels at 1:1 and stays there.
	assert.equal(clampedMargin(1600, 1, 6000), 1600);
	// Half zoom: 3200 content pixels, still under the cap.
	assert.equal(clampedMargin(1600, 0.5, 6000), 1600);
	// A tenth: 16000 content pixels asked for, 6000 granted -- as a screen
	// margin, which is what the view box takes.
	assert.equal(clampedMargin(1600, 0.1, 6000), 600);
	// A viewport with no size never divides by the scale anyway.
	assert.equal(clampedMargin(1600, 0, 6000), 1600);
});

/** A scan over fixed boxes, with the offscreen state held in an array. */
const scanOf = (
	boxes: Box[],
	offscreen: boolean[],
	show: ViewBox | null,
	hide: ViewBox | null,
	budget = Infinity,
	keep: (index: number) => boolean = () => false,
): CullScan => ({
	boxes,
	offscreen: (i) => offscreen[i],
	keep,
	show,
	hide,
	budget,
});

test("a card is shown at the inner box and hidden only past the outer one", () => {
	const show = plain();
	const hide = plain(200);
	const plan = emptyPlan();

	// 1100 is past the viewport but inside the hysteresis band.
	const boxes = [box(1100, 300)];
	// Out of the document: the inner box does not reach it, so it stays out.
	planCull(scanOf(boxes, [true], show, hide), plan);
	assert.deepEqual(plan.show, []);
	// In the document: the outer box still reaches it, so it stays in.
	planCull(scanOf(boxes, [false], show, hide), plan);
	assert.deepEqual(plan.hide, []);
});

test("the band is what a card crossing it costs: one flip, not one a frame", () => {
	const plan = emptyPlan();
	const boxes = [box(900, 300)];
	// On screen, in the document, nothing to do.
	planCull(scanOf(boxes, [false], plain(), plain(200)), plan);
	assert.deepEqual([plan.show, plan.hide], [[], []]);
	// Panned until it is past both boxes: now it goes.
	const far = viewBoxOf(1000, 600, -1400, 0, 1, 0);
	const farHide = viewBoxOf(1000, 600, -1400, 0, 1, 200);
	planCull(scanOf(boxes, [false], far, farHide), plan);
	assert.deepEqual(plan.hide, [0]);
	// Panned back until it reaches the inner box: it comes straight back.
	planCull(scanOf(boxes, [true], plain(), plain(200)), plan);
	assert.deepEqual(plan.show, [0]);
});

test("a card that must stay is never planned out of the document", () => {
	const plan = emptyPlan();
	const boxes = [box(5000, 5000)];
	planCull(scanOf(boxes, [false], plain(), plain(200), Infinity, () => true), plan);
	assert.deepEqual(plan.hide, []);
});

test("a viewport with no size shows everything and hides nothing", () => {
	const plan = emptyPlan();
	const boxes = [box(10, 10), box(9000, 9000)];
	planCull(scanOf(boxes, [true, true], null, null), plan);
	assert.deepEqual(plan.show, [0, 1]);
	planCull(scanOf(boxes, [false, false], null, null), plan);
	assert.deepEqual(plan.hide, []);
});

test("the budget caps the flips and reports the rest as backlog", () => {
	const plan = emptyPlan();
	const boxes = [box(10, 10), box(10, 60), box(10, 110), box(10, 160)];
	planCull(scanOf(boxes, [true, true, true, true], plain(), plain(200), 2), plan);
	assert.deepEqual(plan.show, [0, 1]);
	assert.equal(plan.backlog, 2);
});

test("the budget goes on the cards that come back before the ones that go", () => {
	const plan = emptyPlan();
	// One off-screen card in the document, one on-screen card out of it.
	const boxes = [box(9000, 9000), box(10, 10)];
	planCull(scanOf(boxes, [false, true], plain(), plain(200), 1), plan);
	assert.deepEqual(plan.show, [1], "the visible one is what a viewer would miss");
	assert.deepEqual(plan.hide, []);
	assert.equal(plan.backlog, 1);
});

test("a plan is reusable: the last frame's indices never survive into this one", () => {
	const plan = emptyPlan();
	const boxes = [box(10, 10)];
	planCull(scanOf(boxes, [true], plain(), plain(200)), plan);
	assert.deepEqual(plan.show, [0]);
	planCull(scanOf(boxes, [false], plain(), plain(200)), plan);
	assert.deepEqual(plan.show, []);
	assert.deepEqual(plan.hide, []);
	assert.equal(plan.backlog, 0);
});
