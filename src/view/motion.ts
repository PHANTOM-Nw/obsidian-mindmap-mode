/**
 * "The camera is moving", as a flag that falls back down on its own.
 *
 * Zero imports, exactly like `culling.ts` and `mathSyntax.ts` and for the same
 * reason: `npm test` runs the sources straight through Node with no bundler, so
 * anything a test can reach has to stay clear of `obsidian`. The timers come in
 * through the constructor for the second half of that -- a test drives them by
 * hand rather than waiting out a real delay.
 *
 * What it is for is spelled out beside the rule it drives in `styles.css`:
 * `will-change: transform` has to be on `.mm-content` while it moves and off it
 * again once it stops, and "stops" is not an event anything reports. A camera
 * move is a stream of `Canvas.apply` calls that simply dries up -- the last pan
 * frame, the last wheel notch, a framing jump that lands -- so rest is only ever
 * "nothing has moved for a while", which is exactly what this measures.
 */

/** Just enough of `window` to arm and cancel a timer. */
export interface Timers {
	setTimeout(handler: () => void, timeout: number): number;
	clearTimeout(handle: number): void;
}

/**
 * How long the camera has to sit still before it counts as settled.
 *
 * Long enough to ride out the gap between two wheel notches, short enough that
 * the re-raster it triggers reads as part of the zoom rather than as a delayed
 * flicker of its own.
 */
export const SETTLE_MS = 180;

/** A flag that a touch raises and idleness lowers. */
export class MotionFlag {
	private readonly onChange: (moving: boolean) => void;
	private readonly delay: number;
	private readonly timers: Timers;
	private handle = 0;
	private raised = false;

	constructor(onChange: (moving: boolean) => void, delay: number, timers: Timers) {
		this.onChange = onChange;
		this.delay = delay;
		this.timers = timers;
	}

	get moving(): boolean {
		return this.raised;
	}

	/**
	 * The camera moved. Raises the flag if it was down and restarts the idle
	 * countdown either way, so a gesture that keeps calling this keeps it up.
	 */
	touch(): void {
		if (this.handle !== 0) this.timers.clearTimeout(this.handle);
		this.handle = this.timers.setTimeout(() => {
			this.handle = 0;
			this.raised = false;
			this.onChange(false);
		}, this.delay);
		if (this.raised) return;
		this.raised = true;
		this.onChange(true);
	}

	/**
	 * Teardown. Cancels the countdown without reporting anything: the point is
	 * that no timer is left to fire at an element that has been taken out of the
	 * document.
	 */
	stop(): void {
		if (this.handle !== 0) this.timers.clearTimeout(this.handle);
		this.handle = 0;
		this.raised = false;
	}
}
