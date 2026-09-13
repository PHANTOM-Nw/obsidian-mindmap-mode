/**
 * The map as an Obsidian Canvas file.
 *
 * Pure: the laid-out map goes in, the `.canvas` JSON comes out. Nothing here
 * touches the DOM or the vault, which is what lets the shape of the file be
 * tested directly -- ids included, because the caller supplies the id factory.
 *
 * What is exported is what is on screen: the cards the current fold state
 * leaves visible, at the coordinates the current layout gave them.
 */

export type CanvasSide = "left" | "right";

/**
 * The part of a laid-out node this needs. `LayoutNode` satisfies it, so the
 * view hands its layout straight over.
 */
export interface CanvasSourceNode {
	node: { text: string; virtual: boolean };
	x: number;
	y: number;
	width: number;
	height: number;
	/** 1 for a branch growing right of the root, -1 for one growing left. */
	side: -1 | 1;
	/** Index of the top-level branch, or -1 for the root itself. */
	branch: number;
	parent: CanvasSourceNode | null;
}

export interface CanvasTextNode {
	id: string;
	type: "text";
	text: string;
	x: number;
	y: number;
	width: number;
	height: number;
	color?: string;
}

export interface CanvasEdge {
	id: string;
	fromNode: string;
	fromSide: CanvasSide;
	toNode: string;
	toSide: CanvasSide;
}

export interface CanvasFile {
	nodes: CanvasTextNode[];
	edges: CanvasEdge[];
}

export interface CanvasBuildOptions<T extends CanvasSourceNode> {
	/** Shown on the root card when the note has no heading of its own. */
	title: string;
	/** The branch's colour, or null when branch colours are off. */
	branchColor: (branch: number) => string | null;
	/** 16 lowercase hex characters, the shape Obsidian generates. */
	nextId: () => string;
	/**
	 * The whole text behind a card the map only previews.
	 *
	 * Note content is clipped on the map so a 300-line code block does not
	 * become a 300-line card; the file it is exported into has no such reason
	 * to clip it. Anything else returns null and keeps the text it renders.
	 */
	fullText?: (item: T) => string | null;
}

/** `#rgb`, `#rrggbb`, `#rrggbbaa` and the `rgb()` family. */
const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(([^)]*)\)$/i;

function channel(value: string): string | null {
	const n = Number(value.endsWith("%") ? (Number(value.slice(0, -1)) * 255) / 100 : value);
	if (!Number.isFinite(n)) return null;
	return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}

/** A number, a percentage, or null. Alpha is 0-1; a percentage divides by 100. */
function alphaOf(value: string): number | null {
	const n = Number(value.endsWith("%") ? Number(value.slice(0, -1)) / 100 : value);
	return Number.isFinite(n) ? n : null;
}

/**
 * A colour Canvas will accept, or null.
 *
 * Canvas stores either one of its six preset numbers or a `#rrggbb` string, so
 * a theme that spells a branch colour any other way has its value converted
 * rather than written through -- and anything unrecognised leaves the card its
 * default colour rather than writing a value Obsidian would drop on load.
 *
 * Fully transparent counts as unrecognised. Canvas has nowhere to put the
 * alpha, and `rgba(0, 0, 0, 0)` -- which is what a colour nobody has set comes
 * back as -- would otherwise turn every card black.
 */
export function toHexColor(value: string | null | undefined): string | null {
	if (!value) return null;
	const text = value.trim();

	if (HEX.test(text)) {
		const body = text.slice(1).toLowerCase();
		if (body.length <= 4) {
			if (body.length === 4 && body[3] === "0") return null;
			return `#${body.slice(0, 3).split("").map((c) => c + c).join("")}`;
		}
		if (body.length === 8 && body.slice(6) === "00") return null;
		return `#${body.slice(0, 6)}`;
	}

	const rgb = RGB.exec(text);
	if (!rgb) return null;
	const parts = rgb[1].split(/[\s,/]+/).filter((part) => part !== "");
	if (parts.length < 3) return null;
	if (parts.length > 3 && alphaOf(parts[3]) === 0) return null;
	const channels = parts.slice(0, 3).map(channel);
	if (channels.some((c) => c === null)) return null;
	return `#${channels.join("")}`;
}

function textOf<T extends CanvasSourceNode>(item: T, opts: CanvasBuildOptions<T>): string {
	// A virtual root stands for the file name and has no line of its own.
	if (item.parent === null && item.node.virtual) return opts.title;
	return opts.fullText?.(item) ?? item.node.text;
}

/**
 * Build the `.canvas` object.
 *
 * Sizes are the measured cards, rounded: a Canvas node is a box, and the box
 * the map drew is the one that fits the text. Edges leave the face the branch
 * grows from, which is the right face on the right of the root and the left
 * face on the left of it -- the balanced layout's own rule, read off `side`.
 */
export function buildCanvas<T extends CanvasSourceNode>(
	layout: { nodes: readonly T[] },
	opts: CanvasBuildOptions<T>,
): CanvasFile {
	const ids = new Map<CanvasSourceNode, string>();
	const nodes: CanvasTextNode[] = [];

	for (const item of layout.nodes) {
		const id = opts.nextId();
		ids.set(item, id);

		const entry: CanvasTextNode = {
			id,
			type: "text",
			text: textOf(item, opts),
			x: Math.round(item.x),
			y: Math.round(item.y),
			// A zero-sized Canvas node is not drawn at all.
			width: Math.max(1, Math.round(item.width)),
			height: Math.max(1, Math.round(item.height)),
		};
		const color = toHexColor(opts.branchColor(item.branch));
		if (color) entry.color = color;
		nodes.push(entry);
	}

	const edges: CanvasEdge[] = [];
	for (const item of layout.nodes) {
		const parent = item.parent;
		if (!parent) continue;
		const fromNode = ids.get(parent);
		const toNode = ids.get(item);
		if (!fromNode || !toNode) continue;

		const right = item.side === 1;
		edges.push({
			id: opts.nextId(),
			fromNode,
			fromSide: right ? "right" : "left",
			toNode,
			toSide: right ? "left" : "right",
		});
	}

	return { nodes, edges };
}

/** Obsidian's own formatting: tab-indented JSON. */
export function serializeCanvas(file: CanvasFile): string {
	return JSON.stringify(file, null, "\t");
}

const HEX_DIGITS = "0123456789abcdef";

/**
 * The id factory used outside tests: 16 lowercase hex characters, the shape
 * Obsidian writes. `crypto` where there is one, and `Math.random` where there
 * is not -- these name nodes within one file, they are not a secret.
 */
export function randomId(): string {
	const bytes = new Uint8Array(8);
	if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
		crypto.getRandomValues(bytes);
	} else {
		for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
	}
	let out = "";
	for (const byte of bytes) {
		out += HEX_DIGITS[byte >> 4] + HEX_DIGITS[byte & 15];
	}
	return out;
}
