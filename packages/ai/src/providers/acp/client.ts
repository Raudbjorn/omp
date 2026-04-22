import type * as schema from "@agentclientprotocol/sdk";
import type { Client } from "@agentclientprotocol/sdk";
import { readTextFile, writeTextFile } from "./fs-proxy";
import type { makePermissionPolicy } from "./permissions";

export interface ClientHandlerOptions {
	workspaceRoot: string;
	permissionPolicy: ReturnType<typeof makePermissionPolicy>;
	onSessionUpdate: (notif: schema.SessionNotification) => void | Promise<void>;
}

/**
 * Build an ACP `Client` implementation that wires:
 *   - fs/read_text_file   → fs-proxy.readTextFile
 *   - fs/write_text_file  → fs-proxy.writeTextFile
 *   - session/request_permission → permission policy
 *   - session/update notifications → caller's callback (usually an EventMapper)
 *
 * No terminal support: the capability is NOT advertised, so the agent should
 * not ask. If it does, the request surfaces as an `extMethod` and we reject.
 */
export function makeClientHandler(opts: ClientHandlerOptions): Client {
	return {
		async sessionUpdate(params: schema.SessionNotification): Promise<void> {
			await opts.onSessionUpdate(params);
		},
		async requestPermission(
			req: schema.RequestPermissionRequest,
		): Promise<schema.RequestPermissionResponse> {
			return opts.permissionPolicy(req);
		},
		async readTextFile(req: schema.ReadTextFileRequest): Promise<schema.ReadTextFileResponse> {
			return readTextFile(opts.workspaceRoot, req);
		},
		async writeTextFile(req: schema.WriteTextFileRequest): Promise<schema.WriteTextFileResponse> {
			return writeTextFile(opts.workspaceRoot, req);
		},
	};
}
