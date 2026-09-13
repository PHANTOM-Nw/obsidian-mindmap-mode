/**
 * The geometry behind "is this worth having in the document?".
 *
 * Zero imports, exactly like `mathSyntax.ts` and for the same reason: the view
 * modules that use this all reach `obsidian` sooner or later, and `npm test`
 * runs the sources straight through Node with no bundler to stand one in. The
 * arithmetic that decides what a pan puts on screen is the part worth testing,
 * so it lives where a test can get at it.
 *
 * Everything here works in *content* coordinates -- the space the layout puts
 * cards in, before the viewport's pan and zoom are applied.
 */

/** A rectangle in content coordinates. */
export interface ViewBox {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** A laid-out card: the shape both the layout and the DOM agree on. */
export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Everything about the camera a view box is derived from, read in one go.
 *
 * The size half of it costs a layout to read, so a frame that wants two boxes
 * -- the cards' and the connectors' -- takes these once and derives both from
 * them rather than asking the element twice.
 */
export interface ViewMetrics {
	width: number;
	height: number;
	tx: number;
	ty: number;
	scale: number;
}

/**
 * The part of the content a viewport is showing, grown by `margin` *screen*
 * pixels on every side.
 *
 * The margin is converted through the zoom along with everything else, so it
 * stays the same distance on screen however far the map is zoomed out -- which
 * is the point: it exists to keep a card from appearing at the edge of the
 * screen mid-pan, and that edge is a screen edge.
 */
export function viewBoxOf(
	width: number,
	height: number,
	tx: number,
	ty: number,
	scale: number,
	margin = 0,
): ViewBox | null {
	if (width <= 0 || height <= 0 || scale <= 0) return null;
	return {
		left: zeroed((-margin - tx) / scale),
		top: zeroed((-margin - ty) / scale),
		right: zeroed((width + margin - tx) / scale),
		bottom: zeroed((height + margin - ty) / scale),
	};
}

/** The same box, from metrics already in hand. */
export function viewBoxFrom(metrics: ViewMetrics, margin = 0): ViewBox | null {
	return viewBoxOf(metrics.width, metrics.height, metrics.tx, metrics.ty, metrics.scale, margin);
}

/**
 * A screen margin, capped at a distance in *content* pixels.
 *
 * A margin in screen pixels grows without bound as the map is zoomed out: at
 * the smallest zoom, the connector layer's own margin alone would be sixteen
 * thousand content pixels on every side, and every path in it gets rebuilt each
 * time the camera leaves the drawn region. The cap is what keeps that region
 * proportional to the map rather than to the reciprocal of the zoom.
 */
export function clampedMargin(margin: number, scale: number, maxContent: number): number {
	if (scale <= 0) return margin;
	return Math.min(margin, maxContent * scale);
}

/**
 * `-0` for `0`.
 *
 * An unmoved camera divides a negated zero, and negative zero is a true result:
 * it compares equal to zero everywhere this module uses it. It is only ever a
 * problem when a human reads it -- in a log line, in a failing assertion -- so
 * it is spent here rather than explained at every call site.
 */
function zeroed(value: number): number {
	return value === 0 ? 0 : value;
}

/** Does a box overlap the view at all? Touching edges do not count as overlap. */
export function overlaps(box: Box, view: ViewBox): boolean {
	return (
		box.x < view.right &&
		box.x + box.width > view.left &&
		box.y < view.bottom &&
		box.y + box.height > view.top
	);
}

/**
 * Is `inner` wholly inside `outer`?
 *
 * What the connector layer asks before deciding it can leave itself alone. A
 * missing box is never a cover: no drawn region yet, or no viewport to compare
 * against, both mean "draw".
 */
export function covers(outer: ViewBox | null, inner: ViewBox | null): boolean {
	if (outer === null || inner === null) return false;
	return (
		outer.left <= inner.left &&
		outer.top <= inner.top &&
		outer.right >= inner.right &&
		outer.bottom >= inner.bottom
	);
}

/**
 * What one frame of culling should flip, and what it had to leave.
 *
 * Index lists into the same array the scan was given, reused between frames so
 * a pan allocates nothing.
 */
export interface CullPlan {
	/** Cards to put back in the document. */
	show: number[];
	/** Cards to take out of it. */
	hide: number[];
	/** Flips the budget did not have room for. */
	backlog: number;
}

export function emptyPlan(): CullPlan {
	return { show: [], hide: [], backlog: 0 };
}

/** One frame's worth of the question "what belongs in the document?". */
export interface CullScan {
	boxes: readonly Box[];
	/** Is the card at this index out of the document now? */
	offscreen: (index: number) => boolean;
	/** Cards that must stay in it whatever the geometry says. */
	keep: (index: number) => boolean;
	/** Cards inside this come back. A null box means "no viewport": show them all. */
	show: ViewBox | null;
	/** Cards outside this go, which is a wider box on purpose -- see below. */
	hide: ViewBox | null;
	/** How many cards may actually be flipped this frame. */
	budget: number;
}

/**
 * Decide which cards this frame flips.
 *
 * Two boxes rather than one, and that gap is the hysteresis: a card comes back
 * as soon as it reaches the inner box and only leaves once it is past the outer
 * one, so a card sitting on the boundary of a slow pan is flipped once instead
 * of on every other frame.
 *
 * Shows are planned before hides, and within each pass the order is the layout
 * order the array already has. A show is what the viewer would notice missing;
 * a hide left for the next frame costs nothing but the paint it was going to
 * save, so the budget is spent on the half that shows.
 */
export function planCull(scan: CullScan, plan: CullPlan): void {
	plan.show.length = 0;
	plan.hide.length = 0;
	plan.backlog = 0;
	const count = scan.boxes.length;

	for (let i = 0; i < count; i++) {
		if (!scan.offscreen(i)) continue;
		if (scan.show !== null && !overlaps(scan.boxes[i], scan.show)) continue;
		if (plan.show.length + plan.hide.length >= scan.budget) plan.backlog++;
		else plan.show.push(i);
	}

	// No view box is a viewport with no size -- a map in a hidden tab. Nothing
	// is measurable there, so nothing is culled either.
	if (scan.hide === null || scan.show === null) return;

	for (let i = 0; i < count; i++) {
		if (scan.offscreen(i) || scan.keep(i)) continue;
		if (overlaps(scan.boxes[i], scan.hide)) continue;
		if (plan.show.length + plan.hide.length >= scan.budget) plan.backlog++;
		else plan.hide.push(i);
	}
}

/**
 * Is the connector between two anchors worth drawing?
 *
 * The curve is a cubic bezier whose control points share their x range with the
 * two anchors and take their y from one anchor or the other, so the anchors'
 * own bounding box contains the whole curve. That makes this test exact rather
 * than a conservative approximation -- no curve is ever clipped early.
 */
export function edgeInView(
	px: number,
	py: number,
	cx: number,
	cy: number,
	pad: number,
	view: ViewBox,
): boolean {
	return (
		Math.min(px, cx) - pad < view.right &&
		Math.max(px, cx) + pad > view.left &&
		Math.min(py, cy) - pad < view.bottom &&
		Math.max(py, cy) + pad > view.top
	);
}
