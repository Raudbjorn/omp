import * as os from "node:os";
import type { WebTerminalBinding } from "../config/settings-schema";

export type WebTerminalBindingOption = {
	id: string;
	interface: string;
	ip: string;
	label: string;
	isLoopback: boolean;
	isInternal: boolean;
};

export type WebTerminalBindingError = {
	binding: WebTerminalBindingOption;
	error: string;
};

function isIpv4(family: string | number): boolean {
	return family === "IPv4" || family === 4;
}

function bindingId(binding: { interface: string; ip: string }): string {
	return `${binding.interface}:${binding.ip}`;
}

export function getWebTerminalBindingOptions(): WebTerminalBindingOption[] {
	const interfaces = os.networkInterfaces();
	const options: WebTerminalBindingOption[] = [];

	for (const [name, addresses] of Object.entries(interfaces)) {
		if (!addresses) continue;
		for (const address of addresses) {
			if (!isIpv4(address.family)) continue;
			const ip = address.address;
			const isLoopback = address.internal || ip.startsWith("127.");
			options.push({
				id: bindingId({ interface: name, ip }),
				interface: name,
				ip,
				label: `(${name}/${ip})`,
				isLoopback,
				isInternal: address.internal,
			});
		}
	}

	options.sort((a, b) => {
		if (a.isLoopback !== b.isLoopback) return a.isLoopback ? -1 : 1;
		const nameCompare = a.interface.localeCompare(b.interface);
		if (nameCompare !== 0) return nameCompare;
		return a.ip.localeCompare(b.ip);
	});

	return options;
}

export function reconcileWebTerminalBindings(
	bindings: WebTerminalBinding[],
	options: WebTerminalBindingOption[],
): { active: WebTerminalBindingOption[]; missing: WebTerminalBinding[] } {
	const optionMap = new Map(options.map(option => [bindingId(option), option]));
	const active: WebTerminalBindingOption[] = [];
	const missing: WebTerminalBinding[] = [];

	for (const binding of bindings) {
		const match = optionMap.get(bindingId(binding));
		if (match) {
			active.push(match);
		} else {
			missing.push(binding);
		}
	}

	return { active, missing };
}

export function resolveWebTerminalBindingsWithFallback(
	bindings: WebTerminalBinding[],
	options: WebTerminalBindingOption[],
): { active: WebTerminalBindingOption[]; missing: WebTerminalBinding[]; fallbackUsed: boolean } {
	const { active, missing } = reconcileWebTerminalBindings(bindings, options);
	if (active.length > 0) {
		return { active, missing, fallbackUsed: false };
	}

	const loopbacks = options.filter(option => option.isLoopback);
	if (loopbacks.length > 0) {
		return { active: loopbacks, missing, fallbackUsed: true };
	}

	const fallback = options[0] ? [options[0]] : [];
	return { active: fallback, missing, fallbackUsed: fallback.length > 0 };
}
