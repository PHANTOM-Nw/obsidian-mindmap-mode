/**
 * One animation frame handle, shared by everything the view defers to a frame.
 *
 * Zero imports, exactly like `culling.ts`, `motion.ts` and `perf.ts` and for the
 * same reason: `npm test` runs the sources straight through Node with no
 * bundler, so anything a test can reach has to stay clear of `obsidian`. The
 * frames come in through the constructor for the second half of that -- a test
 * runs them by hand rather than waiting for a browser to paint.
 *
 * What it is for is the rule that a pane resize may not touch the DOM. Obsidian
 * reports one from a `ResizeObserver`, and a resize callback that reads or
 * writes layout is a callback that changes the boxes the observer is in the
 * middle of reporting on: Chromium logs "ResizeObserver loop completed with
 * undelivered notifications", schedules another frame to deliver what it had to
 * drop, and the two feed each other for as long as the pane is open. Recording
 * the resize and acting on the next frame takes the view out of that loop -- the
 * work lands after the observer has finished, where a size change is just a size
 * change.
 *
 * Coalescing is the other half: a resize arrives many times a frame while a
 * split is dragged, and the map only has to be right once, on the frame that
 * gets painted.
 */

/** Just enough of `window` to arm and cancel one frame. */
export interface Frames {
	requestAnimationFrame(callback: () => void): number;
	cancelAnimationFrame(handle: number): void;
}

/** A single pending frame, and the work waiting on it. */
export class Frame {
	private readonly frames: Frames;
	private handle = 0;
	private work: (() => void) | null = null;

	constructor(frames: Frames) {
		this.frames = frames;
	}

	/** Is a frame armed? */
	get pending(): boolean {
		return this.handle !== 0;
	}

	/**
	 * Run this on the next frame.
	 *
	 * Never more than one frame at a time: asking again while one is armed
	 * replaces what it will do rather than arming a second. Callers ask for the
	 * same work every time, so the effect is that a burst of requests inside one
	 * frame costs exactly one run of it.
	 */
	request(work: () => void): void {
		this.work = work;
		if (this.handle !== 0) return;
		this.handle = this.frames.requestAnimationFrame(() => {
			// Cleared before the work runs, so work that asks for another frame
			// gets one instead of being swallowed as a duplicate.
			this.handle = 0;
			const run = this.work;
			this.work = null;
			run?.();
		});
	}

	/**
	 * Teardown, and the guard in front of work that supersedes what is waiting.
	 * Nothing may be left to fire at a map that has been repainted or closed.
	 */
	cancel(): void {
		if (this.handle !== 0) this.frames.cancelAnimationFrame(this.handle);
		this.handle = 0;
		this.work = null;
	}
}
