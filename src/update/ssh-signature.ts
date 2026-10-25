/**
 * Minimal OpenSSH SSHSIG verification (`ssh-keygen -Y sign -n file-release`).
 *
 * This is deliberately self-contained: the updater must authenticate a
 * download without depending on `ssh-keygen` being installed, and checking a
 * signature with an external program would add a trust-boundary process. The
 * wire format is documented in OpenSSH's PROTOCOL.sshsig.
 */
import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";
import { UpdateError } from "./errors.js";

const MAGIC = Buffer.from("SSHSIG");
const ARMOR_BEGIN = "-----BEGIN SSH SIGNATURE-----";
const ARMOR_END = "-----END SSH SIGNATURE-----";

type Signature = {
  publicKey: Buffer;
  namespace: string;
  reserved: Buffer;
  hashAlgorithm: string;
  signatureAlgorithm: string;
  signature: Buffer;
};

class Reader {
  private offset = 0;

  constructor(private readonly buffer: Buffer) {}

  get done(): boolean {
    return this.offset === this.buffer.length;
  }

  uint32(): number {
    if (this.offset + 4 > this.buffer.length) throw new UpdateError("truncated SSH signature");
    const value = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  string(): Buffer {
    const length = this.uint32();
    if (this.offset + length > this.buffer.length) throw new UpdateError("truncated SSH signature");
    const value = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  bytes(length: number): Buffer {
    if (this.offset + length > this.buffer.length) throw new UpdateError("truncated SSH signature");
    const value = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  remaining(): Buffer {
    const value = this.buffer.subarray(this.offset);
    this.offset = this.buffer.length;
    return value;
  }
}

function encodeString(value: Buffer | string): Buffer {
  const body = typeof value === "string" ? Buffer.from(value) : value;
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  return Buffer.concat([length, body]);
}

function decodeArmor(raw: Buffer | string): Buffer {
  const text = typeof raw === "string" ? raw : raw.toString("utf8");
  const begin = text.indexOf(ARMOR_BEGIN);
  const end = text.indexOf(ARMOR_END);
  if (begin < 0 || end < 0 || end <= begin) {
    throw new UpdateError("release signature is not an armored SSH signature");
  }
  const body = text.slice(begin + ARMOR_BEGIN.length, end).replace(/\s+/g, "");
  try {
    return Buffer.from(body, "base64");
  } catch {
    throw new UpdateError("release signature has invalid base64");
  }
}

function parseSignature(raw: Buffer | string): Signature {
  const reader = new Reader(decodeArmor(raw));
  const magic = reader.bytes(6);
  if (!magic.equals(MAGIC)) throw new UpdateError("release signature has the wrong magic");
  if (reader.uint32() !== 1) throw new UpdateError("unsupported SSH signature version");

  const publicKey = reader.string();
  const namespace = reader.string().toString("utf8");
  const reserved = reader.string();
  const hashAlgorithm = reader.string().toString("utf8");
  const signatureBlob = new Reader(reader.string());
  const signatureAlgorithm = signatureBlob.string().toString("utf8");
  const signature = signatureBlob.string();
  if (!reader.done || !signatureBlob.done) {
    throw new UpdateError("release signature has trailing data");
  }
  return { publicKey, namespace, reserved, hashAlgorithm, signatureAlgorithm, signature };
}

type PublicKey = { algorithm: string; key: Buffer };

function decodePublicKey(blob: Buffer): PublicKey {
  const reader = new Reader(blob);
  const algorithm = reader.string().toString("utf8");
  const key = reader.string();
  if (!reader.done) throw new UpdateError("malformed SSH public key");
  return { algorithm, key };
}

function parseAuthorizedKey(line: string): PublicKey {
  const parts = line.trim().split(/\s+/);
  const keyIndex = parts.findIndex((part) => part.startsWith("ssh-"));
  if (keyIndex < 0 || keyIndex + 1 >= parts.length) {
    throw new UpdateError("malformed trusted release key");
  }
  const algorithm = parts[keyIndex];
  const blob = Buffer.from(parts[keyIndex + 1], "base64");
  const parsed = decodePublicKey(blob);
  if (parsed.algorithm !== algorithm) throw new UpdateError("trusted release key type mismatch");
  return parsed;
}

function toKeyObject(publicKey: PublicKey): KeyObject {
  if (publicKey.algorithm !== "ssh-ed25519") {
    throw new UpdateError(`unsupported release key type ${publicKey.algorithm}`);
  }
  return createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: publicKey.key.toString("base64url") },
    format: "jwk",
  });
}

export type VerifySshSignatureOptions = {
  message: Buffer | string;
  signature: Buffer | string;
  trustedKeys: readonly string[];
  namespace?: string;
};

/**
 * Verify `message` against an armored SSHSIG. Returns normally on success and
 * throws `UpdateError` on any structural, trust, or cryptographic failure.
 */
export function verifySshSignature(options: VerifySshSignatureOptions): void {
  const namespace = options.namespace ?? "file-release";
  const parsed = parseSignature(options.signature);
  if (parsed.namespace !== namespace) {
    throw new UpdateError(`release signature namespace is "${parsed.namespace}", want "${namespace}"`);
  }
  if (parsed.signatureAlgorithm !== "ssh-ed25519") {
    throw new UpdateError(`unsupported release signature type ${parsed.signatureAlgorithm}`);
  }
  if (parsed.hashAlgorithm !== "sha256" && parsed.hashAlgorithm !== "sha512") {
    throw new UpdateError(`unsupported release signature hash ${parsed.hashAlgorithm}`);
  }

  const signer = decodePublicKey(parsed.publicKey);
  const trusted = options.trustedKeys.some((line) => {
    const key = parseAuthorizedKey(line);
    return key.algorithm === signer.algorithm && key.key.equals(signer.key);
  });
  if (!trusted) throw new UpdateError("release signature was made by an untrusted key");

  const message = typeof options.message === "string" ? Buffer.from(options.message) : options.message;
  const digest = createHash(parsed.hashAlgorithm).update(message).digest();
  const signed = Buffer.concat([
    MAGIC,
    encodeString(namespace),
    encodeString(parsed.reserved),
    encodeString(parsed.hashAlgorithm),
    encodeString(digest),
  ]);

  try {
    if (!verify(null, signed, toKeyObject(signer), parsed.signature)) {
      throw new UpdateError("release signature does not match SHA256SUMS");
    }
  } catch (err) {
    if (err instanceof UpdateError) throw err;
    throw new UpdateError(`release signature verification failed: ${(err as Error).message}`);
  }
}
