import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { hslToHex, randomInt, realpathAllowMissing, repeat, trimEnd, trimStart } from "../utils";
import { withTempDir } from "./helpers/fixtures";

suite("utils", () =>
{
	test("trims one or more requested prefixes and suffixes", () =>
	{
		assert.equal(trimStart("<<value", "<"), "value");
		assert.equal(trimEnd("value.md.g", ".g", ".md"), "value");
	});

	test("uses injected randomness at inclusive bounds", () =>
	{
		assert.equal(randomInt(3, 7, () => 0), 3);
		assert.equal(randomInt(3, 7, () => .999999), 6);
	});

	test("converts primary HSL colors and repeats values", () =>
	{
		assert.equal(hslToHex(0, 100, 50), "ff0000");
		assert.deepEqual(repeat(3, i => i * 2), [0, 2, 4]);
		assert.deepEqual(repeat(2, "x"), ["x", "x"]);
	});

	test("resolves existing and missing child paths", async () => withTempDir(async dir =>
	{
		const child = path.join(dir, "child");
		await fs.mkdir(child);
		assert.equal(realpathAllowMissing(child), await fs.realpath(child));
		assert.equal(realpathAllowMissing(path.join(child, "missing.txt")), path.join(await fs.realpath(child), "missing.txt"));
	}));
});
