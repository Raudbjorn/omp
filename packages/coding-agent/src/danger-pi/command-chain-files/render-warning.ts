export type CommandFileProblem =
	| {
			kind: "file";
			commandName: string;
			filePath: string;
			messages: string[];
	  }
	| {
			kind: "duplicate";
			commandName: string;
			filePaths: string[];
			winnerPath: string;
	  };

function renderProblem(problem: CommandFileProblem): string[] {
	if (problem.kind === "duplicate") {
		return [
			"  - duplicate command files in same directory:",
			...problem.filePaths.map(filePath => `    - ${filePath}`),
			`    - using ${problem.winnerPath}`,
		];
	}

	return [`  - ${problem.filePath}`, ...problem.messages.map(message => `    - ${message}`)];
}

export function renderCommandFileProblemBody(problems: readonly CommandFileProblem[]): string {
	const grouped = new Map<string, CommandFileProblem[]>();
	for (const problem of problems) {
		const existing = grouped.get(problem.commandName);
		if (existing) {
			existing.push(problem);
			continue;
		}
		grouped.set(problem.commandName, [problem]);
	}

	const sections: string[] = [];
	for (const [commandName, commandProblems] of grouped) {
		sections.push(commandName);
		for (const problem of commandProblems) {
			sections.push(...renderProblem(problem));
		}
	}

	return sections.join("\n");
}

export function renderCommandFileWarning(problems: readonly CommandFileProblem[]): string {
	const body = renderCommandFileProblemBody(problems);
	if (!body) {
		return "Command file errors:";
	}
	return `Command file errors:\n\n${body}`;
}
