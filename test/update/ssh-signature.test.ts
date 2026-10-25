import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verifySshSignature } from "../../src/update/ssh-signature.js";

const fixtures = join(__dirname, "..", "fixtures");
const message = readFileSync(join(fixtures, "SHA256SUMS"));
const signature = readFileSync(join(fixtures, "SHA256SUMS.sig"));
const trusted = [readFileSync(join(fixtures, "allowed_signers"), "utf8").trim()];

describe("verifySshSignature", () => {
	it("accepts a signature from a pinned key", () => {
		expect(() => verifySshSignature({ message, signature, trustedKeys: trusted })).not.toThrow();
	});

	it("rejects a tampered message", () => {
		expect(() =>
			verifySshSignature({
				message: Buffer.concat([message, Buffer.from("x")]),
				signature,
				trustedKeys: trusted,
			}),
		).toThrow(/does not match/);
	});

	it("rejects a key that is not pinned", () => {
		expect(() =>
			verifySshSignature({
				message,
				signature,
				trustedKeys: ["ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA other"],
			}),
		).toThrow(/untrusted key/);
	});

	it("rejects malformed armor and namespaces", () => {
		expect(() => verifySshSignature({ message, signature: "nope", trustedKeys: trusted })).toThrow(
			/not an armored/,
		);
		expect(() =>
			verifySshSignature({ message, signature, trustedKeys: trusted, namespace: "other" }),
		).toThrow(/namespace/);
	});
});
