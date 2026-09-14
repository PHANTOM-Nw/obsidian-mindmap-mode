import { indentWidthOf, walk } from "./types.ts";
import type { MindNode, ParsedDoc } from "./types.ts";

const ANNOTATION = /^([ \t]*):(?:[ \t](.*)|$)/;

/** Called only for ordinary body lines, never frontmatter or fenced code. */
export function isAnnotationLine(line: string, owner: MindNode): boolean {
	if (owner.virtual) return false;
	const match = ANNOTATION.exec(line);
	if (!match) return false;
	const width = indentWidthOf(match[1]);
	const contentColumn = owner.kind === "listitem"
		? indentWidthOf(owner.indent + owner.marker + owner.spacing)
		: 0;
	// Four spaces beyond the content column are indented code, not annotations.
	return width >= contentColumn && width < contentColumn + 4;
}

/** Keep annotations in bodyRanges for every existing source mutation. Split
 * mixed ranges so a body-card editor cannot accidentally replace an annotation.
 * Do this after source projection: annotations of pruned nodes stay ordinary body. */
export function partitionAnnotations(
	root: MindNode,
	ownedLines: ReadonlyMap<MindNode, ReadonlySet<number>>,
	lines: string[],
): void {
	walk(root, (node) => {
		const annotations = ownedLines.get(node);
		if (!annotations?.size) return;
		const ranges: Array<[number, number]> = [];
		const indices: number[] = [];
		for (const [start, end] of node.bodyRanges) {
			let from = start;
			while (from <= end) {
				const annotated = annotations.has(from);
				let to = from;
				while (to < end && annotations.has(to + 1) === annotated) to++;
				if (annotated || lines.slice(from, to + 1).some((line) => line.trim() !== "")) {
					if (annotated) indices.push(ranges.length);
					ranges.push([from, to]);
				}
				from = to + 1;
			}
		}
		node.bodyRanges = ranges;
		node.annotationIndices = indices;
	});
}

export function annotationText(parsed: ParsedDoc, node: MindNode): string {
	return node.annotationIndices.map((index) => {
		const [s, e] = node.bodyRanges[index];
		return parsed.doc.lines.slice(s, e + 1)
			.map((line) => ANNOTATION.exec(line)?.[2] ?? "").join("\n");
	}).join("\n\n");
}

export function bodyCardCount(node: MindNode): number {
	return node.bodyRanges.length - node.annotationIndices.length;
}
