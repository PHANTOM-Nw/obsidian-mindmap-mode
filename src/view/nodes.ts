import type { MindNode } from "../model/types.ts";
import type { LayoutNode } from "../layout/tidyTree.ts";

type Emit = (m: RegExpExecArray, el: HTMLElement) => void;

/**
 * Inline markdown for node titles.
 *
 * Deliberately small and DOM-based: every value goes in as text, never as HTML,
 * so a note can never inject markup into the map.
 */
const PATTERNS: Array<[RegExp, Emit]> = [
	[/`([^`]+)`/g, (m, el) => el.createEl("code", { cls: "mm-code", text: m[1] })],
	[/\*\*([^*]+)\*\*/g, (m, el) => renderRange(el.createEl("strong"), m[1])],
	[/__([^_]+)__/g, (m, el) => renderRange(el.createEl("strong"), m[1])],
	[/~~([^~]+)~~/g, (m, el) => renderRange(el.createEl("del"), m[1])],
	[/==([^=]+)==/g, (m, el) => renderRange(el.createEl("mark"), m[1])],
	[/\*([^*]+)\*/g, (m, el) => renderRange(el.createEl("em"), m[1])],
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

interface Token {
	start: number;
	end: number;
	emit: (el: HTMLElement) => void;
}

function nextToken(text: string, from: number): Token | null {
	let best: Token | null = null;
	for (const [re, emit] of PATTERNS) {
		re.lastIndex = from;
		const m = re.exec(text);
		if (!m) continue;
		if (best === null || m.index < best.start) {
			best = {
				start: m.index,
				end: m.index + m[0].length,
				emit: (el) => emit(m, el),
			};
		}
	}
	return best;
}

function renderRange(el: HTMLElement, text: string): void {
	let i = 0;
	while (i < text.length) {
		const token = nextToken(text, i);
		if (!token) {
			el.appendText(text.slice(i));
			return;
		}
		if (token.start > i) el.appendText(text.slice(i, token.start));
		token.emit(el);
		i = token.end;
	}
}

export function renderInline(el: HTMLElement, text: string): void {
	el.empty();
	if (text.trim() === "") {
		el.createSpan({ cls: "mm-placeholder", text: "Empty" });
		return;
	}
	renderRange(el, text);
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
	renderInline(text, node.text);

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

	return { el, card, text, toggle, badge, checkbox };
}
