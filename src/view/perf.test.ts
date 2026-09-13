import { test } from "node:test";
import assert from "node:assert/strict";

import { PERF_PREFIX, Perf } from "./perf.ts";
import type { PerfDetail, PerfHost } from "./perf.ts";

interface Recorded {
	marks: Array<{ name: string; detail: PerfDetail }>;
	measures: Array<{ name: string; start: number; end: number }>;
	lines: PerfDetail[];
	clock: number[];
}

/** A host that records instead of reporting, with a clock a test drives. */
const host = (): { host: PerfHost; log: Recorded } => {
	const log: Recorded = { marks: [], measures: [], lines: [], clock: [] };
	let now = 0;
	return {
		log,
		host: {
			now: () => {
				now += 10;
				log.clock.push(now);
				return now;
			},
			mark: (name, detail) => log.marks.push({ name, detail }),
			measure: (name, start, end) => log.measures.push({ name, start, end }),
			debug: (detail) => log.lines.push(detail),
		},
	};
};

test("a log that is off reports nothing and never reads the clock", () => {
	const { host: fake, log } = host();
	const perf = new Perf(fake);
	assert.equal(perf.now(), 0);
	perf.span("cull", 0, { total: 10 });
	perf.event("setViewData", { clear: true });
	assert.deepEqual(log, { marks: [], measures: [], lines: [], clock: [] });
});

test("a span becomes one prefixed measure and one console line", () => {
	const { host: fake, log } = host();
	const perf = new Perf(fake);
	perf.enabled = true;
	const start = perf.now();
	perf.span("cull", start, { total: 400, shown: 12 });

	assert.deepEqual(log.measures, [{ name: `${PERF_PREFIX}cull`, start: 10, end: 20 }]);
	assert.deepEqual(log.lines, [{ name: "cull", ms: 10, total: 400, shown: 12 }]);
	assert.deepEqual(log.marks, []);
});

test("an event becomes one prefixed mark, with no duration", () => {
	const { host: fake, log } = host();
	const perf = new Perf(fake);
	perf.enabled = true;
	perf.event("setViewData", { clear: false, skipped: true });

	assert.deepEqual(log.marks, [
		{ name: `${PERF_PREFIX}setViewData`, detail: { clear: false, skipped: true } },
	]);
	assert.deepEqual(log.lines, [{ name: "setViewData", clear: false, skipped: true }]);
	assert.deepEqual(log.measures, []);
});

test("a duration is rounded to something a human reads", () => {
	let now = 0;
	const lines: PerfDetail[] = [];
	const perf = new Perf({
		now: () => (now += 1 / 3),
		mark: () => {},
		measure: () => {},
		debug: (detail) => lines.push(detail),
	});
	perf.enabled = true;
	perf.span("paint", 0);
	assert.deepEqual(lines, [{ name: "paint", ms: 0.33 }]);
});

test("switching the log on and off again stops the reporting with it", () => {
	const { host: fake, log } = host();
	const perf = new Perf(fake);
	perf.enabled = true;
	perf.event("paint");
	perf.enabled = false;
	perf.event("paint");
	assert.equal(log.marks.length, 1);
});
