/**
 * The map, serialized as a self-contained XHTML fragment.
 *
 * Everything the SVG, PNG and HTML exports share is here: one clone of the
 * live `.mm-content`, with every style it is actually being drawn with written
 * onto it inline. The exported documents carry no stylesheet at all, so a
 * property nobody copies is a property the file does not have -- which is the
 * whole reason this reads computed values off the live element rather than
 * trying to ship `styles.css` alongside.
 *
 * Two things the caller owes this function, both because a card that is not in
 * the document has no style and no size:
 *
 *   - every card must be back in the document first (`showAllCards()`), and
 *   - the connector layer must be drawn for the whole map, not for the region
 *     the camera happens to be over.
 *
 * The caller re-culls afterwards. Nothing else is read from the app, and
 * nothing here imports Obsidian -- the DOM helpers it uses (`createDiv`,
 * `createSpan`, `createSvg`, `setCssStyles`, `instanceOf`) are the ones
 * Obsidian puts on the globals and the DOM prototypes.
 */

import { stripIllegalXml } from "./xmlText.ts";

/** Blank margin around the map, in layout pixels. */
export const EXPORT_PADDING = 32;

export interface SnapshotOptions {
	/** The element carrying the whole map: `.mm-content`. */
	content: HTMLElement;
	/** The map's size in layout pixels, at scale 1. */
	width: number;
	height: number;
	/** What sits behind the map, as a CSS colour. */
	background: string;
}

export interface Snapshot {
	/**
	 * The map as a well-formed XHTML fragment, for the SVG's `<foreignObject>`.
	 */
	xhtml: string;
	/**
	 * The same clone, serialized as HTML.
	 *
	 * Not interchangeable with the one above. XML spells an empty element
	 * `<div/>`, and an HTML parser reads that as an *open* `<div>` — so from the
	 * first empty card element onwards every later card would be parsed as a
	 * child of the one before it, and a map of absolutely positioned cards would
	 * collapse into a heap. The `.html` file gets this one.
	 */
	html: string;
	/** The fragment's size, the padding included. */
	width: number;
	height: number;
	background: string;
}

/**
 * The properties carried over from the live element.
 *
 * Longhands throughout: `getComputedStyle` answers a shorthand with whatever
 * the engine feels like reconstructing, and a longhand with the used value.
 */
export const COPIED = [
	"font-family",
	"font-size",
	"font-weight",
	"font-style",
	"line-height",
	"letter-spacing",
	"color",
	"background-color",
	"background-image",
	"border-top-width",
	"border-right-width",
	"border-bottom-width",
	"border-left-width",
	"border-top-style",
	"border-right-style",
	"border-bottom-style",
	"border-left-style",
	"border-top-color",
	"border-right-color",
	"border-bottom-color",
	"border-left-color",
	"border-top-left-radius",
	"border-top-right-radius",
	"border-bottom-right-radius",
	"border-bottom-left-radius",
	"padding-top",
	"padding-right",
	"padding-bottom",
	"padding-left",
	"margin-top",
	"margin-right",
	"margin-bottom",
	"margin-left",
	"box-sizing",
	"width",
	"height",
	"min-width",
	"max-width",
	"display",
	"flex-direction",
	"flex-wrap",
	"justify-content",
	"align-items",
	"align-self",
	"flex-grow",
	"flex-shrink",
	"flex-basis",
	"row-gap",
	"column-gap",
	"position",
	"left",
	"top",
	"white-space",
	// The annotation strip breaks anywhere and the card's text only at a word;
	// uncopied, both would fall back to `normal` and rewrap in the file.
	"overflow-wrap",
	"text-align",
	"text-decoration-line",
	"text-decoration-color",
	"text-decoration-style",
	"vertical-align",
	"opacity",
	"box-shadow",
	"overflow-x",
	"overflow-y",
	"list-style-type",
	"fill",
	"stroke",
	"stroke-width",
	"stroke-linecap",
	"stroke-dasharray",
	"visibility",
];

/**
 * Inherited properties, which a child only needs written down when it differs
 * from its parent. Most of the map is one font in one colour, so this is the
 * difference between a fragment that carries a font stack per element and one
 * that carries it once.
 */
export const INHERITED = new Set([
	"font-family",
	"font-size",
	"font-weight",
	"font-style",
	"line-height",
	"letter-spacing",
	"color",
	"white-space",
	"overflow-wrap",
	"text-align",
	"list-style-type",
	"visibility",
	"fill",
	"stroke",
	"stroke-width",
	"stroke-linecap",
	"stroke-dasharray",
]);

/**
 * Values equal to the CSS initial value. The exported document has no
 * stylesheet, so an absent property already resolves to exactly these.
 */
export const INITIAL: Record<string, string> = {
	"background-image": "none",
	"box-shadow": "none",
	"text-decoration-line": "none",
	"stroke-dasharray": "none",
	"max-width": "none",
	"overflow-wrap": "normal",
	"min-width": "0px",
	"opacity": "1",
	"visibility": "visible",
	"flex-direction": "row",
	"flex-wrap": "nowrap",
	"justify-content": "normal",
	"align-items": "normal",
	"align-self": "auto",
	"flex-grow": "0",
	"flex-shrink": "1",
	"flex-basis": "auto",
	"row-gap": "normal",
	"column-gap": "normal",
};

/** Interactive chrome: the fold/add row, and the button that opens a block. */
const CHROME = ".mm-tools, .mm-expand";

/** Selection, search and drag state -- a moment in the app, not part of the map. */
const STATE_CLASSES = [
	"is-selected",
	"is-search-match",
	"is-search-current",
	"is-dragging",
	"is-drop-target",
	"is-drop-before",
	"is-drop-after",
	"is-drop-invalid",
];

const DROPPED_ATTRIBUTES = ["contenteditable", "tabindex", "draggable"];

/** What a size has to gain to become a border box, per axis. */
const EXTRA: Record<string, string[]> = {
	width: ["padding-left", "padding-right", "border-left-width", "border-right-width"],
	height: ["padding-top", "padding-bottom", "border-top-width", "border-bottom-width"],
};

/**
 * Whether `getComputedStyle().width` answers with the border box when
 * `box-sizing: border-box` is in force.
 *
 * Probed rather than assumed. The two readings differ by exactly the padding
 * and the border, and a card written out that much too narrow does not just
 * look wrong -- it rewraps its text, which moves everything below it.
 */
function reportsBorderBox(): boolean {
	const probe = createDiv();
	probe.setAttribute(
		"style",
		"position:absolute;left:-9999px;top:0;visibility:hidden;" +
			"box-sizing:border-box;width:100px;padding:10px;border:1px solid",
	);
	document.body.appendChild(probe);
	const reported = parseFloat(window.getComputedStyle(probe).width);
	probe.remove();
	return Math.abs(reported - 100) < 0.5;
}

/**
 * A size in whatever box the copied `box-sizing` will make it mean.
 *
 * Pinning the sizes is the point of the whole copy: the export has none of the
 * theme's web fonts, so a card left to size itself would wrap wherever the
 * fallback font happened to put it.
 */
function sizeValue(
	computed: CSSStyleDeclaration,
	property: string,
	borderBox: boolean,
): string | null {
	const raw = parseFloat(computed.getPropertyValue(property));
	if (!Number.isFinite(raw)) return null;
	// Only one case needs work: a border-box element whose size came back as the
	// content box. Everywhere else the value already means the right box.
	if (borderBox || computed.getPropertyValue("box-sizing") !== "border-box") {
		return `${raw}px`;
	}
	let total = raw;
	for (const part of EXTRA[property]) {
		total += parseFloat(computed.getPropertyValue(part)) || 0;
	}
	return `${total}px`;
}

function styleOf(el: Element): CSSStyleDeclaration | null {
	return el.instanceOf(HTMLElement) || el.instanceOf(SVGElement) ? el.style : null;
}

function copyStyle(
	clone: Element,
	computed: CSSStyleDeclaration,
	parent: CSSStyleDeclaration | null,
	borderBox: boolean,
	extra: string[] = [],
): void {
	const target = styleOf(clone);
	if (!target) return;
	for (const property of extra.length === 0 ? COPIED : [...COPIED, ...extra]) {
		const value =
			Object.hasOwn(EXTRA, property)
				? sizeValue(computed, property, borderBox)
				: computed.getPropertyValue(property);
		if (value === null || value === "") continue;
		if (INITIAL[property] === value) continue;
		if (INHERITED.has(property) && parent && parent.getPropertyValue(property) === value) {
			continue;
		}
		target.setProperty(property, value);
	}
}

function dropAttributes(clone: Element): void {
	for (const name of DROPPED_ATTRIBUTES) clone.removeAttribute(name);
	for (const attribute of Array.from(clone.attributes)) {
		if (attribute.name.toLowerCase().startsWith("on")) {
			clone.removeAttribute(attribute.name);
			continue;
		}
		// A `data-href` is note text, and note text can hold characters XML has
		// no way to spell.
		const cleaned = stripIllegalXml(attribute.value);
		if (cleaned !== attribute.value) clone.setAttribute(attribute.name, cleaned);
	}
	// An `<a>` is the one element in the fragment a click could still follow.
	// The map itself never makes one -- a link's target lives in `data-href` and
	// only the view decides what it means -- but MathJax's TeX `\href` does, and
	// a `javascript:` target in a note must not become a live link in an
	// exported page. Stripped rather than unwrapped: an `<a>` with no target is
	// inert, and its styling is already copied onto it.
	//
	// `<use>` is deliberately untouched: its `href` is what points a glyph at
	// the definitions copied in beside it.
	if (clone.localName === "a") {
		clone.removeAttribute("href");
		clone.removeAttribute("xlink:href");
	}
}

/** Which end of the element a pseudo element is drawn at. */
const PSEUDO: Array<[string, boolean]> = [
	["::before", true],
	["::after", false],
];

/**
 * Properties a pseudo element needs beyond the shared list -- it is placed and
 * shaped by its own rule rather than by the flow.
 */
const PSEUDO_EXTRA = ["right", "bottom", "transform", "transform-origin"];

/** The text inside `content`'s quotes, or "" for anything not a plain string. */
function pseudoText(content: string): string {
	const quoted = /^"((?:[^"\\]|\\.)*)"$/.exec(content.trim());
	return quoted ? quoted[1].replace(/\\(.)/g, "$1") : "";
}

/**
 * Redraw `::before` and `::after` as real elements.
 *
 * A pseudo element has no node to hang an inline style on, so it does not
 * survive a clone -- and one of them is load-bearing: the tick on a done task
 * is `.mm-checkbox[data-checked="true"]::after`, an empty `content` shaped
 * entirely out of two borders and a rotation. MathJax's CHTML output draws
 * every glyph the same way, so this is also what puts a formula in the file.
 *
 * Runs after the children have been walked, on purpose: these add children, and
 * the walk pairs live and cloned children by index.
 */
function addPseudo(
	live: Element,
	clone: Element,
	computed: CSSStyleDeclaration,
	borderBox: boolean,
): void {
	for (const [selector, before] of PSEUDO) {
		const style = window.getComputedStyle(live, selector);
		const content = style.getPropertyValue("content");
		if (content === "" || content === "none" || content === "normal") continue;

		const span = createSpan();
		copyStyle(span, style, computed, borderBox, PSEUDO_EXTRA);
		const text = pseudoText(content);
		if (text !== "") span.textContent = text;
		if (before) clone.insertBefore(span, clone.firstChild);
		else clone.appendChild(span);
	}
}

function scrubText(root: Element): void {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		const text = node.nodeValue;
		if (text !== null) node.nodeValue = stripIllegalXml(text);
	}
}

/**
 * Walk the live tree and the clone together.
 *
 * `cloneNode(true)` keeps child order, so index `i` is the same element in
 * both. Children are visited back to front so that dropping one from the clone
 * cannot shift an index that has not been reached yet, and a stripped element
 * takes its subtree out of both walks at once.
 */
function transfer(
	live: Element,
	clone: Element,
	parent: CSSStyleDeclaration | null,
	borderBox: boolean,
): void {
	// Before the style copy, so the attribute scan does not have to walk the
	// inline style this is about to write.
	dropAttributes(clone);
	const computed = window.getComputedStyle(live);
	copyStyle(clone, computed, parent, borderBox);

	const liveKids = live.children;
	const cloneKids = clone.children;
	for (let i = liveKids.length - 1; i >= 0; i--) {
		const liveKid = liveKids[i];
		const cloneKid = cloneKids[i];
		if (!cloneKid) continue;
		if (liveKid.matches(CHROME)) {
			cloneKid.remove();
			continue;
		}
		transfer(liveKid, cloneKid, computed, borderBox);
	}

	// Last: this adds children, and the pairing above goes by index.
	addPseudo(live, clone, computed, borderBox);
}

/** Take the live state classes off, and hand back the undo. */
function suppressState(content: HTMLElement): () => void {
	const selector = STATE_CLASSES.map((name) => `.${name}`).join(", ");
	const touched: Array<[Element, string[]]> = [];
	for (const el of Array.from(content.querySelectorAll(selector))) {
		const removed = STATE_CLASSES.filter((name) => el.classList.contains(name));
		el.classList.remove(...removed);
		touched.push([el, removed]);
	}
	return () => {
		for (const [el, removed] of touched) el.classList.add(...removed);
	};
}

function hrefOf(use: Element): string {
	return use.getAttribute("href") ?? use.getAttribute("xlink:href") ?? "";
}

/**
 * The glyph definitions a formula points at.
 *
 * MathJax's SVG output draws each glyph as a `<use href="#MJX-…">` aimed at a
 * shared cache elsewhere in Obsidian's document. That cache is not part of the
 * map, so the referenced elements are copied into the export -- otherwise a
 * formula is a row of empty boxes the moment the file is opened outside the
 * app. Resolved transitively: a composed glyph is itself made of `<use>`.
 */
function collectDefs(clone: Element): SVGSVGElement | null {
	const present = new Set<string>();
	for (const el of Array.from(clone.querySelectorAll("[id]"))) present.add(el.id);

	const pending: string[] = [];
	const push = (root: ParentNode): void => {
		for (const use of Array.from(root.querySelectorAll("use"))) {
			const href = hrefOf(use);
			if (!href.startsWith("#")) continue;
			const id = href.slice(1);
			if (id === "" || present.has(id)) continue;
			present.add(id);
			pending.push(id);
		}
	};
	push(clone);
	if (pending.length === 0) return null;

	const defs = createSvg("defs");
	while (pending.length > 0) {
		const id = pending.shift() as string;
		const source = document.getElementById(id);
		if (!source) continue;
		const copy = source.cloneNode(true) as Element;
		defs.appendChild(copy);
		push(copy);
	}
	if (defs.childElementCount === 0) return null;

	const holder = createSvg("svg");
	holder.setAttribute("width", "0");
	holder.setAttribute("height", "0");
	holder.setCssStyles({
		position: "absolute",
		width: "0",
		height: "0",
		overflow: "hidden",
	});
	holder.appendChild(defs);
	return holder;
}

/**
 * Clone the map and serialize it.
 *
 * The clone is placed at the padding offset inside a container the size of the
 * map plus that padding on every side. No origin correction is needed: the
 * layout is normalized before it is drawn, so the map already starts at its own
 * origin and `.mm-content` is sized to exactly the box it fills.
 *
 * One thing does not survive, by construction: a card that is under the pointer
 * when the export runs is serialized with its hover styling, because `:hover`
 * is a computed value like any other.
 */
export function snapshotMap(opts: SnapshotOptions): Snapshot {
	const restore = suppressState(opts.content);
	let xhtml: string;
	let html: string;
	try {
		const clone = opts.content.cloneNode(true) as HTMLElement;
		transfer(opts.content, clone, null, reportsBorderBox());

		// After the copy, so the camera's transform and `.mm-content`'s own
		// placement do not come through it.
		clone.setCssStyles({
			position: "absolute",
			left: `${EXPORT_PADDING}px`,
			top: `${EXPORT_PADDING}px`,
			transform: "none",
			width: `${opts.width}px`,
			height: `${opts.height}px`,
		});

		const wrapper = createDiv();
		wrapper.className = "mm-export";
		wrapper.setAttribute(
			"style",
			`position:relative;box-sizing:border-box;overflow:hidden;` +
				`width:${opts.width + EXPORT_PADDING * 2}px;` +
				`height:${opts.height + EXPORT_PADDING * 2}px;` +
				`background:${opts.background}`,
		);

		const defs = collectDefs(clone);
		if (defs) wrapper.appendChild(defs);
		wrapper.appendChild(clone);
		scrubText(wrapper);

		// One clone, serialized twice, because the two documents are parsed by
		// two different parsers. XMLSerializer is what a `<foreignObject>` needs
		// -- well-formed XML, with the XHTML namespace put on the wrapper for us
		// -- and `outerHTML` is what an HTML file needs, where `<div/>` would be
		// read as an unclosed tag.
		xhtml = new XMLSerializer().serializeToString(wrapper);
		html = wrapper.outerHTML;
	} finally {
		restore();
	}

	return {
		xhtml,
		html,
		width: opts.width + EXPORT_PADDING * 2,
		height: opts.height + EXPORT_PADDING * 2,
		background: opts.background,
	};
}
