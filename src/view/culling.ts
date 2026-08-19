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
