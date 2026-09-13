import { finishRenderMath, loadMathJax, renderMath } from "obsidian";

import { MathCache } from "./mathCache.ts";

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
 * flush, and the web fonts. All three are settled once here, at boot. Until they
 * are, a formula is painted as its own source and upgraded in place afterwards,
 * so the wait costs a map one measurement and never a second build.
 *
 * Cost is the third. A render is a TeX parse and a CHTML build, so every
 * distinct formula is rendered once and cloned from there.
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
		// Set unconditionally. This flag is what stops the view from waiting on
		// MathJax again, so a failed load must settle just like a good one.
		settled = true;
	}
}

/**
 * One render per distinct formula, kept for as long as the map is showing the
 * same note.
 *
 * `renderMath` is a TeX parse and a CHTML build, and on a map of formulas it is
 * most of what a paint costs: the same note builds in 13 ms with MathJax still
 * booting and in 264 ms with it up. Nothing about the output depends on where it
 * is drawn -- CHTML is static DOM over a stylesheet MathJax keeps in the
 * document -- so a deep clone of an earlier render is the same formula, at the
 * price of a DOM copy rather than a parse.
 */
const cache = new MathCache<HTMLElement>();

/** Throw the typeset formulas away: a different note, or different settings. */
export function clearMathCache(): void {
	cache.clear();
}

/** A formula the map is showing as its own source until MathJax comes up. */
interface PendingMath {
	span: HTMLElement;
	source: string;
	display: boolean;
}

let pending: PendingMath[] = [];

/**
 * Forget the placeholders of a paint that is being replaced.
 *
 * Called by the build, so the list only ever names cards that are on the map.
 */
export function resetPendingMath(): void {
	pending = [];
}

/**
 * Turn the placeholders the last build left into formulas, in place, and report
 * how many.
 *
 * This is what a map with formulas does instead of painting itself twice: the
 * cards, their sizes and the layout around them are all already right, and the
 * only thing the first paint could not do was typeset. Nothing here is rebuilt,
 * so the caller owes the map a measurement and nothing else.
 *
 * Zero means there is nothing to measure -- MathJax never came up, and the
 * source text on the cards is the final answer.
 */
export function upgradePendingMath(): number {
	const waiting = pending;
	pending = [];
	if (!available) return 0;
	for (const item of waiting) item.span.replaceWith(mathSpan(item.source, item.display));
	return waiting.length;
}

/**
 * Append one formula, or its source text when that is not possible.
 *
 * The fallback covers both "MathJax has not booted yet" and "MathJax is never
 * coming", so a map always paints something readable. Only the first of those is
 * worth coming back to, and `upgradePendingMath` is what comes back.
 */
export function renderMathInto(el: HTMLElement, source: string, display: boolean): void {
	if (!available) {
		const span = el.createSpan({ cls: "mm-math-raw", text: rawOf(source, display) });
		if (!settled) pending.push({ span, source, display });
		return;
	}
	el.appendChild(mathSpan(source, display));
}

/** One formula, detached, ready to be appended or to replace a placeholder. */
function mathSpan(source: string, display: boolean): HTMLElement {
	const span = createSpan({ cls: display ? "mm-math is-display" : "mm-math" });
	try {
		span.appendChild(cache.take(source, display, renderMath, deepCopy));
	} catch (error) {
		// MathJax throws on malformed TeX. Uncaught, that would escape
		// buildNodeElement and blank the entire map over one typo in one node.
		console.error("Mindmap Mode: could not render", rawOf(source, display), error);
		span.empty();
		span.addClass("mm-math-error");
		span.setText(rawOf(source, display));
	}
	return span;
}

function deepCopy(el: HTMLElement): HTMLElement {
	return el.cloneNode(true) as HTMLElement;
}

function rawOf(source: string, display: boolean): string {
	return display ? `$$${source}$$` : `$${source}$`;
}

export { finishRenderMath };
