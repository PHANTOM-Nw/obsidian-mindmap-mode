import { finishRenderMath, loadMathJax, renderMath } from "obsidian";

/**
 * MathJax, borrowed from Obsidian.
 *
 * This is the one place in the map where a DOM node arrives that `createEl` did
 * not build, so it is worth saying why the rule at the top of `nodes.ts` still
 * holds: the note's text is handed to `renderMath` as a TeX *source string* and
 * parsed by MathJax's TeX tokenizer. It is never treated as markup, and there
 * is no `innerHTML` path from note content to the map. The exposure is exactly
 * Obsidian's own when it renders the same note.
 *
 * Timing is the other reason this module exists. Once `loadMathJax()` has
 * resolved, `renderMath()` is synchronous -- a paint can render and measure in
 * the same tick. Only three things are async: the initial load, the stylesheet
 * flush, and the web fonts. All three are settled once here, at boot.
 */

let settled = false;
let available = false;
let booting: Promise<void> | null = null;

/** True once boot has finished, whether or not MathJax came up. */
export function mathSettled(): boolean {
	return settled;
}

export function mathAvailable(): boolean {
	return available;
}

/**
 * Load MathJax, flush its stylesheet and wait for its fonts. Idempotent: the
 * first call owns the work, every later call gets the same promise back.
 */
export function ensureMath(): Promise<void> {
	if (booting) return booting;
	booting = boot();
	return booting;
}

async function boot(): Promise<void> {
	let probe: HTMLElement | null = null;
	try {
		await loadMathJax();

		// MathJax only fetches the web fonts for glyphs it has actually laid
		// out, and it only emits its CHTML stylesheet when asked. Render one
		// throwaway formula in the document so both have something to react to;
		// without this the first real map measures every formula in fallback
		// metrics and lays out around the wrong widths.
		probe = document.body.createDiv({
			cls: "mm-math-probe",
			attr: { "aria-hidden": "true" },
		});
		probe.appendChild(renderMath("x", false));
		await finishRenderMath();
		await document.fonts.ready;

		available = true;
	} catch (error) {
		console.error("Mindmap Mode: MathJax is unavailable, formulas will stay as text.", error);
		available = false;
	} finally {
		probe?.remove();
		// Set unconditionally. This flag is what stops the view from scheduling
		// another rebuild, so a failed load must settle just like a good one.
		settled = true;
	}
}

/**
 * Append one formula, or its source text when that is not possible.
 *
 * The fallback covers both "MathJax has not booted yet" and "MathJax is never
 * coming", so a map always paints something readable.
 */
export function renderMathInto(el: HTMLElement, source: string, display: boolean): void {
	const raw = display ? `$$${source}$$` : `$${source}$`;
	if (!available) {
		el.createSpan({ cls: "mm-math-raw", text: raw });
		return;
	}

	const span = el.createSpan({ cls: display ? "mm-math is-display" : "mm-math" });
	try {
		span.appendChild(renderMath(source, display));
	} catch (error) {
		// MathJax throws on malformed TeX. Uncaught, that would escape
		// buildNodeElement and blank the entire map over one typo in one node.
		console.error("Mindmap Mode: could not render", raw, error);
		span.empty();
		span.addClass("mm-math-error");
		span.setText(raw);
	}
}

export { finishRenderMath };
