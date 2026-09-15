import { test } from "node:test";
import assert from "node:assert/strict";

import { ClickGate, opensEditor } from "./clickIntent.ts";
import type { ClickTarget } from "./clickIntent.ts";

/** Every kind of card a link can be written in. */
const KINDS = ["root", "heading", "listitem", "body"] as const;

/** A single click on a link in a card of that kind. */
const onLink = (kind: string, href = "Mindmap Demo"): ClickTarget => ({
	kind,
	href,
	clickCount: 1,
});

/** A single click on a card, away from any link. */
const onCard = (kind: string): ClickTarget => ({ kind, href: null, clickCount: 1 });

test("a link opens from every kind of card", () => {
	for (const kind of KINDS) {
		const gate = new ClickGate();
		assert.deepEqual(gate.click(onLink(kind)), {
			action: "open",
			href: "Mindmap Demo",
		});
	}
});

test("a link in an annotation opens: the strip does not change its card's kind", () => {
	const gate = new ClickGate();
	assert.deepEqual(gate.click(onLink("heading", "Link Fixture.pdf")), {
		action: "open",
		href: "Link Fixture.pdf",
	});
});

test("a click that is not on a link is left to the rest of the handler", () => {
	const gate = new ClickGate();
	for (const kind of KINDS) {
		assert.deepEqual(gate.click(onCard(kind)), { action: "select" });
	}
	// Blank canvas, which the view reads as "select nothing".
	assert.deepEqual(gate.click(onCard("")), { action: "select" });
	assert.deepEqual(gate.click({ kind: null, href: null, clickCount: 1 }), {
		action: "select",
	});
});

test("a link with an empty target is not a link", () => {
	const gate = new ClickGate();
	assert.deepEqual(gate.click({ kind: "heading", href: "", clickCount: 1 }), {
		action: "select",
	});
});

test("the click a drag leaves behind opens nothing, and spends the flag", () => {
	const gate = new ClickGate();
	gate.dragEnded();
	assert.deepEqual(gate.click(onLink("heading")), { action: "swallow" });
	// One drag, one swallowed click: the next one is a click again.
	assert.deepEqual(gate.click(onLink("heading")), {
		action: "open",
		href: "Mindmap Demo",
	});
});

test("a drag swallows the click on a card too, not only on a link", () => {
	const gate = new ClickGate();
	gate.dragEnded();
	assert.deepEqual(gate.click(onCard("listitem")), { action: "swallow" });
	assert.deepEqual(gate.click(onCard("listitem")), { action: "select" });
});

test("a new press clears the flag, so a drag never costs the click after it", () => {
	// The repaint a drop runs happens inside pointerup, so the browser often
	// never fires the click the flag was raised for.
	const gate = new ClickGate();
	gate.dragEnded();
	gate.pointerDown();
	assert.deepEqual(gate.click(onLink("root")), {
		action: "open",
		href: "Mindmap Demo",
	});

	gate.dragEnded();
	gate.pointerDown();
	assert.deepEqual(gate.click(onCard("root")), { action: "select" });
});

test("a press in the middle of nothing still clears the flag", () => {
	const gate = new ClickGate();
	gate.pointerDown();
	assert.deepEqual(gate.click(onCard("heading")), { action: "select" });
});

test("the second click of a double-click on a link opens nothing", () => {
	const gate = new ClickGate();
	assert.deepEqual(gate.click(onLink("heading")), {
		action: "open",
		href: "Mindmap Demo",
	});
	assert.deepEqual(gate.click({ kind: "heading", href: "Mindmap Demo", clickCount: 2 }), {
		action: "swallow",
	});
	assert.deepEqual(gate.click({ kind: "heading", href: "Mindmap Demo", clickCount: 3 }), {
		action: "swallow",
	});
});

test("a double-click away from a link still reaches the card", () => {
	const gate = new ClickGate();
	assert.deepEqual(gate.click({ kind: "heading", href: null, clickCount: 2 }), {
		action: "select",
	});
});

test("a double-click opens an editor except on a link or the expand button", () => {
	assert.equal(opensEditor({ href: null, onExpand: false }), true);
	assert.equal(opensEditor({ href: "", onExpand: false }), true);
	assert.equal(opensEditor({ href: "Mindmap Demo", onExpand: false }), false);
	assert.equal(opensEditor({ href: null, onExpand: true }), false);
	assert.equal(opensEditor({ href: "Mindmap Demo", onExpand: true }), false);
});
