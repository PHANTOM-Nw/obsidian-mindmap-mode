import { test } from "node:test";
import assert from "node:assert/strict";

import { Frame } from "./frame.ts";
import type { Frames } from "./frame.ts";

/** Frames that only arrive when a test says so. */
class FakeFrames implements Frames {
	private next = 1;
	private readonly pending = new Map<number, () => void>();

	requestAnimationFrame(callback: () => void): number {
		const handle = this.next++;
		this.pending.set(handle, callback);
		return handle;
	}

	cancelAnimationFrame(handle: number): void {
		this.pending.delete(handle);
	}

	/** How many frames are armed. */
	get armed(): number {
		return this.pending.size;
	}

	/** How many were ever asked for, cancelled ones included. */
	get requested(): number {
		return this.next - 1;
	}

	/** Paint: run everything armed now, once. */
	run(): void {
		for (const [handle, callback] of [...this.pending]) {
			this.pending.delete(handle);
			callback();
		}
	}
}

const frame = (): { frame: Frame; frames: FakeFrames; runs: string[] } => {
	const frames = new FakeFrames();
	return { frame: new Frame(frames), frames, runs: [] };
};

test("a fresh frame is not pending and has asked for nothing", () => {
	const { frame: f, frames } = frame();
	assert.equal(f.pending, false);
	assert.equal(frames.requested, 0);
});

test("a request schedules, and does not act", () => {
	// The whole point of the type: `MindmapView.onResize` runs inside Obsidian's
	// ResizeObserver callback, and work that happens there is work that changes
	// the layout the observer is reporting on.
	const { frame: f, frames, runs } = frame();
	f.request(() => runs.push("work"));
	assert.deepEqual(runs, []);
	assert.equal(f.pending, true);

	frames.run();
	assert.deepEqual(runs, ["work"]);
	assert.equal(f.pending, false);
});

test("a burst of requests costs one frame and one run", () => {
	const { frame: f, frames, runs } = frame();
	for (let i = 0; i < 20; i++) f.request(() => runs.push("work"));
	assert.equal(frames.requested, 1);

	frames.run();
	assert.deepEqual(runs, ["work"]);
});

test("the last request is the one that runs", () => {
	const { frame: f, frames, runs } = frame();
	f.request(() => runs.push("first"));
	f.request(() => runs.push("second"));
	frames.run();
	assert.deepEqual(runs, ["second"]);
});

test("work may ask for another frame", () => {
	// The cull's continuation: a frame that ran out of budget leaves the rest to
	// the next one.
	const { frame: f, frames, runs } = frame();
	let left = 2;
	const work = (): void => {
		runs.push("work");
		if (--left > 0) f.request(work);
	};
	f.request(work);

	frames.run();
	assert.deepEqual(runs, ["work"]);
	assert.equal(f.pending, true);

	frames.run();
	assert.deepEqual(runs, ["work", "work"]);
	assert.equal(f.pending, false);
});

test("cancel leaves nothing armed and nothing to run", () => {
	const { frame: f, frames, runs } = frame();
	f.request(() => runs.push("work"));
	f.cancel();
	assert.equal(f.pending, false);
	assert.equal(frames.armed, 0);

	frames.run();
	assert.deepEqual(runs, []);
});

test("cancelling nothing is harmless, and a frame can be reused after it", () => {
	const { frame: f, frames, runs } = frame();
	f.cancel();
	f.cancel();
	assert.equal(frames.requested, 0);

	f.request(() => runs.push("work"));
	frames.run();
	assert.deepEqual(runs, ["work"]);
});
