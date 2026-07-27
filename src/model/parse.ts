import { fromText, isBlank, toText } from "./lines.ts";
import { DEFAULT_PARSE_OPTIONS, indentWidthOf } from "./types.ts";
import type {
	CheckboxState,
	MindNode,
	NodeKind,
	NodeSource,
	ParseOptions,
	ParsedDoc,
} from "./types.ts";

const FRONTMATTER_OPEN = /^---[ \t]*$/;
const FRONTMATTER_CLOSE = /^(?:---|\.\.\.)[ \t]*$/;
const FENCE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;
const HEADING = /^( {0,3})(#{1,6})(?:([ \t]+)(.*))?$/;
// A marker must be followed by whitespace or end-of-line, so "-foo" is a
// paragraph while "-" is an empty item. Group 5 exists only for the bare case,
// which lets an empty item round trip without gaining a phantom space.
const LIST = /^([ \t]*)([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*)|([ \t]*))$/;
const CHECKBOX = /^\[([ xX])\]([ \t]+)([\s\S]*)$/;
const LEADING_WS = /^[ \t]*/;

/** Split an ATX heading's content from its trailing whitespace and closing hashes. */
function splitHeadingSuffix(content: string): [string, string] {
	const m = /(?:[ \t]+#+)?[ \t]*$/.exec(content);
	const idx = m ? m.index : content.length;
	return [content.slice(0, idx), content.slice(idx)];
}

function splitTrailing(content: string): [string, string] {
	const m = /[ \t]*$/.exec(content);
	const idx = m ? m.index : content.length;
	return [content.slice(0, idx), content.slice(idx)];
}

function makeNode(kind: NodeKind, parent: MindNode | null): MindNode {
	return {
		id: "",
		key: "",
		kind,
		virtual: false,
		text: "",
		level: 0,
		indentWidth: 0,
		indent: "",
		marker: "",
		spacing: " ",
		checkbox: null,
		checkboxSpacing: "",
		suffix: "",
		lineStart: -1,
		blockEnd: -1,
		bodyRanges: [],
		children: [],
		parent,
	};
}

function addBody(node: MindNode, line: number): void {
	const last = node.bodyRanges[node.bodyRanges.length - 1];
	if (last && last[1] === line - 1) last[1] = line;
	else node.bodyRanges.push([line, line]);
}

/** Frontmatter is never part of the map and never touched by a mutation. */
function findBodyStart(lines: string[]): number {
	if (lines.length === 0 || !FRONTMATTER_OPEN.test(lines[0])) return 0;
	for (let i = 1; i < lines.length; i++) {
		if (FRONTMATTER_CLOSE.test(lines[i])) return i + 1;
	}
	// Unterminated: not frontmatter at all.
	return 0;
}

export function parseMarkdown(
	text: string,
	options: Partial<ParseOptions> = {},
): ParsedDoc {
	const opts: ParseOptions = { ...DEFAULT_PARSE_OPTIONS, ...options };
	const doc = fromText(text);
	const lines = doc.lines;
	const bodyStart = findBodyStart(lines);

	const root = makeNode("root", null);
	root.virtual = true;
	root.text = opts.title;

	const headingStack: MindNode[] = [root];
	const listStack: MindNode[] = [];
	let current: MindNode = root;

	let fenceChar = "";
	let fenceLen = 0;
	let inFence = false;

	for (let i = bodyStart; i < lines.length; i++) {
		const line = lines[i];

		// --- fenced code: everything inside is inert body content ---------------
		if (inFence) {
			addBody(current, i);
			const m = FENCE.exec(line);
			if (m && m[2][0] === fenceChar && m[2].length >= fenceLen && m[3].trim() === "") {
				inFence = false;
			}
			continue;
		}
		const fence = FENCE.exec(line);
		if (fence) {
			// A backtick fence's info string may not contain a backtick.
			const infoOk = fence[2][0] === "~" || !fence[3].includes("`");
			if (infoOk) {
				inFence = true;
				fenceChar = fence[2][0];
				fenceLen = fence[2].length;
				addBody(current, i);
				continue;
			}
		}

		// --- ATX heading --------------------------------------------------------
		const heading = HEADING.exec(line);
		if (heading) {
			const level = heading[2].length;
			if (level > opts.maxHeadingDepth) {
				addBody(current, i);
				continue;
			}
			const [text, suffix] = splitHeadingSuffix(heading[4] ?? "");

			listStack.length = 0; // a heading always terminates an open list
			while (
				headingStack.length > 1 &&
				headingStack[headingStack.length - 1].level >= level
			) {
				headingStack.pop();
			}
			const parent = headingStack[headingStack.length - 1];

			const node = makeNode("heading", parent);
			node.level = level;
			node.indent = heading[1];
			node.marker = heading[2];
			node.spacing = heading[3] ?? " ";
			node.text = text;
			node.suffix = suffix;
			node.lineStart = i;

			parent.children.push(node);
			headingStack.push(node);
			current = node;
			continue;
		}

		// --- list item ----------------------------------------------------------
		const list = LIST.exec(line);
		if (list) {
			const indent = list[1];
			const width = indentWidthOf(indent);

			while (
				listStack.length > 0 &&
				listStack[listStack.length - 1].indentWidth >= width
			) {
				listStack.pop();
			}
			const parent =
				listStack.length > 0
					? listStack[listStack.length - 1]
					: headingStack[headingStack.length - 1];

			const node = makeNode("listitem", parent);
			node.indent = indent;
			node.indentWidth = width;
			node.marker = list[2];
			node.spacing = list[3] ?? list[5] ?? "";
			node.level = listStack.length + 1;

			let content = list[4] ?? "";
			const check = CHECKBOX.exec(content);
			if (check) {
				node.checkbox = check[1] as CheckboxState;
				node.checkboxSpacing = check[2];
				content = check[3];
			}
			const [text, suffix] = splitTrailing(content);
			node.text = text;
			node.suffix = suffix;
			node.lineStart = i;

			parent.children.push(node);
			listStack.push(node);
			current = node;
			continue;
		}

		// --- everything else is body content -------------------------------------
		if (isBlank(line)) {
			// Blank lines do not close a list (loose lists are still one list).
			addBody(current, i);
			continue;
		}

		const ws = LEADING_WS.exec(line);
		const width = indentWidthOf(ws ? ws[0] : "");
		const openItem = listStack[listStack.length - 1];
		if (openItem && width > openItem.indentWidth) {
			// Indented past the marker: a continuation of that item.
			addBody(openItem, i);
			current = openItem;
		} else {
			listStack.length = 0;
			current = headingStack[headingStack.length - 1];
			addBody(current, i);
		}
	}

	projectSource(root, opts.source);
	dropBlankBodyRanges(root, lines);
	const promoted = promoteRoot(root, opts, lines);
	computeBlockEnd(promoted, lines);

	const byId = new Map<string, MindNode>();
	const byKey = new Map<string, MindNode>();
	assignIdentity(promoted, "0", "", byId, byKey);

	return {
		root: promoted,
		doc,
		bodyStart,
		indentUnit: opts.indentUnit === "auto" ? detectIndentUnit(promoted) : opts.indentUnit,
		byId,
		byKey,
	};
}

/** Fold a pruned node's entire block into a surviving ancestor's body. */
function absorb(target: MindNode, node: MindNode): void {
	let end = node.lineStart;
	for (const [, e] of node.bodyRanges) if (e > end) end = e;
	const stack = [...node.children];
	while (stack.length > 0) {
		const n = stack.pop() as MindNode;
		if (n.lineStart > end) end = n.lineStart;
		for (const [, e] of n.bodyRanges) if (e > end) end = e;
		stack.push(...n.children);
	}
	if (node.lineStart >= 0) target.bodyRanges.push([node.lineStart, end]);
}

function projectSource(root: MindNode, source: NodeSource): void {
	if (source === "headings-and-lists") return;

	const prune = (node: MindNode): void => {
		const kept: MindNode[] = [];
		for (const child of node.children) {
			const drop =
				source === "headings-only"
					? child.kind === "listitem"
					: child.kind === "heading";
			if (drop) {
				if (source === "headings-only") {
					absorb(node, child);
				} else {
					// lists-only: the heading itself becomes body, its children hoist up.
					if (child.lineStart >= 0) node.bodyRanges.push([child.lineStart, child.lineStart]);
					for (const [s, e] of child.bodyRanges) node.bodyRanges.push([s, e]);
					prune(child);
					for (const grand of child.children) {
						grand.parent = node;
						kept.push(grand);
					}
				}
			} else {
				prune(child);
				kept.push(child);
			}
		}
		node.children = kept;
	};

	prune(root);
	normalizeBodyRanges(root);
}

function normalizeBodyRanges(node: MindNode): void {
	if (node.bodyRanges.length > 1) {
		node.bodyRanges.sort((a, b) => a[0] - b[0]);
		const merged: Array<[number, number]> = [];
		for (const range of node.bodyRanges) {
			const last = merged[merged.length - 1];
			if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1]);
			else merged.push([range[0], range[1]]);
		}
		node.bodyRanges = merged;
	}
	for (const child of node.children) normalizeBodyRanges(child);
}

/**
 * Blank-only ranges stay in the file but are not worth a badge, so they are
 * dropped from the model. Nothing is rewritten, so the round trip is unaffected.
 */
function dropBlankBodyRanges(node: MindNode, lines: string[]): void {
	node.bodyRanges = node.bodyRanges.filter(([s, e]) => {
		for (let i = s; i <= e; i++) if (!isBlank(lines[i])) return true;
		return false;
	});
	for (const child of node.children) dropBlankBodyRanges(child, lines);
}

function promoteRoot(root: MindNode, opts: ParseOptions, lines: string[]): MindNode {
	if (opts.rootPolicy === "filename") return root;

	const headings = root.children.filter((c) => c.kind === "heading");
	const single =
		root.children.length === 1 &&
		root.children[0].kind === "heading" &&
		root.children[0].level === 1;

	const target =
		opts.rootPolicy === "h1"
			? (headings.find((h) => h.level === 1) ?? null)
			: single
				? root.children[0]
				: null;

	if (!target) return root;
	if (opts.rootPolicy === "h1" && target !== root.children[0]) return root;

	// Carry over any preamble the old root owned, and any siblings we would
	// otherwise orphan.
	for (const range of root.bodyRanges) target.bodyRanges.push(range);
	for (const sibling of root.children) {
		if (sibling === target) continue;
		sibling.parent = target;
		target.children.push(sibling);
	}
	target.kind = "root";
	target.parent = null;
	target.virtual = false;
	normalizeBodyRanges(target);
	dropBlankBodyRanges(target, lines);
	return target;
}

function computeBlockEnd(node: MindNode, lines: string[]): number {
	let end = node.lineStart;
	for (const [, e] of node.bodyRanges) if (e > end) end = e;
	for (const child of node.children) {
		const childEnd = computeBlockEnd(child, lines);
		if (childEnd > end) end = childEnd;
	}
	while (end > node.lineStart && end >= 0 && isBlank(lines[end])) end--;
	node.blockEnd = end;
	return end;
}

function assignIdentity(
	node: MindNode,
	id: string,
	key: string,
	byId: Map<string, MindNode>,
	byKey: Map<string, MindNode>,
): void {
	node.id = id;
	node.key = key;
	byId.set(id, node);
	byKey.set(key, node);

	const used = new Map<string, number>();
	node.children.forEach((child, index) => {
		const base = `${child.kind === "heading" ? "h" : "l"}:${child.text.trim().toLowerCase()}`;
		const seen = used.get(base) ?? 0;
		used.set(base, seen + 1);
		const childKey = `${key}/${base}${seen > 0 ? `#${seen}` : ""}`;
		assignIdentity(child, `${id}.${index}`, childKey, byId, byKey);
	});
}

/** Infer one level of list indentation from how the file already nests. */
function detectIndentUnit(root: MindNode): string {
	let usesTab = false;
	let smallest = Infinity;

	const visit = (node: MindNode): void => {
		for (const child of node.children) {
			if (child.kind === "listitem") {
				if (child.indent.includes("\t")) usesTab = true;
				if (node.kind === "listitem") {
					const delta = child.indentWidth - node.indentWidth;
					if (delta > 0 && delta < smallest) smallest = delta;
				}
			}
			visit(child);
		}
	};
	visit(root);

	if (usesTab) return "\t";
	return " ".repeat(Number.isFinite(smallest) ? smallest : 2);
}

/** Reconstruct the exact source text a ParsedDoc came from. */
export function serialize(parsed: ParsedDoc): string {
	return toText(parsed.doc);
}
