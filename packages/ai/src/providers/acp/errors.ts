export type AcpErrorCode =
	| "binary_missing"
	| "auth_required"
	| "handshake_timeout"
	| "session_new_timeout"
	| "prompt_timeout"
	| "invalid_json_line"
	| "fs_escape"
	| "fs_too_large"
	| "permission_denied"
	| "child_exit_unexpected"
	| "refusal"
	| "not_implemented";

export interface AcpErrorDetails {
	/** Optional install/login hint to surface to the user. */
	hint?: string;
	/** Extra context (path, stderr tail, etc.). */
	context?: Record<string, unknown>;
}

export class AcpError extends Error {
	readonly code: AcpErrorCode;
	readonly details: AcpErrorDetails;

	constructor(code: AcpErrorCode, message: string, details: AcpErrorDetails = {}) {
		super(message);
		this.name = "AcpError";
		this.code = code;
		this.details = details;
	}
}
