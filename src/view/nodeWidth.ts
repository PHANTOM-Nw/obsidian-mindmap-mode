import type { NodeKind } from "../model/types.ts";

/** Note content gets more room than a topic title needs. */
export const BODY_WIDTH_FACTOR = 1.6;

/** The two caps a node is built with, in CSS pixels. */
export interface NodeMaxWidth {
	/** `.mm-node`: the card and the annotation strip below it, which is what
	 *  `width: max-content` is measured against. */
	node: number;
	/** The card's own text, or null when the node's cap is the only one it
	 *  needs. */
	text: number | null;
}

/**
 * How wide a node may run.
 *
 * A title wraps at **Maximum card width** and note content at that times
 * `BODY_WIDTH_FACTOR`. An annotation is set in the width of note content, so an
 * annotated title node is capped at the wider of the two and the card's text
 * carries the title's cap itself -- otherwise a title would start wrapping
 * later merely because something was written underneath it. The node's cap is
 * the one the card is drawn at: `.mm-node` is `max-content` and the card fills
 * it, so card and strip are always exactly as wide as each other.
 */
export function nodeMaxWidth(
	kind: NodeKind,
	hasAnnotation: boolean,
	maxNodeWidth: number,
): NodeMaxWidth {
	const body = Math.round(maxNodeWidth * BODY_WIDTH_FACTOR);
	if (kind === "body") return { node: body, text: null };
	if (!hasAnnotation) return { node: maxNodeWidth, text: null };
	return { node: body, text: maxNodeWidth };
}
