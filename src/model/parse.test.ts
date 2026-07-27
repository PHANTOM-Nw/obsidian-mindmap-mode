import { test } from "node:test";
import assert from "node:assert/strict";

import { parseMarkdown, serialize } from "./parse.ts";
import { toText } from "./lines.ts";
import { renderNodeLine, walk } from "./types.ts";
import type { MindNode } from "./types.ts";

const FRONTMATTER = `---
tags: [a, b]
nested:
  key: "# not a heading"
---

# Title

Intro paragraph.

## Alpha

- one
	- one-a
	- [ ] one-b
	- [x] one-c
- two

## Beta

\`\`\`js
// # not a heading
// - not a list item
const x = 1;
\`\`\`

| a | b |
| --- | --- |
| 1 | 2 |

### Beta deep

Trailing words.
`;

const SAMPLES: Record<string, string> = {
	frontmatter: FRONTMATTER,
	empty: "",
	blankOnly: "\n\n\n",
	noTrailingNewline: "# A\n\n- x\n- y",
	crlf: "---\r\nk: v\r\n---\r\n\r\n# A\r\n\r\n- one\r\n\t- two\r\n",
	noStructure: "Just a paragraph.\n\nAnd another.\n",
	multipleH1: "# One\n\ntext\n\n# Two\n\n- a\n",
	closingHashes: "## Title ##\n\n### Other  \n",
	orderedList: "1. first\n2) second\n   1. nested\n",
	tildeFence: "~~~\n# nope\n~~~\n\n# yes\n",
	nestedFence: "````md\n```\n# still nope\n```\n````\n\n# real\n",
	deepIndent: "- a\n  - b\n    - c\n      - d\n",
	emptyItems: "-\n- \n- x\n",
	messyWhitespace: "#   Spaced   \n\n-   item   \n",
	htmlBlock: "# H\n\n<div>\n  # not a heading\n</div>\n\n- item\n",
	hashtagNotHeading: "#tag is not a heading\n\n# real heading\n",
	sevenHashes: "####### too many\n\n# ok\n",
};

test("round trip is byte-identical for every sample", () => {
	for (const [name, text] of Object.entries(SAMPLES)) {
		const parsed = parseMarkdown(text, { title: name });
		assert.equal(serialize(parsed), text, `sample "${name}" did not round trip`);
	}
});

test("every node re-renders its own source line exactly", () => {
	for (const [name, text] of Object.entries(SAMPLES)) {
		const parsed = parseMarkdown(text, { title: name });
		walk(parsed.root, (node) => {
			if (node.lineStart < 0 || node.virtual) return;
			assert.equal(
				renderNodeLine(node),
				parsed.doc.lines[node.lineStart],
				`sample "${name}": node ${node.id} did not re-render its line`,
			);
		});
	}
});

test("fenced code contributes no nodes", () => {
	const parsed = parseMarkdown(SAMPLES.frontmatter, { title: "t" });
	const texts: string[] = [];
	walk(parsed.root, (n) => texts.push(n.text));
	assert.ok(!texts.some((t) => t.includes("not a heading")));
	assert.ok(!texts.some((t) => t.includes("not a list item")));
	assert.ok(!texts.some((t) => t.includes("const x")));
});

test("tilde and longer backtick fences are respected", () => {
	for (const key of ["tildeFence", "nestedFence"]) {
		const parsed = parseMarkdown(SAMPLES[key], { title: "t" });
		const texts: string[] = [];
		walk(parsed.root, (n) => texts.push(n.text));
		assert.ok(!texts.some((t) => t.includes("nope")), `${key} leaked a fenced heading`);
	}
});

test("frontmatter is excluded from the tree", () => {
	const parsed = parseMarkdown(FRONTMATTER, { title: "t" });
	assert.equal(parsed.bodyStart, 5);
	const texts: string[] = [];
	walk(parsed.root, (n) => texts.push(n.text));
	assert.ok(!texts.some((t) => t.includes("not a heading")));
	assert.ok(!texts.some((t) => t.includes("tags")));
});

test("a lone H1 becomes the root and keeps its source line", () => {
	const parsed = parseMarkdown(FRONTMATTER, { title: "filename" });
	assert.equal(parsed.root.text, "Title");
	assert.equal(parsed.root.virtual, false);
	assert.equal(parsed.root.kind, "root");
	assert.ok(parsed.root.lineStart >= 0);
});

test("multiple H1s fall back to a virtual filename root", () => {
	const parsed = parseMarkdown(SAMPLES.multipleH1, { title: "My Note" });
	assert.equal(parsed.root.virtual, true);
	assert.equal(parsed.root.text, "My Note");
	assert.equal(parsed.root.lineStart, -1);
	assert.equal(parsed.root.children.length, 2);
});

test("headings nest by level and lists hang off their section", () => {
	const parsed = parseMarkdown(FRONTMATTER, { title: "t" });
	const names = parsed.root.children.map((c) => c.text);
	assert.deepEqual(names, ["Alpha", "Beta"]);

	const alpha = parsed.root.children[0];
	assert.deepEqual(
		alpha.children.map((c) => c.text),
		["one", "two"],
	);
	assert.deepEqual(
		alpha.children[0].children.map((c) => c.text),
		["one-a", "one-b", "one-c"],
	);

	const beta = parsed.root.children[1];
	assert.deepEqual(
		beta.children.map((c) => c.text),
		["Beta deep"],
	);
});

test("checkboxes are captured without swallowing the text", () => {
	const parsed = parseMarkdown(FRONTMATTER, { title: "t" });
	const items: MindNode[] = [];
	walk(parsed.root, (n) => {
		if (n.checkbox !== null) items.push(n);
	});
	assert.deepEqual(
		items.map((n) => [n.text, n.checkbox]),
		[
			["one-b", " "],
			["one-c", "x"],
		],
	);
});

test("blockEnd covers the whole subtree but excludes trailing blanks", () => {
	const parsed = parseMarkdown(FRONTMATTER, { title: "t" });
	const alpha = parsed.root.children[0];
	const lines = parsed.doc.lines;
	assert.equal(lines[alpha.blockEnd].trim(), "- two");

	const beta = parsed.root.children[1];
	assert.equal(lines[beta.blockEnd].trim(), "Trailing words.");
	assert.equal(beta.blockEnd, parsed.root.blockEnd);
});

test("body content is attributed to the owning node", () => {
	const parsed = parseMarkdown(FRONTMATTER, { title: "t" });
	const beta = parsed.root.children[1];
	const body = beta.bodyRanges.map(([s, e]) =>
		parsed.doc.lines.slice(s, e + 1).join("\n"),
	);
	const joined = body.join("\n");
	assert.ok(joined.includes("```js"));
	assert.ok(joined.includes("| a | b |"));
	// The nested heading is a node, not body.
	assert.ok(!joined.includes("### Beta deep"));
});

test("indent unit is detected from the file", () => {
	assert.equal(parseMarkdown("- a\n\t- b\n").indentUnit, "\t");
	assert.equal(parseMarkdown("- a\n  - b\n").indentUnit, "  ");
	assert.equal(parseMarkdown("- a\n    - b\n").indentUnit, "    ");
	assert.equal(parseMarkdown("# only headings\n").indentUnit, "  ");
});

test("CRLF endings survive intact", () => {
	const parsed = parseMarkdown(SAMPLES.crlf, { title: "t" });
	assert.equal(parsed.doc.eol, "\r\n");
	assert.equal(toText(parsed.doc), SAMPLES.crlf);
	assert.equal(parsed.root.text, "A");
});

test("'#tag' and seven hashes are not headings", () => {
	const a = parseMarkdown(SAMPLES.hashtagNotHeading, { title: "t" });
	assert.equal(a.root.text, "real heading");
	const b = parseMarkdown(SAMPLES.sevenHashes, { title: "t" });
	assert.equal(b.root.text, "ok");
});

test("headings-only mode drops list nodes but keeps their lines as body", () => {
	const parsed = parseMarkdown(FRONTMATTER, { title: "t", source: "headings-only" });
	const kinds: string[] = [];
	walk(parsed.root, (n) => kinds.push(n.kind));
	assert.ok(!kinds.includes("listitem"));

	const alpha = parsed.root.children[0];
	const body = alpha.bodyRanges
		.map(([s, e]) => parsed.doc.lines.slice(s, e + 1).join("\n"))
		.join("\n");
	assert.ok(body.includes("- one"));
	assert.ok(body.includes("- two"));
	assert.equal(serialize(parsed), FRONTMATTER);
});

test("lists-only mode drops heading nodes and hoists their lists", () => {
	const parsed = parseMarkdown(FRONTMATTER, { title: "t", source: "lists-only" });
	const kinds: string[] = [];
	walk(parsed.root, (n) => {
		if (n.kind !== "root") kinds.push(n.kind);
	});
	assert.ok(!kinds.includes("heading"));
	assert.deepEqual(
		parsed.root.children.map((c) => c.text),
		["one", "two"],
	);
	assert.equal(serialize(parsed), FRONTMATTER);
});

test("maxHeadingDepth folds deeper headings into body", () => {
	const parsed = parseMarkdown(FRONTMATTER, { title: "t", maxHeadingDepth: 2 });
	const texts: string[] = [];
	walk(parsed.root, (n) => texts.push(n.text));
	assert.ok(!texts.includes("Beta deep"));
	assert.equal(serialize(parsed), FRONTMATTER);
});

test("ids and keys are unique and resolvable", () => {
	const parsed = parseMarkdown(FRONTMATTER, { title: "t" });
	let count = 0;
	walk(parsed.root, (n) => {
		count++;
		assert.equal(parsed.byId.get(n.id), n, `id ${n.id} did not resolve`);
		assert.equal(parsed.byKey.get(n.key), n, `key ${n.key} did not resolve`);
	});
	assert.equal(parsed.byId.size, count);
	assert.equal(parsed.byKey.size, count);
});

test("duplicate sibling names still get distinct keys", () => {
	const parsed = parseMarkdown("# R\n\n- dup\n- dup\n- dup\n");
	const keys = parsed.root.children.map((c) => c.key);
	assert.equal(new Set(keys).size, 3);
});
