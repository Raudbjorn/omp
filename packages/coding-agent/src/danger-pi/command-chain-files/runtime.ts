import type { AssistantMessage, ImageContent } from "@oh-my-pi/pi-ai";
import { renderPromptTemplate } from "../../config/prompt-templates";
import { parseCommandArgs, substituteArgs } from "../../utils/command-args";

export type PromptChainStreamingBehavior = "followUp" | "steer";

interface PromptChainDispatchOptions {
	streamingBehavior?: PromptChainStreamingBehavior;
	images?: readonly ImageContent[];
}

export interface PromptChainTurnResult {
	stopReason: AssistantMessage["stopReason"];
	success: boolean;
}

export interface PromptChainRuntimeHost {
	onTurnComplete(handler: (result: PromptChainTurnResult) => Promise<void>): void;
	prompt(text: string, options?: PromptChainDispatchOptions): Promise<void>;
}

export interface PromptChainExecutor {
	execute(
		commandName: string,
		stepTemplates: readonly string[],
		argsString: string,
		options?: PromptChainDispatchOptions,
	): Promise<void>;
}

type QueuedChainState = {
	commandName: string;
	stepTemplates: readonly string[];
	args: string[];
	nextStepIndex: number;
	activeStepIndex?: number;
	firstStepImages?: readonly ImageContent[];
};

export function renderPromptChainStep(template: string, args: readonly string[]): string {
	const argsText = args.join(" ");
	const substituted = substituteArgs(template, [...args]);
	return renderPromptTemplate(substituted, {
		args: [...args],
		ARGUMENTS: argsText,
		arguments: argsText,
	});
}

export function createPromptChainExecutor(host: PromptChainRuntimeHost): PromptChainExecutor {
	const queue: QueuedChainState[] = [];
	let listenerInstalled = false;

	const clearQueue = (): void => {
		queue.length = 0;
	};

	const removeFinishedChains = (): void => {
		while (
			queue[0] &&
			queue[0].activeStepIndex === undefined &&
			queue[0].nextStepIndex >= queue[0].stepTemplates.length
		) {
			queue.shift();
		}
	};

	const completeCurrentStep = (result: PromptChainTurnResult): void => {
		const chain = queue[0];
		if (!chain || chain.activeStepIndex === undefined) {
			return;
		}

		const completedStepIndex = chain.activeStepIndex;
		chain.activeStepIndex = undefined;
		if (!result.success) {
			return;
		}

		chain.nextStepIndex = completedStepIndex + 1;
	};

	const dispatchCurrentStep = async (chain: QueuedChainState, options?: PromptChainDispatchOptions): Promise<void> => {
		if (chain.activeStepIndex !== undefined) {
			return;
		}
		const stepIndex = chain.nextStepIndex;
		const template = chain.stepTemplates[stepIndex];
		if (template === undefined) {
			return;
		}
		const rendered = renderPromptChainStep(template, chain.args);
		chain.activeStepIndex = stepIndex;
		const images = stepIndex === 0 ? chain.firstStepImages : undefined;
		const dispatchOptions =
			options?.streamingBehavior === undefined && images === undefined
				? undefined
				: { streamingBehavior: options?.streamingBehavior, images };
		try {
			await host.prompt(rendered, dispatchOptions);
		} catch (error) {
			chain.activeStepIndex = undefined;
			throw error;
		}
	};

	const ensureListener = (): void => {
		if (listenerInstalled) {
			return;
		}
		listenerInstalled = true;
		host.onTurnComplete(async result => {
			const hadActiveStep = queue[0]?.activeStepIndex !== undefined;
			if (!result.success && hadActiveStep) {
				clearQueue();
				return;
			}
			completeCurrentStep(result);
			removeFinishedChains();
			const chain = queue[0];
			if (!chain) {
				return;
			}
			await dispatchCurrentStep(chain, { streamingBehavior: "followUp" });
			removeFinishedChains();
		});
	};

	return {
		async execute(
			commandName: string,
			stepTemplates: readonly string[],
			argsString: string,
			options?: PromptChainDispatchOptions,
		): Promise<void> {
			if (stepTemplates.length === 0) {
				return;
			}
			ensureListener();
			removeFinishedChains();

			const chain: QueuedChainState = {
				commandName,
				stepTemplates,
				args: parseCommandArgs(argsString),
				nextStepIndex: 0,
				firstStepImages: options?.images,
			};
			const shouldKickOffImmediately = queue.length === 0;
			queue.push(chain);
			if (!shouldKickOffImmediately) {
				return;
			}
			try {
				await dispatchCurrentStep(chain, options);
			} catch (error) {
				if (queue[0] === chain && chain.activeStepIndex === undefined && chain.nextStepIndex === 0) {
					queue.shift();
				}
				throw error;
			}
		},
	};
}
