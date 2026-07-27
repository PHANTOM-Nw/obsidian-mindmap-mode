import { test } from "node:test";
import assert from "node:assert/strict";

import { MATH_DISPLAY, MATH_INLINE } from "./mathSyntax.ts";

/** Every match of one pattern, as [index, body] pairs. */
function scan(re: RegExp, text: string): Array<[number, string]> {
	re.lastIndex = 0;
	const found: Array<[number, string]> = [];
	for (let m = re.exec(text); m; m = re.exec(text)) found.push([m.index, m[1]]);
	return found;
}

/**
 * What the node tokenizer does: try every pattern from `from`, keep the earliest
 * match, ties going to whichever pattern was listed first.
 */
function firstToken(
	text: string,
	from = 0,
): { start: number; end: number; body: string; display: boolean } | null {
	let best: { start: number; end: number; body: string; display: boolean } | null = null;
	for (const [re, display] of [
		[MATH_DISPLAY, true],
		[MATH_INLINE, false],
	] as Array<[RegExp, boolean]>) {
		re.lastIndex = from;
		const m = re.exec(text);
		if (!m) continue;
		if (best === null || m.index < best.start) {
			best = { start: m.index, end: m.index + m[0].length, body: m[1], display };
		}
	}
	return best;
}

test("plain inline formulas are matched whole", () => {
	assert.deepEqual(scan(MATH_INLINE, "$\\lambda$"), [[0, "\\lambda"]]);
	assert.deepEqual(scan(MATH_INLINE, "学习率 $\\lambda$ 与 $\\alpha_t$"), [
		[4, "\\lambda"],
		[16, "\\alpha_t"],
	]);
});

test("markdown emphasis characters inside a formula are left alone", () => {
	assert.deepEqual(scan(MATH_INLINE, "$a_b$"), [[0, "a_b"]]);
	assert.deepEqual(scan(MATH_INLINE, "$x*y*z$"), [[0, "x*y*z"]]);
	assert.deepEqual(scan(MATH_INLINE, "$a__b__c$"), [[0, "a__b__c"]]);
});

test("currency is not mistaken for math", () => {
	assert.deepEqual(scan(MATH_INLINE, "costs $5 and $10"), []);
	assert.deepEqual(scan(MATH_INLINE, "$5-$10"), []);
	assert.deepEqual(scan(MATH_INLINE, "budget $20 to $30 per seat"), []);
});

test("an escaped dollar never opens a formula", () => {
	assert.deepEqual(scan(MATH_INLINE, "\\$5 and \\$7"), []);
	assert.deepEqual(scan(MATH_INLINE, "price \\$x$ tail"), []);
});

test("a backslash-escaped dollar can live inside a formula", () => {
	assert.deepEqual(scan(MATH_INLINE, "$a\\$b$"), [[0, "a\\$b"]]);
});

test("a formula body may not open or close on whitespace", () => {
	assert.deepEqual(scan(MATH_INLINE, "$ x$"), []);
	assert.deepEqual(scan(MATH_INLINE, "$x $"), []);
	assert.deepEqual(scan(MATH_INLINE, "$x y$"), [[0, "x y"]]);
});

test("a formula does not run across a line break", () => {
	assert.deepEqual(scan(MATH_INLINE, "$a\nb$"), []);
});

test("display math wins on position, so $$x$$ is never read as inline", () => {
	const token = firstToken("$$x$$");
	assert.deepEqual(token, { start: 0, end: 5, body: "x", display: true });
});

test("display math is found mid-line", () => {
	assert.deepEqual(firstToken("总和 $$\\sum_{i=1}^{n} x_i$$ 完"), {
		start: 3,
		end: 25,
		body: "\\sum_{i=1}^{n} x_i",
		display: true,
	});
});

test("adjacent inline formulas stay two tokens", () => {
	const first = firstToken("$x$$y$");
	assert.deepEqual(first, { start: 0, end: 3, body: "x", display: false });
	assert.deepEqual(firstToken("$x$$y$", first?.end), {
		start: 3,
		end: 6,
		body: "y",
		display: false,
	});
});

test("a formula nested in bold is found by the recursive pass", () => {
	// renderRange recurses into **...** with the inner text, so the tokenizer
	// sees "加粗 $x$" rather than the whole line.
	assert.deepEqual(scan(MATH_INLINE, "加粗 $x$"), [[3, "x"]]);
});
