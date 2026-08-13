import { setIcon } from "obsidian";

import type { LayoutNode } from "../layout/tidyTree.ts";
import { nextInlineToken } from "../model/inlineText.ts";
import type { InlineKind } from "../model/inlineText.ts";
import { renderMathInto } from "./math.ts";
import { MATH_DISPLAY, MATH_INLINE } from "./mathSyntax.ts";

/** Carried through the recursion so nested markup can report what it emitted. */
interface InlineContext {
	sawMath: boolean;
}

type Emit = (m: RegExpExecArray, el: HTMLElement, ctx: InlineContext) => void;

/**
 * A link, with its target carried as data rather than as an `href`.
 *
 * Never an `<a href>`: a note that writes `[click](javascript:…)` would then be
 * one click away from running script in the renderer. The target stays inert
 * text until the view is asked to open it, and the view refuses the schemes it
 * does not know.
 */
function linkSpan(el: HTMLElement, cls: string, label: string, target: string): void {
	const span = el.createSpan({ cls, text: label });
	// `<path>` wrapping and a trailing `"title"` are markdown-link syntax, not
	// part of what the link points at.
	const href = target.trim().replace(/^<(.*)>$/, "$1").replace(/\s+"[^"]*"$/, "").trim();
	if (href !== "") span.dataset.href = href;
}

/**
 * How each inline rule becomes DOM.
 *
 * The rules themselves live in `model/inlineText.ts`, where the search reads
 * them too. A `Record` over the kinds is what keeps the two halves together: a
 * rule added there without an emitter here is a compile error, not a token that
 * silently renders as nothing.
 *
 * Deliberately DOM-based throughout: every value goes in as text, never as
 * HTML, so a note can never inject markup into the map.
 */
const EMIT: Record<InlineKind, Emit> = {
	code: (m, el) => el.createEl("code", { cls: "mm-code", text: m[1] }),
	strong: (m, el, ctx) => renderRange(el.createEl("strong"), m[1], ctx),
	strike: (m, el, ctx) => renderRange(el.createEl("del"), m[1], ctx),
	highlight: (m, el, ctx) => renderRange(el.createEl("mark"), m[1], ctx),
	em: (m, el, ctx) => renderRange(el.createEl("em"), m[1], ctx),
	wikilink: (m, el) => linkSpan(el, "mm-link", m[2] ?? m[1], m[1]),
	link: (m, el) => linkSpan(el, "mm-link", m[1], m[2]),
	embed: (m, el) => linkSpan(el, "mm-embed", m[1], m[1]),
};

const MATH_PATTERNS: Array<[RegExp, Emit]> = [
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
];

interface Token {
	start: number;
	end: number;
	emit: (el: HTMLElement) => void;
}

/**
 * Math is scanned first and an inline token only adopted on a strict `<`, so a
 * formula wins an exact-index tie. Everything past that is decided by
 * earliest-match-wins, which is what keeps `$a_b$` away from the `__` rule and
 * `$x*y*z$` away from the `*` rule.
 */
function nextToken(text: string, from: number, ctx: InlineContext): Token | null {
	let best: Token | null = null;
	for (const [re, emit] of MATH_PATTERNS) {
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
	const inline = nextInlineToken(text, from);
	if (inline && (best === null || inline.start < best.start)) {
		const emit = EMIT[inline.rule.kind];
		best = {
			start: inline.start,
			end: inline.end,
			emit: (el) => emit(inline.match, el, ctx),
		};
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
	branchColors: boolean;
	/** Render the text verbatim: code blocks and tables must not be marked up. */
	preformatted: boolean;
	/** Draw the button that opens the block whole, in its own dialog. */
	expandable: boolean;
	/** Draw the hover button that adds a child. Off for note content. */
	addable: boolean;
	collapsed: boolean;
	/** True when the node has anything to unfold, body cards included. */
	hasChildren: boolean;
	/** Shown on the toggle while collapsed. */
	hiddenCount: number;
}

export interface NodeElement {
	el: HTMLElement;
	card: HTMLElement;
	text: HTMLElement;
	toggle: HTMLElement | null;
	checkbox: HTMLElement | null;
	expand: HTMLElement | null;
	add: HTMLElement | null;
	hasMath: boolean;
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
	let hasMath = false;
	if (opts.preformatted) {
		el.dataset.block = "pre";
		text.setText(node.text);
	} else {
		hasMath = renderInline(text, node.text);
	}

	// Inside the card, not beside it. `canPan` already lets a pointerdown on
	// `.mm-card` through, and anything outside it would have to be named there
	// too or the canvas takes pointer capture and swallows the click.
	// Absolutely positioned, so it stays out of flow and cannot move the
	// measurements `measureAndPlace` takes off this element.
	let expand: HTMLElement | null = null;
	if (opts.expandable) {
		expand = card.createDiv({ cls: "mm-expand" });
		expand.setAttribute("role", "button");
		expand.setAttribute("aria-label", "Show the whole block");
		setIcon(expand, "maximize-2");
		// `setIcon` is silent when the id is not in the bundled set, which would
		// leave an invisible but clickable box in the corner of every card.
		if (!expand.firstElementChild) expand.setText("⤢");
	}

	// The furniture on the branch side of the card: the fold toggle, then the
	// button that grows a child. One row, absolutely positioned, so neither can
	// reach the measurements `measureAndPlace` takes off this element.
	let toggle: HTMLElement | null = null;
	let add: HTMLElement | null = null;
	if (opts.hasChildren || opts.addable) {
		const tools = el.createDiv({ cls: "mm-tools" });

		if (opts.hasChildren) {
			toggle = tools.createDiv({ cls: "mm-toggle" });
			toggle.setAttribute("role", "button");
			if (opts.collapsed) {
				toggle.setText(String(opts.hiddenCount));
				toggle.setAttribute("aria-label", "Expand");
			} else {
				toggle.addClass("is-open");
				toggle.setAttribute("aria-label", "Collapse");
			}
		}

		if (opts.addable) {
			add = tools.createDiv({ cls: "mm-add" });
			add.setAttribute("role", "button");
			add.setAttribute("aria-label", "Add child");
			setIcon(add, "plus");
			if (!add.firstElementChild) add.setText("+");
		}
	}

	return { el, card, text, toggle, checkbox, expand, add, hasMath };
}
