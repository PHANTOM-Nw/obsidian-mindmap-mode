import { test } from "node:test";
import assert from "node:assert/strict";

import { stripIllegalXml } from "./xmlText.ts";

/** The three C0 controls XML 1.0 allows. */
const LEGAL = new Set([0x09, 0x0a, 0x0d]);

test("drops every C0 control but tab, newline and carriage return", () => {
	for (let code = 0x00; code <= 0x20; code++) {
		const char = String.fromCharCode(code);
		const legal = code === 0x20 || LEGAL.has(code);
		assert.equal(
			stripIllegalXml(`a${char}b`),
			legal ? `a${char}b` : "ab",
			`U+${code.toString(16).padStart(4, "0").toUpperCase()}`,
		);
	}
});

test("drops the two noncharacters at the end of the BMP", () => {
	assert.equal(stripIllegalXml("a\uFFFEb\uFFFFc"), "abc");
});

test("leaves ordinary text alone", () => {
	const text = "Ordinary — 中文 — $x^{2}$ — \tone\r\ntwo \u{1F600}";
	assert.equal(stripIllegalXml(text), text);
});
