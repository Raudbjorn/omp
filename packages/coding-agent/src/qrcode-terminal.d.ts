declare module "qrcode-terminal" {
	export type GenerateCallback = (qrcode: string) => void;

	export interface GenerateOptions {
		small?: boolean;
	}

	export function generate(text: string, callback: GenerateCallback): void;
	export function generate(text: string, options: GenerateOptions, callback: GenerateCallback): void;

	const qrcode: {
		generate: typeof generate;
	};

	export default qrcode;
}
