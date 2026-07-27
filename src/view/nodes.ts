import type { MindNode } from "../model/types.ts";
import type { LayoutNode } from "../layout/tidyTree.ts";
import { renderMathInto } from "./math.ts";
import { MATH_DISPLAY, MATH_INLINE } from "./mathSyntax.ts";

/** Carried through the recursion so nested markup can report what it emitted. */
interface InlineContext {
	sawMath: boolean;
}

type Emit = (m: RegExpExecArray, el: HTMLElement, ctx: InlineContext) => void;

/**
 * Inline markdown for node titles.
 *
 * Deliberately small and DOM-based: every value goes in as text, never as HTML,
 * so a note can never inject markup into the map.
 */
const PATTERNS: Array<[RegExp, Emit]> = [
	[/`([^`]+)`/g, (m, el) => el.createEl("code", { cls: "mm-code", text: m[1] })],
	[/\*\*([^*]+)\*\*/g, (m, el, ctx) => renderRange(el.createEl("strong"), m[1], ctx)],
	[/__([^_]+)__/g, (m, el, ctx) => renderRange(el.createEl("strong"), m[1], ctx)],
	[/~~([^~]+)~~/g, (m, el, ctx) => renderRange(el.createEl("del"), m[1], ctx)],
	[/==([^=]+)==/g, (m, el, ctx) => renderRange(el.createEl("mark"), m[1], ctx)],
	[/\*([^*]+)\*/g, (m, el, ctx) => renderRange(el.createEl("em"), m[1], ctx)],
	[
		/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
		(m, el) => el.createSpan({ cls: "mm-link", text: m[2] ?? m[1] }),
	],
	[
		/\[([^\]]+)\]\(([^)]+)\)/g,
		(m, el) => el.createSpan({ cls: "mm-link", text: m[1] }),
	],
	[
		/!\[\[([^\]]+)\]\]/g,
		(m, el) => el.createSpan({ cls: "mm-embed", text: m[1] }),
	],
];

/**
 * Math goes in front so that on the rare exact-index tie the strict `<` in
 * `nextToken` awards the token to the formula. Everything past that is decided
 * by earliest-match-wins, which is what keeps `$a_b$` away from the `__` rule
 * and `$x*y*z$` away from the `*` rule.
 */
const ALL_PATTERNS: Array<[RegExp, Emit]> = [
	[
		MATH_DISPLAY,
		(m, el, ctx) => {
			ctx.sawMath = true;
			renderMathInto(el, m[1], true);
		},
	],
	[
		MATH_INLINE,
		(m, el, ctx) => {
			ctx.sawMath = true;
			renderMathInto(el, m[1], false);
		},
	],
	...PATTERNS,
];

interface Token {
	start: number;
	end: number;
	emit: (el: HTMLElement) => void;
}

function nextToken(text: string, from: number, ctx: InlineContext): Token | null {
	let best: Token | null = null;
	for (const [re, emit] of ALL_PATTERNS) {
		re.lastIndex = from;
		const m = re.exec(text);
		if (!m) continue;
		if (best === null || m.index < best.start) {
			best = {
				start: m.index,
				end: m.index + m[0].length,
				emit: (el) => emit(m, el, ctx),
			};
		}
	}
	return best;
}

function renderRange(el: HTMLElement, text: string, ctx: InlineContext): void {
	let i = 0;
	while (i < text.length) {
		const token = nextToken(text, i, ctx);
		if (!token) {
			el.appendText(text.slice(i));
			return;
		}
		if (token.start > i) el.appendText(text.slice(i, token.start));
		token.emit(el);
		i = token.end;
	}
}

/** Returns true when the title contained a formula, so the view knows to
 *  re-measure once MathJax has flushed its stylesheet. */
export function renderInline(el: HTMLElement, text: string): boolean {
	el.empty();
	if (text.trim() === "") {
		el.createSpan({ cls: "mm-placeholder", text: "Empty" });
		return false;
	}
	const ctx: InlineContext = { sawMath: false };
	renderRange(el, text, ctx);
	return ctx.sawMath;
}

export interface NodeElementOptions {
	maxWidth: number;
	showBodyBadges: boolean;
	branchColors: boolean;
	collapsed: boolean;
	hiddenCount: number;
}

export interface NodeElement {
	el: HTMLElement;
	card: HTMLElement;
	text: HTMLElement;
	toggle: HTMLElement | null;
	badge: HTMLElement | null;
	checkbox: HTMLElement | null;
	hasMath: boolean;
}

function descendantCount(node: MindNode): number {
	let total = 0;
	for (const child of node.children) total += 1 + descendantCount(child);
	return total;
}

export function buildNodeElement(
	parent: HTMLElement,
	layout: LayoutNode,
	opts: NodeElementOptions,
): NodeElement {
	const node = layout.node;
	const el = parent.createDiv({ cls: "mm-node" });
	el.dataset.id = node.id;
	el.dataset.kind = node.kind;
	el.dataset.depth = String(Math.min(layout.depth, 6));
	if (opts.branchColors && layout.branch >= 0) {
		el.dataset.branch = String(layout.branch % 10);
	}
	if (opts.collapsed) el.addClass("is-collapsed");
	if (node.virtual) el.addClass("is-virtual");
	el.style.maxWidth = `${opts.maxWidth}px`;

	const card = el.createDiv({ cls: "mm-card" });

	let checkbox: HTMLElement | null = null;
	if (node.checkbox !== null) {
		checkbox = card.createDiv({ cls: "mm-checkbox" });
		checkbox.dataset.checked = node.checkbox === " " ? "false" : "true";
		checkbox.setAttribute("role", "checkbox");
		checkbox.setAttribute("aria-checked", node.checkbox === " " ? "false" : "true");
		if (node.checkbox !== " ") card.addClass("is-checked");
	}

	const text = card.createDiv({ cls: "mm-text" });
	const hasMath = renderInline(text, node.text);

	let badge: HTMLElement | null = null;
	if (opts.showBodyBadges && node.bodyRanges.length > 0) {
		badge = card.createDiv({ cls: "mm-badge" });
		badge.createSpan({ cls: "mm-badge-icon", text: "≡" });
		badge.createSpan({ cls: "mm-badge-count", text: String(node.bodyRanges.length) });
		badge.setAttribute(
			"aria-label",
			`${node.bodyRanges.length} block${node.bodyRanges.length === 1 ? "" : "s"} of note content`,
		);
	}

	let toggle: HTMLElement | null = null;
	if (node.children.length > 0) {
		toggle = el.createDiv({ cls: "mm-toggle" });
		toggle.setAttribute("role", "button");
		if (opts.collapsed) {
			toggle.setText(String(opts.hiddenCount || descendantCount(node)));
			toggle.setAttribute("aria-label", "Expand");
		} else {
			toggle.addClass("is-open");
			toggle.setAttribute("aria-label", "Collapse");
		}
	}

	return { el, card, text, toggle, badge, checkbox, hasMath };
}
