import { describe, expect, it } from "vitest";
import { assertSafeEntry } from "../../src/update/archive.js";
import { checksumFor, parseChecksums, sha256, verifyChecksum } from "../../src/update/checksum.js";

describe("archive entry safety", () => {
	it("accepts regular files and directories under the declared root", () => {
		expect(assertSafeEntry("wze-websearch/dist/index.js", "File")).toBe("wze-websearch/dist/index.js");
		expect(assertSafeEntry("wze-websearch/", "Directory")).toBe("wze-websearch/");
	});

	it.each([
		["/etc/passwd", "File"],
		["C:/Windows/system32", "File"],
		["wze-websearch/../../etc/passwd", "File"],
		["other-root/file", "File"],
		["wze-websearch/link", "SymbolicLink"],
		["wze-websearch/hard", "Link"],
		["wze-websearch/\\\\server\\share", "File"],
	])("rejects %s", (path, type) => {
		expect(() => assertSafeEntry(path, type)).toThrow();
	});
});

describe("checksums", () => {
	const data = Buffer.from("artifact");
	const sum = sha256(data);

	it("parses sha256sum lines with binary markers", () => {
		expect(parseChecksums(`${sum}  a.tar.gz\n${sum} *b.tar.gz\n`)).toEqual([
			{ hash: sum, name: "a.tar.gz" },
			{ hash: sum, name: "b.tar.gz" },
		]);
		expect(checksumFor(`${sum}  a.tar.gz\n`, "a.tar.gz")).toBe(sum);
	});

	it("accepts matching bytes and rejects a mismatch or a missing entry", () => {
		expect(() => verifyChecksum(`${sum}  a.tar.gz\n`, "a.tar.gz", data)).not.toThrow();
		expect(() => verifyChecksum(`${sum}  a.tar.gz\n`, "a.tar.gz", Buffer.from("other"))).toThrow(
			/checksum mismatch/,
		);
		expect(() => verifyChecksum(`${sum}  a.tar.gz\n`, "b.tar.gz", data)).toThrow(/no entry/);
	});
});
