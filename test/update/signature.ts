import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";

function encodeString(value: Buffer | string): Buffer {
	const body = typeof value === "string" ? Buffer.from(value) : value;
	const length = Buffer.alloc(4);
	length.writeUInt32BE(body.length);
	return Buffer.concat([length, body]);
}

export type TestSigner = {
	trustedLine: string;
	sign: (message: Buffer | string) => string;
};

/**
 * Generate a throwaway Ed25519 key and produce SSHSIG envelopes in the same
 * format as `ssh-keygen -Y sign -n file-release`, so updater tests need no
 * external signing binary.
 */
export function makeTestSigner(): TestSigner {
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	const jwk = publicKey.export({ format: "jwk" }) as { x: string };
	const raw = Buffer.from(jwk.x, "base64url");
	const publicBlob = Buffer.concat([encodeString("ssh-ed25519"), encodeString(raw)]);
	const trustedLine = `ssh-ed25519 ${publicBlob.toString("base64")} test`;

	return {
		trustedLine,
		sign(message) {
			const body = typeof message === "string" ? Buffer.from(message) : message;
			const digest = createHash("sha256").update(body).digest();
			const signed = Buffer.concat([
				Buffer.from("SSHSIG"),
				encodeString("file-release"),
				encodeString(""),
				encodeString("sha256"),
				encodeString(digest),
			]);
			const signature = sign(null, signed, privateKey as KeyObject);
			const signatureBlob = Buffer.concat([encodeString("ssh-ed25519"), encodeString(signature)]);
			const envelope = Buffer.concat([
				Buffer.from("SSHSIG"),
				Buffer.from([0, 0, 0, 1]),
				encodeString(publicBlob),
				encodeString("file-release"),
				encodeString(""),
				encodeString("sha256"),
				encodeString(signatureBlob),
			]);
			return `-----BEGIN SSH SIGNATURE-----\n${envelope.toString("base64")}\n-----END SSH SIGNATURE-----\n`;
		},
	};
}
