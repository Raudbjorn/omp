import { type Static, Type } from "@sinclair/typebox";

export const CommandChainFileSchema = Type.Object({
	description: Type.String(),
	steps: Type.Array(Type.String()),
});

export type CommandChainFile = Static<typeof CommandChainFileSchema>;
