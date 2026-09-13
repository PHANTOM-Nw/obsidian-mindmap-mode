/**
 * The SVG document, drawn into a bitmap.
 *
 * The image is loaded from a `data:` URL rather than a blob URL: a blob URL is
 * revoked on the same document that made it, and an `<img>` that has not
 * finished decoding when that happens fails silently.
 *
 * Known limitation, and not one this solves: an SVG loaded through an `<img>`
 * is rendered with no access to anything outside itself. Nothing the fragment
 * references by URL is fetched -- an `<img>` in a note's content, and the
 * theme's web fonts, which is why text in the PNG falls back to the fonts the
 * system already has. Everything else is inline and comes through as drawn.
 */

/** Rendered at twice the layout size, so the text survives being zoomed into. */
export const PNG_SCALE = 2;

/** Chromium refuses a canvas with a side longer than this. */
export const MAX_CANVAS_PX = 16384;

export interface RasterResult {
	data: ArrayBuffer;
	/** True when the map was too big for 2x and had to be drawn smaller. */
	clamped: boolean;
}

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("The map could not be rendered as an image."));
		image.src = src;
	});
}

export async function rasterize(
	svg: string,
	width: number,
	height: number,
): Promise<RasterResult> {
	const scale = Math.min(PNG_SCALE, MAX_CANVAS_PX / width, MAX_CANVAS_PX / height);
	const canvas = createEl("canvas");
	canvas.width = Math.max(1, Math.floor(width * scale));
	canvas.height = Math.max(1, Math.floor(height * scale));

	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("This platform has no 2D canvas to draw on.");

	// The fragment names the fonts it was drawn with; the ones that are actually
	// available have to be ready before anything is measured against them.
	await document.fonts.ready;

	const image = await loadImage(
		`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
	);
	ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, "image/png"),
	);
	if (!blob) throw new Error("The image could not be encoded as a PNG.");

	return { data: await blob.arrayBuffer(), clamped: scale < PNG_SCALE };
}
