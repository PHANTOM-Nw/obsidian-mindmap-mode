/**
 * One render per formula, and a copy for every use of it.
 *
 * Zero imports, exactly like `culling.ts`, `motion.ts` and `perf.ts` and for the
 * same reason: `npm test` runs the sources straight through Node with no
 * bundler, so anything a test can reach has to stay clear of `obsidian`. The
 * rendering and the copying are passed in, which is what keeps MathJax and the
 * DOM on the other side of this file.
 */

/**
 * How many formulas are kept.
 *
 * A dense map is a few hundred; past that the entries at the front are ones the
 * note stopped asking for, and a formula dropped by mistake costs exactly one
 * render to get back.
 */
export const MATH_CACHE_LIMIT = 512;

/**
 * The same TeX renders differently in the two delimiters, so the mode is part of
 * the key. The prefix is the delimiter itself, which no source can start with:
 * `$$x$$` inside `$…$` is not a formula, it is the empty one.
 */
export function mathKey(source: string, display: boolean): string {
	return display ? `$$${source}` : `$${source}`;
}

export class MathCache<T> {
	private readonly entries = new Map<string, T>();
	private readonly limit: number;

	constructor(limit: number = MATH_CACHE_LIMIT) {
		this.limit = Math.max(1, limit);
	}

	get size(): number {
		return this.entries.size;
	}

	/**
	 * A copy of `source` rendered, rendering it only the first time it is asked
	 * for.
	 *
	 * Always a copy, never the stored render: the one in the cache is never in
	 * the document, so nothing that happens to a map can reach it.
	 *
	 * `render` may throw -- malformed TeX does -- and nothing is stored when it
	 * does, so a source that fails goes on failing rather than being remembered
	 * as an empty formula.
	 */
	take(
		source: string,
		display: boolean,
		render: (source: string, display: boolean) => T,
		copy: (value: T) => T,
	): T {
		const key = mathKey(source, display);
		const found = this.entries.get(key);
		if (found !== undefined) {
			// Re-inserted, so the map's own order is least-recently-used: what a
			// note keeps asking for is what survives the bound.
			this.entries.delete(key);
			this.entries.set(key, found);
			return copy(found);
		}

		const made = render(source, display);
		this.entries.set(key, made);
		if (this.entries.size > this.limit) {
			const oldest = this.entries.keys().next();
			if (!oldest.done) this.entries.delete(oldest.value);
		}
		return copy(made);
	}

	clear(): void {
		this.entries.clear();
	}
}
