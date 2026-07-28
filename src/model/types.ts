import type { LineDoc } from "./lines.ts";

/**
 * "body" is never produced by the parser. The view synthesises those nodes from
 * a node's `bodyRanges` so paragraphs, code blocks and tables can be expanded on
 * the map; they are deliberately absent from `byId`/`byKey`, which is what makes
 * every mutation refuse them.
 */
export type NodeKind = "root" | "heading" | "listitem" | "body";

/** `null` when the item has no checkbox at all. */
export type CheckboxState = " " | "x" | "X" | null;

export type NodeSource = "headings-and-lists" | "headings-only" | "lists-only";

export type RootPolicy = "auto" | "filename" | "h1";

/**
 * One node of the map, carrying enough source detail to rebuild its own line
 * exactly:
 *
 *   line = indent + marker + spacing + checkboxRaw + text + suffix
 *
 * Keeping the pieces separate (rather than one opaque prefix) is what lets the
 * re-leveling pass rewrite a marker while preserving the checkbox and text.
 */
export interface MindNode {
	/** Index path, e.g. "0.2.1". Stable within one parse. */
	id: string;
	/** Text-derived path, used to carry fold/selection across a re-parse. */
	key: string;
	kind: NodeKind;
	/** True for a synthetic root standing in for the filename (no backing line). */
	virtual: boolean;

	text: string;
	/** Heading level 1-6; for list items, the nesting depth starting at 1. */
	level: number;
	/** Visual column of this item's indent, tabs expanded. List items only. */
	indentWidth: number;

	indent: string;
	marker: string;
	spacing: string;
	checkbox: CheckboxState;
	checkboxSpacing: string;
	/** Trailing whitespace, plus any ATX closing hashes. */
	suffix: string;

	/** Line holding this node's marker, or -1 for a virtual root. */
	lineStart: number;
	/** Last non-blank line of the whole subtree, or -1 for a virtual root. */
	blockEnd: number;
	/** Owned lines that are not part of any child node. Inclusive ranges. */
	bodyRanges: Array<[number, number]>;

	children: MindNode[];
	parent: MindNode | null;
}

export interface ParsedDoc {
	root: MindNode;
	doc: LineDoc;
	/** First line after frontmatter. Nothing may ever be inserted above it. */
	bodyStart: number;
	/** Indent string used for one level of list nesting, detected from the file. */
	indentUnit: string;
	byId: Map<string, MindNode>;
	byKey: Map<string, MindNode>;
}

export interface ParseOptions {
	/** Shown on the root card when the root is virtual. */
	title: string;
	source: NodeSource;
	rootPolicy: RootPolicy;
	/** Headings deeper than this are folded into body content. */
	maxHeadingDepth: number;
	/**
	 * The literal indent string for new list items, or the sentinel `"auto"` to
	 * detect it from the file. Typed plain `string` on purpose: a
	 * `"auto" | string` union collapses to `string` anyway, so writing it out
	 * only implies a narrowing the compiler never performs.
	 */
	indentUnit: string;
}

export const DEFAULT_PARSE_OPTIONS: ParseOptions = {
	title: "Untitled",
	source: "headings-and-lists",
	rootPolicy: "auto",
	maxHeadingDepth: 6,
	indentUnit: "auto",
};

/** Columns a tab advances. Matches Obsidian's default. */
export const TAB_WIDTH = 4;

export function indentWidthOf(indent: string): number {
	let w = 0;
	for (const ch of indent) w += ch === "\t" ? TAB_WIDTH - (w % TAB_WIDTH) : 1;
	return w;
}

/** Rebuild a node's source line from its parts. */
export function renderNodeLine(node: MindNode, text: string = node.text): string {
	const spacing = node.spacing === "" && text !== "" ? " " : node.spacing;
	const check =
		node.checkbox === null ? "" : `[${node.checkbox}]${node.checkboxSpacing || " "}`;
	return node.indent + node.marker + spacing + check + text + node.suffix;
}

export function isAncestor(maybeAncestor: MindNode, node: MindNode): boolean {
	for (let p: MindNode | null = node.parent; p; p = p.parent) {
		if (p === maybeAncestor) return true;
	}
	return false;
}

export function walk(node: MindNode, visit: (n: MindNode) => void): void {
	visit(node);
	for (const child of node.children) walk(child, visit);
}
