import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { COPIED, INHERITED, INITIAL } from "./snapshot.ts";

/**
 * The exported file carries no stylesheet, so a property `snapshot.ts` does not
 * copy is a property the file does not have. This reads the rules the map is
 * actually drawn with out of `styles.css` and checks the list against them,
 * which is what makes an uncopied property a failing test rather than a
 * silently wrong export.
 */
const CSS = readFileSync(
	fileURLToPath(new URL("../../styles.css", import.meta.url)),
	"utf8",
);

/** The declarations of one rule, as written. */
function declarations(selector: string): Array<[string, string]> {
	const at = CSS.indexOf(`\n${selector} {`);
	assert.notEqual(at, -1, `${selector} is not in styles.css any more`);
	const body = CSS.slice(at + selector.length + 4, CSS.indexOf("}", at));
	return body
		.split(";")
		.map((line) => line.trim())
		.filter((line) => line !== "" && !line.startsWith("/*"))
		.map((line) => {
			const colon = line.indexOf(":");
			return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()] as [string, string];
		});
}

const SIDES = ["top", "right", "bottom", "left"];

/** `getComputedStyle` answers a shorthand with whatever it feels like, so the
 *  copy is longhands throughout -- and so is this. */
const LONGHANDS: Record<string, string[]> = {
	margin: SIDES.map((side) => `margin-${side}`),
	padding: SIDES.map((side) => `padding-${side}`),
	"border-left": ["border-left-width", "border-left-style", "border-left-color"],
	border: SIDES.flatMap((side) => [
		`border-${side}-width`,
		`border-${side}-style`,
		`border-${side}-color`,
	]),
};

/**
 * Properties a static file has no use for: they describe how the map answers a
 * pointer, and the export answers none. `min-height` joins them because every
 * box is written out with the height it was measured at.
 */
const NOT_EXPORTED = new Set(["user-select", "cursor", "min-height", "resize"]);

function required(selector: string): string[] {
	const out: string[] = [];
	for (const [property] of declarations(selector)) {
		if (NOT_EXPORTED.has(property)) continue;
		out.push(...(LONGHANDS[property] ?? [property]));
	}
	return out;
}

test("every property the annotation strip is drawn with is carried into an export", () => {
	const copied = new Set(COPIED);
	for (const property of required(".mm-annotation")) {
		assert.ok(copied.has(property), `snapshot.ts does not copy ${property}`);
	}
});

test("the card's row is carried into an export too", () => {
	const copied = new Set(COPIED);
	for (const property of required(".mm-row")) {
		assert.ok(copied.has(property), `snapshot.ts does not copy ${property}`);
	}
});

test("the inherited and initial tables only name properties that are copied", () => {
	const copied = new Set(COPIED);
	for (const property of INHERITED) {
		assert.ok(copied.has(property), `${property} is inherited but never copied`);
	}
	for (const property of Object.keys(INITIAL)) {
		assert.ok(copied.has(property), `${property} has an initial value but is never copied`);
	}
});

test("no property is copied twice", () => {
	assert.equal(new Set(COPIED).size, COPIED.length);
});
