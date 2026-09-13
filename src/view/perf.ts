/**
 * Opt-in timing for the render path.
 *
 * Zero imports, exactly like `culling.ts` and `motion.ts` and for the same
 * reason: `npm test` runs the sources straight through Node with no bundler, so
 * anything a test can reach has to stay clear of `obsidian`. The browser's
 * `performance` and `console` come in through a host object for the second half
 * of that -- a test reads back what would have been recorded instead of
 * scraping DevTools.
 *
 * Everything lands twice: a `performance.measure` (or `mark`) under the
 * `mindmap:` prefix, which is what puts it in the Timings track, and one
 * `console.debug` line carrying the numbers, which is what makes it readable
 * without opening a profile.
 *
 * Off is the default, and off costs one boolean branch per call site.
 */

/** Whatever a call site wants to say about the work it just did. */
export type PerfDetail = Record<string, unknown>;

export const PERF_PREFIX = "mindmap:";

/** Just enough of `performance` and `console` to record one timing. */
export interface PerfHost {
	now(): number;
	mark(name: string, detail: PerfDetail): void;
	measure(name: string, start: number, end: number): void;
	debug(detail: PerfDetail): void;
}

/**
 * The real one. Instrumentation must never be the reason a paint fails, so a
 * host that throws -- an exotic runtime, a disabled buffer -- is swallowed.
 */
export function browserHost(): PerfHost {
	return {
		now: () => performance.now(),
		mark: (name, detail) => {
			try {
				performance.mark(name, { detail });
			} catch {
				/* timing is never worth a broken frame */
			}
		},
		measure: (name, start, end) => {
			try {
				performance.measure(name, { start, end });
			} catch {
				/* as above */
			}
		},
		debug: (detail) => console.debug("Mindmap Mode perf", detail),
	};
}

/** A timing log that reports nothing until it is switched on. */
export class Perf {
	enabled = false;

	private readonly host: PerfHost;

	constructor(host: PerfHost = browserHost()) {
		this.host = host;
	}

	/**
	 * When a span started, or 0 when the log is off.
	 *
	 * The one call a disabled log still makes, which is why it is a branch and a
	 * constant rather than a clock read.
	 */
	now(): number {
		return this.enabled ? this.host.now() : 0;
	}

	/** A stretch of work that started at `start`, as a `performance.measure`. */
	span(name: string, start: number, detail: PerfDetail = {}): void {
		if (!this.enabled) return;
		const end = this.host.now();
		this.host.measure(`${PERF_PREFIX}${name}`, start, end);
		this.host.debug({ name, ms: round(end - start), ...detail });
	}

	/** Something that happened, with no duration, as a `performance.mark`. */
	event(name: string, detail: PerfDetail = {}): void {
		if (!this.enabled) return;
		this.host.mark(`${PERF_PREFIX}${name}`, detail);
		this.host.debug({ name, ...detail });
	}
}

/** Milliseconds are read by a human, not compared by a machine. */
function round(ms: number): number {
	return Math.round(ms * 100) / 100;
}
