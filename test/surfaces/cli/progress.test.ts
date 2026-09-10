import { describe, expect, it, vi } from "vitest";
import { createProgressReporter, formatProgressLine } from "../../../src/surfaces/cli/progress.js";

describe("formatProgressLine", () => {
	it("renders each AI step as a stable one-line status", () => {
		expect(formatProgressLine({ step: "planning" })).toBe("⠋ Planning search…");
		expect(formatProgressLine({ step: "plan-decided", queries: ["a", "b"] })).toBe(
			"✓ Plan: 2 searches",
		);
		expect(formatProgressLine({ step: "searching", index: 1, total: 2, query: "a" })).toBe(
			'⠋ Searching (1/2): "a"…',
		);
		expect(
			formatProgressLine({
				step: "searched",
				index: 1,
				total: 2,
				query: "a",
				sessionId: "session-a",
				resultCount: 3,
			}),
		).toBe('✓ Searched (1/2): "a" — 3 results');
		expect(formatProgressLine({ step: "synthesizing" })).toBe("⠋ Synthesizing answer…");
		expect(formatProgressLine({ step: "done", sessionCount: 2, resultCount: 6 })).toBe(
			"✓ Done: 2 sessions, 6 results",
		);
	});
});

describe("createProgressReporter", () => {
	it("writes lines to stderr only when stderr is a TTY", () => {
		const write = vi.fn();
		const reporter = createProgressReporter({ stderr: { isTTY: true, write } });
		reporter.report({ step: "planning" });
		expect(write).toHaveBeenCalledTimes(1);
		expect(write.mock.calls[0][0]).toContain("Planning search");
	});

	it("stays silent when stderr is piped", () => {
		const write = vi.fn();
		const reporter = createProgressReporter({ stderr: { isTTY: false, write } });
		reporter.report({ step: "planning" });
		expect(write).not.toHaveBeenCalled();
	});

	it("stays silent for --json output even on a TTY", () => {
		const write = vi.fn();
		const reporter = createProgressReporter({ stderr: { isTTY: true, write }, json: true });
		reporter.report({ step: "planning" });
		expect(write).not.toHaveBeenCalled();
	});
});
