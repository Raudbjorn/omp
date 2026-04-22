import * as crypto from "node:crypto";
import { isEnoent } from "@oh-my-pi/pi-utils";
import { getManagedPolicyPublicKeyPath, getManagedPolicySignaturePath } from "./policy-paths";
import type { ManagedPolicyFileSource, ManagedPolicyVerification, PolicyIssue } from "./types";

export interface VerifyManagedPolicySignatureInput {
	readonly filePath: string;
	readonly source: ManagedPolicyFileSource;
	readonly text: string;
}

export interface VerifyManagedPolicySignatureResult {
	readonly verification: ManagedPolicyVerification;
	readonly issues: readonly PolicyIssue[];
}

export async function verifyManagedPolicySignature(
	input: VerifyManagedPolicySignatureInput,
): Promise<VerifyManagedPolicySignatureResult> {
	const signaturePath = getManagedPolicySignaturePath(input.filePath);
	const publicKeyPath = getManagedPolicyPublicKeyPath(input.filePath);
	const signatureText = await readOptionalText(signaturePath);
	const publicKeyText = await readOptionalText(publicKeyPath);
	const signatureRequired = input.source === "system";

	if (signatureText === null && publicKeyText === null && !signatureRequired) {
		return {
			verification: {
				status: "not-required",
				signaturePath,
				publicKeyPath,
			},
			issues: [],
		};
	}

	if (signatureText === null) {
		return createFailure(
			"signature-missing",
			"Managed policy signature file is missing",
			signaturePath,
			publicKeyPath,
		);
	}

	if (publicKeyText === null) {
		return createFailure(
			"public-key-missing",
			"Managed policy public key file is missing",
			signaturePath,
			publicKeyPath,
		);
	}

	let publicKey: crypto.KeyObject;
	try {
		publicKey = crypto.createPublicKey(publicKeyText);
	} catch (error) {
		return createFailure(
			"public-key-invalid",
			`Managed policy public key could not be parsed: ${String(error)}`,
			signaturePath,
			publicKeyPath,
		);
	}

	if (publicKey.asymmetricKeyType !== "ed25519") {
		return createFailure(
			"public-key-invalid",
			`Managed policy public key must be ed25519, got ${publicKey.asymmetricKeyType ?? "unknown"}`,
			signaturePath,
			publicKeyPath,
		);
	}

	let signature: Buffer;
	try {
		signature = decodeSignature(signatureText);
	} catch (error) {
		return createFailure(
			"signature-invalid",
			`Managed policy signature could not be decoded: ${String(error)}`,
			signaturePath,
			publicKeyPath,
		);
	}

	const verified = crypto.verify(null, Buffer.from(input.text, "utf8"), publicKey, signature);
	if (!verified) {
		return createFailure(
			"signature-invalid",
			"Managed policy signature verification failed",
			signaturePath,
			publicKeyPath,
		);
	}

	return {
		verification: {
			status: "verified",
			signaturePath,
			publicKeyPath,
		},
		issues: [],
	};
}

async function readOptionalText(filePath: string): Promise<string | null> {
	try {
		return await Bun.file(filePath).text();
	} catch (error) {
		if (isEnoent(error)) return null;
		throw error;
	}
}

function decodeSignature(text: string): Buffer {
	const normalized = text.replace(/\s+/g, "").trim();
	if (normalized.length === 0) {
		throw new Error("signature file is empty");
	}
	const buffer = Buffer.from(normalized, "base64");
	if (buffer.length === 0) {
		throw new Error("signature file is not valid base64");
	}
	return buffer;
}

function createFailure(
	code: Extract<
		PolicyIssue["code"],
		"signature-missing" | "signature-invalid" | "public-key-missing" | "public-key-invalid"
	>,
	message: string,
	signaturePath: string,
	publicKeyPath: string,
): VerifyManagedPolicySignatureResult {
	return {
		verification: {
			status: code,
			signaturePath,
			publicKeyPath,
			message,
		},
		issues: [{ code, message, path: code.startsWith("public-key") ? publicKeyPath : signaturePath }],
	};
}
