import { test } from "node:test";
import assert from "node:assert/strict";

import { escapeXml, htmlDocument, svgDocument } from "./documents.ts";

const base = {
	body: '<div xmlns="http://www.w3.org/1999/xhtml">map</div>',
	width: 800,
	height: 600,
	background: "rgb(30, 30, 30)",
	title: "Plan",
};

test("the SVG document declares its size three times, consistently", () => {
	const svg = svgDocument(base);
	assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="800" height="600" /);
	assert.match(svg, /viewBox="0 0 800 600"/);
	assert.match(svg, /<foreignObject x="0" y="0" width="800" height="600">/);
	assert.ok(svg.endsWith("</svg>"));
});

test("the SVG document paints the background before the map", () => {
	const svg = svgDocument(base);
	const rect = svg.indexOf("<rect");
	const map = svg.indexOf("<foreignObject");
	assert.ok(rect > 0 && rect < map, "the rect covers the whole canvas under the map");
	assert.match(svg, /fill="rgb\(30, 30, 30\)"/);
	assert.ok(svg.includes(base.body));
});

test("a background that could close the style block is refused", () => {
	const svg = svgDocument({ ...base, background: "</style><script>x</script>" });
	assert.match(svg, /fill="#ffffff"/);
	const html = htmlDocument({ ...base, background: "</style><script>x</script>" });
	assert.ok(!html.includes("<script>"));
	assert.match(html, /background: #ffffff;/);
});

test("the HTML document is a static page with the map in its body", () => {
	const html = htmlDocument(base);
	assert.ok(html.startsWith("<!doctype html>"));
	assert.match(html, /<meta charset="utf-8"\/>/);
	assert.match(html, /<title>Plan<\/title>/);
	assert.match(html, /body \{ margin: 0; background: rgb\(30, 30, 30\); \}/);
	assert.match(html, /\.mm-export \{ width: 800px; height: 600px; \}/);
	assert.ok(html.includes(base.body));
	assert.ok(!html.includes("<script"));
});

test("the HTML document takes an HTML-serialized body through unchanged", () => {
	// The two documents are parsed by two different parsers, and this is the one
	// that gets the HTML serialization. `<div></div>` has to survive as written:
	// the XML spelling of the same empty element, `<div/>`, would be read here as
	// a tag that was never closed, and every later card would nest inside it.
	const body = '<div class="mm-export"><div class="mm-checkbox"></div><div></div></div>';
	const html = htmlDocument({ ...base, body });

	assert.ok(html.includes(body));
	assert.ok(!html.includes("<div/>"));
});

test("a title full of markup is escaped in both documents", () => {
	const title = `a < b & "c" 'd' > e`;
	const escaped = "a &lt; b &amp; &quot;c&quot; &apos;d&apos; &gt; e";

	assert.match(svgDocument({ ...base, title }), new RegExp(`<title>${escaped}</title>`));
	assert.match(htmlDocument({ ...base, title }), new RegExp(`<title>${escaped}</title>`));
});

test("escaping is ampersand-first, so nothing is escaped twice", () => {
	assert.equal(escapeXml("&lt;"), "&amp;lt;");
});
