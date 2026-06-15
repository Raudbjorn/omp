import { executeShell } from "@oh-my-pi/pi-natives";
import { NON_INTERACTIVE_ENV } from "../exec/non-interactive-env";

const SHELL_INTERPOLATION_TIMEOUT_MS = 10_000;

/**
 * Input for the post-render shell interpolation pass.
 *
 * Callers keep ownership of source gating and body extraction. This helper only
 * expands shell expressions inside already-rendered body text.
 */
export interface ShellInterpolationOptions {
	/** Already-rendered body content to scan exactly once from left to right. */
	body: string;
	/** Session working directory used for every embedded command. */
	cwd: string;
	/** Human-readable source label for actionable failures, such as `/review` or `skill:triage`. */
	sourceLabel: string;
}

/**
 * Expand Claude-style single-line `!` shell expressions in rendered body text.
 *
 * The helper intentionally does one dumb pass: find `!\`` markers, require the
 * closing backtick on the same line, execute each command in order, and splice
 * stdout back into the original body without re-scanning replacement text.
 */
export async function interpolateShellExpressions(options: ShellInterpolationOptions): Promise<string> {
	const { body, cwd, sourceLabel } = options;
	const parts: string[] = [];
	let cursor = 0;

	for (;;) {
		const expressionStart = body.indexOf("!`", cursor);
		if (expressionStart === -1) {
			break;
		}

		parts.push(body.slice(cursor, expressionStart));

		const commandStart = expressionStart + 2;
		const lineEnd = body.indexOf("\n", commandStart);
		const expressionEnd = body.indexOf("`", commandStart);
		if (expressionEnd === -1 || (lineEnd !== -1 && expressionEnd > lineEnd)) {
			const malformedEnd = lineEnd === -1 ? body.length : lineEnd;
			const command = body.slice(commandStart, malformedEnd);
			throw new Error(
				`Malformed shell interpolation in ${sourceLabel} for command \`${command}\`: missing closing backtick before end of line`,
			);
		}

		const command = body.slice(commandStart, expressionEnd);
		parts.push(await executeInterpolatedCommand(command, { cwd, sourceLabel }));
		cursor = expressionEnd + 1;
	}

	parts.push(body.slice(cursor));
	return parts.join("");
}

async function executeInterpolatedCommand(
	command: string,
	context: { cwd: string; sourceLabel: string },
): Promise<string> {
	let output = "";

	try {
		const result = await executeShell(
			{
				command,
				cwd: context.cwd,
				env: getShellInterpolationEnv(),
				timeoutMs: SHELL_INTERPOLATION_TIMEOUT_MS,
			},
			(error, chunk) => {
				if (!error) {
					output += chunk;
				}
			},
		);

		if (result.timedOut) {
			throw new Error(
				`Shell interpolation failed in ${context.sourceLabel} for command \`${command}\`: command timed out after ${Math.round(SHELL_INTERPOLATION_TIMEOUT_MS / 1000)} seconds`,
			);
		}
		if (result.cancelled) {
			throw new Error(
				`Shell interpolation failed in ${context.sourceLabel} for command \`${command}\`: command was cancelled`,
			);
		}
		if (result.exitCode !== 0) {
			throw new Error(
				`Shell interpolation failed in ${context.sourceLabel} for command \`${command}\`: command exited with code ${result.exitCode}`,
			);
		}

		return trimSingleTrailingNewline(output);
	} catch (error) {
		if (error instanceof Error && error.message.includes(context.sourceLabel) && error.message.includes(command)) {
			throw error;
		}
		throw new Error(
			`Shell interpolation failed in ${context.sourceLabel} for command \`${command}\`: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	}
}

function getShellInterpolationEnv(): Record<string, string> {
	const inheritedEnv: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (typeof value === "string") {
			inheritedEnv[key] = value;
		}
	}
	return { ...inheritedEnv, ...NON_INTERACTIVE_ENV };
}

function trimSingleTrailingNewline(text: string): string {
	if (text.endsWith("\r\n")) {
		return text.slice(0, -2);
	}
	if (text.endsWith("\n")) {
		return text.slice(0, -1);
	}
	return text;
}
