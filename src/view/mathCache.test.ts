import { test } from "node:test";
import assert from "node:assert/strict";

import { MATH_CACHE_LIMIT, MathCache, mathKey } from "./mathCache.ts";

/** A render, standing in for the CHTML tree MathJax would have built. */
interface Render {
	source: string;
	display: boolean;
	/** 0 is the one the cache holds; every copy of it is a generation deeper. */
	copies: number;
}

/** A renderer that records what it was asked for, so a test can count it. */
const renderer = (): { render: (s: string, d: boolean) => Render; calls: string[] } => {
	const calls: string[] = [];
	return {
		calls,
		render: (source, display) => {
			calls.push(mathKey(source, display));
			return { source, display, copies: 0 };
		},
	};
};

const copy = (value: Render): Render => ({ ...value, copies: value.copies + 1 });

test("the delimiters are part of the key, so the two modes never share a render", () => {
	assert.notEqual(mathKey("x", true), mathKey("x", false));
	// `$$x$$` written inline is the empty formula followed by text, so no inline
	// source can collide with a display one.
	assert.equal(mathKey("x", false), "$x");
	assert.equal(mathKey("x", true), "$$x");
});

test("a source is rendered once, however often it is asked for", () => {
	const { render, calls } = renderer();
	const cache = new MathCache<Render>();

	for (let i = 0; i < 5; i++) cache.take("e^{i\\pi}", false, render, copy);
	cache.take("e^{i\\pi}", true, render, copy);

	assert.deepEqual(calls, ["$e^{i\\pi}", "$$e^{i\\pi}"]);
	assert.equal(cache.size, 2);
});

test("every caller gets a copy, never the render the cache is holding", () => {
	const { render } = renderer();
	const cache = new MathCache<Render>();

	const first = cache.take("x", false, render, copy);
	const second = cache.take("x", false, render, copy);

	assert.notEqual(first, second);
	// One generation deep each: both are copies of the stored render rather than
	// copies of one another, so nothing a map does to a card can reach the cache.
	assert.equal(first.copies, 1);
	assert.equal(second.copies, 1);
});

test("a render that throws is not remembered as a formula", () => {
	const cache = new MathCache<Render>();
	let calls = 0;
	const bad = (): Render => {
		calls++;
		throw new Error("malformed TeX");
	};

	assert.throws(() => cache.take("\\frac", false, bad, copy));
	assert.equal(cache.size, 0);
	assert.throws(() => cache.take("\\frac", false, bad, copy));
	assert.equal(calls, 2);
});

test("the cache is bounded, and drops what has gone longest unused", () => {
	const { render, calls } = renderer();
	const cache = new MathCache<Render>(3);

	cache.take("a", false, render, copy);
	cache.take("b", false, render, copy);
	cache.take("c", false, render, copy);
	// `a` is asked for again, so `b` is now the oldest.
	cache.take("a", false, render, copy);
	cache.take("d", false, render, copy);

	assert.equal(cache.size, 3);
	calls.length = 0;
	cache.take("a", false, render, copy);
	cache.take("c", false, render, copy);
	cache.take("d", false, render, copy);
	assert.deepEqual(calls, [], "a, c and d are still held");
	cache.take("b", false, render, copy);
	assert.deepEqual(calls, ["$b"], "b was the one evicted");
});

test("clearing drops every render, and the default bound is a map's worth", () => {
	const { render, calls } = renderer();
	const cache = new MathCache<Render>();

	cache.take("x", false, render, copy);
	cache.clear();
	cache.take("x", false, render, copy);

	assert.deepEqual(calls, ["$x", "$x"]);
	assert.equal(cache.size, 1);
	assert.ok(MATH_CACHE_LIMIT >= 300, "a dense map's formulas all fit at once");
});
