import { isBlank } from "./lines.ts";
import { TAB_WIDTH, indentWidthOf } from "./types.ts";
import type { MindNode, ParsedDoc } from "./types.ts";

/** The structural shape a node should take at its destination. */
export interface NodeSpec {
	kind: "heading" | "listitem";
	/** Heading level 1-6. Meaningless for list items. */
	level: number;
	/** Leading whitespace. Always "" for headings. */
	indent: string;
	marker: string;
}

/** A non-virtual root is a real H1 line, so it behaves like a heading. */
export function isHeadingLike(node: MindNode): boolean {
	return !node.virtual && (node.kind === "heading" || node.kind === "root");
}

export function specOf(node: MindNode): NodeSpec {
	return isHeadingLike(node)
		? { kind: "heading", level: node.level, indent: "", marker: node.marker }
		: { kind: "listitem", level: 0, indent: node.indent, marker: node.marker };
}

/**
 * Where a child of `parentSpec` lands.
 *
 * A node keeps its own kind whenever the destination allows it — a list item
 * never spontaneously becomes a heading. The one forced conversion is a heading
 * that would land deeper than H6, or under a list item; those become list items.
 */
export function childSpecFromSpec(
	parentSpec: NodeSpec,
	childKind: "heading" | "listitem",
	indentUnit: string,
	marker: string,
): NodeSpec {
	if (childKind === "heading" && parentSpec.kind === "heading" && parentSpec.level < 6) {
		const level = parentSpec.level + 1;
		return { kind: "heading", level, indent: "", marker: "#".repeat(level) };
	}
	const indent =
		parentSpec.kind === "listitem" ? parentSpec.indent + indentUnit : "";
	const safeMarker = /^[-*+]$|^\d{1,9}[.)]$/.test(marker) ? marker : "-";
	return { kind: "listitem", level: 0, indent, marker: safeMarker };
}

/** Spec for a brand-new child of `parent`, mimicking existing siblings if any. */
export function childSpecFor(
	parent: MindNode,
	indentUnit: string,
	preferKind?: "heading" | "listitem",
): NodeSpec {
	const model = parent.children[0];
	if (model && !preferKind) {
		return specOf(model);
	}
	const kind: "heading" | "listitem" =
		preferKind ?? (isHeadingLike(parent) && parent.level < 6 ? "heading" : "listitem");

	// An empty note gets an outline rather than an H1, so the new node cannot be
	// silently promoted into the document's root heading on the next parse.
	if (parent.virtual && !model) {
		return { kind: "listitem", level: 0, indent: "", marker: "-" };
	}
	if (parent.virtual) {
		return { kind: "heading", level: 1, indent: "", marker: "#" };
	}
	return childSpecFromSpec(specOf(parent), kind, indentUnit, model?.marker ?? "-");
}

/** Column where a node's continuation/body content sits. */
function contentColumn(spec: NodeSpec): number {
	if (spec.kind === "heading") return 0;
	return indentWidthOf(spec.indent) + spec.marker.length + 1;
}

function currentContentColumn(node: MindNode): number {
	if (isHeadingLike(node)) return 0;
	return indentWidthOf(node.indent + node.marker + node.spacing);
}

function makeIndent(width: number, unit: string): string {
	if (unit === "\t") {
		const tabs = Math.floor(width / TAB_WIDTH);
		return "\t".repeat(tabs) + " ".repeat(width - tabs * TAB_WIDTH);
	}
	return " ".repeat(width);
}

/**
 * Shift a line's indentation by `delta` columns.
 *
 * Applied uniformly across a whole body range, so a fenced code block moves as
 * a unit and the code inside keeps its relative indentation.
 */
export function shiftIndent(line: string, delta: number, unit: string): string {
	if (isBlank(line)) return line;
	const m = /^[ \t]*/.exec(line);
	const ws = m ? m[0] : "";
	const width = Math.max(0, indentWidthOf(ws) + delta);
	return makeIndent(width, unit) + line.slice(ws.length);
}

function renderWithSpec(node: MindNode, spec: NodeSpec): string {
	const wasHeading = isHeadingLike(node);
	const kindChanged = wasHeading !== (spec.kind === "heading");
	const spacing = kindChanged ? " " : node.spacing || " ";

	if (spec.kind === "heading") {
		// list -> heading: keep the checkbox as literal text rather than dropping
		// state on the floor. Moving it back under a list restores it verbatim.
		const text = node.checkbox !== null ? `[${node.checkbox}] ${node.text}` : node.text;
		let suffix = kindChanged ? "" : node.suffix;
		if (!kindChanged && spec.level !== node.level) {
			suffix = suffix.replace(/#+/, spec.marker);
		}
		return spec.indent + spec.marker + spacing + text + suffix;
	}

	const check =
		node.checkbox === null ? "" : `[${node.checkbox}]${node.checkboxSpacing || " "}`;
	const suffix = kindChanged ? "" : node.suffix;
	return spec.indent + spec.marker + spacing + check + node.text + suffix;
}

/**
 * Rewrite an entire subtree's lines for a new position in the document.
 *
 * Structural lines get new markers; body lines are shifted uniformly so they
 * stay attached to their owner. Text, checkboxes and code content are never
 * altered.
 */
export function relevelBlock(
	parsed: ParsedDoc,
	node: MindNode,
	rootSpec: NodeSpec,
	indentUnit: string,
): string[] {
	const lines = parsed.doc.lines;
	const start = node.lineStart;
	const end = node.blockEnd;

	const rewrites = new Map<number, string>();
	const shifts = new Map<number, number>();

	const visit = (n: MindNode, spec: NodeSpec): void => {
		if (n.lineStart >= start && n.lineStart <= end) {
			rewrites.set(n.lineStart, renderWithSpec(n, spec));
		}
		const delta = contentColumn(spec) - currentContentColumn(n);
		if (delta !== 0) {
			for (const [s, e] of n.bodyRanges) {
				for (let i = Math.max(s, start); i <= Math.min(e, end); i++) shifts.set(i, delta);
			}
		}
		for (const child of n.children) {
			visit(
				child,
				childSpecFromSpec(
					spec,
					isHeadingLike(child) ? "heading" : "listitem",
					indentUnit,
					child.marker,
				),
			);
		}
	};
	visit(node, rootSpec);

	const out: string[] = [];
	for (let i = start; i <= end; i++) {
		const rewritten = rewrites.get(i);
		if (rewritten !== undefined) {
			out.push(rewritten);
			continue;
		}
		const delta = shifts.get(i);
		out.push(delta === undefined ? lines[i] : shiftIndent(lines[i], delta, indentUnit));
	}
	return out;
}
