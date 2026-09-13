/**
 * The two document wrappers an exported map is poured into.
 *
 * Both take the map already serialized as an XHTML fragment -- that part needs
 * the DOM and lives in `snapshot.ts` -- and are otherwise pure string work, so
 * the shape of what gets written to the vault is testable on its own.
 */

export interface DocumentOptions {
	/** The map, serialized as a well-formed XHTML fragment. */
	body: string;
	width: number;
	height: number;
	/** What sits behind the map, as a CSS colour. */
	background: string;
	/** The note's basename. */
	title: string;
}

/**
 * Both files are parsed as XML or served as markup, so every one of these has
 * to go in escaped -- including the apostrophe, which an XML parser accepts by
 * name but a single-quoted attribute would end early.
 */
export function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/**
 * A CSS colour, or white.
 *
 * The value comes from `getComputedStyle`, so in practice it is always an
 * `rgb(...)`. It is still checked rather than trusted: it is written into a
 * `<style>` block, where the one thing that must not get through is anything
 * that could close it.
 */
function cssColor(value: string): string {
	return /^[#a-zA-Z0-9(),.%\s/-]+$/.test(value) ? value.trim() : "#ffffff";
}

/**
 * The `.svg` file: a background rect, then the map itself inside a
 * `<foreignObject>`.
 *
 * The fragment declares the XHTML namespace on its own root, which is what
 * makes it legal content for a `<foreignObject>` in an XML document.
 */
export function svgDocument(opts: DocumentOptions): string {
	const { width, height } = opts;
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
		`viewBox="0 0 ${width} ${height}">` +
		`<title>${escapeXml(opts.title)}</title>` +
		`<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(cssColor(opts.background))}"/>` +
		`<foreignObject x="0" y="0" width="${width}" height="${height}">${opts.body}</foreignObject>` +
		`</svg>`
	);
}

/** The `.html` file: the same fragment, in a static page with no scripts. */
export function htmlDocument(opts: DocumentOptions): string {
	return [
		"<!doctype html>",
		'<html lang="en">',
		"<head>",
		'<meta charset="utf-8"/>',
		'<meta name="viewport" content="width=device-width, initial-scale=1"/>',
		`<title>${escapeXml(opts.title)}</title>`,
		"<style>",
		`body { margin: 0; background: ${cssColor(opts.background)}; }`,
		`.mm-export { width: ${opts.width}px; height: ${opts.height}px; }`,
		"</style>",
		"</head>",
		"<body>",
		opts.body,
		"</body>",
		"</html>",
		"",
	].join("\n");
}
