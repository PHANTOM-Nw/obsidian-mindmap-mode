import type { MindNode } from "../model/types.ts";

export type Side = -1 | 1;

/**
 * A node is two boxes, and the layout needs both.
 *
 * `width`/`height` are the whole `.mm-node`: the card, plus the annotation
 * strip that may hang below it. That is the space the node occupies, so it is
 * what siblings are spaced by and what the map's bounds are taken from.
 *
 * `cardWidth`/`cardHeight` are the `.mm-card` inside it. The card is the only
 * thing the eye reads as the node, so it is what a parent centres itself on,
 * what a child is offset from, and what a connector anchors to. An annotation
 * hangs below the card, so it adds height to the node box and never moves the
 * card inside it. It may widen the card, which fills the node box's width.
 */
export interface LayoutNode {
	node: MindNode;
	width: number;
	height: number;
	cardWidth: number;
	cardHeight: number;
	x: number;
	y: number;
	depth: number;
	side: Side;
	/**
	 * How much this subtree counts for when splitting the branches between the
	 * two sides. 0 means "work it out from what is visible".
	 *
	 * The view sets it on the top-level branches from the *whole* tree, folded
	 * parts included, so that folding something deep can never move a branch
	 * from one side of the root to the other.
	 */
	weight: number;
	/** Index of the top-level branch this node belongs to, for colouring. */
	branch: number;
	children: LayoutNode[];
	parent: LayoutNode | null;
}

export interface LayoutOptions {
	mode: "balanced" | "right";
	horizontalGap: number;
	verticalGap: number;
	padding: number;
}

export interface LayoutResult {
	width: number;
	height: number;
	nodes: LayoutNode[];
}

export function createLayoutNode(
	node: MindNode,
	parent: LayoutNode | null,
	depth: number,
): LayoutNode {
	return {
		node,
		width: 0,
		height: 0,
		cardWidth: 0,
		cardHeight: 0,
		x: 0,
		y: 0,
		depth,
		side: 1,
		weight: 0,
		branch: parent ? parent.branch : -1,
		children: [],
		parent,
	};
}

function leafCount(n: LayoutNode): number {
	if (n.children.length === 0) return 1;
	let total = 0;
	for (const c of n.children) total += leafCount(c);
	return total;
}

/** Stack a group of subtrees vertically, returning the group's total height. */
function placeGroup(
	group: LayoutNode[],
	x: number,
	top: number,
	opts: LayoutOptions,
): number {
	let cursor = top;
	let total = 0;
	for (const child of group) {
		const h = place(child, x, cursor, opts);
		cursor += h + opts.verticalGap;
		total += h + opts.verticalGap;
	}
	return group.length > 0 ? total - opts.verticalGap : 0;
}

/**
 * Position one subtree with its top edge at `top`, returning its total height.
 *
 * A parent card sits at the vertical centre of its children's cards. When the
 * parent card is taller than that span, the children are pushed down so nothing
 * overlaps.
 *
 * Two boxes, two jobs: the extent this returns and the space the next sibling
 * is stacked after are the whole node, annotation included, while the centring
 * and the child offset are the card alone.
 */
function place(n: LayoutNode, x: number, top: number, opts: LayoutOptions): number {
	n.x = x;
	if (n.children.length === 0) {
		n.y = top;
		return n.height;
	}

	const childX = x + n.cardWidth + opts.horizontalGap;
	let total = placeGroup(n.children, childX, top, opts);

	const first = n.children[0];
	const last = n.children[n.children.length - 1];
	const centre = (first.y + first.cardHeight / 2 + (last.y + last.cardHeight / 2)) / 2;
	n.y = centre - n.cardHeight / 2;

	if (n.y < top) {
		const delta = top - n.y;
		for (const child of n.children) translate(child, 0, delta);
		n.y = top;
		total += delta;
	}

	const bottom = Math.max(top + total, n.y + n.height);
	return bottom - top;
}

function translate(n: LayoutNode, dx: number, dy: number): void {
	n.x += dx;
	n.y += dy;
	for (const c of n.children) translate(c, dx, dy);
}

function mirror(n: LayoutNode, axis: number): void {
	n.x = 2 * axis - n.x - n.cardWidth;
	n.side = -1;
	for (const c of n.children) mirror(c, axis);
}

/**
 * The vertical middle of the cards a placed group covers.
 *
 * The cards, not the node boxes. The root is centred on what its branches read
 * as, and an annotation strip hanging off the bottom one is not something to
 * counterbalance -- centring on the occupied box instead would slide every card
 * on the map up by half the strip. With no strip anywhere this is exactly half
 * the height `placeGroup` reports, which is what keeps it from moving a map
 * that has none.
 */
function cardMiddle(group: LayoutNode[]): number {
	if (group.length === 0) return 0;
	let top = Infinity;
	let bottom = -Infinity;
	const stack = [...group];
	while (stack.length > 0) {
		const n = stack.pop() as LayoutNode;
		if (n.y < top) top = n.y;
		if (n.y + n.cardHeight > bottom) bottom = n.y + n.cardHeight;
		stack.push(...n.children);
	}
	return (top + bottom) / 2;
}

function setSide(n: LayoutNode, side: Side): void {
	n.side = side;
	for (const c of n.children) setSide(c, side);
}

/**
 * Split top-level branches between the two sides at the point where half the
 * weight has been used, which keeps reading order intact: down the right, then
 * down the left.
 *
 * The weight comes from the caller when it has one, because counting visible
 * leaves instead would make the split move every time something is folded --
 * and a branch jumping from one side of the root to the other is the single
 * most disorienting thing a fold can do.
 */
function partition(children: LayoutNode[]): { right: LayoutNode[]; left: LayoutNode[] } {
	const weights = children.map((child) => child.weight || leafCount(child));
	const total = weights.reduce((a, b) => a + b, 0);
	const half = total / 2;

	let running = 0;
	let split = children.length;
	for (let i = 0; i < children.length; i++) {
		running += weights[i];
		if (running >= half) {
			split = i + 1;
			break;
		}
	}
	// Never leave one side empty when there is something to share.
	if (split >= children.length && children.length > 1) split = children.length - 1;
	if (split < 1) split = 1;

	return { right: children.slice(0, split), left: children.slice(split) };
}

export function layoutTree(root: LayoutNode, opts: LayoutOptions): LayoutResult {
	root.children.forEach((child, index) => {
		child.branch = index;
		const stack = [...child.children];
		while (stack.length > 0) {
			const n = stack.pop() as LayoutNode;
			n.branch = index;
			stack.push(...n.children);
		}
	});

	root.x = 0;
	root.y = -root.cardHeight / 2;
	const childX = root.cardWidth + opts.horizontalGap;

	if (opts.mode === "right" || root.children.length < 2) {
		placeGroup(root.children, childX, 0, opts);
		const middle = cardMiddle(root.children);
		for (const child of root.children) translate(child, 0, -middle);
		setSideAll(root.children, 1);
	} else {
		const { right, left } = partition(root.children);

		placeGroup(right, childX, 0, opts);
		const middleRight = cardMiddle(right);
		for (const child of right) translate(child, 0, -middleRight);
		setSideAll(right, 1);

		placeGroup(left, childX, 0, opts);
		const middleLeft = cardMiddle(left);
		for (const child of left) translate(child, 0, -middleLeft);
		const axis = root.x + root.cardWidth / 2;
		for (const child of left) mirror(child, axis);
	}

	return normalize(root, opts.padding);
}

function setSideAll(group: LayoutNode[], side: Side): void {
	for (const n of group) setSide(n, side);
}

function normalize(root: LayoutNode, padding: number): LayoutResult {
	const nodes: LayoutNode[] = [];
	const stack: LayoutNode[] = [root];
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	while (stack.length > 0) {
		const n = stack.pop() as LayoutNode;
		nodes.push(n);
		if (n.x < minX) minX = n.x;
		if (n.y < minY) minY = n.y;
		if (n.x + n.width > maxX) maxX = n.x + n.width;
		if (n.y + n.height > maxY) maxY = n.y + n.height;
		stack.push(...n.children);
	}

	const dx = padding - minX;
	const dy = padding - minY;
	for (const n of nodes) {
		n.x += dx;
		n.y += dy;
	}

	return {
		width: maxX - minX + padding * 2,
		height: maxY - minY + padding * 2,
		nodes,
	};
}
