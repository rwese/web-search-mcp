/**
 * Interactive CLI progress for long runs (the AI answer loop, raw search).
 *
 * TTY-gated stderr only: silent when piped or under `--json` so stdout
 * stays machine-readable. One stable line per step — no spinners that
 * rewrite the terminal, no stdout pollution.
 */
import type { ProgressEvent } from "../../ai/agent.js";

export type ProgressStderr = {
	isTTY?: boolean;
	write(message: string): void;
};

export type ProgressReporterOptions = {
	stderr?: ProgressStderr;
	json?: boolean;
};

/** Render one progress event as a single human-readable status line. */
export function formatProgressLine(event: ProgressEvent): string {
	switch (event.step) {
		case "planning":
			return "⠋ Planning search…";
		case "plan-decided":
			return `✓ Plan: ${event.queries.length} search${event.queries.length === 1 ? "" : "es"}`;
		case "searching":
			return `⠋ Searching (${event.index}/${event.total}): ${JSON.stringify(event.query)}…`;
		case "searched":
			return `✓ Searched (${event.index}/${event.total}): ${JSON.stringify(event.query)} — ${event.resultCount} result${event.resultCount === 1 ? "" : "s"}`;
		case "synthesizing":
			return "⠋ Synthesizing answer…";
		case "done":
			return `✓ Done: ${event.sessionCount} session${event.sessionCount === 1 ? "" : "s"}, ${event.resultCount} result${event.resultCount === 1 ? "" : "s"}`;
	}
}

export type ProgressReporter = {
	report(event: ProgressEvent): void;
};

/** Create a reporter; `report` no-ops unless stderr is a TTY and output is human-readable. */
export function createProgressReporter(opts: ProgressReporterOptions = {}): ProgressReporter {
	const stderr = opts.stderr ?? process.stderr;
	const enabled = stderr.isTTY === true && opts.json !== true;
	return {
		report(event: ProgressEvent): void {
			if (!enabled) return;
			stderr.write(`${formatProgressLine(event)}\n`);
		},
	};
}
