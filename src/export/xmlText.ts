/**
 * Note text on its way into an XML document.
 *
 * Split out of the serializer so the rule can be checked without a DOM: this
 * module imports nothing and touches nothing.
 */

/**
 * The code points XML 1.0 has no way to spell, as inclusive ranges.
 *
 * The C0 controls, and the two noncharacters at the end of the BMP. A note can
 * hold any of them, and one reaching `XMLSerializer` produces a document the
 * browser then refuses to parse -- which is the SVG and the PNG failing over a
 * character nobody can see. Tab, newline and carriage return are legal and are
 * not in the list.
 */
const ILLEGAL_RANGES: ReadonlyArray<readonly [number, number]> = [
	[0x00, 0x08],
	[0x0b, 0x0c],
	[0x0e, 0x1f],
	[0xfffe, 0xffff],
];

/** `\uXXXX` -- the six characters a regular expression reads as one escape. */
function escaped(code: number): string {
	return `\\u${code.toString(16).padStart(4, "0")}`;
}

/**
 * Assembled from the ranges rather than written out as a literal, so the source
 * of a file about control characters contains none of them.
 */
const ILLEGAL_XML = new RegExp(
	`[${ILLEGAL_RANGES.map(([from, to]) => `${escaped(from)}-${escaped(to)}`).join("")}]`,
	"g",
);

/** The same text, with everything XML cannot carry taken out. */
export function stripIllegalXml(text: string): string {
	return text.replace(ILLEGAL_XML, "");
}
