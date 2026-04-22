import type { AcpConfig } from "../stream";

export type AuthStatus =
	| { kind: "missing"; hint: string }
	| { kind: "logged_out"; hint: string }
	| { kind: "logged_in_oauth"; mtime: Date }
	| { kind: "logged_in_api_key" };

export interface CliAdapter {
	readonly id: string;
	readonly displayName: string;
	readonly binary: string;
	readonly installHint: string;
	readonly loginCommand: readonly string[];

	probeAuth(env: NodeJS.ProcessEnv): Promise<AuthStatus>;
	spawnArgs(config: AcpConfig): readonly string[];
	extraEnv(config: AcpConfig): Readonly<Record<string, string>>;
}
