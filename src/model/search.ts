/**
 * Finding nodes by their text.
 *
 * The tree is the source, never the DOM: a collapsed branch has no cards at all,
 * and the cards that do exist hold MathJax output rather than the note's words.
 * That makes this a pure module, which is also what lets it be tested directly.
 */

import { plainText } from "./inlineText.ts";
import { walk } from "./types.ts";
import type { MindNode } from "./types.ts";

export interface SearchQuery {
	text: string;
	regex: boolean;
}

export interface SearchMatch {
	key: string;
	id: string;
	/** The projection that matched, as a reader sees it on the card. */
	text: string;
}

export interface SearchResult {
	matches: SearchMatch[];
	/** True when `regex` was on and the pattern would not compile. */
	invalid: boolean;
}

/**
 * Every node whose visible text matches, in document order.
 *
 * An empty query finds nothing rather than everything: the bar is open for most
 * of a search session, and "all of them" is not a useful thing to highlight.
 * Body cards are out of scope in v1 -- they are not in `byKey`, the selection
 * refuses them, and their card face is a truncated preview of the block.
 */
export function searchTree(root: MindNode, query: SearchQuery): SearchResult {
	const matches: SearchMatch[] = [];
	if (query.text === "") return { matches, invalid: false };

	let re: RegExp | null = null;
	if (query.regex) {
		try {
			// No `g` flag: a shared `lastIndex` would carry from one node to the
			// next and silently skip half the tree.
			re = new RegExp(query.text, "i");
		} catch {
			// A pattern is incomplete for as long as it is being typed, so this is
			// the normal case, not an error to report.
			return { matches, invalid: true };
		}
	}
	const needle = query.text.toLowerCase();

	walk(root, (node) => {
		// A virtual root stands for the filename and owns no line; a body card is
		// note content the map only displays.
		if (node.virtual || node.kind === "body") return;
		const text = plainText(node.text);
		const hit = re ? re.test(text) : text.toLowerCase().includes(needle);
		if (hit) matches.push({ key: node.key, id: node.id, text });
	});
	return { matches, invalid: false };
}

/**
 * The collapsed ancestors actually keeping a node off the map, outermost first.
 *
 * Outermost first because that is the one a caller wants on its own: opening a
 * node whose own parent is still folded shows nothing, and a selection folded
 * away has to land on the card that swallowed it.
 */
export function hiddenAncestorKeys(node: MindNode, collapsed: ReadonlySet<string>): string[] {
	const keys: string[] = [];
	for (let p: MindNode | null = node.parent; p; p = p.parent) {
		if (collapsed.has(p.key)) keys.push(p.key);
	}
	return keys.reverse();
}
