import { isBlank, replaceLine, spliceLines, toText } from "./lines.ts";
import type { LineDoc } from "./lines.ts";
import { isAncestor, renderNodeLine } from "./types.ts";
import type { MindNode, ParsedDoc } from "./types.ts";
import {
	childSpecFor,
	isHeadingLike,
	relevelBlock,
	specOf,
} from "./releveling.ts";
import type { NodeSpec } from "./releveling.ts";

export interface Mutation {
	/** Full document text after the edit. */
	text: string;
	/** Line to re-focus once the new text is parsed, or -1. */
	focusLine: number;
	/** False when the operation was rejected; `text` is then unchanged. */
	ok: boolean;
}

function unchanged(parsed: ParsedDoc): Mutation {
	return { text: toText(parsed.doc), focusLine: -1, ok: false };
}

function done(doc: LineDoc, focusLine: number): Mutation {
	return { text: toText(doc), focusLine, ok: true };
}

function renderNew(spec: NodeSpec, text: string): string {
	return spec.indent + spec.marker + " " + text;
}

function nextOrderedMarker(marker: string): string {
	const m = /^(\d{1,9})([.)])$/.exec(marker);
	return m ? String(Number(m[1]) + 1) + m[2] : marker;
}

/**
 * Headings need a blank line around them to stay headings. List items must not
 * get one, or a tight list turns loose.
 */
function padBlock(
	lines: string[],
	insertAt: number,
	block: string[],
	isHeading: boolean,
): { block: string[]; offset: number } {
	if (!isHeading || block.length === 0) return { block, offset: 0 };
	const out = block.slice();
	let offset = 0;
	if (insertAt > 0 && !isBlank(lines[insertAt - 1])) {
		out.unshift("");
		offset = 1;
	}
	if (
		insertAt < lines.length &&
		!isBlank(lines[insertAt]) &&
		!isBlank(out[out.length - 1])
	) {
		out.push("");
	}
	return { block: out, offset };
}

interface Collapse {
	doc: LineDoc;
	/** Index the removal started at, for callers still holding later indices. */
	at: number;
	count: number;
}

/** Tidy the blank-line run left behind at a deletion seam. */
function collapseBlanks(doc: LineDoc, at: number, bodyStart: number): Collapse {
	let start = at;
	while (start > bodyStart && isBlank(doc.lines[start - 1])) start--;
	let end = at;
	while (end < doc.lines.length && isBlank(doc.lines[end])) end++;

	const run = end - start;
	if (run === 0) return { doc, at: start, count: 0 };
	const keep = end >= doc.lines.length ? 0 : Math.min(run, 1);
	if (run === keep) return { doc, at: start, count: 0 };
	return { doc: spliceLines(doc, start, run - keep, []), at: start, count: run - keep };
}

export function canRename(node: MindNode): boolean {
	return !node.virtual;
}

export function renameNode(
	parsed: ParsedDoc,
	node: MindNode,
	text: string,
): Mutation {
	if (!canRename(node) || node.lineStart < 0) return unchanged(parsed);
	const clean = text.replace(/[\r\n]+/g, " ").trim();
	if (clean === node.text) return unchanged(parsed);
	const doc = replaceLine(parsed.doc, node.lineStart, renderNodeLine(node, clean));
	return done(doc, node.lineStart);
}

export function addChild(
	parsed: ParsedDoc,
	parent: MindNode,
	text = "",
): Mutation {
	const spec = childSpecFor(parent, parsed.indentUnit);
	const insertAt = Math.max(parent.blockEnd + 1, parsed.bodyStart);
	const { block, offset } = padBlock(
		parsed.doc.lines,
		insertAt,
		[renderNew(spec, text)],
		spec.kind === "heading",
	);
	const doc = spliceLines(parsed.doc, insertAt, 0, block);
	return done(doc, insertAt + offset);
}

export function addSibling(
	parsed: ParsedDoc,
	node: MindNode,
	text = "",
): Mutation {
	if (!node.parent || node.lineStart < 0) return unchanged(parsed);
	const spec = specOf(node);
	if (spec.kind === "listitem") spec.marker = nextOrderedMarker(spec.marker);

	const insertAt = Math.max(node.blockEnd + 1, parsed.bodyStart);
	const { block, offset } = padBlock(
		parsed.doc.lines,
		insertAt,
		[renderNew(spec, text)],
		spec.kind === "heading",
	);
	const doc = spliceLines(parsed.doc, insertAt, 0, block);
	return done(doc, insertAt + offset);
}

/**
 * A sibling directly above `node`, rather than below it.
 *
 * The marker is taken as-is: `nextOrderedMarker` is for appending after a
 * numbered item, and inserting above one wants that item's own number.
 */
export function addSiblingBefore(
	parsed: ParsedDoc,
	node: MindNode,
	text = "",
): Mutation {
	if (!node.parent || node.lineStart < 0) return unchanged(parsed);
	const spec = specOf(node);

	const insertAt = Math.max(node.lineStart, parsed.bodyStart);
	const { block, offset } = padBlock(
		parsed.doc.lines,
		insertAt,
		[renderNew(spec, text)],
		spec.kind === "heading",
	);
	const doc = spliceLines(parsed.doc, insertAt, 0, block);
	return done(doc, insertAt + offset);
}

export function deleteNode(parsed: ParsedDoc, node: MindNode): Mutation {
	if (!node.parent || node.lineStart < 0) return unchanged(parsed);
	const count = node.blockEnd - node.lineStart + 1;
	const removed = spliceLines(parsed.doc, node.lineStart, count, []);
	const { doc } = collapseBlanks(removed, node.lineStart, parsed.bodyStart);
	return done(doc, Math.max(node.parent.lineStart, -1));
}

export function toggleCheckbox(parsed: ParsedDoc, node: MindNode): Mutation {
	if (isHeadingLike(node) || node.virtual || node.lineStart < 0) {
		return unchanged(parsed);
	}
	// Cycle none -> unchecked -> checked -> none, so an accidental add is easy
	// to take back.
	const next = node.checkbox === null ? " " : node.checkbox === " " ? "x" : null;
	const spacing = node.spacing || " ";
	const check = next === null ? "" : `[${next}]${node.checkboxSpacing || " "}`;
	const line = node.indent + node.marker + spacing + check + node.text + node.suffix;
	return done(replaceLine(parsed.doc, node.lineStart, line), node.lineStart);
}

export function canMove(node: MindNode, newParent: MindNode): boolean {
	if (!node.parent || node.lineStart < 0) return false;
	if (node === newParent) return false;
	if (isAncestor(node, newParent)) return false;
	return true;
}

/**
 * Move a subtree under `newParent`, landing directly after line `anchorLine`.
 *
 * Callers differ in which line they anchor to -- the parent's last line (append
 * as the last child), a sibling's last line (drop below it), the line above a
 * sibling (drop above it) -- and in `kind`, the shape the block takes when it
 * lands.
 */
function moveWithAnchor(
	parsed: ParsedDoc,
	node: MindNode,
	newParent: MindNode,
	anchorLine: number,
	kind: "heading" | "listitem",
): Mutation {
	if (!canMove(node, newParent)) return unchanged(parsed);

	const rootSpec = childSpecFor(newParent, parsed.indentUnit, kind);
	const block = relevelBlock(parsed, node, rootSpec, parsed.indentUnit);

	const removeStart = node.lineStart;
	const removeCount = node.blockEnd - node.lineStart + 1;

	// If the anchor sits inside the block we are lifting out (it does when the
	// target is our own ancestor and we are its last content), fall back to the
	// hole we just made.
	let anchor = anchorLine;
	if (anchor >= removeStart && anchor <= node.blockEnd) anchor = removeStart - 1;

	const removed = spliceLines(parsed.doc, removeStart, removeCount, []);
	const tidy = collapseBlanks(removed, removeStart, parsed.bodyStart);
	let doc = tidy.doc;

	let insertAt = anchor + 1;
	if (anchor >= removeStart) insertAt -= removeCount;
	if (insertAt > tidy.at) insertAt -= Math.min(tidy.count, insertAt - tidy.at);
	insertAt = Math.max(parsed.bodyStart, Math.min(insertAt, doc.lines.length));

	const { block: padded, offset } = padBlock(
		doc.lines,
		insertAt,
		block,
		rootSpec.kind === "heading",
	);
	doc = spliceLines(doc, insertAt, 0, padded);
	return done(doc, insertAt + offset);
}

/**
 * Move a subtree under `newParent`, rewriting its markers for the new depth.
 *
 * `after` places the block directly following that node instead of appending it
 * as the last child, which is what outdenting needs.
 */
export function moveNode(
	parsed: ParsedDoc,
	node: MindNode,
	newParent: MindNode,
	after?: MindNode,
): Mutation {
	if (!canMove(node, newParent)) return unchanged(parsed);
	return moveWithAnchor(
		parsed,
		node,
		newParent,
		(after ?? newParent).blockEnd,
		isHeadingLike(node) ? "heading" : "listitem",
	);
}

/**
 * Whether `node` may be dropped beside `target` as one of its siblings.
 *
 * First-level branches are excluded on purpose: the layout splits them between
 * the two sides of the root by weight, so their order is the layout's to decide
 * and dragging one above another would say nothing about where it lands.
 */
export function canReorder(node: MindNode, target: MindNode): boolean {
	const parent = target.parent;
	// No parent: the root. No grandparent: a first-level branch.
	if (!parent || !parent.parent) return false;
	if (target.virtual || target.lineStart < 0) return false;
	if (node === target) return false;
	return canMove(node, parent);
}

/**
 * The shape a node has to take to be read as `target`'s sibling.
 *
 * It is the *target's* kind, not the moved node's: a list item written after a
 * heading is that heading's content, not its sibling, and a heading written
 * among list items swallows the ones below it. Landing beside something means
 * being written the way it is written.
 */
function siblingKind(target: MindNode): "heading" | "listitem" {
	return isHeadingLike(target) ? "heading" : "listitem";
}

/** Drop `node` in as `target`'s sibling, directly above it. */
export function moveBefore(
	parsed: ParsedDoc,
	node: MindNode,
	target: MindNode,
): Mutation {
	if (!canReorder(node, target) || !target.parent) return unchanged(parsed);
	return moveWithAnchor(
		parsed,
		node,
		target.parent,
		target.lineStart - 1,
		siblingKind(target),
	);
}

/** Drop `node` in as `target`'s sibling, after the whole of `target`'s subtree. */
export function moveAfter(
	parsed: ParsedDoc,
	node: MindNode,
	target: MindNode,
): Mutation {
	if (!canReorder(node, target) || !target.parent) return unchanged(parsed);
	return moveWithAnchor(parsed, node, target.parent, target.blockEnd, siblingKind(target));
}

export function indentNode(parsed: ParsedDoc, node: MindNode): Mutation {
	const siblings = node.parent?.children ?? [];
	const index = siblings.indexOf(node);
	if (index <= 0) return unchanged(parsed);
	return moveNode(parsed, node, siblings[index - 1]);
}

export function outdentNode(parsed: ParsedDoc, node: MindNode): Mutation {
	const parent = node.parent;
	if (!parent || !parent.parent) return unchanged(parsed);
	return moveNode(parsed, node, parent.parent, parent);
}

/** Replace one body range's text, used by the node's body popover. */
export function replaceBodyRange(
	parsed: ParsedDoc,
	node: MindNode,
	rangeIndex: number,
	text: string,
): Mutation {
	const range = node.bodyRanges[rangeIndex];
	if (!range) return unchanged(parsed);
	const [start, end] = range;
	const replacement = text.split(/\r\n|\n|\r/);
	const doc = spliceLines(parsed.doc, start, end - start + 1, replacement);
	return done(doc, node.lineStart);
}

/** Text of one body range, for display and editing. */
export function bodyRangeText(parsed: ParsedDoc, range: [number, number]): string {
	return parsed.doc.lines.slice(range[0], range[1] + 1).join("\n");
}
