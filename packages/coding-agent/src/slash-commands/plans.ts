import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getPlansDir, isEnoent } from "@oh-my-pi/pi-utils";

export interface PlanEntry {
	readonly id: string;
	readonly title: string;
	readonly path: string;
	readonly modified: Date;
	readonly size: number;
}

const PLAN_FILE_EXT = ".md";
const MAX_TITLE_SCAN_LINES = 5;
const MAX_TITLE_LEN = 80;

async function readTitleFromFile(filePath: string, fallback: string): Promise<string> {
	try {
		const contents = await fs.readFile(filePath, { encoding: "utf8" });
		const lines = contents.split("\n", MAX_TITLE_SCAN_LINES);
		for (const raw of lines) {
			const line = raw.trim();
			if (line.startsWith("# Plan: ")) return line.slice("# Plan: ".length).slice(0, MAX_TITLE_LEN);
			if (line.startsWith("# ")) return line.slice(2).slice(0, MAX_TITLE_LEN);
		}
		return fallback;
	} catch {
		return fallback;
	}
}

export async function loadPlans(plansDir: string = getPlansDir()): Promise<PlanEntry[]> {
	let entries: string[];
	try {
		entries = await fs.readdir(plansDir);
	} catch (err) {
		if (isEnoent(err)) return [];
		throw err;
	}

	const plans: PlanEntry[] = [];
	for (const entry of entries) {
		if (!entry.endsWith(PLAN_FILE_EXT)) continue;
		const fullPath = path.join(plansDir, entry);
		let stat: Awaited<ReturnType<typeof fs.stat>>;
		try {
			stat = await fs.stat(fullPath);
		} catch (err) {
			if (isEnoent(err)) continue;
			throw err;
		}
		if (!stat.isFile()) continue;
		const id = entry.slice(0, -PLAN_FILE_EXT.length);
		const title = await readTitleFromFile(fullPath, id);
		plans.push({ id, title, path: fullPath, modified: stat.mtime, size: stat.size });
	}

	plans.sort((a, b) => b.modified.getTime() - a.modified.getTime());
	return plans;
}

function formatRelative(date: Date, now: Date = new Date()): string {
	const diffMs = now.getTime() - date.getTime();
	const mins = Math.floor(diffMs / 60_000);
	const hours = Math.floor(diffMs / 3_600_000);
	const days = Math.floor(diffMs / 86_400_000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	if (hours < 24) return `${hours}h ago`;
	if (days === 1) return "1d ago";
	if (days < 7) return `${days}d ago`;
	return date.toISOString().slice(0, 10);
}

export function formatPlansList(plans: readonly PlanEntry[]): string {
	if (plans.length === 0) {
		return `No saved plans. Drop plan files into ${getPlansDir()}/ (*.md).`;
	}
	const lines = [`Saved plans (${plans.length}):`];
	plans.forEach((plan, i) => {
		const idx = `${i + 1}`.padStart(2, " ");
		lines.push(`  ${idx}. ${plan.title}   ${formatRelative(plan.modified)}`);
		if (plan.title !== plan.id) lines.push(`      id: ${plan.id}`);
	});
	lines.push("");
	lines.push("Usage: /plans load <n|id> | /plans delete <n|id> | /plans show <n|id>");
	return lines.join("\n");
}

export function resolvePlanArg(plans: readonly PlanEntry[], arg: string): PlanEntry | null {
	const trimmed = arg.trim();
	if (!trimmed) return null;
	const asIndex = Number.parseInt(trimmed, 10);
	if (Number.isFinite(asIndex) && String(asIndex) === trimmed && asIndex >= 1 && asIndex <= plans.length) {
		return plans[asIndex - 1] ?? null;
	}
	return plans.find(p => p.id === trimmed) ?? null;
}

export async function deletePlanFile(plan: PlanEntry): Promise<void> {
	await fs.unlink(plan.path);
}

export async function readPlanContents(plan: PlanEntry): Promise<string> {
	return fs.readFile(plan.path, { encoding: "utf8" });
}
