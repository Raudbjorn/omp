/**
 * Check if response contains real verification evidence.
 * Matches output patterns from bun test, git diff, typecheck, build.
 */
export function hasVerificationEvidence(text: string): boolean {
	// bun test summary: "N pass", "N fail"
	if (/\d+\s+(pass|fail)/i.test(text)) return true;
	// bun test checkmarks
	if (/[✓×]/.test(text)) return true;
	// TypeScript errors: "error TS1234:"
	if (/error TS\d+/i.test(text)) return true;
	// git diff hunk headers: "@@ -1,5 +1,6 @@"
	if (/^@@ -\d+,\d+ \+\d+,\d+ @@/m.test(text)) return true;
	// diff line changes: lines starting with +/- (excluding file headers)
	if (/^[+-](?!$)(?!\+(?!$)|-(?!$)|\+\+|--)/m.test(text)) return true;
	// Build status
	if (/build (succeeded|failed)/i.test(text)) return true;
	return false;
}
