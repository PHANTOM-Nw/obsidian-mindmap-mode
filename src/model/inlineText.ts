/**
 * The inline markdown a node title is written in, as data.
 *
 * The renderer (`view/nodes.ts`) and the search (`model/search.ts`) have to
 * agree on where a token starts and on which part of it a reader actually sees,
 * so the rules and the tokenizer live here and the renderer keeps nothing but
 * its emit table. Free of every import -- `obsidian` above all -- so
 * `node --test` can run this file as-is.
 *
 * The `$...$` delimiters are deliberately absent. They live in
 * `view/mathSyntax.ts`, which the renderer composes in front of these rules;
 * `plainText` therefore leaves a formula exactly as the note wrote it, dollars
 * and backslashes included, and a formula is searched as its TeX source.
 */

/**
 * What a token means, not how it was spelled: `**a**` and `__a__` are both
 * `strong`, because everything downstream treats them the same.
 */
export type InlineKind =
	| "code"
	| "strong"
	| "strike"
	| "highlight"
	| "em"
	| "wikilink"
	| "link"
	| "embed";

export interface InlineRule {
	kind: InlineKind;
	/** Global; every scan re-aims `lastIndex` before using it. */
	re: RegExp;
	/** The part of the match a reader sees. */
	visible: (m: RegExpExecArray) => string;
	/** True when what a reader sees is itself markup and must be re-scanned. */
	nested: boolean;
}

/**
 * Deliberately small and ordered: earliest match wins, and the order below is
 * the tie-break contract for an exact draw. `**` has to precede `*`, and the
 * embed rule only survives at the end because `![[x]]` starts one character
 * before the wikilink inside it.
 */
export const INLINE_RULES: InlineRule[] = [
	{ kind: "code", re: /`([^`]+)`/g, visible: (m) => m[1], nested: false },
	{ kind: "strong", re: /\*\*([^*]+)\*\*/g, visible: (m) => m[1], nested: true },
	{ kind: "strong", re: /__([^_]+)__/g, visible: (m) => m[1], nested: true },
	{ kind: "strike", re: /~~([^~]+)~~/g, visible: (m) => m[1], nested: true },
	{ kind: "highlight", re: /==([^=]+)==/g, visible: (m) => m[1], nested: true },
	{ kind: "em", re: /\*([^*]+)\*/g, visible: (m) => m[1], nested: true },
	{
		kind: "wikilink",
		re: /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
		// The alias, or the target when there is none. A target that has been
		// given a label is not something the reader can see.
		visible: (m) => m[2] ?? m[1],
		nested: false,
	},
	{ kind: "link", re: /\[([^\]]+)\]\(([^)]+)\)/g, visible: (m) => m[1], nested: false },
	{ kind: "embed", re: /!\[\[([^\]]+)\]\]/g, visible: (m) => m[1], nested: false },
];

export interface InlineToken {
	rule: InlineRule;
	start: number;
	/** Index just past the token, where the next scan resumes. */
	end: number;
	match: RegExpExecArray;
}

/**
 * The first token at or after `from`: earliest match wins, an exact tie going to
 * whichever rule is listed first.
 *
 * The patterns are shared and carry `lastIndex`, but every scan re-aims them
 * before it reads, so a nested call can never disturb the one it returns into.
 */
export function nextInlineToken(
	text: string,
	from: number,
	rules: readonly InlineRule[] = INLINE_RULES,
): InlineToken | null {
	let best: InlineToken | null = null;
	for (const rule of rules) {
		rule.re.lastIndex = from;
		const m = rule.re.exec(text);
		if (!m) continue;
		if (best === null || m.index < best.start) {
			best = { rule, start: m.index, end: m.index + m[0].length, match: m };
		}
	}
	return best;
}

/**
 * A title as a reader sees it on the card: markers stripped, link labels kept,
 * link targets dropped.
 *
 * Mirrors `renderInline`'s recursion, so `**bold** text` is found by "bold
 * text" and `[[note|Label]]` by "Label" but never by "note".
 */
export function plainText(text: string): string {
	let out = "";
	let i = 0;
	while (i < text.length) {
		const token = nextInlineToken(text, i);
		if (!token) return out + text.slice(i);
		if (token.start > i) out += text.slice(i, token.start);
		const visible = token.rule.visible(token.match);
		out += token.rule.nested ? plainText(visible) : visible;
		i = token.end;
	}
	return out;
}
