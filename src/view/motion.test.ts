import { test } from "node:test";
import assert from "node:assert/strict";

import { MotionFlag, SETTLE_MS } from "./motion.ts";
import type { Timers } from "./motion.ts";

/** A clock that only moves when a test says so. */
class FakeTimers implements Timers {
	private next = 1;
	private now = 0;
	private readonly pending = new Map<number, { at: number; run: () => void }>();

	setTimeout(handler: () => void, timeout: number): number {
		const handle = this.next++;
		this.pending.set(handle, { at: this.now + timeout, run: handler });
		return handle;
	}

	clearTimeout(handle: number): void {
		this.pending.delete(handle);
	}

	/** How many timers are still armed. */
	get armed(): number {
		return this.pending.size;
	}

	advance(ms: number): void {
		this.now += ms;
		for (const [handle, timer] of [...this.pending]) {
			if (timer.at > this.now) continue;
			this.pending.delete(handle);
			timer.run();
		}
	}
}

/** A flag and the log of what it reported, in order. */
const flag = (): { flag: MotionFlag; clock: FakeTimers; reports: boolean[] } => {
	const clock = new FakeTimers();
	const reports: boolean[] = [];
	return { flag: new MotionFlag((moving) => reports.push(moving), SETTLE_MS, clock), clock, reports };
};

test("a flag starts down and reports nothing", () => {
	const { flag: motion, reports } = flag();
	assert.equal(motion.moving, false);
	assert.deepEqual(reports, []);
});

test("the first touch raises it and says so once", () => {
	const { flag: motion, reports } = flag();
	motion.touch();
	assert.equal(motion.moving, true);
	assert.deepEqual(reports, [true]);
});

test("touches inside the interval keep it up without reporting again", () => {
	const { flag: motion, clock, reports } = flag();
	// A pan: a touch every frame for well past one settle interval.
	for (let frame = 0; frame < 30; frame++) {
		motion.touch();
		clock.advance(16);
	}
	assert.equal(motion.moving, true);
	assert.deepEqual(reports, [true]);
});

test("it drops once the camera has been idle for the interval", () => {
	const { flag: motion, clock, reports } = flag();
	motion.touch();
	clock.advance(SETTLE_MS - 1);
	assert.equal(motion.moving, true, "one millisecond short is still moving");
	clock.advance(1);
	assert.equal(motion.moving, false);
	assert.deepEqual(reports, [true, false]);
});

test("the countdown restarts from the last touch, not the first", () => {
	const { flag: motion, clock } = flag();
	motion.touch();
	clock.advance(SETTLE_MS - 10);
	motion.touch();
	clock.advance(SETTLE_MS - 10);
	assert.equal(motion.moving, true, "the second touch bought another full interval");
	clock.advance(10);
	assert.equal(motion.moving, false);
});

test("a touch after settling raises it again", () => {
	const { flag: motion, clock, reports } = flag();
	motion.touch();
	clock.advance(SETTLE_MS);
	motion.touch();
	assert.equal(motion.moving, true);
	clock.advance(SETTLE_MS);
	assert.deepEqual(reports, [true, false, true, false]);
});

test("stop leaves no timer armed, so nothing fires at a detached element", () => {
	const { flag: motion, clock, reports } = flag();
	motion.touch();
	motion.stop();
	assert.equal(motion.moving, false);
	assert.equal(clock.armed, 0);
	clock.advance(SETTLE_MS * 10);
	assert.deepEqual(reports, [true], "teardown reports nothing of its own");
});

test("stop on a flag that never moved is a no-op", () => {
	const { flag: motion, clock, reports } = flag();
	motion.stop();
	assert.equal(clock.armed, 0);
	clock.advance(SETTLE_MS);
	assert.deepEqual(reports, []);
});
