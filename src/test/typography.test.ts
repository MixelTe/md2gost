import * as assert from "node:assert/strict";
import { Doc, NBSP_GROUPS, type NbspGroups, type Rune } from "../doc";
import { formatTypography, parseMD, runifyDoc } from "../parser";
import { transformProse } from "../inline";
import { withTempDir, writeMarkdown } from "./helpers/fixtures";

function runes(text: string, doc = new Doc())
{
	doc.appendText(text, 1);
	return (runifyDoc(doc).nodes[0] as any).text as Rune[];
}

suite("literal text and typography controls", () =>
{
	test("keeps escaped markup literal while ordinary references and formatting work", () =>
	{
		const result = runes(String.raw`\_ \[sd] \*literal\* \# Heading \\ [sd] **bold**`);
		assert.equal(result.filter(r => r.type == "ref").length, 1);
		assert.equal(result.find(r => r.type == "ref")?.text, "sd");
		assert.ok(result.map(r => r.text).join("").startsWith("_ [sd] *literal* # Heading \\"));
		assert.ok(result.some(r => r.text == "bold" && r.bold));
		assert.equal(result.some(r => r.text.includes("literal") && r.italic), false);
	});

	test("handles odd/even backslashes and leaves code and formula contents intact", () =>
	{
		const result = runes(String.raw`\\[id] \\\[literal] \$` + " \\");
		assert.equal(result.filter(r => r.type == "ref").length, 1);
		assert.ok(result.map(r => r.text).join("").includes("\\[literal]"));
		const protectedRuns = runes("`в UTF-8 \\_ [id]` $x_i \\text{a-b}$");
		assert.equal(protectedRuns.find(r => r.mono)?.text, String.raw`в UTF-8 \_ [id]`);
		assert.equal(protectedRuns.find(r => r.type == "math")?.text, String.raw`x_i \text{a-b}`);
	});

	test("preserves visible URLs and destinations, including balanced parentheses", () =>
	{
		const url = "https://example.test/foo-bar/UTF-8/(part)?a=1&b=2#some-anchor";
		const result = runes(`${url} [${url}](${url}) [в тексте](<../foo-bar—baz.docx>) <${url}>`);
		assert.equal(result.filter(r => r.link == url).length, 1);
		assert.ok(result.some(r => r.link == url && r.text == url));
		assert.ok(result.some(r => r.link == "../foo-bar—baz.docx" && r.text == "в\u00a0тексте"));
		assert.ok(result.map(r => r.text).join("").includes(url));
		assert.equal(result.filter(r => !!r.link).length, 2);
	});

	test("formatter protects addresses and inline code while formatting prose", () =>
	{
		const input = "Текст — [подпись — текст](https://example.test/a—b) https://example.test/a—b `a—b`";
		assert.equal(transformProse(input, text => text.replaceAll("—", "–")), "Текст – [подпись – текст](https://example.test/a—b) https://example.test/a—b `a—b`");
	});

	test("formatter matches entire backtick runs and respects escaped openers", () =>
	{
		const change = (text: string) => transformProse(text, value => value.replaceAll("—", "–"));
		assert.equal(change("Before — `one `` A—B` after —"), "Before – `one `` A—B` after –");
		assert.equal(change("Before — ``one ``` A—B`` after —"), "Before – ``one ``` A—B`` after –");
		assert.equal(change("\\`A—B`"), "\\`A–B`");
		assert.equal(change("Unclosed ` A—B"), "Unclosed ` A–B");
	});

	const samples = {
		short_words: "для работы", references: "рисунок 12", abbreviations: "№ 12", standards: "ГОСТ Р 123",
		addresses: "ул. Ленина", years: "2026 г.", initials: "А. С. Пушкин", units: "10 кг",
	};
	for (const group of NBSP_GROUPS)
		test(`controls the ${group} group independently`, () =>
		{
			const disabled = Object.fromEntries(NBSP_GROUPS.map(key => [key, false])) as NbspGroups;
			assert.equal(formatTypography(samples[group], disabled), samples[group]);
			disabled[group] = true;
			assert.ok(formatTypography(samples[group], disabled).includes("\u00a0"));
		});

	test("applies global and group rules in document order and preserves explicit NBSP", async () => withTempDir(async dir =>
	{
		const doc = await parseMD(await writeMarkdown(dir, "!!rule typography nbsp off\n!!rule typography nbsp units on\n\nдля работы 10 кг рисунок [id] X&nbsp;Y A\u00a0B"));
		assert.equal(doc.typography.nbsp.units, true);
		assert.equal(doc.typography.nbsp.references, false);
		const text = (runifyDoc(doc).nodes[0] as any).text.map((r: any) => r.text).join("");
		assert.equal(text, "для работы 10\u00a0кг рисунок id X\u00a0Y A\u00a0B");
		const other = await parseMD(await writeMarkdown(dir, "!!rule typography nbsp units off\n!!rule typography nbsp on"));
		assert.ok(NBSP_GROUPS.every(key => other.typography.nbsp[key]));
	}));

	test("reference group also controls the automatic space before reference and value runes", () =>
	{
		const doc = new Doc();
		doc.typography.nbsp.references = false;
		assert.equal(runes("объект [id] всего [!pages]", doc)[0]?.text, "объект ");
		assert.equal(runes("объект [id]")[0]?.text, "объект\u00a0");
	});

	test("validates new rule values without changing previous settings", async () => withTempDir(async dir =>
	{
		const warnings: string[] = [];
		const doc = await parseMD(await writeMarkdown(dir, "!!rule typography nbsp units no\n!!rule link color nope\n!!rule link underline no"), undefined, {}, false, null, w => warnings.push(w));
		assert.equal(warnings.length, 3);
		assert.deepEqual(doc.link, { color: "0563c1", underline: true });
		assert.ok(doc.typography.nbsp.units);
	}));
});
