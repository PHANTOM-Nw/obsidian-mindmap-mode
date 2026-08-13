import { test } from "node:test";
import assert from "node:assert/strict";

import { nextInlineToken, plainText } from "./inlineText.ts";

test("every marker is stripped down to what a reader sees", () => {
	assert.equal(plainText("`code`"), "code");
	assert.equal(plainText("**bold** text"), "bold text");
	assert.equal(plainText("__bold__ text"), "bold text");
	assert.equal(plainText("~~gone~~"), "gone");
	assert.equal(plainText("==marked=="), "marked");
	assert.equal(plainText("*em* here"), "em here");
	assert.equal(plainText(""), "");
	assert.equal(plainText("plain title"), "plain title");
});

test("nested markup is unwrapped all the way down", () => {
	assert.equal(plainText("**bold with `code` in it**"), "bold with code in it");
	assert.equal(plainText("==**both**=="), "both");
	// `***a***` is what the renderer draws it as, not what a full markdown
	// parser would: `**a**` matches from index 1, so the odd star stays text.
	assert.equal(plainText("***a***"), "*a*");
});

test("a wikilink is found by its label, never by its target", () => {
	assert.equal(plainText("[[Mindmap Demo|Read the demo]]"), "Read the demo");
	assert.equal(plainText("[[Mindmap Demo]]"), "Mindmap Demo");
	assert.equal(plainText("see [text](https://example.com/page) now"), "see text now");
	assert.equal(plainText("![[diagram.png]]"), "diagram.png");
});

test("code content is left exactly as written", () => {
	assert.equal(plainText("`**not bold**`"), "**not bold**");
	assert.equal(plainText("`[[not a link]]`"), "[[not a link]]");
});

test("math is not a rule here, so a formula stays its own source", () => {
	// Pins the v1 limitation: `$...$` lives in view/mathSyntax.ts and the
	// renderer composes it in front of these rules, so search sees TeX.
	assert.equal(plainText("$\\lambda$ 学习率"), "$\\lambda$ 学习率");
	assert.equal(plainText("rate $a_b$"), "rate $a_b$");
});

test("CJK and other plain text pass through untouched", () => {
	assert.equal(plainText("第一章 标题"), "第一章 标题");
	assert.equal(plainText("**第一章** 标题"), "第一章 标题");
});

test("an unclosed delimiter is text, not a token", () => {
	assert.equal(plainText("**unclosed"), "**unclosed");
	assert.equal(plainText("a * b * c"), "a  b  c");
	assert.equal(plainText("[label](unclosed"), "[label](unclosed");
	assert.equal(plainText("`tick"), "`tick");
});

test("an exact tie goes to whichever rule is listed first", () => {
	const bold = nextInlineToken("**a**", 0);
	assert.equal(bold?.rule.kind, "strong");
	assert.deepEqual([bold?.start, bold?.end], [0, 5]);

	// `![[x]]` starts one character before the wikilink it contains, so it wins
	// on position rather than on order.
	const embed = nextInlineToken("![[x]]", 0);
	assert.equal(embed?.rule.kind, "embed");
	assert.deepEqual([embed?.start, embed?.end], [0, 6]);
});

test("scanning resumes from an offset without re-reading the first token", () => {
	const text = "`one` and **two**";
	const first = nextInlineToken(text, 0);
	assert.equal(first?.rule.kind, "code");
	const second = nextInlineToken(text, first?.end ?? 0);
	assert.equal(second?.rule.kind, "strong");
	assert.equal(second?.match[1], "two");
	assert.equal(nextInlineToken(text, second?.end ?? 0), null);
});

test("the shared patterns are not left holding state between scans", () => {
	// The rules carry `lastIndex`, and plainText recurses into nested markup
	// while an outer scan is in flight. Both have to come out the same twice.
	const text = "**a `b` c** and [[x|y]] and *d*";
	assert.equal(plainText(text), plainText(text));
	assert.equal(plainText(text), "a b c and y and d");
	assert.deepEqual(nextInlineToken(text, 0), nextInlineToken(text, 0));
});
